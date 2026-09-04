-- Doctor's Diary Database V2, P0 baseline. Rev 4.3.2f.
-- This file is the only P0 schema authority. No P1+ tables belong here.
create extension if not exists pgcrypto;

create type profession as enum ('DOCTOR','DENTIST','MEDICAL_STUDENT','NURSE','PHYSIOTHERAPIST','OTHER');
create type credential_status as enum ('UNVERIFIED','PENDING','NEEDS_INFORMATION','VERIFIED','REJECTED','EXPIRED','SUSPENDED','REVOKED');
create type credential_source as enum ('SELF_ASSERTED','STAFF_VERIFIED','REGULATOR_IMPORT');
create type capability as enum ('PUBLIC','MEDICAL_STUDENT','DOCTOR');
create type location_type as enum ('PERSONAL_CHAMBER','CLINIC','HOSPITAL','HOSPITAL_DEPARTMENT','DIAGNOSTIC_CENTRE','TELEMEDICINE','OTHER');
create type practice_role as enum ('DOCTOR','RECEPTIONIST','LOCATION_ADMIN','PRACTICE_MANAGER');
create type subject_kind as enum ('SELF','DEPENDENT');
create type subject_status as enum ('ACTIVE','MERGED','DECEASED','LOCKED');
create type subject_authority as enum ('SELF','GUARDIAN','CARE_MANAGER');
create type actor_kind as enum ('USER','PLATFORM_STAFF','SERVICE_AGENT','SYSTEM');
create type consent_grantee_kind as enum ('DOCTOR','ORGANIZATION','PLATFORM_STAFF_ROLE','SERVICE_AGENT','PLATFORM');
create type consent_type as enum ('CLINICAL_LINK','DOCUMENT_SHARE','CROSS_DOCTOR_REFERRAL','SUPPORT_CONTEXT','MARKETING_CONTACT');
create type encounter_status as enum ('DRAFT','COMPLETED','CANCELLED');
create type prescription_status as enum ('DRAFT','FINALIZED','VOIDED');
create type appointment_status as enum ('SCHEDULED','CONFIRMED','ARRIVED','IN_CONSULTATION','COMPLETED','CANCELLED','NO_SHOW');
create type appointment_source as enum ('INTERNAL','DOCTOR','RECEPTIONIST','ASSISTANT','WALK_IN','PUBLIC_WEB','PUBLIC_APP','SUPPORT_ASSISTED');
create type appointment_mode as enum ('IN_PERSON','ONLINE','HOME_VISIT');
create type metric_period_kind as enum ('DAY','MONTH');

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null check (length(full_name) between 1 and 200),
  phone_raw text, phone_e164 text check (phone_e164 is null or phone_e164 ~ '^[+][1-9][0-9]{1,14}$'),
  phone_country_hint text check (phone_country_hint is null or phone_country_hint ~ '^[A-Z]{2}$'),
  locale text not null default 'en', primary_language text, timezone text,
  avatar_path text, onboarded_at timestamptz, deactivated_at timestamptz,
  created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp()
);

create table regulators (
  id uuid primary key default gen_random_uuid(), country_code text not null check (country_code ~ '^[A-Z]{2}$'),
  authority_code text not null, authority_name text not null, number_format_hint text,
  is_active boolean not null default true, unique(country_code, authority_code), unique(id, country_code)
);
create table regulator_professions (
  regulator_id uuid not null references regulators(id) on delete restrict,
  profession profession not null, registers_from date, registers_until date,
  primary key (regulator_id, profession)
);
create table professional_profiles (
  id uuid primary key default gen_random_uuid(), profile_id uuid not null unique references profiles(id) on delete restrict,
  profession profession not null, display_name text not null, designation text, qualification text, bio text,
  profile_slug text unique, profile_visibility text not null default 'PRIVATE' check (profile_visibility in ('PRIVATE','PUBLIC')),
  professional_photo_path text, signature_path text, patient_number_prefix text not null default 'PT', patient_number_seq integer not null default 0,
  created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(), unique(id, profession),
  check (profile_slug is null or profile_slug ~ '^[a-z0-9]([a-z0-9-]{1,38}[a-z0-9])$')
);
create table professional_credentials (
  id uuid primary key default gen_random_uuid(), professional_profile_id uuid not null references professional_profiles(id) on delete cascade,
  regulator_id uuid not null references regulators(id), country_code text not null, profession profession not null,
  registration_display text not null, registration_normalized text generated always as (nullif(upper(regexp_replace(registration_display, '[^A-Za-z0-9]', '', 'g')), '')) stored,
  verification_status credential_status not null default 'UNVERIFIED', verified_at timestamptz, expires_at timestamptz,
  source_kind credential_source not null default 'SELF_ASSERTED',
  foreign key (professional_profile_id, profession) references professional_profiles(id, profession),
  foreign key (regulator_id, country_code) references regulators(id, country_code),
  foreign key (regulator_id, profession) references regulator_professions(regulator_id, profession),
  check (expires_at is null or expires_at > coalesce(verified_at, clock_timestamp()))
);
create unique index professional_credentials_verified_key on professional_credentials(regulator_id, registration_normalized) where verification_status='VERIFIED';
create index professional_credentials_status_idx on professional_credentials(professional_profile_id, verification_status);
create table profile_capabilities (
  profile_id uuid not null references profiles(id) on delete cascade, capability capability not null,
  granted_by_kind text not null check (granted_by_kind in ('CREDENTIAL','BASELINE')),
  source_row_id uuid, professional_profile_id uuid references professional_profiles(id),
  effective_from timestamptz not null, effective_until timestamptz, refreshed_at timestamptz not null default clock_timestamp(),
  primary key(profile_id, capability)
);

