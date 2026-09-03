--
-- PostgreSQL database dump
--

\restrict DD_P0_GOLDEN

-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.6

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: auth; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA auth;


--
-- Name: storage; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA storage;


--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;


--
-- Name: EXTENSION pgcrypto; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pgcrypto IS 'cryptographic functions';


--
-- Name: actor_kind; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.actor_kind AS ENUM (
    'USER',
    'PLATFORM_STAFF',
    'SERVICE_AGENT',
    'SYSTEM'
);


--
-- Name: appointment_mode; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.appointment_mode AS ENUM (
    'IN_PERSON',
    'ONLINE',
    'HOME_VISIT'
);


--
-- Name: appointment_source; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.appointment_source AS ENUM (
    'INTERNAL',
    'DOCTOR',
    'RECEPTIONIST',
    'ASSISTANT',
    'WALK_IN',
    'PUBLIC_WEB',
    'PUBLIC_APP',
    'SUPPORT_ASSISTED'
);


--
-- Name: appointment_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.appointment_status AS ENUM (
    'SCHEDULED',
    'CONFIRMED',
    'ARRIVED',
    'IN_CONSULTATION',
    'COMPLETED',
    'CANCELLED',
    'NO_SHOW'
);


--
-- Name: capability; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.capability AS ENUM (
    'PUBLIC',
    'MEDICAL_STUDENT',
    'DOCTOR'
);


--
-- Name: consent_grantee_kind; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.consent_grantee_kind AS ENUM (
    'DOCTOR',
    'ORGANIZATION',
    'PLATFORM_STAFF_ROLE',
    'SERVICE_AGENT',
    'PLATFORM'
);


--
-- Name: consent_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.consent_type AS ENUM (
    'CLINICAL_LINK',
    'DOCUMENT_SHARE',
    'CROSS_DOCTOR_REFERRAL',
    'SUPPORT_CONTEXT',
    'MARKETING_CONTACT'
);


--
-- Name: credential_source; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.credential_source AS ENUM (
    'SELF_ASSERTED',
    'STAFF_VERIFIED',
    'REGULATOR_IMPORT'
);


--
-- Name: credential_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.credential_status AS ENUM (
    'UNVERIFIED',
    'PENDING',
    'NEEDS_INFORMATION',
    'VERIFIED',
    'REJECTED',
    'EXPIRED',
    'SUSPENDED',
    'REVOKED'
);


--
-- Name: encounter_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.encounter_status AS ENUM (
    'DRAFT',
    'COMPLETED',
    'CANCELLED'
);


--
-- Name: location_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.location_type AS ENUM (
    'PERSONAL_CHAMBER',
    'CLINIC',
    'HOSPITAL',
    'HOSPITAL_DEPARTMENT',
    'DIAGNOSTIC_CENTRE',
    'TELEMEDICINE',
    'OTHER'
);


--
-- Name: metric_period_kind; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.metric_period_kind AS ENUM (
    'DAY',
    'MONTH'
);


--
-- Name: practice_role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.practice_role AS ENUM (
    'DOCTOR',
    'RECEPTIONIST',
    'LOCATION_ADMIN',
    'PRACTICE_MANAGER'
);


--
-- Name: prescription_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.prescription_status AS ENUM (
    'DRAFT',
    'FINALIZED',
    'VOIDED'
);


--
-- Name: profession; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.profession AS ENUM (
    'DOCTOR',
    'DENTIST',
    'MEDICAL_STUDENT',
    'NURSE',
    'PHYSIOTHERAPIST',
    'OTHER'
);


--
-- Name: subject_authority; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.subject_authority AS ENUM (
    'SELF',
    'GUARDIAN',
    'CARE_MANAGER'
);


--
-- Name: subject_kind; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.subject_kind AS ENUM (
    'SELF',
    'DEPENDENT'
);


--
-- Name: subject_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.subject_status AS ENUM (
    'ACTIVE',
    'MERGED',
    'DECEASED',
    'LOCKED'
);


--
-- Name: uid(); Type: FUNCTION; Schema: auth; Owner: -
--

CREATE FUNCTION auth.uid() RETURNS uuid
    LANGUAGE sql STABLE
    AS $$ select nullif(current_setting('request.uid', true), '')::uuid $$;


