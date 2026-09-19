\set ON_ERROR_STOP on
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create role supabase_admin nologin bypassrls;
create schema auth;

create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
create or replace function auth.jwt() returns jsonb language sql stable as $$
  select jsonb_build_object(
    'sub', current_setting('request.jwt.claim.sub', true),
    'aal', coalesce(nullif(current_setting('request.jwt.claim.aal', true), ''), 'aal1')
  );
$$;
grant usage on schema auth to authenticated, service_role;
grant execute on function auth.uid() to authenticated, service_role;
grant execute on function auth.jwt() to authenticated, service_role;

create type public.location_role as enum ('DOCTOR','RECEPTIONIST','LOCATION_ADMIN');
create type public.member_status as enum ('INVITED','ACTIVE','SUSPENDED');
create type public.appointment_status as enum ('SCHEDULED','CONFIRMED','ARRIVED','IN_CONSULTATION','COMPLETED','CANCELLED','NO_SHOW');
create type public.appointment_event_type as enum ('CREATED','CONFIRMED','RESCHEDULED','ARRIVED','CONSULTATION_STARTED','COMPLETED','CANCELLED','NO_SHOW');
create type public.cancellation_reason as enum ('PATIENT_REQUEST','PATIENT_UNWELL','DOCTOR_UNAVAILABLE','RESCHEDULED','DUPLICATE','OTHER');
create type public.visit_type as enum ('NEW','FOLLOW_UP','REPORT_REVIEW','PROCEDURE','EMERGENCY');
create type public.encounter_status as enum ('DRAFT','COMPLETED','CANCELLED');
create type public.document_type as enum ('LAB_REPORT','IMAGING_REPORT','PREVIOUS_PRESCRIPTION','DISCHARGE_SUMMARY','REFERRAL','MEDICAL_CERTIFICATE','OTHER');
create type public.priority_reason as enum ('EMERGENCY','ELDERLY','CHILD','PREGNANT','DISABILITY','UNWELL_WAITING','DOCTOR_INSTRUCTION','STAFF_OR_FAMILY','OTHER');
create type public.queue_event_type as enum ('CALLED','SKIPPED','RECALLED','PRIORITY_SET','PRIORITY_CLEARED');