create table dd_number_allocations (
  dd_patient_number text primary key, health_subject_id uuid, allocated_at timestamptz not null default clock_timestamp(),
  allocation_state text not null default 'LIVE' check (allocation_state in ('LIVE','RETIRED'))
);
create table health_subjects (
  id uuid primary key default gen_random_uuid(), dd_patient_number text not null unique,
  kind subject_kind not null, claimed_profile_id uuid unique references profiles(id), full_name text not null,
  name_normalized text generated always as (lower(btrim(regexp_replace(full_name, '\\s+', ' ', 'g')))) stored,
  dob date, dob_precision text not null default 'DAY', approx_age_years integer, age_recorded_on date,
  sex text not null, blood_group text, phone_raw text, phone_e164 text, phone_country_hint text, email text,
  merged_into_id uuid references health_subjects(id) on delete restrict, status subject_status not null default 'ACTIVE',
  created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(),
  check ((status='MERGED') = (merged_into_id is not null)), check (kind='SELF' or claimed_profile_id is null)
  ,foreign key (dd_patient_number) references dd_number_allocations(dd_patient_number)
);
create table health_subject_origins (
  health_subject_id uuid primary key references health_subjects(id) on delete restrict, origin_type text not null,
  registration_channel text not null, organization_id uuid, organization_name_at_origin text,
  practice_location_id uuid, location_name_at_origin text, origin_doctor_id uuid references professional_profiles(id),
  registered_by_profile_id uuid references profiles(id), registered_by_actor_kind actor_kind not null,
  registered_at timestamptz not null default clock_timestamp()
);
create table subject_acquisition_events (
  id uuid primary key default gen_random_uuid(), health_subject_id uuid not null references health_subjects(id) on delete restrict,
  event_kind text not null, organization_id uuid, practice_location_id uuid, doctor_id uuid references professional_profiles(id),
  actor_kind actor_kind not null, actor_id uuid, occurred_at timestamptz not null default clock_timestamp(), seq bigserial unique
);
create table health_subject_access (
  id uuid primary key default gen_random_uuid(), health_subject_id uuid not null references health_subjects(id) on delete restrict,
  profile_id uuid not null references profiles(id) on delete restrict, authority subject_authority not null,
  relationship_label text, granted_by_profile_id uuid references profiles(id), granted_via_consent_id uuid,
  effective_from timestamptz not null default clock_timestamp(), expires_at timestamptz, revoked_at timestamptz,
  revoked_by uuid references profiles(id), revoke_reason text, check (expires_at is null or expires_at > effective_from),
  check (authority <> 'CARE_MANAGER' or granted_via_consent_id is not null)
);
create unique index health_subject_access_live_key on health_subject_access(health_subject_id, profile_id, authority) where revoked_at is null;
create unique index health_subject_access_self_key on health_subject_access(health_subject_id) where authority='SELF' and revoked_at is null;
create table health_subject_access_events (
  id uuid primary key default gen_random_uuid(), health_subject_access_id uuid not null references health_subject_access(id) on delete restrict,
  from_state text, to_state text, actor_kind actor_kind not null, actor_id uuid, reason text,
  occurred_at timestamptz not null default clock_timestamp(), seq bigserial unique
);
create table health_subject_number_aliases (
  dd_patient_number text primary key, health_subject_id uuid not null references health_subjects(id) on delete restrict,
  retired_at timestamptz not null default clock_timestamp(), reason text not null, retired_by uuid references profiles(id)
);