--
-- Name: allocate_dd_patient_number(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.allocate_dd_patient_number() RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare
  alphabet constant text := '0123456789ABCDFGHJKMNPQRSTVWXYZ';
  data text := '';
  candidate text;
  byte integer;
begin
  for attempt in 1..8 loop
    data := '';
    while length(data) < 9 loop
      byte := get_byte(gen_random_bytes(1), 0);
      if byte < 248 then data := data || substr(alphabet, (byte % 31) + 1, 1); end if;
    end loop;
    candidate := data || public.dd_check_symbol(data);
    begin
      insert into dd_number_allocations(dd_patient_number) values (candidate);
      return candidate;
    exception when unique_violation then null;
    end;
  end loop;
  raise exception 'DD_NUMBER_ALLOCATION_EXHAUSTED' using errcode = 'P0001';
end $$;


--
-- Name: allocate_queue_token(uuid, date, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.allocate_queue_token(chamber_key uuid, queue_date date, appointment_key uuid) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare doctor uuid; token integer;
begin
  doctor := public.current_doctor_id();
  if doctor is null or not public.has_capability(public.current_profile_id(), 'DOCTOR') then raise exception 'PRACTICE_AUTHORITY_REQUIRED' using errcode='42501'; end if;
  if not exists (select 1 from appointments a where a.id=appointment_key and a.doctor_chamber_id=chamber_key and a.owner_doctor_id=doctor and a.session_date=queue_date and a.status in ('ARRIVED','IN_CONSULTATION')) then
    raise exception 'QUEUE_APPOINTMENT_CONTEXT_INVALID' using errcode='P0001';
  end if;
  insert into queue_token_counters(doctor_chamber_id, session_date, next_token) values (chamber_key, queue_date, 2)
  on conflict (doctor_chamber_id, session_date) do update set next_token=queue_token_counters.next_token+1
  returning next_token-1 into token;
  insert into queue_entries(appointment_id, doctor_chamber_id, practice_location_id, session_date, queue_token)
  select appointment_key, a.doctor_chamber_id, a.practice_location_id, queue_date, token from appointments a where a.id=appointment_key;
  return token;
exception when unique_violation then
  raise exception 'QUEUE_TOKEN_ALREADY_ALLOCATED' using errcode='P0001';
end $$;


--
-- Name: create_clinical_patient(text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_clinical_patient(patient_name text, location_id uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare doctor uuid; result uuid; next_number integer; prefix text;
begin
  doctor := public.current_doctor_id();
  if doctor is null or not public.has_capability(public.current_profile_id(), 'DOCTOR') then raise exception 'PRACTICE_AUTHORITY_REQUIRED' using errcode='42501'; end if;
  select patient_number_seq, patient_number_prefix into next_number, prefix from professional_profiles where id=doctor for update;
  update professional_profiles set patient_number_seq=next_number+1 where id=doctor;
  insert into clinical_patients(owner_doctor_id, patient_number, full_name) values (doctor, prefix || '-' || lpad(next_number::text, 6, '0'), patient_name) returning id into result;
  return result;
end $$;


--
-- Name: create_health_subject(text, public.subject_kind, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_health_subject(subject_name text, subject_kind public.subject_kind, subject_sex text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare result uuid; number text;
begin
  if public.current_profile_id() is null then raise exception 'AUTHENTICATION_REQUIRED' using errcode='42501'; end if;
  number := public.allocate_dd_patient_number();
  insert into health_subjects(dd_patient_number, kind, claimed_profile_id, full_name, sex)
  values (number, subject_kind, case when subject_kind='SELF' then public.current_profile_id() end, subject_name, subject_sex)
  returning id into result;
  update dd_number_allocations set health_subject_id=result where dd_patient_number=number;
  insert into health_subject_origins(health_subject_id, origin_type, registration_channel, registered_by_profile_id, registered_by_actor_kind)
  values (result, 'SELF_REGISTRATION', 'API', public.current_profile_id(), 'USER');
  insert into health_subject_access(health_subject_id, profile_id, authority) values (result, public.current_profile_id(), case when subject_kind='SELF' then 'SELF' else 'GUARDIAN' end);
  return result;
end $$;


--
-- Name: create_professional_profile(text, public.profession); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_professional_profile(display_name text, profession public.profession) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare result uuid;
begin
  if public.current_profile_id() is null then raise exception 'AUTHENTICATION_REQUIRED' using errcode='42501'; end if;
  insert into professional_profiles(profile_id, display_name, profession) values (public.current_profile_id(), display_name, profession)
  returning id into result;
  return result;
end $$;


--
-- Name: current_doctor_id(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.current_doctor_id() RETURNS uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  select pp.id from professional_profiles pp where pp.profile_id = public.current_profile_id() and pp.profession = 'DOCTOR'
$$;


--
-- Name: current_profile_id(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.current_profile_id() RETURNS uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  select auth.uid()
$$;


--
-- Name: dd_check_symbol(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.dd_check_symbol(data text) RETURNS text
    LANGUAGE plpgsql IMMUTABLE STRICT
    AS $$
declare
  alphabet constant text := '0123456789ABCDFGHJKMNPQRSTVWXYZ';
  state integer := 31;
  value integer;
begin
  if length(data) <> 9 then raise exception 'INVALID_DD_DATA' using errcode = 'P0001'; end if;
  for i in 1..9 loop
    value := strpos(alphabet, substr(upper(data), i, 1)) - 1;
    if value < 0 then raise exception 'INVALID_DD_DATA' using errcode = 'P0001'; end if;
    state := ((state + value) % 31) * 2 % 31;
  end loop;
  return substr(alphabet, ((31 + 1 - state) % 31) + 1, 1);
end $$;


--
-- Name: emit_audit_event(text, text, uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.emit_audit_event(action_code text, resource_kind text, resource_key uuid, correlation_key uuid DEFAULT NULL::uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $_$
declare result uuid;
begin
  if action_code !~ '^[A-Z][A-Z0-9_.-]{1,63}$' or resource_kind !~ '^[a-z][a-z0-9_.-]{1,63}$' then
    raise exception 'AUDIT_CODE_INVALID' using errcode='P0001';
  end if;
  insert into audit_events(actor_kind, actor_id, action, resource_type, resource_id, correlation_id)
  values ('USER', public.current_profile_id(), action_code, resource_kind, resource_key, correlation_key)
  returning id into result;
  return result;
end $_$;


--
-- Name: finalize_prescription(uuid, integer, jsonb, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.finalize_prescription(prescription_key uuid, expected_version integer, approved_bundle jsonb, approved_digest text, frozen_signature_path text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare doctor uuid;
begin
  doctor := public.current_doctor_id();
  if doctor is null or not public.has_capability(public.current_profile_id(), 'DOCTOR') then raise exception 'PRACTICE_AUTHORITY_REQUIRED' using errcode='42501'; end if;
  update prescriptions
  set status='FINALIZED', version=version+1, review_bundle_snapshot=approved_bundle, review_digest=approved_digest, signature_asset_path=frozen_signature_path, snapshot_schema_version='P0', finalized_at=clock_timestamp()
  where id=prescription_key and owner_doctor_id=doctor and status='DRAFT' and version=expected_version;
  if not found then raise exception 'PRESCRIPTION_VERSION_OR_STATE_CONFLICT' using errcode='P0001'; end if;
  perform public.emit_audit_event('PRESCRIPTION_FINALIZED', 'prescriptions', prescription_key, null);
  return prescription_key;
end $$;


--
-- Name: has_capability(uuid, public.capability); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.has_capability(subject_profile_id uuid, requested public.capability) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  select exists (
    select 1 from profile_capabilities pc
    where pc.profile_id = subject_profile_id and pc.capability = requested
      and pc.effective_from <= clock_timestamp()
      and (pc.effective_until is null or pc.effective_until > clock_timestamp())
  )
$$;


--
-- Name: is_live_edge(timestamp with time zone, timestamp with time zone, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_live_edge(effective_from timestamp with time zone, expires_at timestamp with time zone, revoked_at timestamp with time zone) RETURNS boolean
    LANGUAGE sql STABLE
    AS $$
  select effective_from <= clock_timestamp() and (expires_at is null or expires_at > clock_timestamp()) and revoked_at is null
$$;


--
-- Name: normalize_dd_number(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.normalize_dd_number(input text) RETURNS text
    LANGUAGE plpgsql IMMUTABLE STRICT
    AS $$
declare
  normalized text;
  alphabet constant text := '0123456789ABCDFGHJKMNPQRSTVWXYZ';
  checksum integer := 31;
  symbol text;
  value integer;
begin
  normalized := upper(regexp_replace(regexp_replace(coalesce(input, ''), '^DD[- ]', '', 'i'), '[[:space:]-]', '', 'g'));
  normalized := translate(normalized, 'ILO', '110');
  if length(normalized) <> 10 then raise exception 'INVALID_DD_NUMBER' using errcode = 'P0001'; end if;
  for i in 1..10 loop
    symbol := substr(normalized, i, 1);
    value := strpos(alphabet, symbol) - 1;
    if value < 0 then raise exception 'INVALID_DD_NUMBER' using errcode = 'P0001'; end if;
    if i < 10 then checksum := ((checksum + value) % 31) * 2 % 31;
    else checksum := (checksum + value) % 31; end if;
  end loop;
  if checksum <> 1 then raise exception 'INVALID_DD_NUMBER' using errcode = 'P0001'; end if;
  return normalized;
end $$;


--
-- Name: open_encounter(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.open_encounter(patient_id uuid, location_id uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare doctor uuid; result uuid;
begin
  doctor := public.current_doctor_id();
  if doctor is null or not public.has_capability(public.current_profile_id(), 'DOCTOR') then raise exception 'PRACTICE_AUTHORITY_REQUIRED' using errcode='42501'; end if;
  insert into encounters(owner_doctor_id, clinical_patient_id, practice_location_id) values (doctor, patient_id, location_id) returning id into result;
  return result;
end $$;


--
-- Name: open_prescription(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.open_prescription(encounter_key uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare doctor uuid; result uuid; patient uuid; location uuid;
begin
  doctor := public.current_doctor_id();
  if doctor is null or not public.has_capability(public.current_profile_id(), 'DOCTOR') then raise exception 'PRACTICE_AUTHORITY_REQUIRED' using errcode='42501'; end if;
  select clinical_patient_id, practice_location_id into patient, location from encounters where id=encounter_key and owner_doctor_id=doctor;
  if patient is null then raise exception 'ENCOUNTER_NOT_FOUND' using errcode='P0001'; end if;
  insert into prescriptions(encounter_id, owner_doctor_id, clinical_patient_id, practice_location_id) values (encounter_key, doctor, patient, location) returning id into result;
  return result;
end $$;


--
-- Name: prevent_append_only_change(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.prevent_append_only_change() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  raise exception 'APPEND_ONLY_RECORD' using errcode='P0001';
end $$;


--
-- Name: prevent_dd_number_change(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.prevent_dd_number_change() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  if new.dd_patient_number is distinct from old.dd_patient_number then raise exception 'DD_NUMBER_IMMUTABLE' using errcode = 'P0001'; end if;
  return new;
end $$;


--
-- Name: prevent_finalized_item_mutation(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.prevent_finalized_item_mutation() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  if exists (select 1 from prescriptions p where p.id=coalesce(old.prescription_id, new.prescription_id) and p.status='FINALIZED') then
    raise exception 'PRESCRIPTION_FINALIZED_IMMUTABLE' using errcode='P0001';
  end if;
  return coalesce(new, old);
end $$;


--
-- Name: prevent_finalized_prescription_mutation(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.prevent_finalized_prescription_mutation() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  if old.status='FINALIZED' then raise exception 'PRESCRIPTION_FINALIZED_IMMUTABLE' using errcode='P0001'; end if;
  return new;
end $$;


--
-- Name: refresh_capability_trigger(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.refresh_capability_trigger() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
begin
  perform public.refresh_profile_capabilities((select profile_id from professional_profiles where id = coalesce(new.professional_profile_id, old.professional_profile_id)));
  return new;
end $$;


--
-- Name: refresh_profile_capabilities(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.refresh_profile_capabilities(subject_profile_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
begin
  delete from profile_capabilities where profile_id = subject_profile_id;
  insert into profile_capabilities(profile_id, capability, granted_by_kind, source_row_id, professional_profile_id, effective_from, effective_until)
  select pp.profile_id, 'DOCTOR', 'CREDENTIAL', pc.id, pp.id, coalesce(pc.verified_at, clock_timestamp()), pc.expires_at
  from professional_credentials pc
  join professional_profiles pp on pp.id = pc.professional_profile_id and pp.profession = 'DOCTOR'
  where pp.profile_id = subject_profile_id and pc.profession = 'DOCTOR' and pc.verification_status = 'VERIFIED'
  order by pc.verified_at desc nulls last limit 1;
  insert into profile_capabilities(profile_id, capability, granted_by_kind, effective_from)
  values (subject_profile_id, 'PUBLIC', 'BASELINE', clock_timestamp());
end $$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: users; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.users (
    id uuid NOT NULL
);


--
-- Name: appointment_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.appointment_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    appointment_id uuid NOT NULL,
    from_status public.appointment_status,
    to_status public.appointment_status NOT NULL,
    actor_kind public.actor_kind NOT NULL,
    actor_id uuid,
    reason text,
    occurred_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    seq bigint NOT NULL
);

ALTER TABLE ONLY public.appointment_events FORCE ROW LEVEL SECURITY;


--
-- Name: appointment_events_seq_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.appointment_events_seq_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: appointment_events_seq_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.appointment_events_seq_seq OWNED BY public.appointment_events.seq;


--
-- Name: appointments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.appointments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_doctor_id uuid NOT NULL,
    owner_profession public.profession DEFAULT 'DOCTOR'::public.profession NOT NULL,
    practice_location_id uuid NOT NULL,
    doctor_chamber_id uuid,
    clinical_patient_id uuid,
    health_subject_id uuid,
    booked_by_profile_id uuid,
    scheduled_at timestamp with time zone NOT NULL,
    session_date date NOT NULL,
    duration_minutes integer DEFAULT 30 NOT NULL,
    visit_type text NOT NULL,
    mode public.appointment_mode DEFAULT 'IN_PERSON'::public.appointment_mode NOT NULL,
    source_channel public.appointment_source NOT NULL,
    status public.appointment_status DEFAULT 'SCHEDULED'::public.appointment_status NOT NULL,
    fee_amount_minor bigint,
    currency_code text,
    public_booking_ref uuid,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT appointments_check CHECK (((clinical_patient_id IS NOT NULL) OR (health_subject_id IS NOT NULL) OR (source_channel = 'WALK_IN'::public.appointment_source))),
    CONSTRAINT appointments_owner_profession_check CHECK ((owner_profession = 'DOCTOR'::public.profession))
);

ALTER TABLE ONLY public.appointments FORCE ROW LEVEL SECURITY;


--
-- Name: audit_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    actor_kind public.actor_kind NOT NULL,
    actor_id uuid,
    acted_as text,
    on_behalf_of uuid,
    action text NOT NULL,
    resource_type text NOT NULL,
    resource_id uuid,
    correlation_id uuid,
    request_id uuid,
    practice_location_id uuid,
    ip inet,
    user_agent text,
    occurred_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    seq bigint NOT NULL,
    CONSTRAINT audit_events_action_check CHECK ((action ~ '^[A-Z][A-Z0-9_.-]{1,63}$'::text)),
    CONSTRAINT audit_events_resource_type_check CHECK ((resource_type ~ '^[a-z][a-z0-9_.-]{1,63}$'::text))
);

ALTER TABLE ONLY public.audit_events FORCE ROW LEVEL SECURITY;


--
-- Name: audit_events_seq_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.audit_events_seq_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: audit_events_seq_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.audit_events_seq_seq OWNED BY public.audit_events.seq;


--
-- Name: clinical_patients; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.clinical_patients (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_doctor_id uuid NOT NULL,
    owner_profession public.profession DEFAULT 'DOCTOR'::public.profession NOT NULL,
    patient_number text NOT NULL,
    full_name text NOT NULL,
    name_normalized text GENERATED ALWAYS AS (lower(btrim(regexp_replace(full_name, '\\s+'::text, ' '::text, 'g'::text)))) STORED,
    dob date,
    dob_precision text,
    sex text,
    phone_raw text,
    phone_e164 text,
    email text,
    address text,
    blood_group text,
    merged_into_id uuid,
    deleted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    updated_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT clinical_patients_owner_profession_check CHECK ((owner_profession = 'DOCTOR'::public.profession))
);

ALTER TABLE ONLY public.clinical_patients FORCE ROW LEVEL SECURITY;


--
-- Name: consent_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.consent_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    consent_record_id uuid NOT NULL,
    event text NOT NULL,
    actor_kind public.actor_kind NOT NULL,
    actor_id uuid,
    occurred_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    seq bigint NOT NULL
);

ALTER TABLE ONLY public.consent_events FORCE ROW LEVEL SECURITY;


--
-- Name: consent_events_seq_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.consent_events_seq_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: consent_events_seq_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.consent_events_seq_seq OWNED BY public.consent_events.seq;


--
-- Name: consent_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.consent_records (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    health_subject_id uuid NOT NULL,
    subject_actor_profile_id uuid NOT NULL,
    subject_actor_access_id uuid,
    grantee_kind public.consent_grantee_kind NOT NULL,
    grantee_id uuid,
    consent_type public.consent_type NOT NULL,
    scope jsonb DEFAULT '{}'::jsonb NOT NULL,
    purpose text NOT NULL,
    policy_version text NOT NULL,
    granted_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    effective_from timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    expires_at timestamp with time zone,
    revoked_at timestamp with time zone,
    revoked_by_profile_id uuid,
    evidence jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT consent_records_check CHECK (((grantee_kind = 'PLATFORM'::public.consent_grantee_kind) = (grantee_id IS NULL))),
    CONSTRAINT consent_records_check1 CHECK ((effective_from >= granted_at)),
    CONSTRAINT consent_records_check2 CHECK (((expires_at IS NULL) OR (expires_at > effective_from)))
);

ALTER TABLE ONLY public.consent_records FORCE ROW LEVEL SECURITY;


--
-- Name: dd_number_allocations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dd_number_allocations (
    dd_patient_number text NOT NULL,
    health_subject_id uuid,
    allocated_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    allocation_state text DEFAULT 'LIVE'::text NOT NULL,
    CONSTRAINT dd_number_allocations_allocation_state_check CHECK ((allocation_state = ANY (ARRAY['LIVE'::text, 'RETIRED'::text])))
);

ALTER TABLE ONLY public.dd_number_allocations FORCE ROW LEVEL SECURITY;


--
-- Name: doctor_chamber_hours; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.doctor_chamber_hours (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    doctor_chamber_id uuid NOT NULL,
    weekday integer NOT NULL,
    start_time time without time zone NOT NULL,
    end_time time without time zone NOT NULL,
    CONSTRAINT doctor_chamber_hours_check CHECK ((start_time < end_time)),
    CONSTRAINT doctor_chamber_hours_weekday_check CHECK (((weekday >= 0) AND (weekday <= 6)))
);

ALTER TABLE ONLY public.doctor_chamber_hours FORCE ROW LEVEL SECURITY;


--
-- Name: doctor_chambers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.doctor_chambers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    doctor_id uuid NOT NULL,
    practice_location_id uuid NOT NULL,
    public_note text,
    "position" integer DEFAULT 0 NOT NULL
);

ALTER TABLE ONLY public.doctor_chambers FORCE ROW LEVEL SECURITY;


--
-- Name: encounter_diagnoses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.encounter_diagnoses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    encounter_id uuid NOT NULL,
    owner_doctor_id uuid NOT NULL,
    diagnosis_text text NOT NULL
);

ALTER TABLE ONLY public.encounter_diagnoses FORCE ROW LEVEL SECURITY;


--
-- Name: encounter_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.encounter_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    encounter_id uuid NOT NULL,
    owner_doctor_id uuid NOT NULL,
    event text NOT NULL,
    occurred_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    seq bigint NOT NULL
);

ALTER TABLE ONLY public.encounter_events FORCE ROW LEVEL SECURITY;


--
-- Name: encounter_events_seq_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.encounter_events_seq_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: encounter_events_seq_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.encounter_events_seq_seq OWNED BY public.encounter_events.seq;


--
-- Name: encounter_investigations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.encounter_investigations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    encounter_id uuid NOT NULL,
    owner_doctor_id uuid NOT NULL,
    investigation_text text NOT NULL
);

ALTER TABLE ONLY public.encounter_investigations FORCE ROW LEVEL SECURITY;


--
-- Name: encounters; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.encounters (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_doctor_id uuid NOT NULL,
    owner_profession public.profession DEFAULT 'DOCTOR'::public.profession NOT NULL,
    clinical_patient_id uuid NOT NULL,
    practice_location_id uuid NOT NULL,
    appointment_id uuid,
    status public.encounter_status DEFAULT 'DRAFT'::public.encounter_status NOT NULL,
    chief_complaints text,
    present_illness text,
    past_history text,
    examination text,
    assessment text,
    advice text,
    version integer DEFAULT 1 NOT NULL,
    started_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    completed_at timestamp with time zone,
    CONSTRAINT encounters_owner_profession_check CHECK ((owner_profession = 'DOCTOR'::public.profession))
);

ALTER TABLE ONLY public.encounters FORCE ROW LEVEL SECURITY;


--
-- Name: health_subject_access; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.health_subject_access (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    health_subject_id uuid NOT NULL,
    profile_id uuid NOT NULL,
    authority public.subject_authority NOT NULL,
    relationship_label text,
    granted_by_profile_id uuid,
    granted_via_consent_id uuid,
    effective_from timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    expires_at timestamp with time zone,
    revoked_at timestamp with time zone,
    revoked_by uuid,
    revoke_reason text,
    CONSTRAINT health_subject_access_check CHECK (((expires_at IS NULL) OR (expires_at > effective_from))),
    CONSTRAINT health_subject_access_check1 CHECK (((authority <> 'CARE_MANAGER'::public.subject_authority) OR (granted_via_consent_id IS NOT NULL)))
);

ALTER TABLE ONLY public.health_subject_access FORCE ROW LEVEL SECURITY;


--
-- Name: health_subject_access_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.health_subject_access_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    health_subject_access_id uuid NOT NULL,
    from_state text,
    to_state text,
    actor_kind public.actor_kind NOT NULL,
    actor_id uuid,
    reason text,
    occurred_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    seq bigint NOT NULL
);

ALTER TABLE ONLY public.health_subject_access_events FORCE ROW LEVEL SECURITY;


--
-- Name: health_subject_access_events_seq_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.health_subject_access_events_seq_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: health_subject_access_events_seq_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.health_subject_access_events_seq_seq OWNED BY public.health_subject_access_events.seq;


--
-- Name: health_subject_number_aliases; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.health_subject_number_aliases (
    dd_patient_number text NOT NULL,
    health_subject_id uuid NOT NULL,
    retired_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    reason text NOT NULL,
    retired_by uuid
);

ALTER TABLE ONLY public.health_subject_number_aliases FORCE ROW LEVEL SECURITY;


--
-- Name: health_subject_origins; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.health_subject_origins (
    health_subject_id uuid NOT NULL,
    origin_type text NOT NULL,
    registration_channel text NOT NULL,
    organization_id uuid,
    organization_name_at_origin text,
    practice_location_id uuid,
    location_name_at_origin text,
    origin_doctor_id uuid,
    registered_by_profile_id uuid,
    registered_by_actor_kind public.actor_kind NOT NULL,
    registered_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);

ALTER TABLE ONLY public.health_subject_origins FORCE ROW LEVEL SECURITY;


--
-- Name: health_subjects; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.health_subjects (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    dd_patient_number text NOT NULL,
    kind public.subject_kind NOT NULL,
    claimed_profile_id uuid,
    full_name text NOT NULL,
    name_normalized text GENERATED ALWAYS AS (lower(btrim(regexp_replace(full_name, '\\s+'::text, ' '::text, 'g'::text)))) STORED,
    dob date,
    dob_precision text DEFAULT 'DAY'::text NOT NULL,
    approx_age_years integer,
    age_recorded_on date,
    sex text NOT NULL,
    blood_group text,
    phone_raw text,
    phone_e164 text,
    phone_country_hint text,
    email text,
    merged_into_id uuid,
    status public.subject_status DEFAULT 'ACTIVE'::public.subject_status NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    updated_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT health_subjects_check CHECK (((status = 'MERGED'::public.subject_status) = (merged_into_id IS NOT NULL))),
    CONSTRAINT health_subjects_check1 CHECK (((kind = 'SELF'::public.subject_kind) OR (claimed_profile_id IS NULL)))
);

ALTER TABLE ONLY public.health_subjects FORCE ROW LEVEL SECURITY;


--
-- Name: healthcare_organizations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.healthcare_organizations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    legal_name text NOT NULL,
    display_name text NOT NULL,
    org_type text NOT NULL,
    country_code text NOT NULL,
    public_code text,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    updated_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT healthcare_organizations_country_code_check CHECK ((country_code ~ '^[A-Z]{2}$'::text))
);

ALTER TABLE ONLY public.healthcare_organizations FORCE ROW LEVEL SECURITY;


--
-- Name: metric_classification_registry; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.metric_classification_registry (
    classification_code text NOT NULL
);

ALTER TABLE ONLY public.metric_classification_registry FORCE ROW LEVEL SECURITY;


--
-- Name: metric_contributions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.metric_contributions (
    metric_code text NOT NULL,
    source_event_key uuid NOT NULL,
    period_day date NOT NULL,
    doctor_id uuid,
    practice_location_id uuid,
    delta smallint NOT NULL,
    classification_code text,
    ingested_on date DEFAULT CURRENT_DATE NOT NULL,
    contribution_seq bigint NOT NULL,
    CONSTRAINT metric_contributions_delta_check CHECK ((delta = ANY (ARRAY['-1'::integer, 1])))
);

ALTER TABLE ONLY public.metric_contributions FORCE ROW LEVEL SECURITY;


--
-- Name: metric_contributions_contribution_seq_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.metric_contributions_contribution_seq_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: metric_contributions_contribution_seq_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.metric_contributions_contribution_seq_seq OWNED BY public.metric_contributions.contribution_seq;


--
-- Name: metric_definitions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.metric_definitions (
    metric_code text NOT NULL,
    display_name text NOT NULL,
    unit text NOT NULL,
    allowed_dimensions text[] NOT NULL,
    is_active boolean DEFAULT true NOT NULL
);

ALTER TABLE ONLY public.metric_definitions FORCE ROW LEVEL SECURITY;


--
-- Name: metric_rollups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.metric_rollups (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    metric_code text NOT NULL,
    period_kind public.metric_period_kind NOT NULL,
    period_start date NOT NULL,
    doctor_id uuid,
    practice_location_id uuid,
    count_value bigint DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);

ALTER TABLE ONLY public.metric_rollups FORCE ROW LEVEL SECURITY;


--
-- Name: metric_source_refs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.metric_source_refs (
    source_ref uuid DEFAULT gen_random_uuid() NOT NULL,
    object_kind text NOT NULL,
    object_id uuid NOT NULL,
    transition text NOT NULL,
    transition_seq integer DEFAULT 0 NOT NULL
);

ALTER TABLE ONLY public.metric_source_refs FORCE ROW LEVEL SECURITY;


--
-- Name: practice_locations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.practice_locations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid,
    name text NOT NULL,
    location_type public.location_type NOT NULL,
    public_short_code text,
    country_code text NOT NULL,
    admin_area text,
    city text,
    address text,
    postal_code text,
    geo_lat numeric(9,6),
    geo_lng numeric(9,6),
    timezone text NOT NULL,
    phone text,
    logo_path text,
    settings jsonb DEFAULT '{}'::jsonb NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    is_bookable boolean DEFAULT false NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    updated_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT practice_locations_check CHECK (((geo_lat IS NULL) = (geo_lng IS NULL))),
    CONSTRAINT practice_locations_geo_lat_check CHECK (((geo_lat IS NULL) OR ((geo_lat >= ('-90'::integer)::numeric) AND (geo_lat <= (90)::numeric)))),
    CONSTRAINT practice_locations_geo_lng_check CHECK (((geo_lng IS NULL) OR ((geo_lng >= ('-180'::integer)::numeric) AND (geo_lng <= (180)::numeric))))
);

ALTER TABLE ONLY public.practice_locations FORCE ROW LEVEL SECURITY;


--
-- Name: practice_memberships; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.practice_memberships (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    practice_location_id uuid NOT NULL,
    profile_id uuid NOT NULL,
    role public.practice_role NOT NULL,
    status text DEFAULT 'ACTIVE'::text NOT NULL,
    invited_by uuid,
    joined_at timestamp with time zone
);

ALTER TABLE ONLY public.practice_memberships FORCE ROW LEVEL SECURITY;


--
-- Name: prescription_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.prescription_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    prescription_id uuid NOT NULL,
    event text NOT NULL,
    actor_kind public.actor_kind NOT NULL,
    actor_id uuid,
    occurred_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    seq bigint NOT NULL
);

ALTER TABLE ONLY public.prescription_events FORCE ROW LEVEL SECURITY;


--
-- Name: prescription_events_seq_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.prescription_events_seq_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: prescription_events_seq_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.prescription_events_seq_seq OWNED BY public.prescription_events.seq;


--
-- Name: prescription_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.prescription_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    prescription_id uuid NOT NULL,
    display_name text NOT NULL,
    brand_name text,
    generic_name text,
    strength_text text,
    dose_text text,
    dosage_form text,
    route text,
    schedule_text text,
    duration_text text,
    quantity_text text,
    food_relation text,
    is_prn boolean DEFAULT false NOT NULL,
    instructions text,
    substitution_allowed boolean DEFAULT false NOT NULL,
    "position" integer NOT NULL
);

ALTER TABLE ONLY public.prescription_items FORCE ROW LEVEL SECURITY;


--
-- Name: prescription_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.prescription_templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    doctor_id uuid NOT NULL,
    name text NOT NULL,
    template jsonb DEFAULT '{}'::jsonb NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);

ALTER TABLE ONLY public.prescription_templates FORCE ROW LEVEL SECURITY;


--
-- Name: prescriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.prescriptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    encounter_id uuid NOT NULL,
    owner_doctor_id uuid NOT NULL,
    owner_profession public.profession DEFAULT 'DOCTOR'::public.profession NOT NULL,
    clinical_patient_id uuid NOT NULL,
    practice_location_id uuid NOT NULL,
    status public.prescription_status DEFAULT 'DRAFT'::public.prescription_status NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    review_bundle_snapshot jsonb,
    review_digest text,
    signature_asset_path text,
    replaces_prescription_id uuid,
    replacement_reason text,
    snapshot_schema_version text,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    finalized_at timestamp with time zone,
    CONSTRAINT prescriptions_check CHECK (((status <> 'FINALIZED'::public.prescription_status) OR ((review_bundle_snapshot IS NOT NULL) AND (review_digest IS NOT NULL) AND (signature_asset_path IS NOT NULL)))),
    CONSTRAINT prescriptions_owner_profession_check CHECK ((owner_profession = 'DOCTOR'::public.profession))
);

ALTER TABLE ONLY public.prescriptions FORCE ROW LEVEL SECURITY;


--
-- Name: professional_credentials; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.professional_credentials (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    professional_profile_id uuid NOT NULL,
    regulator_id uuid NOT NULL,
    country_code text NOT NULL,
    profession public.profession NOT NULL,
    registration_display text NOT NULL,
    registration_normalized text GENERATED ALWAYS AS (NULLIF(upper(regexp_replace(registration_display, '[^A-Za-z0-9]'::text, ''::text, 'g'::text)), ''::text)) STORED,
    verification_status public.credential_status DEFAULT 'UNVERIFIED'::public.credential_status NOT NULL,
    verified_at timestamp with time zone,
    expires_at timestamp with time zone,
    source_kind public.credential_source DEFAULT 'SELF_ASSERTED'::public.credential_source NOT NULL,
    CONSTRAINT professional_credentials_check CHECK (((expires_at IS NULL) OR (expires_at > COALESCE(verified_at, clock_timestamp()))))
);

ALTER TABLE ONLY public.professional_credentials FORCE ROW LEVEL SECURITY;


--
-- Name: professional_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.professional_profiles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    profile_id uuid NOT NULL,
    profession public.profession NOT NULL,
    display_name text NOT NULL,
    designation text,
    qualification text,
    bio text,
    profile_slug text,
    profile_visibility text DEFAULT 'PRIVATE'::text NOT NULL,
    professional_photo_path text,
    signature_path text,
    patient_number_prefix text DEFAULT 'PT'::text NOT NULL,
    patient_number_seq integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    updated_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT professional_profiles_profile_slug_check CHECK (((profile_slug IS NULL) OR (profile_slug ~ '^[a-z0-9]([a-z0-9-]{1,38}[a-z0-9])$'::text))),
    CONSTRAINT professional_profiles_profile_visibility_check CHECK ((profile_visibility = ANY (ARRAY['PRIVATE'::text, 'PUBLIC'::text])))
);

ALTER TABLE ONLY public.professional_profiles FORCE ROW LEVEL SECURITY;


--
-- Name: profile_capabilities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profile_capabilities (
    profile_id uuid NOT NULL,
    capability public.capability NOT NULL,
    granted_by_kind text NOT NULL,
    source_row_id uuid,
    professional_profile_id uuid,
    effective_from timestamp with time zone NOT NULL,
    effective_until timestamp with time zone,
    refreshed_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT profile_capabilities_granted_by_kind_check CHECK ((granted_by_kind = ANY (ARRAY['CREDENTIAL'::text, 'BASELINE'::text])))
);

ALTER TABLE ONLY public.profile_capabilities FORCE ROW LEVEL SECURITY;


--
-- Name: profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profiles (
    id uuid NOT NULL,
    full_name text NOT NULL,
    phone_raw text,
    phone_e164 text,
    phone_country_hint text,
    locale text DEFAULT 'en'::text NOT NULL,
    primary_language text,
    timezone text,
    avatar_path text,
    onboarded_at timestamp with time zone,
    deactivated_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    updated_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT profiles_full_name_check CHECK (((length(full_name) >= 1) AND (length(full_name) <= 200))),
    CONSTRAINT profiles_phone_country_hint_check CHECK (((phone_country_hint IS NULL) OR (phone_country_hint ~ '^[A-Z]{2}$'::text))),
    CONSTRAINT profiles_phone_e164_check CHECK (((phone_e164 IS NULL) OR (phone_e164 ~ '^\\+[1-9][0-9]{1,14}$'::text)))
);

ALTER TABLE ONLY public.profiles FORCE ROW LEVEL SECURITY;


--
-- Name: queue_entries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.queue_entries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    appointment_id uuid NOT NULL,
    doctor_chamber_id uuid NOT NULL,
    practice_location_id uuid NOT NULL,
    session_date date NOT NULL,
    queue_token integer NOT NULL,
    priority integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);

ALTER TABLE ONLY public.queue_entries FORCE ROW LEVEL SECURITY;


--
-- Name: queue_token_counters; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.queue_token_counters (
    doctor_chamber_id uuid NOT NULL,
    session_date date NOT NULL,
    next_token integer DEFAULT 1 NOT NULL
);

ALTER TABLE ONLY public.queue_token_counters FORCE ROW LEVEL SECURITY;


--
-- Name: regulator_professions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.regulator_professions (
    regulator_id uuid NOT NULL,
    profession public.profession NOT NULL,
    registers_from date,
    registers_until date
);

ALTER TABLE ONLY public.regulator_professions FORCE ROW LEVEL SECURITY;


--
-- Name: regulators; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.regulators (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    country_code text NOT NULL,
    authority_code text NOT NULL,
    authority_name text NOT NULL,
    number_format_hint text,
    is_active boolean DEFAULT true NOT NULL,
    CONSTRAINT regulators_country_code_check CHECK ((country_code ~ '^[A-Z]{2}$'::text))
);

ALTER TABLE ONLY public.regulators FORCE ROW LEVEL SECURITY;


--
-- Name: subject_acquisition_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.subject_acquisition_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    health_subject_id uuid NOT NULL,
    event_kind text NOT NULL,
    organization_id uuid,
    practice_location_id uuid,
    doctor_id uuid,
    actor_kind public.actor_kind NOT NULL,
    actor_id uuid,
    occurred_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    seq bigint NOT NULL
);

ALTER TABLE ONLY public.subject_acquisition_events FORCE ROW LEVEL SECURITY;


--
-- Name: subject_acquisition_events_seq_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.subject_acquisition_events_seq_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: subject_acquisition_events_seq_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.subject_acquisition_events_seq_seq OWNED BY public.subject_acquisition_events.seq;


--
-- Name: buckets; Type: TABLE; Schema: storage; Owner: -
--

CREATE TABLE storage.buckets (
    id text NOT NULL,
    name text NOT NULL,
    public boolean NOT NULL
);


--
-- Name: objects; Type: TABLE; Schema: storage; Owner: -
--

CREATE TABLE storage.objects (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    bucket_id text NOT NULL,
    name text NOT NULL
);


--
-- Name: appointment_events seq; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointment_events ALTER COLUMN seq SET DEFAULT nextval('public.appointment_events_seq_seq'::regclass);


--
-- Name: audit_events seq; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_events ALTER COLUMN seq SET DEFAULT nextval('public.audit_events_seq_seq'::regclass);


--
-- Name: consent_events seq; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consent_events ALTER COLUMN seq SET DEFAULT nextval('public.consent_events_seq_seq'::regclass);


--
-- Name: encounter_events seq; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.encounter_events ALTER COLUMN seq SET DEFAULT nextval('public.encounter_events_seq_seq'::regclass);


--
-- Name: health_subject_access_events seq; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.health_subject_access_events ALTER COLUMN seq SET DEFAULT nextval('public.health_subject_access_events_seq_seq'::regclass);


--
-- Name: metric_contributions contribution_seq; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.metric_contributions ALTER COLUMN contribution_seq SET DEFAULT nextval('public.metric_contributions_contribution_seq_seq'::regclass);


--
-- Name: prescription_events seq; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prescription_events ALTER COLUMN seq SET DEFAULT nextval('public.prescription_events_seq_seq'::regclass);


--
-- Name: subject_acquisition_events seq; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subject_acquisition_events ALTER COLUMN seq SET DEFAULT nextval('public.subject_acquisition_events_seq_seq'::regclass);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: appointment_events appointment_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointment_events
    ADD CONSTRAINT appointment_events_pkey PRIMARY KEY (id);


--
-- Name: appointment_events appointment_events_seq_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointment_events
    ADD CONSTRAINT appointment_events_seq_key UNIQUE (seq);


--
-- Name: appointments appointments_id_owner_doctor_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointments
    ADD CONSTRAINT appointments_id_owner_doctor_id_key UNIQUE (id, owner_doctor_id);


--
-- Name: appointments appointments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointments
    ADD CONSTRAINT appointments_pkey PRIMARY KEY (id);


--
-- Name: appointments appointments_public_booking_ref_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointments
    ADD CONSTRAINT appointments_public_booking_ref_key UNIQUE (public_booking_ref);


--
-- Name: audit_events audit_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_events
    ADD CONSTRAINT audit_events_pkey PRIMARY KEY (id);


--
-- Name: audit_events audit_events_seq_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_events
    ADD CONSTRAINT audit_events_seq_key UNIQUE (seq);


--
-- Name: clinical_patients clinical_patients_id_owner_doctor_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clinical_patients
    ADD CONSTRAINT clinical_patients_id_owner_doctor_id_key UNIQUE (id, owner_doctor_id);


--
-- Name: clinical_patients clinical_patients_owner_doctor_id_patient_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clinical_patients
    ADD CONSTRAINT clinical_patients_owner_doctor_id_patient_number_key UNIQUE (owner_doctor_id, patient_number);


--
-- Name: clinical_patients clinical_patients_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clinical_patients
    ADD CONSTRAINT clinical_patients_pkey PRIMARY KEY (id);


--
-- Name: consent_events consent_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consent_events
    ADD CONSTRAINT consent_events_pkey PRIMARY KEY (id);


--
-- Name: consent_events consent_events_seq_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consent_events
    ADD CONSTRAINT consent_events_seq_key UNIQUE (seq);


--
-- Name: consent_records consent_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consent_records
    ADD CONSTRAINT consent_records_pkey PRIMARY KEY (id);


--
-- Name: dd_number_allocations dd_number_allocations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dd_number_allocations
    ADD CONSTRAINT dd_number_allocations_pkey PRIMARY KEY (dd_patient_number);


--
-- Name: doctor_chamber_hours doctor_chamber_hours_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.doctor_chamber_hours
    ADD CONSTRAINT doctor_chamber_hours_pkey PRIMARY KEY (id);


--
-- Name: doctor_chambers doctor_chambers_doctor_id_practice_location_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.doctor_chambers
    ADD CONSTRAINT doctor_chambers_doctor_id_practice_location_id_key UNIQUE (doctor_id, practice_location_id);


--
-- Name: doctor_chambers doctor_chambers_id_doctor_id_practice_location_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.doctor_chambers
    ADD CONSTRAINT doctor_chambers_id_doctor_id_practice_location_id_key UNIQUE (id, doctor_id, practice_location_id);


--
-- Name: doctor_chambers doctor_chambers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.doctor_chambers
    ADD CONSTRAINT doctor_chambers_pkey PRIMARY KEY (id);


--
-- Name: encounter_diagnoses encounter_diagnoses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.encounter_diagnoses
    ADD CONSTRAINT encounter_diagnoses_pkey PRIMARY KEY (id);


--
-- Name: encounter_events encounter_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.encounter_events
    ADD CONSTRAINT encounter_events_pkey PRIMARY KEY (id);


--
-- Name: encounter_events encounter_events_seq_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.encounter_events
    ADD CONSTRAINT encounter_events_seq_key UNIQUE (seq);


--
-- Name: encounter_investigations encounter_investigations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.encounter_investigations
    ADD CONSTRAINT encounter_investigations_pkey PRIMARY KEY (id);


--
-- Name: encounters encounters_id_owner_doctor_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.encounters
    ADD CONSTRAINT encounters_id_owner_doctor_id_key UNIQUE (id, owner_doctor_id);


--
-- Name: encounters encounters_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.encounters
    ADD CONSTRAINT encounters_pkey PRIMARY KEY (id);


--
-- Name: health_subject_access_events health_subject_access_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.health_subject_access_events
    ADD CONSTRAINT health_subject_access_events_pkey PRIMARY KEY (id);


--
-- Name: health_subject_access_events health_subject_access_events_seq_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.health_subject_access_events
    ADD CONSTRAINT health_subject_access_events_seq_key UNIQUE (seq);


--
-- Name: health_subject_access health_subject_access_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.health_subject_access
    ADD CONSTRAINT health_subject_access_pkey PRIMARY KEY (id);


--
-- Name: health_subject_number_aliases health_subject_number_aliases_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.health_subject_number_aliases
    ADD CONSTRAINT health_subject_number_aliases_pkey PRIMARY KEY (dd_patient_number);


--
-- Name: health_subject_origins health_subject_origins_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.health_subject_origins
    ADD CONSTRAINT health_subject_origins_pkey PRIMARY KEY (health_subject_id);


--
-- Name: health_subjects health_subjects_claimed_profile_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.health_subjects
    ADD CONSTRAINT health_subjects_claimed_profile_id_key UNIQUE (claimed_profile_id);


--
-- Name: health_subjects health_subjects_dd_patient_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.health_subjects
    ADD CONSTRAINT health_subjects_dd_patient_number_key UNIQUE (dd_patient_number);


--
-- Name: health_subjects health_subjects_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.health_subjects
    ADD CONSTRAINT health_subjects_pkey PRIMARY KEY (id);


--
-- Name: healthcare_organizations healthcare_organizations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.healthcare_organizations
    ADD CONSTRAINT healthcare_organizations_pkey PRIMARY KEY (id);


--
-- Name: healthcare_organizations healthcare_organizations_public_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.healthcare_organizations
    ADD CONSTRAINT healthcare_organizations_public_code_key UNIQUE (public_code);


--
-- Name: metric_classification_registry metric_classification_registry_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.metric_classification_registry
    ADD CONSTRAINT metric_classification_registry_pkey PRIMARY KEY (classification_code);


--
-- Name: metric_contributions metric_contributions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.metric_contributions
    ADD CONSTRAINT metric_contributions_pkey PRIMARY KEY (metric_code, source_event_key);


--
-- Name: metric_definitions metric_definitions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.metric_definitions
    ADD CONSTRAINT metric_definitions_pkey PRIMARY KEY (metric_code);


--
-- Name: metric_rollups metric_rollups_metric_code_period_kind_period_start_doctor__key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.metric_rollups
    ADD CONSTRAINT metric_rollups_metric_code_period_kind_period_start_doctor__key UNIQUE (metric_code, period_kind, period_start, doctor_id, practice_location_id);


--
-- Name: metric_rollups metric_rollups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.metric_rollups
    ADD CONSTRAINT metric_rollups_pkey PRIMARY KEY (id);


--
-- Name: metric_source_refs metric_source_refs_object_kind_object_id_transition_transit_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.metric_source_refs
    ADD CONSTRAINT metric_source_refs_object_kind_object_id_transition_transit_key UNIQUE (object_kind, object_id, transition, transition_seq);


--
-- Name: metric_source_refs metric_source_refs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.metric_source_refs
    ADD CONSTRAINT metric_source_refs_pkey PRIMARY KEY (source_ref);


--
-- Name: practice_locations practice_locations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.practice_locations
    ADD CONSTRAINT practice_locations_pkey PRIMARY KEY (id);


--
-- Name: practice_locations practice_locations_public_short_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.practice_locations
    ADD CONSTRAINT practice_locations_public_short_code_key UNIQUE (public_short_code);


--
-- Name: practice_memberships practice_memberships_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.practice_memberships
    ADD CONSTRAINT practice_memberships_pkey PRIMARY KEY (id);


--
-- Name: practice_memberships practice_memberships_practice_location_id_profile_id_role_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.practice_memberships
    ADD CONSTRAINT practice_memberships_practice_location_id_profile_id_role_key UNIQUE (practice_location_id, profile_id, role);


--
-- Name: prescription_events prescription_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prescription_events
    ADD CONSTRAINT prescription_events_pkey PRIMARY KEY (id);


--
-- Name: prescription_events prescription_events_seq_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prescription_events
    ADD CONSTRAINT prescription_events_seq_key UNIQUE (seq);


--
-- Name: prescription_items prescription_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prescription_items
    ADD CONSTRAINT prescription_items_pkey PRIMARY KEY (id);


--
-- Name: prescription_items prescription_items_prescription_id_position_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prescription_items
    ADD CONSTRAINT prescription_items_prescription_id_position_key UNIQUE (prescription_id, "position");


--
-- Name: prescription_templates prescription_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prescription_templates
    ADD CONSTRAINT prescription_templates_pkey PRIMARY KEY (id);


--
-- Name: prescriptions prescriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prescriptions
    ADD CONSTRAINT prescriptions_pkey PRIMARY KEY (id);


--
-- Name: professional_credentials professional_credentials_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.professional_credentials
    ADD CONSTRAINT professional_credentials_pkey PRIMARY KEY (id);


--
-- Name: professional_profiles professional_profiles_id_profession_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.professional_profiles
    ADD CONSTRAINT professional_profiles_id_profession_key UNIQUE (id, profession);


--
-- Name: professional_profiles professional_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.professional_profiles
    ADD CONSTRAINT professional_profiles_pkey PRIMARY KEY (id);


--
-- Name: professional_profiles professional_profiles_profile_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.professional_profiles
    ADD CONSTRAINT professional_profiles_profile_id_key UNIQUE (profile_id);


--
-- Name: professional_profiles professional_profiles_profile_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.professional_profiles
    ADD CONSTRAINT professional_profiles_profile_slug_key UNIQUE (profile_slug);


--
-- Name: profile_capabilities profile_capabilities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profile_capabilities
    ADD CONSTRAINT profile_capabilities_pkey PRIMARY KEY (profile_id, capability);


--
-- Name: profiles profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);


--
-- Name: queue_entries queue_entries_appointment_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.queue_entries
    ADD CONSTRAINT queue_entries_appointment_id_key UNIQUE (appointment_id);


--
-- Name: queue_entries queue_entries_doctor_chamber_id_session_date_queue_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.queue_entries
    ADD CONSTRAINT queue_entries_doctor_chamber_id_session_date_queue_token_key UNIQUE (doctor_chamber_id, session_date, queue_token);


--
-- Name: queue_entries queue_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.queue_entries
    ADD CONSTRAINT queue_entries_pkey PRIMARY KEY (id);


--
-- Name: queue_token_counters queue_token_counters_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.queue_token_counters
    ADD CONSTRAINT queue_token_counters_pkey PRIMARY KEY (doctor_chamber_id, session_date);


--
-- Name: regulator_professions regulator_professions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.regulator_professions
    ADD CONSTRAINT regulator_professions_pkey PRIMARY KEY (regulator_id, profession);


--
-- Name: regulators regulators_country_code_authority_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.regulators
    ADD CONSTRAINT regulators_country_code_authority_code_key UNIQUE (country_code, authority_code);


--
-- Name: regulators regulators_id_country_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.regulators
    ADD CONSTRAINT regulators_id_country_code_key UNIQUE (id, country_code);


--
-- Name: regulators regulators_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.regulators
    ADD CONSTRAINT regulators_pkey PRIMARY KEY (id);


--
-- Name: subject_acquisition_events subject_acquisition_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subject_acquisition_events
    ADD CONSTRAINT subject_acquisition_events_pkey PRIMARY KEY (id);


--
-- Name: subject_acquisition_events subject_acquisition_events_seq_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subject_acquisition_events
    ADD CONSTRAINT subject_acquisition_events_seq_key UNIQUE (seq);


--
-- Name: buckets buckets_pkey; Type: CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.buckets
    ADD CONSTRAINT buckets_pkey PRIMARY KEY (id);


--
-- Name: objects objects_pkey; Type: CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.objects
    ADD CONSTRAINT objects_pkey PRIMARY KEY (id);


--
-- Name: health_subject_access_live_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX health_subject_access_live_key ON public.health_subject_access USING btree (health_subject_id, profile_id, authority) WHERE (revoked_at IS NULL);


--
-- Name: health_subject_access_self_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX health_subject_access_self_key ON public.health_subject_access USING btree (health_subject_id) WHERE ((authority = 'SELF'::public.subject_authority) AND (revoked_at IS NULL));


--
-- Name: prescriptions_one_draft; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX prescriptions_one_draft ON public.prescriptions USING btree (encounter_id) WHERE (status = 'DRAFT'::public.prescription_status);


--
-- Name: professional_credentials_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX professional_credentials_status_idx ON public.professional_credentials USING btree (professional_profile_id, verification_status);


--
-- Name: professional_credentials_verified_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX professional_credentials_verified_key ON public.professional_credentials USING btree (regulator_id, registration_normalized) WHERE (verification_status = 'VERIFIED'::public.credential_status);


--
-- Name: audit_events audit_events_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER audit_events_append_only BEFORE DELETE OR UPDATE ON public.audit_events FOR EACH ROW EXECUTE FUNCTION public.prevent_append_only_change();


--
-- Name: health_subjects health_subject_dd_number_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER health_subject_dd_number_immutable BEFORE UPDATE ON public.health_subjects FOR EACH ROW EXECUTE FUNCTION public.prevent_dd_number_change();


--
-- Name: health_subject_origins health_subject_origins_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER health_subject_origins_append_only BEFORE DELETE OR UPDATE ON public.health_subject_origins FOR EACH ROW EXECUTE FUNCTION public.prevent_append_only_change();


--
-- Name: prescription_items prescription_items_finalized_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER prescription_items_finalized_immutable BEFORE INSERT OR DELETE OR UPDATE ON public.prescription_items FOR EACH ROW EXECUTE FUNCTION public.prevent_finalized_item_mutation();


--
-- Name: prescriptions prescriptions_finalized_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER prescriptions_finalized_immutable BEFORE UPDATE ON public.prescriptions FOR EACH ROW EXECUTE FUNCTION public.prevent_finalized_prescription_mutation();


--
-- Name: professional_credentials professional_credentials_capability_refresh; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER professional_credentials_capability_refresh AFTER INSERT OR DELETE OR UPDATE ON public.professional_credentials FOR EACH ROW EXECUTE FUNCTION public.refresh_capability_trigger();


--
-- Name: appointment_events appointment_events_appointment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointment_events
    ADD CONSTRAINT appointment_events_appointment_id_fkey FOREIGN KEY (appointment_id) REFERENCES public.appointments(id);


--
-- Name: appointments appointments_booked_by_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointments
    ADD CONSTRAINT appointments_booked_by_profile_id_fkey FOREIGN KEY (booked_by_profile_id) REFERENCES public.profiles(id);


--
-- Name: appointments appointments_clinical_patient_id_owner_doctor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointments
    ADD CONSTRAINT appointments_clinical_patient_id_owner_doctor_id_fkey FOREIGN KEY (clinical_patient_id, owner_doctor_id) REFERENCES public.clinical_patients(id, owner_doctor_id);


--
-- Name: appointments appointments_doctor_chamber_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointments
    ADD CONSTRAINT appointments_doctor_chamber_id_fkey FOREIGN KEY (doctor_chamber_id) REFERENCES public.doctor_chambers(id);


--
-- Name: appointments appointments_doctor_chamber_id_owner_doctor_id_practice_lo_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointments
    ADD CONSTRAINT appointments_doctor_chamber_id_owner_doctor_id_practice_lo_fkey FOREIGN KEY (doctor_chamber_id, owner_doctor_id, practice_location_id) REFERENCES public.doctor_chambers(id, doctor_id, practice_location_id);


--
-- Name: appointments appointments_owner_doctor_id_owner_profession_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointments
    ADD CONSTRAINT appointments_owner_doctor_id_owner_profession_fkey FOREIGN KEY (owner_doctor_id, owner_profession) REFERENCES public.professional_profiles(id, profession);


--
-- Name: appointments appointments_practice_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointments
    ADD CONSTRAINT appointments_practice_location_id_fkey FOREIGN KEY (practice_location_id) REFERENCES public.practice_locations(id);


--
-- Name: clinical_patients clinical_patients_merged_into_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clinical_patients
    ADD CONSTRAINT clinical_patients_merged_into_id_fkey FOREIGN KEY (merged_into_id) REFERENCES public.clinical_patients(id) ON DELETE RESTRICT;


--
-- Name: clinical_patients clinical_patients_owner_doctor_id_owner_profession_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clinical_patients
    ADD CONSTRAINT clinical_patients_owner_doctor_id_owner_profession_fkey FOREIGN KEY (owner_doctor_id, owner_profession) REFERENCES public.professional_profiles(id, profession);


--
-- Name: consent_events consent_events_consent_record_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consent_events
    ADD CONSTRAINT consent_events_consent_record_id_fkey FOREIGN KEY (consent_record_id) REFERENCES public.consent_records(id) ON DELETE RESTRICT;


--
-- Name: consent_records consent_records_health_subject_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consent_records
    ADD CONSTRAINT consent_records_health_subject_id_fkey FOREIGN KEY (health_subject_id) REFERENCES public.health_subjects(id) ON DELETE RESTRICT;


--
-- Name: consent_records consent_records_revoked_by_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consent_records
    ADD CONSTRAINT consent_records_revoked_by_profile_id_fkey FOREIGN KEY (revoked_by_profile_id) REFERENCES public.profiles(id);


--
-- Name: consent_records consent_records_subject_actor_access_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consent_records
    ADD CONSTRAINT consent_records_subject_actor_access_id_fkey FOREIGN KEY (subject_actor_access_id) REFERENCES public.health_subject_access(id);


--
-- Name: consent_records consent_records_subject_actor_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consent_records
    ADD CONSTRAINT consent_records_subject_actor_profile_id_fkey FOREIGN KEY (subject_actor_profile_id) REFERENCES public.profiles(id);


--
-- Name: doctor_chamber_hours doctor_chamber_hours_doctor_chamber_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.doctor_chamber_hours
    ADD CONSTRAINT doctor_chamber_hours_doctor_chamber_id_fkey FOREIGN KEY (doctor_chamber_id) REFERENCES public.doctor_chambers(id) ON DELETE RESTRICT;


--
-- Name: doctor_chambers doctor_chambers_doctor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.doctor_chambers
    ADD CONSTRAINT doctor_chambers_doctor_id_fkey FOREIGN KEY (doctor_id) REFERENCES public.professional_profiles(id) ON DELETE RESTRICT;


--
-- Name: doctor_chambers doctor_chambers_practice_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.doctor_chambers
    ADD CONSTRAINT doctor_chambers_practice_location_id_fkey FOREIGN KEY (practice_location_id) REFERENCES public.practice_locations(id) ON DELETE RESTRICT;


--
-- Name: encounter_diagnoses encounter_diagnoses_encounter_id_owner_doctor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.encounter_diagnoses
    ADD CONSTRAINT encounter_diagnoses_encounter_id_owner_doctor_id_fkey FOREIGN KEY (encounter_id, owner_doctor_id) REFERENCES public.encounters(id, owner_doctor_id) ON DELETE RESTRICT;


--
-- Name: encounter_events encounter_events_encounter_id_owner_doctor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.encounter_events
    ADD CONSTRAINT encounter_events_encounter_id_owner_doctor_id_fkey FOREIGN KEY (encounter_id, owner_doctor_id) REFERENCES public.encounters(id, owner_doctor_id);


--
-- Name: encounter_investigations encounter_investigations_encounter_id_owner_doctor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.encounter_investigations
    ADD CONSTRAINT encounter_investigations_encounter_id_owner_doctor_id_fkey FOREIGN KEY (encounter_id, owner_doctor_id) REFERENCES public.encounters(id, owner_doctor_id) ON DELETE RESTRICT;


--
-- Name: encounters encounters_clinical_patient_id_owner_doctor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.encounters
    ADD CONSTRAINT encounters_clinical_patient_id_owner_doctor_id_fkey FOREIGN KEY (clinical_patient_id, owner_doctor_id) REFERENCES public.clinical_patients(id, owner_doctor_id);


--
-- Name: encounters encounters_owner_doctor_id_owner_profession_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.encounters
    ADD CONSTRAINT encounters_owner_doctor_id_owner_profession_fkey FOREIGN KEY (owner_doctor_id, owner_profession) REFERENCES public.professional_profiles(id, profession);


--
-- Name: encounters encounters_practice_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.encounters
    ADD CONSTRAINT encounters_practice_location_id_fkey FOREIGN KEY (practice_location_id) REFERENCES public.practice_locations(id);


--
-- Name: health_subject_access_events health_subject_access_events_health_subject_access_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.health_subject_access_events
    ADD CONSTRAINT health_subject_access_events_health_subject_access_id_fkey FOREIGN KEY (health_subject_access_id) REFERENCES public.health_subject_access(id) ON DELETE RESTRICT;


--
-- Name: health_subject_access health_subject_access_granted_by_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.health_subject_access
    ADD CONSTRAINT health_subject_access_granted_by_profile_id_fkey FOREIGN KEY (granted_by_profile_id) REFERENCES public.profiles(id);


--
-- Name: health_subject_access health_subject_access_health_subject_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.health_subject_access
    ADD CONSTRAINT health_subject_access_health_subject_id_fkey FOREIGN KEY (health_subject_id) REFERENCES public.health_subjects(id) ON DELETE RESTRICT;


--
-- Name: health_subject_access health_subject_access_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.health_subject_access
    ADD CONSTRAINT health_subject_access_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE RESTRICT;


--
-- Name: health_subject_access health_subject_access_revoked_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.health_subject_access
    ADD CONSTRAINT health_subject_access_revoked_by_fkey FOREIGN KEY (revoked_by) REFERENCES public.profiles(id);


--
-- Name: health_subject_number_aliases health_subject_number_aliases_health_subject_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.health_subject_number_aliases
    ADD CONSTRAINT health_subject_number_aliases_health_subject_id_fkey FOREIGN KEY (health_subject_id) REFERENCES public.health_subjects(id) ON DELETE RESTRICT;


--
-- Name: health_subject_number_aliases health_subject_number_aliases_retired_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.health_subject_number_aliases
    ADD CONSTRAINT health_subject_number_aliases_retired_by_fkey FOREIGN KEY (retired_by) REFERENCES public.profiles(id);


--
-- Name: health_subject_origins health_subject_origins_health_subject_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.health_subject_origins
    ADD CONSTRAINT health_subject_origins_health_subject_id_fkey FOREIGN KEY (health_subject_id) REFERENCES public.health_subjects(id) ON DELETE RESTRICT;


--
-- Name: health_subject_origins health_subject_origins_origin_doctor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.health_subject_origins
    ADD CONSTRAINT health_subject_origins_origin_doctor_id_fkey FOREIGN KEY (origin_doctor_id) REFERENCES public.professional_profiles(id);


--
-- Name: health_subject_origins health_subject_origins_registered_by_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.health_subject_origins
    ADD CONSTRAINT health_subject_origins_registered_by_profile_id_fkey FOREIGN KEY (registered_by_profile_id) REFERENCES public.profiles(id);


--
-- Name: health_subjects health_subjects_claimed_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.health_subjects
    ADD CONSTRAINT health_subjects_claimed_profile_id_fkey FOREIGN KEY (claimed_profile_id) REFERENCES public.profiles(id);


--
-- Name: health_subjects health_subjects_dd_patient_number_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.health_subjects
    ADD CONSTRAINT health_subjects_dd_patient_number_fkey FOREIGN KEY (dd_patient_number) REFERENCES public.dd_number_allocations(dd_patient_number);


--
-- Name: health_subjects health_subjects_merged_into_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.health_subjects
    ADD CONSTRAINT health_subjects_merged_into_id_fkey FOREIGN KEY (merged_into_id) REFERENCES public.health_subjects(id) ON DELETE RESTRICT;


--
-- Name: metric_contributions metric_contributions_classification_code_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.metric_contributions
    ADD CONSTRAINT metric_contributions_classification_code_fkey FOREIGN KEY (classification_code) REFERENCES public.metric_classification_registry(classification_code);


--
-- Name: metric_contributions metric_contributions_doctor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.metric_contributions
    ADD CONSTRAINT metric_contributions_doctor_id_fkey FOREIGN KEY (doctor_id) REFERENCES public.professional_profiles(id);


--
-- Name: metric_contributions metric_contributions_metric_code_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.metric_contributions
    ADD CONSTRAINT metric_contributions_metric_code_fkey FOREIGN KEY (metric_code) REFERENCES public.metric_definitions(metric_code);


--
-- Name: metric_contributions metric_contributions_practice_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.metric_contributions
    ADD CONSTRAINT metric_contributions_practice_location_id_fkey FOREIGN KEY (practice_location_id) REFERENCES public.practice_locations(id);


--
-- Name: metric_contributions metric_contributions_source_event_key_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.metric_contributions
    ADD CONSTRAINT metric_contributions_source_event_key_fkey FOREIGN KEY (source_event_key) REFERENCES public.metric_source_refs(source_ref);


--
-- Name: metric_rollups metric_rollups_doctor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.metric_rollups
    ADD CONSTRAINT metric_rollups_doctor_id_fkey FOREIGN KEY (doctor_id) REFERENCES public.professional_profiles(id);


--
-- Name: metric_rollups metric_rollups_metric_code_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.metric_rollups
    ADD CONSTRAINT metric_rollups_metric_code_fkey FOREIGN KEY (metric_code) REFERENCES public.metric_definitions(metric_code);


--
-- Name: metric_rollups metric_rollups_practice_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.metric_rollups
    ADD CONSTRAINT metric_rollups_practice_location_id_fkey FOREIGN KEY (practice_location_id) REFERENCES public.practice_locations(id);


--
-- Name: practice_locations practice_locations_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.practice_locations
    ADD CONSTRAINT practice_locations_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id);


--
-- Name: practice_locations practice_locations_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.practice_locations
    ADD CONSTRAINT practice_locations_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.healthcare_organizations(id) ON DELETE RESTRICT;


--
-- Name: practice_memberships practice_memberships_invited_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.practice_memberships
    ADD CONSTRAINT practice_memberships_invited_by_fkey FOREIGN KEY (invited_by) REFERENCES public.profiles(id);


--
-- Name: practice_memberships practice_memberships_practice_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.practice_memberships
    ADD CONSTRAINT practice_memberships_practice_location_id_fkey FOREIGN KEY (practice_location_id) REFERENCES public.practice_locations(id) ON DELETE RESTRICT;


--
-- Name: practice_memberships practice_memberships_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.practice_memberships
    ADD CONSTRAINT practice_memberships_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE RESTRICT;


--
-- Name: prescription_events prescription_events_prescription_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prescription_events
    ADD CONSTRAINT prescription_events_prescription_id_fkey FOREIGN KEY (prescription_id) REFERENCES public.prescriptions(id) ON DELETE RESTRICT;


--
-- Name: prescription_items prescription_items_prescription_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prescription_items
    ADD CONSTRAINT prescription_items_prescription_id_fkey FOREIGN KEY (prescription_id) REFERENCES public.prescriptions(id) ON DELETE RESTRICT;


--
-- Name: prescription_templates prescription_templates_doctor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prescription_templates
    ADD CONSTRAINT prescription_templates_doctor_id_fkey FOREIGN KEY (doctor_id) REFERENCES public.professional_profiles(id);


--
-- Name: prescriptions prescriptions_clinical_patient_id_owner_doctor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prescriptions
    ADD CONSTRAINT prescriptions_clinical_patient_id_owner_doctor_id_fkey FOREIGN KEY (clinical_patient_id, owner_doctor_id) REFERENCES public.clinical_patients(id, owner_doctor_id);


--
-- Name: prescriptions prescriptions_encounter_id_owner_doctor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prescriptions
    ADD CONSTRAINT prescriptions_encounter_id_owner_doctor_id_fkey FOREIGN KEY (encounter_id, owner_doctor_id) REFERENCES public.encounters(id, owner_doctor_id);


--
-- Name: prescriptions prescriptions_owner_doctor_id_owner_profession_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prescriptions
    ADD CONSTRAINT prescriptions_owner_doctor_id_owner_profession_fkey FOREIGN KEY (owner_doctor_id, owner_profession) REFERENCES public.professional_profiles(id, profession);


--
-- Name: prescriptions prescriptions_practice_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prescriptions
    ADD CONSTRAINT prescriptions_practice_location_id_fkey FOREIGN KEY (practice_location_id) REFERENCES public.practice_locations(id);


--
-- Name: prescriptions prescriptions_replaces_prescription_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prescriptions
    ADD CONSTRAINT prescriptions_replaces_prescription_id_fkey FOREIGN KEY (replaces_prescription_id) REFERENCES public.prescriptions(id);


--
-- Name: professional_credentials professional_credentials_professional_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.professional_credentials
    ADD CONSTRAINT professional_credentials_professional_profile_id_fkey FOREIGN KEY (professional_profile_id) REFERENCES public.professional_profiles(id) ON DELETE CASCADE;


--
-- Name: professional_credentials professional_credentials_professional_profile_id_professio_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.professional_credentials
    ADD CONSTRAINT professional_credentials_professional_profile_id_professio_fkey FOREIGN KEY (professional_profile_id, profession) REFERENCES public.professional_profiles(id, profession);


--
-- Name: professional_credentials professional_credentials_regulator_id_country_code_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.professional_credentials
    ADD CONSTRAINT professional_credentials_regulator_id_country_code_fkey FOREIGN KEY (regulator_id, country_code) REFERENCES public.regulators(id, country_code);


--
-- Name: professional_credentials professional_credentials_regulator_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.professional_credentials
    ADD CONSTRAINT professional_credentials_regulator_id_fkey FOREIGN KEY (regulator_id) REFERENCES public.regulators(id);


--
-- Name: professional_credentials professional_credentials_regulator_id_profession_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.professional_credentials
    ADD CONSTRAINT professional_credentials_regulator_id_profession_fkey FOREIGN KEY (regulator_id, profession) REFERENCES public.regulator_professions(regulator_id, profession);


--
-- Name: professional_profiles professional_profiles_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.professional_profiles
    ADD CONSTRAINT professional_profiles_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE RESTRICT;


--
-- Name: profile_capabilities profile_capabilities_professional_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profile_capabilities
    ADD CONSTRAINT profile_capabilities_professional_profile_id_fkey FOREIGN KEY (professional_profile_id) REFERENCES public.professional_profiles(id);


--
-- Name: profile_capabilities profile_capabilities_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profile_capabilities
    ADD CONSTRAINT profile_capabilities_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: profiles profiles_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: queue_entries queue_entries_appointment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.queue_entries
    ADD CONSTRAINT queue_entries_appointment_id_fkey FOREIGN KEY (appointment_id) REFERENCES public.appointments(id) ON DELETE RESTRICT;


--
-- Name: queue_entries queue_entries_doctor_chamber_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.queue_entries
    ADD CONSTRAINT queue_entries_doctor_chamber_id_fkey FOREIGN KEY (doctor_chamber_id) REFERENCES public.doctor_chambers(id);


--
-- Name: queue_entries queue_entries_practice_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.queue_entries
    ADD CONSTRAINT queue_entries_practice_location_id_fkey FOREIGN KEY (practice_location_id) REFERENCES public.practice_locations(id);


--
-- Name: queue_token_counters queue_token_counters_doctor_chamber_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.queue_token_counters
    ADD CONSTRAINT queue_token_counters_doctor_chamber_id_fkey FOREIGN KEY (doctor_chamber_id) REFERENCES public.doctor_chambers(id) ON DELETE RESTRICT;


--
-- Name: regulator_professions regulator_professions_regulator_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.regulator_professions
    ADD CONSTRAINT regulator_professions_regulator_id_fkey FOREIGN KEY (regulator_id) REFERENCES public.regulators(id) ON DELETE RESTRICT;


--
-- Name: subject_acquisition_events subject_acquisition_events_doctor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subject_acquisition_events
    ADD CONSTRAINT subject_acquisition_events_doctor_id_fkey FOREIGN KEY (doctor_id) REFERENCES public.professional_profiles(id);


--
-- Name: subject_acquisition_events subject_acquisition_events_health_subject_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subject_acquisition_events
    ADD CONSTRAINT subject_acquisition_events_health_subject_id_fkey FOREIGN KEY (health_subject_id) REFERENCES public.health_subjects(id) ON DELETE RESTRICT;


--
-- Name: appointment_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.appointment_events ENABLE ROW LEVEL SECURITY;

--
-- Name: appointment_events appointment_events_owner_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY appointment_events_owner_read ON public.appointment_events FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.appointments a
  WHERE ((a.id = appointment_events.appointment_id) AND (a.owner_doctor_id = public.current_doctor_id())))));


--
-- Name: appointments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;

--
-- Name: appointments appointments_owner_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY appointments_owner_read ON public.appointments FOR SELECT USING ((owner_doctor_id = public.current_doctor_id()));


--
-- Name: audit_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;

--
-- Name: audit_events audit_events_actor_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY audit_events_actor_read ON public.audit_events FOR SELECT USING ((actor_id = public.current_profile_id()));


--
-- Name: clinical_patients; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.clinical_patients ENABLE ROW LEVEL SECURITY;

--
-- Name: clinical_patients clinical_patients_owner_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY clinical_patients_owner_read ON public.clinical_patients FOR SELECT USING ((owner_doctor_id = public.current_doctor_id()));


--
-- Name: consent_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.consent_events ENABLE ROW LEVEL SECURITY;

--
-- Name: consent_records; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.consent_records ENABLE ROW LEVEL SECURITY;

--
-- Name: consent_records consent_subject_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY consent_subject_read ON public.consent_records FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.health_subject_access a
  WHERE ((a.health_subject_id = consent_records.health_subject_id) AND (a.profile_id = public.current_profile_id()) AND public.is_live_edge(a.effective_from, a.expires_at, a.revoked_at)))));


