-- Doctor's Diary Database V2, P1 identity-completion schema.
-- Additive only: P0 baseline remains unchanged and is replayed first.

create type credential_verification_method as enum (
  'MANUAL_REVIEW','REGULATOR_API','DOCUMENT_UPLOAD','IN_PERSON'
);
create type platform_staff_role as enum (
  'COMMUNITY_MODERATOR','MODERATION_SUPERVISOR','SUPPORT_AGENT',
  'CREDENTIAL_VERIFIER','FINANCE_OPERATOR','PLATFORM_ADMIN',
  'HEALTH_ADVISORY_EDITOR','PUBLIC_HEALTH_SOURCE_STEWARD','PLATFORM_ANALYST'
);
create type medical_student_status as enum ('ACTIVE','GRADUATED','WITHDRAWN');
create type health_signal_status as enum ('OK','DEGRADED','FAILING');
create type health_signal_unit as enum ('COUNT','PERCENT','SECONDS','BYTES','RATIO');
create type health_signal_detail_type as enum ('INTEGER','NUMERIC','BOOLEAN','ENUM');

create table public.platform_staff (
  profile_id uuid primary key references public.profiles(id) on delete restrict,
  is_active boolean not null default true,
  granted_by uuid references public.profiles(id) on delete restrict,
  revoked_at timestamptz,
  note text check (note is null or length(note) <= 500),
  is_owner_account boolean not null default false,
  created_at timestamptz not null default clock_timestamp(),
  check ((is_active and revoked_at is null) or (not is_active and revoked_at is not null))
);
create unique index platform_staff_one_active_owner
  on public.platform_staff((is_owner_account))
  where is_owner_account and is_active;

create table public.platform_staff_roles (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.platform_staff(profile_id) on delete restrict,
  role platform_staff_role not null,
  granted_by uuid not null references public.profiles(id) on delete restrict,
  granted_at timestamptz not null default clock_timestamp(),
  revoked_at timestamptz
);
create unique index platform_staff_roles_live_key
  on public.platform_staff_roles(profile_id, role) where revoked_at is null;

alter table public.professional_credentials
  add column verification_method credential_verification_method,
  add column verified_by_staff_id uuid references public.platform_staff(profile_id) on delete restrict,
  add column evidence_ref text check (evidence_ref is null or length(evidence_ref) <= 500);

create unique index professional_credentials_open_review_key
  on public.professional_credentials(professional_profile_id, regulator_id)
  where verification_status in ('PENDING','NEEDS_INFORMATION');
create unique index professional_credentials_verified_profile_regulator_key
  on public.professional_credentials(professional_profile_id, regulator_id)
  where verification_status='VERIFIED';
create table public.credential_review_events (
  seq bigserial primary key,
  credential_id uuid not null references public.professional_credentials(id) on delete restrict,
  event_kind text not null check (event_kind in (
    'SUBMITTED','RESUBMITTED','NEEDS_INFORMATION','FIRST_VERIFIER_APPROVED',
    'VERIFIED','REJECTED','CANCELLED'
  )),
  from_status credential_status,
  to_status credential_status not null,
  actor_profile_id uuid references public.profiles(id) on delete restrict,
  actor_role platform_staff_role,
  note text check (note is null or length(note) <= 1000),
  occurred_at timestamptz not null default clock_timestamp()
);
create index credential_review_events_credential_idx
  on public.credential_review_events(credential_id, seq);

create table public.medical_institutions (
  id uuid primary key default gen_random_uuid(),
  country_code text not null check (country_code ~ '^[A-Z]{2}$'),
  name text not null check (length(btrim(name)) between 2 and 200),
  name_normalized text generated always as (lower(btrim(regexp_replace(name, '\\s+', ' ', 'g')))) stored,
  institution_type text not null check (institution_type in ('MEDICAL_COLLEGE','UNIVERSITY','TEACHING_HOSPITAL','OTHER')),
  regulator_id uuid,
  is_active boolean not null default true,
  unique(id, country_code),
  unique(country_code, name_normalized)
);
alter table public.medical_institutions
  add constraint medical_institutions_regulator_country_fk
  foreign key (regulator_id, country_code)
  references public.regulators(id, country_code) on delete restrict;