create table consent_records (
  id uuid primary key default gen_random_uuid(), health_subject_id uuid not null references health_subjects(id) on delete restrict,
  subject_actor_profile_id uuid not null references profiles(id), subject_actor_access_id uuid references health_subject_access(id),
  grantee_kind consent_grantee_kind not null, grantee_id uuid, consent_type consent_type not null,
  scope jsonb not null default '{}', purpose text not null, policy_version text not null, granted_at timestamptz not null default clock_timestamp(),
  effective_from timestamptz not null default clock_timestamp(), expires_at timestamptz, revoked_at timestamptz, revoked_by_profile_id uuid references profiles(id),
  evidence jsonb not null default '{}', check ((grantee_kind='PLATFORM') = (grantee_id is null)),
  check (effective_from >= granted_at), check (expires_at is null or expires_at > effective_from)
);
create table consent_events (
  id uuid primary key default gen_random_uuid(), consent_record_id uuid not null references consent_records(id) on delete restrict,
  event text not null, actor_kind actor_kind not null, actor_id uuid, occurred_at timestamptz not null default clock_timestamp(), seq bigserial unique
);
create table audit_events (
  id uuid primary key default gen_random_uuid(), actor_kind actor_kind not null, actor_id uuid, acted_as text,
  on_behalf_of uuid, action text not null, resource_type text not null, resource_id uuid, correlation_id uuid,
  request_id uuid, practice_location_id uuid, anon_session_ref uuid, ip inet, user_agent text,
  occurred_at timestamptz not null default clock_timestamp(), seq bigserial unique,
  check (action ~ '^[A-Z][A-Z0-9_.-]{1,63}$'), check (resource_type ~ '^[a-z][a-z0-9_.-]{1,63}$'),
  check (
    anon_session_ref is null
    or (actor_kind='SYSTEM' and actor_id is null and ip is null and user_agent is null)
  )
);

create table healthcare_organizations (
  id uuid primary key default gen_random_uuid(), legal_name text not null, display_name text not null,
  org_type text not null, country_code text not null check (country_code ~ '^[A-Z]{2}$'), public_code text unique,
  is_active boolean not null default true, created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp()
);
create table practice_locations (
  id uuid primary key default gen_random_uuid(), organization_id uuid references healthcare_organizations(id) on delete restrict,
  name text not null, location_type location_type not null, public_short_code text unique, country_code text not null,
  admin_area text, city text, address text, postal_code text, geo_lat numeric(9,6), geo_lng numeric(9,6), timezone text not null,
  phone text, logo_path text, settings jsonb not null default '{}', is_active boolean not null default true, is_bookable boolean not null default false,
  created_by uuid references profiles(id), created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(),
  check ((geo_lat is null) = (geo_lng is null)), check (geo_lat is null or geo_lat between -90 and 90), check (geo_lng is null or geo_lng between -180 and 180)
);
create table practice_memberships (
  id uuid primary key default gen_random_uuid(), practice_location_id uuid not null references practice_locations(id) on delete restrict,
  profile_id uuid not null references profiles(id) on delete restrict, role practice_role not null, status text not null default 'ACTIVE',
  invited_by uuid references profiles(id), joined_at timestamptz, unique(practice_location_id, profile_id, role)
);
create table doctor_chambers (
  id uuid primary key default gen_random_uuid(), doctor_id uuid not null references professional_profiles(id) on delete restrict,
  practice_location_id uuid not null references practice_locations(id) on delete restrict, public_note text, position integer not null default 0,
  unique(doctor_id, practice_location_id), unique(id, doctor_id, practice_location_id)
);
create table doctor_chamber_hours (
  id uuid primary key default gen_random_uuid(), doctor_chamber_id uuid not null references doctor_chambers(id) on delete restrict,
  weekday integer not null check (weekday between 0 and 6), start_time time not null, end_time time not null, check (start_time < end_time)
);