--
-- Name: dd_number_allocations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.dd_number_allocations ENABLE ROW LEVEL SECURITY;

--
-- Name: doctor_chamber_hours; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.doctor_chamber_hours ENABLE ROW LEVEL SECURITY;

--
-- Name: doctor_chamber_hours doctor_chamber_hours_owner_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY doctor_chamber_hours_owner_read ON public.doctor_chamber_hours FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.doctor_chambers c
  WHERE ((c.id = doctor_chamber_hours.doctor_chamber_id) AND (c.doctor_id = public.current_doctor_id())))));


--
-- Name: doctor_chambers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.doctor_chambers ENABLE ROW LEVEL SECURITY;

--
-- Name: doctor_chambers doctor_chambers_owner_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY doctor_chambers_owner_read ON public.doctor_chambers FOR SELECT USING ((doctor_id = public.current_doctor_id()));


--
-- Name: encounter_diagnoses; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.encounter_diagnoses ENABLE ROW LEVEL SECURITY;

--
-- Name: encounter_diagnoses encounter_diagnoses_owner_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY encounter_diagnoses_owner_read ON public.encounter_diagnoses FOR SELECT USING ((owner_doctor_id = public.current_doctor_id()));


--
-- Name: encounter_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.encounter_events ENABLE ROW LEVEL SECURITY;