create table public.profiles (
  id uuid primary key,
  full_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.doctor_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.practice_locations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  timezone text not null default 'Asia/Dhaka',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.practice_location_members (
  id uuid primary key default gen_random_uuid(),
  practice_location_id uuid not null references public.practice_locations(id),
  user_id uuid not null references public.profiles(id),
  role public.location_role not null,
  status public.member_status not null default 'ACTIVE',
  invited_by uuid references public.profiles(id),
  joined_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (practice_location_id, user_id, role)
);
create table public.doctor_chambers (
  id uuid primary key default gen_random_uuid(),
  doctor_profile_id uuid not null references public.doctor_profiles(id),
  practice_location_id uuid not null references public.practice_locations(id),
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (doctor_profile_id, practice_location_id)
);
create table public.patients (
  id uuid primary key default gen_random_uuid(),
  owner_doctor_id uuid not null references public.doctor_profiles(id),
  patient_number text not null,
  full_name text not null,
  name_normalized text not null,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create table public.patient_location_links (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id),
  practice_location_id uuid not null references public.practice_locations(id),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (patient_id, practice_location_id)
);
create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  owner_doctor_id uuid not null references public.doctor_profiles(id),
  practice_location_id uuid not null references public.practice_locations(id),
  patient_id uuid not null references public.patients(id),
  scheduled_for timestamptz not null,
  duration_minutes integer not null default 15,
  visit_type public.visit_type not null default 'NEW',
  status public.appointment_status not null default 'SCHEDULED',
  reason text,
  token_number integer,
  arrived_at timestamptz,
  consultation_started_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  cancellation_reason public.cancellation_reason,
  cancellation_note text,
  rescheduled_from_id uuid references public.appointments(id),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  session_date date not null,
  booking_source text not null default 'INTERNAL',
  public_booking_ref uuid
);
create table public.appointment_events (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references public.appointments(id),
  practice_location_id uuid not null references public.practice_locations(id),
  event_type public.appointment_event_type not null,
  from_status public.appointment_status,
  to_status public.appointment_status,
  actor_id uuid references public.profiles(id),
  note text,
  created_at timestamptz not null default clock_timestamp(),
  seq bigserial not null
);
create table public.queue_entries (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null unique references public.appointments(id),
  practice_location_id uuid not null references public.practice_locations(id),
  session_date date not null,
  called_at timestamptz,
  call_count integer not null default 0,
  skipped_at timestamptz,
  skip_count integer not null default 0,
  priority integer not null default 0,
  priority_reason public.priority_reason,
  priority_note text,
  priority_set_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.queue_events (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references public.appointments(id),
  practice_location_id uuid not null references public.practice_locations(id),
  event_type public.queue_event_type not null,
  reason public.priority_reason,
  note text,
  actor_id uuid references public.profiles(id),
  created_at timestamptz not null default clock_timestamp(),
  seq bigserial not null
);
create table public.encounters (
  id uuid primary key default gen_random_uuid(),
  owner_doctor_id uuid not null references public.doctor_profiles(id),
  patient_id uuid not null references public.patients(id),
  practice_location_id uuid not null references public.practice_locations(id),
  appointment_id uuid references public.appointments(id),
  status public.encounter_status not null default 'DRAFT',
  vital_height_cm numeric,
  vital_weight_kg numeric,
  vital_temperature_c numeric,
  vital_pulse_bpm integer,
  vital_systolic integer,
  vital_diastolic integer,
  vital_resp_rate integer,
  vital_spo2 integer,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.patient_documents (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id),
  owner_doctor_id uuid not null references public.doctor_profiles(id),
  practice_location_id uuid not null references public.practice_locations(id),
  encounter_id uuid references public.encounters(id),
  document_type public.document_type not null default 'OTHER',
  title text not null,
  document_date date,
  notes text,
  storage_path text not null,
  mime_type text not null,
  size_bytes integer not null,
  original_filename text not null,
  uploaded_by uuid references public.profiles(id),
  archived_at timestamptz,
  archived_by uuid references public.profiles(id),
  archive_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  practice_location_id uuid references public.practice_locations(id),
  actor_id uuid references public.profiles(id),
  action text not null,
  resource_type text not null,
  resource_id uuid,
  ip text,
  user_agent text,
  meta jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);
create table public.appointment_token_counters (
  practice_location_id uuid not null references public.practice_locations(id),
  session_date date not null,
  last_token integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (practice_location_id, session_date)
);
create table public.encounter_diagnoses (
  id uuid primary key default gen_random_uuid(),
  encounter_id uuid not null references public.encounters(id),
  diagnosis text not null
);
create table public.encounter_investigations (
  id uuid primary key default gen_random_uuid(),
  encounter_id uuid not null references public.encounters(id),
  investigation text not null
);
create table public.prescriptions (
  id uuid primary key default gen_random_uuid(),
  encounter_id uuid not null references public.encounters(id),
  owner_doctor_id uuid not null references public.doctor_profiles(id)
);

create or replace function public.current_doctor_id() returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select d.id from public.doctor_profiles d where d.user_id = auth.uid() limit 1;
$$;
create or replace function public.session_is_aal2() returns boolean
language sql stable set search_path = pg_catalog, public as $$
  select coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2';
$$;
create or replace function public.require_aal2() returns void
language plpgsql stable set search_path = pg_catalog, public as $$
begin
  if not public.session_is_aal2() then raise exception 'AAL2_REQUIRED' using errcode='42501'; end if;
end;
$$;
create or replace function public.doctor_practises_at(target_doctor uuid, target_location uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.doctor_profiles d
    join public.practice_location_members m on m.user_id=d.user_id
    where d.id=target_doctor and m.practice_location_id=target_location
      and m.role='DOCTOR' and m.status='ACTIVE'
  );
$$;
create or replace function public.session_date_for(target_location uuid, at timestamptz) returns date
language sql stable security definer set search_path = public, pg_temp as $$
  select (at at time zone coalesce(
    (select l.timezone from public.practice_locations l where l.id=target_location),
    'Asia/Dhaka'))::date;
$$;
create or replace function public.allocate_token(target_location uuid, target_session date) returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_token integer;
begin
  insert into public.appointment_token_counters(practice_location_id,session_date,last_token)
  values(target_location,target_session,1)
  on conflict(practice_location_id,session_date) do update
    set last_token=public.appointment_token_counters.last_token+1, updated_at=now()
  returning last_token into v_token;
  return v_token;
end;
$$;
create or replace function public.appointment_transition_allowed(from_status public.appointment_status, to_status public.appointment_status) returns boolean
language sql immutable as $$
  select case from_status
    when 'SCHEDULED' then to_status in ('CONFIRMED','ARRIVED','CANCELLED','NO_SHOW')
    when 'CONFIRMED' then to_status in ('ARRIVED','CANCELLED','NO_SHOW')
    when 'ARRIVED' then to_status in ('IN_CONSULTATION','CANCELLED','NO_SHOW')
    when 'IN_CONSULTATION' then to_status in ('COMPLETED','CANCELLED')
    else false end;
$$;

grant usage on schema public to authenticated, service_role;
grant select on public.doctor_profiles, public.practice_locations, public.practice_location_members,
  public.doctor_chambers, public.patients, public.patient_location_links, public.appointments,
  public.queue_entries, public.audit_events to authenticated;
grant select on public.encounter_diagnoses, public.encounter_investigations to authenticated;
revoke insert, update, delete on public.encounter_diagnoses, public.encounter_investigations from authenticated;
revoke all on public.patient_documents, public.encounters, public.appointment_events,
  public.queue_events, public.appointment_token_counters, public.prescriptions from authenticated, anon;
revoke all on all tables in schema public from anon;

alter table public.doctor_chambers enable row level security;
alter table public.doctor_chambers force row level security;
alter table public.patients enable row level security;
alter table public.patients force row level security;
alter table public.appointments enable row level security;
alter table public.appointments force row level security;
alter table public.queue_entries enable row level security;
alter table public.queue_entries force row level security;
alter table public.audit_events enable row level security;
alter table public.audit_events force row level security;

create policy doctor_chambers_select_owner on public.doctor_chambers for select to authenticated
  using (doctor_profile_id = public.current_doctor_id());
create policy patients_select_owner on public.patients for select to authenticated
  using (owner_doctor_id = public.current_doctor_id());
create policy appointments_select_owner on public.appointments for select to authenticated
  using (owner_doctor_id = public.current_doctor_id());
create policy queue_entries_select_owner on public.queue_entries for select to authenticated
  using (exists (select 1 from public.appointments a
                where a.id=queue_entries.appointment_id and a.owner_doctor_id=public.current_doctor_id()));
create policy audit_events_select_actor on public.audit_events for select to authenticated
  using (actor_id = auth.uid());