create table clinical_patients (
  id uuid primary key default gen_random_uuid(), owner_doctor_id uuid not null, owner_profession profession not null default 'DOCTOR',
  patient_number text not null, full_name text not null, name_normalized text generated always as (lower(btrim(regexp_replace(full_name, '\\s+', ' ', 'g')))) stored,
  dob date, dob_precision text, sex text, phone_raw text, phone_e164 text, email text, address text, blood_group text,
  merged_into_id uuid references clinical_patients(id) on delete restrict, deleted_at timestamptz,
  created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(),
  unique(owner_doctor_id, patient_number), unique(id, owner_doctor_id),
  foreign key(owner_doctor_id, owner_profession) references professional_profiles(id, profession), check(owner_profession='DOCTOR')
);
create table encounters (
  id uuid primary key default gen_random_uuid(), owner_doctor_id uuid not null, owner_profession profession not null default 'DOCTOR',
  clinical_patient_id uuid not null, practice_location_id uuid not null references practice_locations(id), appointment_id uuid,
  status encounter_status not null default 'DRAFT', chief_complaints text, present_illness text, past_history text, examination text, assessment text, advice text,
  version integer not null default 1, started_at timestamptz not null default clock_timestamp(), completed_at timestamptz,
  unique(id, owner_doctor_id), foreign key(owner_doctor_id, owner_profession) references professional_profiles(id, profession),
  foreign key(clinical_patient_id, owner_doctor_id) references clinical_patients(id, owner_doctor_id), check(owner_profession='DOCTOR')
);
create table encounter_diagnoses (
  id uuid primary key default gen_random_uuid(), encounter_id uuid not null, owner_doctor_id uuid not null, diagnosis_text text not null,
  foreign key(encounter_id, owner_doctor_id) references encounters(id, owner_doctor_id) on delete restrict
);
create table encounter_investigations (
  id uuid primary key default gen_random_uuid(), encounter_id uuid not null, owner_doctor_id uuid not null, investigation_text text not null,
  foreign key(encounter_id, owner_doctor_id) references encounters(id, owner_doctor_id) on delete restrict
);
create table encounter_events (
  id uuid primary key default gen_random_uuid(), encounter_id uuid not null, owner_doctor_id uuid not null, event text not null,
  occurred_at timestamptz not null default clock_timestamp(), seq bigserial unique, foreign key(encounter_id, owner_doctor_id) references encounters(id, owner_doctor_id)
);
create table prescription_templates (
  id uuid primary key default gen_random_uuid(), doctor_id uuid not null references professional_profiles(id), name text not null, template jsonb not null default '{}',
  is_active boolean not null default true, created_at timestamptz not null default clock_timestamp()
);
create table prescriptions (
  id uuid primary key default gen_random_uuid(), encounter_id uuid not null, owner_doctor_id uuid not null, owner_profession profession not null default 'DOCTOR',
  clinical_patient_id uuid not null, practice_location_id uuid not null references practice_locations(id), status prescription_status not null default 'DRAFT', version integer not null default 1,
  review_bundle_snapshot jsonb, review_digest text, signature_asset_path text, replaces_prescription_id uuid references prescriptions(id), replacement_reason text,
  snapshot_schema_version text, created_at timestamptz not null default clock_timestamp(), finalized_at timestamptz,
  foreign key(encounter_id, owner_doctor_id) references encounters(id, owner_doctor_id), foreign key(clinical_patient_id, owner_doctor_id) references clinical_patients(id, owner_doctor_id),
  foreign key(owner_doctor_id, owner_profession) references professional_profiles(id, profession), check(owner_profession='DOCTOR'),
  check(status <> 'FINALIZED' or (review_bundle_snapshot is not null and review_digest is not null and signature_asset_path is not null))
);
create unique index prescriptions_one_draft on prescriptions(encounter_id) where status='DRAFT';
create table prescription_items (
  id uuid primary key default gen_random_uuid(), prescription_id uuid not null references prescriptions(id) on delete restrict, display_name text not null,
  brand_name text, generic_name text, strength_text text, dose_text text, dosage_form text, route text, schedule_text text, duration_text text, quantity_text text,
  food_relation text, is_prn boolean not null default false, instructions text, substitution_allowed boolean not null default false, position integer not null,
  unique(prescription_id, position)
);
create table prescription_events (
  id uuid primary key default gen_random_uuid(), prescription_id uuid not null references prescriptions(id) on delete restrict, event text not null,
  actor_kind actor_kind not null, actor_id uuid, occurred_at timestamptz not null default clock_timestamp(), seq bigserial unique
);