--
-- Name: encounter_events encounter_events_owner_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY encounter_events_owner_read ON public.encounter_events FOR SELECT USING ((owner_doctor_id = public.current_doctor_id()));


--
-- Name: encounter_investigations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.encounter_investigations ENABLE ROW LEVEL SECURITY;

--
-- Name: encounter_investigations encounter_investigations_owner_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY encounter_investigations_owner_read ON public.encounter_investigations FOR SELECT USING ((owner_doctor_id = public.current_doctor_id()));


--
-- Name: encounters; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.encounters ENABLE ROW LEVEL SECURITY;

--
-- Name: encounters encounters_owner_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY encounters_owner_read ON public.encounters FOR SELECT USING ((owner_doctor_id = public.current_doctor_id()));


--
-- Name: health_subject_access; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.health_subject_access ENABLE ROW LEVEL SECURITY;

--
-- Name: health_subject_access_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.health_subject_access_events ENABLE ROW LEVEL SECURITY;

--
-- Name: health_subject_access health_subject_access_self_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY health_subject_access_self_read ON public.health_subject_access FOR SELECT USING ((profile_id = public.current_profile_id()));


--
-- Name: health_subject_number_aliases; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.health_subject_number_aliases ENABLE ROW LEVEL SECURITY;