create table public.medical_student_profiles (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null unique references public.profiles(id) on delete restrict,
  status medical_student_status not null default 'ACTIVE',
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique(id, profile_id)
);

create table public.student_enrollments (
  id uuid primary key default gen_random_uuid(),
  medical_student_profile_id uuid not null references public.medical_student_profiles(id) on delete restrict,
  medical_institution_id uuid not null references public.medical_institutions(id) on delete restrict,
  institution_country_code text not null,
  student_id_display text,
  student_id_normalized text generated always as (
    nullif(upper(regexp_replace(coalesce(student_id_display,''), '[^A-Za-z0-9]', '', 'g')), '')
  ) stored,
  programme text not null check (length(btrim(programme)) between 2 and 160),
  started_on date,
  expected_graduation date,
  ended_on date,
  verification_status credential_status not null default 'PENDING',
  verification_method credential_verification_method,
  verified_at timestamptz,
  verified_by_staff_id uuid references public.platform_staff(profile_id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  foreign key (medical_institution_id, institution_country_code)
    references public.medical_institutions(id, country_code) on delete restrict,
  check (ended_on is null or started_on is null or ended_on >= started_on),
  check (expected_graduation is null or started_on is null or expected_graduation >= started_on)
);
create unique index student_enrollments_verified_student_key
  on public.student_enrollments(medical_institution_id, student_id_normalized)
  where verification_status='VERIFIED' and student_id_normalized is not null;
create unique index student_enrollments_open_review_key
  on public.student_enrollments(medical_student_profile_id, medical_institution_id)
  where verification_status in ('PENDING','NEEDS_INFORMATION');

alter table public.medical_institutions
  add column regulated_profession profession generated always as ('MEDICAL_STUDENT'::profession) stored,
  add constraint medical_institutions_regulator_profession_fk
    foreign key (regulator_id, regulated_profession)
    references public.regulator_professions(regulator_id, profession) on delete restrict;

alter table public.profile_capabilities
  drop constraint profile_capabilities_granted_by_kind_check,
  add constraint profile_capabilities_granted_by_kind_check
    check (granted_by_kind in ('CREDENTIAL','ENROLLMENT','BASELINE'));
create table public.health_signal_registry (
  signal_code text primary key check (signal_code ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  expected_interval interval not null check (expected_interval > interval '0 seconds'),
  is_active boolean not null default true
);
create table public.health_signal_registry_keys (
  signal_code text not null references public.health_signal_registry(signal_code) on delete restrict,
  detail_key text not null check (detail_key ~ '^[a-z][a-z0-9_]{1,47}$'),
  value_type health_signal_detail_type not null,
  enum_values text[],
  min_value numeric,
  max_value numeric,
  primary key(signal_code, detail_key),
  check ((value_type='ENUM') = (enum_values is not null)),
  check (enum_values is null or cardinality(enum_values) between 1 and 32),
  check (min_value is null or max_value is null or min_value <= max_value)
);
create or replace function public.p1_jsonb_object_key_count(value jsonb)
returns integer
language sql immutable strict parallel safe
set search_path = pg_catalog
as $$
  select case
    when pg_catalog.jsonb_typeof(value) = 'object' then
      (select count(*)::integer from pg_catalog.jsonb_object_keys(value))
    else null
  end
$$;

create table public.system_health_signals (
  id uuid primary key default gen_random_uuid(),
  observed_at timestamptz not null default clock_timestamp(),
  signal_code text not null references public.health_signal_registry(signal_code) on delete restrict,
  status health_signal_status not null,
  value numeric,
  unit health_signal_unit,
  detail jsonb not null default '{}'::jsonb,
  check (jsonb_typeof(detail)='object'),
  check (public.p1_jsonb_object_key_count(detail) <= 12)
);
create index system_health_signals_latest_idx
  on public.system_health_signals(signal_code, observed_at desc);