create table appointments (
  id uuid primary key default gen_random_uuid(), owner_doctor_id uuid not null, owner_profession profession not null default 'DOCTOR',
  practice_location_id uuid not null references practice_locations(id), doctor_chamber_id uuid references doctor_chambers(id), clinical_patient_id uuid,
  health_subject_id uuid, booked_by_profile_id uuid references profiles(id), scheduled_at timestamptz not null, session_date date not null,
  duration_minutes integer not null default 30, visit_type text not null, mode appointment_mode not null default 'IN_PERSON', source_channel appointment_source not null,
  status appointment_status not null default 'SCHEDULED', fee_amount_minor bigint, currency_code text, public_booking_ref uuid unique,
  created_at timestamptz not null default clock_timestamp(), unique(id, owner_doctor_id), foreign key(owner_doctor_id, owner_profession) references professional_profiles(id, profession),
  foreign key(clinical_patient_id, owner_doctor_id) references clinical_patients(id, owner_doctor_id), foreign key(doctor_chamber_id, owner_doctor_id, practice_location_id) references doctor_chambers(id, doctor_id, practice_location_id),
  check(owner_profession='DOCTOR'),
  check (
    (
      source_channel='INTERNAL'
      and public_booking_ref is null
      and (clinical_patient_id is not null or health_subject_id is not null)
    )
    or (
      source_channel in ('DOCTOR','RECEPTIONIST','ASSISTANT')
      and public_booking_ref is null
      and booked_by_profile_id is not null
      and (clinical_patient_id is not null or health_subject_id is not null)
    )
    or (
      source_channel='WALK_IN'
      and public_booking_ref is null
      and clinical_patient_id is not null
    )
    or (
      source_channel in ('PUBLIC_WEB','PUBLIC_APP')
      and public_booking_ref is not null
      and doctor_chamber_id is not null
      and booked_by_profile_id is null
    )
  )
);
create table appointment_events (
  id uuid primary key default gen_random_uuid(), appointment_id uuid not null references appointments(id), from_status appointment_status, to_status appointment_status not null,
  actor_kind actor_kind not null, actor_id uuid, reason text, occurred_at timestamptz not null default clock_timestamp(), seq bigserial unique
);

create table public_booking_contacts (
  appointment_id uuid primary key references appointments(id) on delete restrict,
  contact_name text not null check (length(btrim(contact_name)) between 1 and 200),
  phone_raw text check (phone_raw is null or length(btrim(phone_raw)) between 1 and 64),
  phone_e164 text check (phone_e164 is null or phone_e164 ~ '^[+][1-9][0-9]{1,14}$'),
  phone_country_hint text check (phone_country_hint is null or phone_country_hint ~ '^[A-Z]{2}$'),
  email text check (email is null or length(btrim(email)) between 3 and 320),
  locale text check (locale is null or length(btrim(locale)) between 1 and 32),
  lifecycle_status text not null default 'ACTIVE'
    check (lifecycle_status in ('ACTIVE','RESOLVED','CANCELLED','PURGE_ELIGIBLE')),
  resolved_at timestamptz,
  cancelled_at timestamptz,
  purge_eligible_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check (phone_raw is not null or email is not null),
  check (resolved_at is null or lifecycle_status in ('RESOLVED','PURGE_ELIGIBLE')),
  check (cancelled_at is null or lifecycle_status in ('CANCELLED','PURGE_ELIGIBLE')),
  check (purge_eligible_at is null or lifecycle_status='PURGE_ELIGIBLE'),
  check (lifecycle_status <> 'RESOLVED' or resolved_at is not null),
  check (lifecycle_status <> 'CANCELLED' or cancelled_at is not null),
  check (lifecycle_status <> 'PURGE_ELIGIBLE' or purge_eligible_at is not null)
);

create table queue_token_counters (
  doctor_chamber_id uuid not null references doctor_chambers(id) on delete restrict, session_date date not null, next_token integer not null default 1,
  primary key(doctor_chamber_id, session_date)
);
create table queue_entries (
  id uuid primary key default gen_random_uuid(), appointment_id uuid not null unique references appointments(id) on delete restrict, doctor_chamber_id uuid not null references doctor_chambers(id),
  practice_location_id uuid not null references practice_locations(id), session_date date not null, queue_token integer not null, priority integer not null default 0,
  created_at timestamptz not null default clock_timestamp(), unique(doctor_chamber_id, session_date, queue_token)
);