--
-- Name: health_subject_origins; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.health_subject_origins ENABLE ROW LEVEL SECURITY;

--
-- Name: health_subjects; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.health_subjects ENABLE ROW LEVEL SECURITY;

--
-- Name: health_subjects health_subjects_access_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY health_subjects_access_read ON public.health_subjects FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.health_subject_access a
  WHERE ((a.health_subject_id = health_subjects.id) AND (a.profile_id = public.current_profile_id()) AND public.is_live_edge(a.effective_from, a.expires_at, a.revoked_at)))));


--
-- Name: healthcare_organizations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.healthcare_organizations ENABLE ROW LEVEL SECURITY;

--
-- Name: metric_classification_registry; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.metric_classification_registry ENABLE ROW LEVEL SECURITY;

--
-- Name: metric_contributions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.metric_contributions ENABLE ROW LEVEL SECURITY;

--
-- Name: metric_definitions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.metric_definitions ENABLE ROW LEVEL SECURITY;

--
-- Name: metric_rollups; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.metric_rollups ENABLE ROW LEVEL SECURITY;

--
-- Name: metric_rollups metric_rollups_no_direct_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY metric_rollups_no_direct_read ON public.metric_rollups FOR SELECT USING (false);


--
-- Name: metric_source_refs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.metric_source_refs ENABLE ROW LEVEL SECURITY;

--
-- Name: practice_locations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.practice_locations ENABLE ROW LEVEL SECURITY;

--
-- Name: practice_locations practice_locations_member_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY practice_locations_member_read ON public.practice_locations FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.practice_memberships pm
  WHERE ((pm.practice_location_id = practice_locations.id) AND (pm.profile_id = public.current_profile_id()) AND (pm.status = 'ACTIVE'::text)))));


--
-- Name: practice_memberships; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.practice_memberships ENABLE ROW LEVEL SECURITY;

--
-- Name: practice_memberships practice_memberships_self_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY practice_memberships_self_read ON public.practice_memberships FOR SELECT USING ((profile_id = public.current_profile_id()));


--
-- Name: prescription_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.prescription_events ENABLE ROW LEVEL SECURITY;

--
-- Name: prescription_events prescription_events_owner_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY prescription_events_owner_read ON public.prescription_events FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.prescriptions p
  WHERE ((p.id = prescription_events.prescription_id) AND (p.owner_doctor_id = public.current_doctor_id())))));


--
-- Name: prescription_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.prescription_items ENABLE ROW LEVEL SECURITY;

--
-- Name: prescription_items prescription_items_owner_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY prescription_items_owner_read ON public.prescription_items FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.prescriptions p
  WHERE ((p.id = prescription_items.prescription_id) AND (p.owner_doctor_id = public.current_doctor_id())))));