create table anon_rate_limit_policies (
  rpc_code text not null
    check (rpc_code in ('PUBLIC_CHAMBER_AVAILABILITY','CREATE_PUBLIC_BOOKING','PUBLIC_BOOKING_STATUS')),
  bucket_kind text not null
    check (bucket_kind in ('SESSION_GLOBAL','NETWORK_GLOBAL','SESSION_RESOURCE','NETWORK_RESOURCE')),
  window_seconds integer not null check (window_seconds between 1 and 86400),
  max_requests integer not null check (max_requests between 1 and 100000),
  enabled boolean not null default true,
  policy_version text not null check (length(btrim(policy_version)) between 1 and 64),
  effective_from timestamptz not null,
  updated_at timestamptz not null default clock_timestamp(),
  primary key (rpc_code, bucket_kind, policy_version)
);
create unique index anon_rate_limit_policies_one_active
  on anon_rate_limit_policies(rpc_code, bucket_kind)
  where enabled;

create table anon_rate_limit_buckets (
  rpc_code text not null,
  bucket_kind text not null,
  policy_version text not null,
  key_digest bytea not null check (octet_length(key_digest)=32),
  window_started_at timestamptz not null,
  request_count integer not null check (request_count >= 1),
  last_seen_at timestamptz not null,
  expires_at timestamptz not null,
  primary key (rpc_code, bucket_kind, key_digest, window_started_at),
  foreign key (rpc_code, bucket_kind, policy_version)
    references anon_rate_limit_policies(rpc_code, bucket_kind, policy_version)
    on delete restrict,
  check (last_seen_at >= window_started_at),
  check (expires_at > window_started_at)
);
create index anon_rate_limit_buckets_expiry_idx
  on anon_rate_limit_buckets(expires_at);

-- Domain-L P0 foundation. Raw stores have no owner-reader grant; rollups carry no clinical keys.
create table metric_definitions (metric_code text primary key, display_name text not null, unit text not null, allowed_dimensions text[] not null, is_active boolean not null default true);
create table metric_classification_registry (classification_code text primary key);
create table metric_source_refs (
  source_ref uuid primary key default gen_random_uuid(), object_kind text not null, object_id uuid not null, transition text not null, transition_seq integer not null default 0,
  unique(object_kind, object_id, transition, transition_seq)
);
create table metric_contributions (
  metric_code text not null references metric_definitions(metric_code), source_event_key uuid not null references metric_source_refs(source_ref), period_day date not null,
  doctor_id uuid references professional_profiles(id), practice_location_id uuid references practice_locations(id), delta smallint not null check(delta in(-1,1)),
  classification_code text references metric_classification_registry(classification_code), ingested_on date not null default current_date, contribution_seq bigserial,
  primary key(metric_code, source_event_key)
);
create table metric_rollups (
  id uuid primary key default gen_random_uuid(), metric_code text not null references metric_definitions(metric_code), period_kind metric_period_kind not null,
  period_start date not null, doctor_id uuid references professional_profiles(id), practice_location_id uuid references practice_locations(id), count_value bigint not null default 0,
  updated_at timestamptz not null default clock_timestamp(), unique(metric_code, period_kind, period_start, doctor_id, practice_location_id)
);
do $$
declare
  ingress record;
begin
  if not exists (select 1 from pg_roles where rolname='dd_owner_analytics') then
    create role dd_owner_analytics noinherit;
  end if;

  if not exists (select 1 from pg_roles where rolname='dd_metrics_reader') then
    create role dd_metrics_reader noinherit;
  end if;

  if not exists (select 1 from pg_roles where rolname='dd_metrics_rollup') then
    create role dd_metrics_rollup noinherit;
  end if;

  select
    rolsuper,
    rolcreatedb,
    rolcreaterole,
    rolinherit,
    rolcanlogin,
    rolreplication,
    rolbypassrls
  into ingress
  from pg_roles
  where rolname = 'dd_public_ingress';

  if not found then
    create role dd_public_ingress
      nosuperuser
      nocreatedb
      nocreaterole
      noinherit
      login
      noreplication
      nobypassrls;
  else
    if ingress.rolsuper
       or ingress.rolcreatedb
       or ingress.rolcreaterole
       or ingress.rolinherit
       or not ingress.rolcanlogin
       or ingress.rolreplication
       or ingress.rolbypassrls then
      raise exception 'DD_PUBLIC_INGRESS_ROLE_ATTRIBUTES_INVALID'
        using errcode='42501';
    end if;
  end if;
end $$;