--
-- Name: prescription_templates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.prescription_templates ENABLE ROW LEVEL SECURITY;

--
-- Name: prescriptions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.prescriptions ENABLE ROW LEVEL SECURITY;

--
-- Name: prescriptions prescriptions_owner_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY prescriptions_owner_read ON public.prescriptions FOR SELECT USING ((owner_doctor_id = public.current_doctor_id()));


--
-- Name: professional_credentials; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.professional_credentials ENABLE ROW LEVEL SECURITY;

--
-- Name: professional_profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.professional_profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: professional_profiles professional_profiles_custodial_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY professional_profiles_custodial_read ON public.professional_profiles FOR SELECT USING ((profile_id = public.current_profile_id()));


--
-- Name: profile_capabilities; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.profile_capabilities ENABLE ROW LEVEL SECURITY;

--
-- Name: profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: profiles profiles_self_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY profiles_self_read ON public.profiles FOR SELECT USING ((id = public.current_profile_id()));


--
-- Name: queue_entries; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.queue_entries ENABLE ROW LEVEL SECURITY;

--
-- Name: queue_entries queue_entries_owner_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY queue_entries_owner_read ON public.queue_entries FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.appointments a
  WHERE ((a.id = queue_entries.appointment_id) AND (a.owner_doctor_id = public.current_doctor_id())))));


--
-- Name: queue_token_counters; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.queue_token_counters ENABLE ROW LEVEL SECURITY;

--
-- Name: regulator_professions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.regulator_professions ENABLE ROW LEVEL SECURITY;

--
-- Name: regulators; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.regulators ENABLE ROW LEVEL SECURITY;

--
-- Name: subject_acquisition_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.subject_acquisition_events ENABLE ROW LEVEL SECURITY;

--
-- Name: objects frozen_prescription_assets_no_delete; Type: POLICY; Schema: storage; Owner: -
--

CREATE POLICY frozen_prescription_assets_no_delete ON storage.objects FOR DELETE TO authenticated USING (false);


--
-- Name: objects private_objects_no_anon; Type: POLICY; Schema: storage; Owner: -
--

CREATE POLICY private_objects_no_anon ON storage.objects TO anon USING (false) WITH CHECK (false);


--
-- Name: objects private_objects_owner_path; Type: POLICY; Schema: storage; Owner: -
--

CREATE POLICY private_objects_owner_path ON storage.objects FOR SELECT TO authenticated USING (((bucket_id = ANY (ARRAY['doctor-profile-photos'::text, 'doctor-signatures'::text])) AND (split_part(name, '/'::text, 1) = (auth.uid())::text)));


--
-- Name: objects private_objects_owner_write; Type: POLICY; Schema: storage; Owner: -
--

CREATE POLICY private_objects_owner_write ON storage.objects FOR INSERT TO authenticated WITH CHECK (((bucket_id = ANY (ARRAY['doctor-profile-photos'::text, 'doctor-signatures'::text])) AND (split_part(name, '/'::text, 1) = (auth.uid())::text)));


--
-- PostgreSQL database dump complete
--

\unrestrict DD_P0_GOLDEN

