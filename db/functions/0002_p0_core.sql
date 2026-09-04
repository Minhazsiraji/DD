create or replace function public.normalize_dd_number(input text)
returns text language plpgsql immutable strict as $$
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

create or replace function public.dd_check_symbol(data text)
returns text language plpgsql immutable strict as $$
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

create or replace function public.allocate_dd_patient_number()
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare
  alphabet constant text := '0123456789ABCDFGHJKMNPQRSTVWXYZ';
  data text := '';
  candidate text;
  byte integer;
begin
  for attempt in 1..8 loop
    data := '';
    while length(data) < 9 loop
      byte := get_byte(extensions.gen_random_bytes(1), 0);
      if byte < 248 then data := data || substr(alphabet, (byte % 31) + 1, 1); end if;
    end loop;
    candidate := data || public.dd_check_symbol(data);
    begin
      insert into public.dd_number_allocations(dd_patient_number) values (candidate);
      return candidate;
    exception when unique_violation then null;
    end;
  end loop;
  raise exception 'DD_NUMBER_ALLOCATION_EXHAUSTED' using errcode = 'P0001';
end $$;

create or replace function public.current_profile_id()
returns uuid language sql stable security definer set search_path = public, pg_temp as $$
  select auth.uid()
$$;

create or replace function public.current_doctor_id()
returns uuid language sql stable security definer set search_path = public, pg_temp as $$
  select pp.id from public.professional_profiles pp where pp.profile_id = public.current_profile_id() and pp.profession = 'DOCTOR'
$$;

create or replace function public.has_capability(subject_profile_id uuid, requested capability)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.profile_capabilities pc
    where pc.profile_id = subject_profile_id and pc.capability = requested
      and pc.effective_from <= clock_timestamp()
      and (pc.effective_until is null or pc.effective_until > clock_timestamp())
  )
$$;

create or replace function public.refresh_profile_capabilities(subject_profile_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  delete from public.profile_capabilities where profile_id = subject_profile_id;
  insert into public.profile_capabilities(profile_id, capability, granted_by_kind, source_row_id, professional_profile_id, effective_from, effective_until)
  select
    pp.profile_id,
    'DOCTOR',
    'CREDENTIAL',
    pc.id,
    pp.id,
    pc.verified_at,
    pc.expires_at
  from public.professional_credentials pc
  join public.professional_profiles pp
    on pp.id = pc.professional_profile_id
   and pp.profession = 'DOCTOR'
  where pp.profile_id = subject_profile_id
    and pc.profession = 'DOCTOR'
    and pc.verification_status = 'VERIFIED'
    and pc.verified_at is not null
    and pc.verified_at <= clock_timestamp()
    and (
      pc.expires_at is null
      or pc.expires_at > clock_timestamp()
    )
  order by
    pc.verified_at desc,
    pc.id asc
  limit 1;
  insert into public.profile_capabilities(profile_id, capability, granted_by_kind, effective_from)
  values (subject_profile_id, 'PUBLIC', 'BASELINE', clock_timestamp());
end $$;

create or replace function public.refresh_capability_trigger()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.refresh_profile_capabilities((select profile_id from public.professional_profiles where id = coalesce(new.professional_profile_id, old.professional_profile_id)));
  return new;
end $$;
create trigger professional_credentials_capability_refresh after insert or update or delete on professional_credentials
for each row execute function public.refresh_capability_trigger();

create or replace function public.is_live_edge(effective_from timestamptz, expires_at timestamptz, revoked_at timestamptz)
returns boolean language sql stable as $$
  select effective_from <= clock_timestamp() and (expires_at is null or expires_at > clock_timestamp()) and revoked_at is null
$$;

create or replace function public.prevent_dd_number_change()
returns trigger language plpgsql as $$
begin
  if new.dd_patient_number is distinct from old.dd_patient_number then raise exception 'DD_NUMBER_IMMUTABLE' using errcode = 'P0001'; end if;
  return new;
end $$;
create trigger health_subject_dd_number_immutable before update on health_subjects
for each row execute function public.prevent_dd_number_change();

create or replace function public.prevent_append_only_change()
returns trigger language plpgsql as $$
begin
  raise exception 'APPEND_ONLY_RECORD' using errcode='P0001';
end $$;
create trigger health_subject_origins_append_only before update or delete on health_subject_origins
for each row execute function public.prevent_append_only_change();
create trigger audit_events_append_only before update or delete on audit_events
for each row execute function public.prevent_append_only_change();

create or replace function public.create_professional_profile(display_name text, profession profession)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare result uuid;
begin
  if public.current_profile_id() is null then raise exception 'AUTHENTICATION_REQUIRED' using errcode='42501'; end if;
  insert into public.professional_profiles(profile_id, display_name, profession) values (public.current_profile_id(), display_name, profession)
  returning id into result;
  return result;
end $$;

create or replace function public.emit_audit_event(action_code text, resource_kind text, resource_key uuid, correlation_key uuid default null)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare result uuid;
begin
  if action_code !~ '^[A-Z][A-Z0-9_.-]{1,63}$' or resource_kind !~ '^[a-z][a-z0-9_.-]{1,63}$' then
    raise exception 'AUDIT_CODE_INVALID' using errcode='P0001';
  end if;
  insert into public.audit_events(actor_kind, actor_id, action, resource_type, resource_id, correlation_id)
  values ('USER', public.current_profile_id(), action_code, resource_kind, resource_key, correlation_key)
  returning id into result;
  return result;
end $$;


-- ---------------------------------------------------------------------------
-- P0 trusted anonymous-ingress context.
--
-- The browser/anon role cannot call this setter. The trusted DD public ingress
-- connects with the narrow dd_public_ingress LOGIN role, derives all HMAC
-- digests outside PostgreSQL using the uncommitted server secret, then sets
-- transaction-local context here. The three public RPCs never accept these
-- trusted values as caller arguments.
-- ---------------------------------------------------------------------------

create or replace function public.set_public_ingress_context(
  session_ref uuid,
  session_started_at timestamptz,
  session_digest bytea,
  network_digest bytea,
  resource_digest bytea,
  public_source public.appointment_source,
  request_key uuid
)
returns void
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
begin
  if session_user <> 'dd_public_ingress' then
    raise exception 'TRUSTED_PUBLIC_INGRESS_REQUIRED' using errcode='42501';
  end if;

  if session_ref is null
     or session_started_at is null
     or session_digest is null
     or network_digest is null
     or resource_digest is null
     or public_source is null
     or request_key is null then
    raise exception 'TRUSTED_PUBLIC_CONTEXT_INCOMPLETE' using errcode='42501';
  end if;

  if session_ref::text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception 'ANON_SESSION_REF_INVALID' using errcode='22023';
  end if;

  if request_key::text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception 'PUBLIC_REQUEST_ID_INVALID' using errcode='22023';
  end if;

  if session_started_at > clock_timestamp()
     or session_started_at <= clock_timestamp() - interval '24 hours' then
    raise exception 'ANON_SESSION_EXPIRED_OR_INVALID' using errcode='22023';
  end if;

  if octet_length(session_digest) <> 32
     or octet_length(network_digest) <> 32
     or octet_length(resource_digest) <> 32 then
    raise exception 'PUBLIC_RATE_DIGEST_INVALID' using errcode='22023';
  end if;

  if public_source not in ('PUBLIC_WEB','PUBLIC_APP') then
    raise exception 'PUBLIC_SOURCE_INVALID' using errcode='22023';
  end if;

  perform pg_catalog.set_config('dd.anon_session_ref', session_ref::text, true);
  perform pg_catalog.set_config('dd.anon_session_started_at', session_started_at::text, true);
  perform pg_catalog.set_config('dd.anon_session_digest', encode(session_digest, 'hex'), true);
  perform pg_catalog.set_config('dd.network_digest', encode(network_digest, 'hex'), true);
  perform pg_catalog.set_config('dd.resource_digest', encode(resource_digest, 'hex'), true);
  perform pg_catalog.set_config('dd.public_source_channel', public_source::text, true);
  perform pg_catalog.set_config('dd.public_request_id', request_key::text, true);
  perform pg_catalog.set_config('dd.public_ingress_ready', '1', true);
end $$;


create or replace function public.require_public_ingress_context()
returns void
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
declare
  session_ref text;
  session_started text;
  session_digest text;
  network_digest text;
  resource_digest text;
  public_source text;
  request_key text;
begin
  if session_user <> 'dd_public_ingress' then
    raise exception 'TRUSTED_PUBLIC_INGRESS_REQUIRED' using errcode='42501';
  end if;

  if current_setting('dd.public_ingress_ready', true) is distinct from '1' then
    raise exception 'TRUSTED_PUBLIC_CONTEXT_REQUIRED' using errcode='42501';
  end if;

  session_ref := current_setting('dd.anon_session_ref', true);
  session_started := current_setting('dd.anon_session_started_at', true);
  session_digest := current_setting('dd.anon_session_digest', true);
  network_digest := current_setting('dd.network_digest', true);
  resource_digest := current_setting('dd.resource_digest', true);
  public_source := current_setting('dd.public_source_channel', true);
  request_key := current_setting('dd.public_request_id', true);

  if session_ref is null
     or session_started is null
     or session_digest is null
     or network_digest is null
     or resource_digest is null
     or public_source is null
     or request_key is null then
    raise exception 'TRUSTED_PUBLIC_CONTEXT_INCOMPLETE' using errcode='42501';
  end if;

  if session_ref !~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     or request_key !~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     or session_started::timestamptz > clock_timestamp()
     or session_started::timestamptz <= clock_timestamp() - interval '24 hours'
     or length(session_digest) <> 64
     or length(network_digest) <> 64
     or length(resource_digest) <> 64
     or public_source not in ('PUBLIC_WEB','PUBLIC_APP') then
    raise exception 'TRUSTED_PUBLIC_CONTEXT_INVALID' using errcode='42501';
  end if;
end $$;


-- ---------------------------------------------------------------------------
-- Atomic DB-authoritative anonymous rate consumption.
--
-- Fixed acquisition order is deliberate so concurrent callers acquire the four
-- bucket rows consistently. Each bucket is updated with a single
-- INSERT ... ON CONFLICT ... WHERE operation, so two simultaneous requests
-- cannot both cross the same configured budget.
-- ---------------------------------------------------------------------------

create or replace function public.consume_anon_rate_limit(target_rpc text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  bucket_order constant text[] := array[
    'SESSION_GLOBAL',
    'NETWORK_GLOBAL',
    'SESSION_RESOURCE',
    'NETWORK_RESOURCE'
  ];
  bucket_name text;
  policy record;
  bucket_key bytea;
  now_at timestamptz := clock_timestamp();
  window_start timestamptz;
  expiry_at timestamptz;
  observed_count integer;
  allowed boolean := true;
begin
  perform public.require_public_ingress_context();

  if target_rpc not in (
    'PUBLIC_CHAMBER_AVAILABILITY',
    'CREATE_PUBLIC_BOOKING',
    'PUBLIC_BOOKING_STATUS'
  ) then
    raise exception 'ANON_RPC_CODE_INVALID' using errcode='22023';
  end if;

  foreach bucket_name in array bucket_order loop
    select
      p.rpc_code,
      p.bucket_kind,
      p.window_seconds,
      p.max_requests,
      p.policy_version
    into policy
    from public.anon_rate_limit_policies p
    where p.rpc_code = target_rpc
      and p.bucket_kind = bucket_name
      and p.enabled
      and p.effective_from <= now_at
    order by p.effective_from desc
    limit 1;

    if not found then
      raise exception 'ANON_RATE_POLICY_MISSING' using errcode='P0001';
    end if;

    bucket_key := case bucket_name
      when 'SESSION_GLOBAL'
        then decode(current_setting('dd.anon_session_digest'), 'hex')
      when 'NETWORK_GLOBAL'
        then decode(current_setting('dd.network_digest'), 'hex')
      when 'SESSION_RESOURCE'
        then extensions.digest(
          decode(current_setting('dd.anon_session_digest'), 'hex')
          || decode(current_setting('dd.resource_digest'), 'hex'),
          'sha256'
        )
      when 'NETWORK_RESOURCE'
        then extensions.digest(
          decode(current_setting('dd.network_digest'), 'hex')
          || decode(current_setting('dd.resource_digest'), 'hex'),
          'sha256'
        )
    end;

    window_start :=
      to_timestamp(
        floor(extract(epoch from now_at) / policy.window_seconds)
        * policy.window_seconds
      );

    expiry_at :=
      window_start
      + pg_catalog.make_interval(secs => policy.window_seconds * 2);

    observed_count := null;

    insert into public.anon_rate_limit_buckets as b(
      rpc_code,
      bucket_kind,
      policy_version,
      key_digest,
      window_started_at,
      request_count,
      last_seen_at,
      expires_at
    )
    values (
      target_rpc,
      bucket_name,
      policy.policy_version,
      bucket_key,
      window_start,
      1,
      now_at,
      expiry_at
    )
    on conflict (rpc_code, bucket_kind, key_digest, window_started_at)
    do update
      set request_count = b.request_count + 1,
          policy_version = excluded.policy_version,
          last_seen_at = excluded.last_seen_at,
          expires_at = greatest(b.expires_at, excluded.expires_at)
      where b.request_count < policy.max_requests
    returning request_count into observed_count;

    if observed_count is null then
      allowed := false;
    end if;
  end loop;

  return allowed;
end $$;


-- ---------------------------------------------------------------------------
-- Bounded anonymous audit writer.
-- No free-form metadata and no booking/contact payload.
-- ---------------------------------------------------------------------------

create or replace function public.emit_anon_audit_event(
  target_rpc text,
  outcome_code text,
  resource_kind text,
  resource_key uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  result uuid;
  action_code text;
begin
  perform public.require_public_ingress_context();

  if target_rpc not in (
    'PUBLIC_CHAMBER_AVAILABILITY',
    'CREATE_PUBLIC_BOOKING',
    'PUBLIC_BOOKING_STATUS'
  ) then
    raise exception 'ANON_AUDIT_RPC_INVALID' using errcode='22023';
  end if;

  if outcome_code not in (
    'SUCCESS',
    'VALIDATION_FAILURE',
    'NOT_FOUND',
    'RATE_LIMITED',
    'INTERNAL_FAILURE'
  ) then
    raise exception 'ANON_AUDIT_OUTCOME_INVALID' using errcode='22023';
  end if;

  if resource_kind not in (
    'doctor_chamber',
    'public_booking',
    'anon_request'
  ) then
    raise exception 'ANON_AUDIT_RESOURCE_INVALID' using errcode='22023';
  end if;

  -- A raw public booking reference is prohibited in anonymous audit rows.
  if target_rpc = 'PUBLIC_BOOKING_STATUS' and resource_key is not null then
    raise exception 'RAW_BOOKING_REF_AUDIT_FORBIDDEN' using errcode='22023';
  end if;

  action_code := 'ANON.' || target_rpc || '.' || outcome_code;

  insert into public.audit_events(
    actor_kind,
    actor_id,
    action,
    resource_type,
    resource_id,
    request_id,
    anon_session_ref,
    ip,
    user_agent
  )
  values (
    'SYSTEM',
    null,
    action_code,
    resource_kind,
    resource_key,
    current_setting('dd.public_request_id')::uuid,
    current_setting('dd.anon_session_ref')::uuid,
    null,
    null
  )
  returning id into result;

  return result;
end $$;


-- ---------------------------------------------------------------------------
-- Restricted fallback for an unexpected transaction-aborting public-ingress
-- failure. The trusted application calls this in a NEW transaction after the
-- failed request; it accepts only bounded identifiers/outcome, never PII.
-- ---------------------------------------------------------------------------

create or replace function public.record_public_ingress_failure(
  target_rpc text,
  session_ref uuid,
  request_key uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  result uuid;
begin
  if session_user <> 'dd_public_ingress' then
    raise exception 'TRUSTED_PUBLIC_INGRESS_REQUIRED' using errcode='42501';
  end if;

  if session_ref is null or request_key is null then
    raise exception 'PUBLIC_FAILURE_AUDIT_ID_INVALID' using errcode='22023';
  end if;

  if target_rpc not in (
    'PUBLIC_CHAMBER_AVAILABILITY',
    'CREATE_PUBLIC_BOOKING',
    'PUBLIC_BOOKING_STATUS'
  ) then
    raise exception 'ANON_AUDIT_RPC_INVALID' using errcode='22023';
  end if;

  if session_ref::text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     or request_key::text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception 'PUBLIC_FAILURE_AUDIT_ID_INVALID' using errcode='22023';
  end if;

  insert into public.audit_events(
    actor_kind,
    actor_id,
    action,
    resource_type,
    resource_id,
    request_id,
    anon_session_ref,
    ip,
    user_agent
  )
  values (
    'SYSTEM',
    null,
    'ANON.' || target_rpc || '.INTERNAL_FAILURE',
    'anon_request',
    null,
    request_key,
    session_ref,
    null,
    null
  )
  returning id into result;

  return result;
end $$;


create or replace function public.create_health_subject(subject_name text, subject_kind subject_kind, subject_sex text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare result uuid; number text;
begin
  if public.current_profile_id() is null then raise exception 'AUTHENTICATION_REQUIRED' using errcode='42501'; end if;
  number := public.allocate_dd_patient_number();
  insert into public.health_subjects(dd_patient_number, kind, claimed_profile_id, full_name, sex)
  values (number, subject_kind, case when subject_kind='SELF' then public.current_profile_id() end, subject_name, subject_sex)
  returning id into result;
  update public.dd_number_allocations set health_subject_id=result where dd_patient_number=number;
  insert into public.health_subject_origins(health_subject_id, origin_type, registration_channel, registered_by_profile_id, registered_by_actor_kind)
  values (result, 'SELF_REGISTRATION', 'API', public.current_profile_id(), 'USER');
  insert into public.health_subject_access(health_subject_id, profile_id, authority) values (result, public.current_profile_id(), case when subject_kind='SELF' then 'SELF' else 'GUARDIAN' end);
  return result;
end $$;

create or replace function public.create_clinical_patient(patient_name text, location_id uuid)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare doctor uuid; result uuid; next_number integer; prefix text;
begin
  doctor := public.current_doctor_id();
  if doctor is null or not public.has_capability(public.current_profile_id(), 'DOCTOR') then raise exception 'PRACTICE_AUTHORITY_REQUIRED' using errcode='42501'; end if;
  select patient_number_seq, patient_number_prefix into next_number, prefix from public.professional_profiles where id=doctor for update;
  update public.professional_profiles set patient_number_seq=next_number+1 where id=doctor;
  insert into public.clinical_patients(owner_doctor_id, patient_number, full_name) values (doctor, prefix || '-' || lpad(next_number::text, 6, '0'), patient_name) returning id into result;
  return result;
end $$;

create or replace function public.open_encounter(patient_id uuid, location_id uuid)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare doctor uuid; result uuid;
begin
  doctor := public.current_doctor_id();
  if doctor is null or not public.has_capability(public.current_profile_id(), 'DOCTOR') then raise exception 'PRACTICE_AUTHORITY_REQUIRED' using errcode='42501'; end if;
  insert into public.encounters(owner_doctor_id, clinical_patient_id, practice_location_id) values (doctor, patient_id, location_id) returning id into result;
  return result;
end $$;

create or replace function public.open_prescription(encounter_key uuid)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare doctor uuid; result uuid; patient uuid; location uuid;
begin
  doctor := public.current_doctor_id();
  if doctor is null or not public.has_capability(public.current_profile_id(), 'DOCTOR') then raise exception 'PRACTICE_AUTHORITY_REQUIRED' using errcode='42501'; end if;
  select clinical_patient_id, practice_location_id into patient, location from public.encounters where id=encounter_key and owner_doctor_id=doctor;
  if patient is null then raise exception 'ENCOUNTER_NOT_FOUND' using errcode='P0001'; end if;
  insert into public.prescriptions(encounter_id, owner_doctor_id, clinical_patient_id, practice_location_id) values (encounter_key, doctor, patient, location) returning id into result;
  return result;
end $$;

create or replace function public.finalize_prescription(prescription_key uuid, expected_version integer, approved_bundle jsonb, approved_digest text, frozen_signature_path text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare doctor uuid;
begin
  doctor := public.current_doctor_id();
  if doctor is null or not public.has_capability(public.current_profile_id(), 'DOCTOR') then raise exception 'PRACTICE_AUTHORITY_REQUIRED' using errcode='42501'; end if;
  update public.prescriptions
  set status='FINALIZED', version=version+1, review_bundle_snapshot=approved_bundle, review_digest=approved_digest, signature_asset_path=frozen_signature_path, snapshot_schema_version='P0', finalized_at=clock_timestamp()
  where id=prescription_key and owner_doctor_id=doctor and status='DRAFT' and version=expected_version;
  if not found then raise exception 'PRESCRIPTION_VERSION_OR_STATE_CONFLICT' using errcode='P0001'; end if;
  perform public.emit_audit_event('PRESCRIPTION_FINALIZED', 'prescriptions', prescription_key, null);
  return prescription_key;
end $$;

create or replace function public.prevent_finalized_prescription_mutation()
returns trigger language plpgsql as $$
begin
  if old.status='FINALIZED' then raise exception 'PRESCRIPTION_FINALIZED_IMMUTABLE' using errcode='P0001'; end if;
  return new;
end $$;
create trigger prescriptions_finalized_immutable before update on prescriptions
for each row execute function public.prevent_finalized_prescription_mutation();

create or replace function public.prevent_finalized_item_mutation()
returns trigger language plpgsql as $$
begin
  if exists (select 1 from prescriptions p where p.id=coalesce(old.prescription_id, new.prescription_id) and p.status='FINALIZED') then
    raise exception 'PRESCRIPTION_FINALIZED_IMMUTABLE' using errcode='P0001';
  end if;
  return coalesce(new, old);
end $$;
create trigger prescription_items_finalized_immutable before insert or update or delete on prescription_items
for each row execute function public.prevent_finalized_item_mutation();



-- ---------------------------------------------------------------------------
-- Shared P0 public scheduling primitives.
-- Availability and creation must use these same predicates.
-- ---------------------------------------------------------------------------

create or replace function public.resolve_public_local_instant(
  local_value timestamp without time zone,
  timezone_name text
)
returns timestamptz
language plpgsql
stable
set search_path = pg_catalog, pg_temp
as $$
declare
  resolved timestamptz;
  matching_instants integer;
begin
  if local_value is null or timezone_name is null then
    return null;
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_timezone_names tz
    where tz.name = timezone_name
  ) then
    return null;
  end if;

  resolved := local_value at time zone timezone_name;

  -- Nonexistent local wall-clock value: PostgreSQL normalises it.
  if (resolved at time zone timezone_name) is distinct from local_value then
    return null;
  end if;

  -- Ambiguous local wall-clock value: more than one nearby UTC instant maps
  -- back to the same local timestamp. Search a deliberately wide ±26h window
  -- so this is not hard-coded to a one-hour DST transition.
  select count(*)
  into matching_instants
  from pg_catalog.generate_series(
    resolved - interval '26 hours',
    resolved + interval '26 hours',
    interval '1 minute'
  ) candidate
  where (candidate at time zone timezone_name) = local_value;

  if matching_instants <> 1 then
    return null;
  end if;

  return resolved;
end $$;


create or replace function public.public_chamber_is_eligible(
  chamber_key uuid
)
returns boolean
language sql
volatile
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.doctor_chambers dc
    join public.practice_locations pl
      on pl.id = dc.practice_location_id
    join public.professional_profiles pp
      on pp.id = dc.doctor_id
     and pp.profession = 'DOCTOR'
    where dc.id = chamber_key
      and pl.is_active = true
      and pl.is_bookable = true
      and exists (
        select 1
        from pg_catalog.pg_timezone_names tz
        where tz.name = pl.timezone
      )
      and pp.profile_visibility = 'PUBLIC'
      and public.has_capability(pp.profile_id, 'DOCTOR')
      and exists (
        select 1
        from public.professional_credentials pc
        where pc.professional_profile_id = pp.id
          and pc.profession = 'DOCTOR'
          and pc.verification_status = 'VERIFIED'
          and pc.verified_at is not null
          and pc.verified_at <= clock_timestamp()
          and (pc.expires_at is null or pc.expires_at > clock_timestamp())
      )
      and exists (
        select 1
        from public.practice_memberships pm
        where pm.practice_location_id = dc.practice_location_id
          and pm.profile_id = pp.profile_id
          and pm.role = 'DOCTOR'
          and pm.status = 'ACTIVE'
      )
  )
$$;


create or replace function public.public_slot_is_open(
  chamber_key uuid,
  slot_start timestamptz,
  evaluation_at timestamptz default clock_timestamp()
)
returns boolean
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  timezone_name text;
  local_start timestamp without time zone;
  local_end timestamp without time zone;
  resolved timestamptz;
  resolved_end timestamptz;
  has_hours boolean;
  has_overlap boolean;
begin
  if chamber_key is null
     or slot_start is null
     or evaluation_at is null
     or slot_start <= evaluation_at then
    return false;
  end if;

  if not public.public_chamber_is_eligible(chamber_key) then
    return false;
  end if;

  select pl.timezone
  into timezone_name
  from public.doctor_chambers dc
  join public.practice_locations pl
    on pl.id = dc.practice_location_id
  where dc.id = chamber_key;

  if timezone_name is null then
    return false;
  end if;

  local_start := slot_start at time zone timezone_name;
  local_end := local_start + interval '30 minutes';

  resolved := public.resolve_public_local_instant(
    local_start,
    timezone_name
  );

  resolved_end := public.resolve_public_local_instant(
    local_end,
    timezone_name
  );

  -- Both wall-clock endpoints must be uniquely representable, and the
  -- resolved elapsed interval must remain exactly 30 minutes.
  if resolved is null
     or resolved_end is null
     or resolved is distinct from slot_start
     or resolved_end - resolved <> interval '30 minutes' then
    return false;
  end if;

  select exists (
    select 1
    from public.doctor_chamber_hours h
    where h.doctor_chamber_id = chamber_key
      and h.weekday = extract(dow from local_start)::integer
      and local_start::time >= h.start_time
      and local_end::date = local_start::date
      and local_end::time <= h.end_time
      and mod(
        extract(
          epoch from (local_start::time - h.start_time)
        )::bigint,
        1800
      ) = 0
  )
  into has_hours;

  if not has_hours then
    return false;
  end if;

  -- One shared chamber capacity. Every status except CANCELLED / NO_SHOW
  -- consumes capacity, irrespective of appointment source.
  select exists (
    select 1
    from public.appointments a
    where a.doctor_chamber_id = chamber_key
      and a.status not in ('CANCELLED','NO_SHOW')
      and a.scheduled_at < slot_start + interval '30 minutes'
      and (
        a.scheduled_at
        + pg_catalog.make_interval(mins => a.duration_minutes)
      ) > slot_start
  )
  into has_overlap;

  return not has_overlap;
end $$;


create or replace function public.lock_public_booking_chamber(
  chamber_key uuid
)
returns table (
  owner_doctor_id uuid,
  practice_location_id uuid,
  timezone_name text,
  country_code text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if chamber_key is null then
    return;
  end if;

  -- Canonical concurrency anchor: exact doctor_chambers row.
  perform 1
  from public.doctor_chambers dc
  where dc.id = chamber_key
  for update;

  if not found then
    return;
  end if;

  -- Recheck public eligibility after lock acquisition.
  if not public.public_chamber_is_eligible(chamber_key) then
    return;
  end if;

  return query
  select
    dc.doctor_id,
    dc.practice_location_id,
    pl.timezone,
    pl.country_code
  from public.doctor_chambers dc
  join public.practice_locations pl
    on pl.id = dc.practice_location_id
  where dc.id = chamber_key;
end $$;



-- ---------------------------------------------------------------------------
-- P0 anonymous RPC #1
-- ---------------------------------------------------------------------------

create or replace function public.public_chamber_availability(
  chamber_id uuid,
  local_start_date date,
  local_end_date date
)
returns table (
  starts_at timestamptz,
  ends_at timestamptz,
  remaining_capacity integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  evaluation_at timestamptz := clock_timestamp();
begin
  perform public.require_public_ingress_context();

  if not public.consume_anon_rate_limit(
    'PUBLIC_CHAMBER_AVAILABILITY'
  ) then
    perform public.emit_anon_audit_event(
      'PUBLIC_CHAMBER_AVAILABILITY',
      'RATE_LIMITED',
      'doctor_chamber',
      chamber_id
    );
    return;
  end if;

  if chamber_id is null
     or local_start_date is null
     or local_end_date is null
     or local_end_date < local_start_date
     or (local_end_date - local_start_date) > 30 then
    perform public.emit_anon_audit_event(
      'PUBLIC_CHAMBER_AVAILABILITY',
      'VALIDATION_FAILURE',
      'doctor_chamber',
      chamber_id
    );
    return;
  end if;

  if not public.public_chamber_is_eligible(chamber_id) then
    perform public.emit_anon_audit_event(
      'PUBLIC_CHAMBER_AVAILABILITY',
      'NOT_FOUND',
      'doctor_chamber',
      chamber_id
    );
    return;
  end if;

  return query
  with chamber_context as (
    select pl.timezone
    from public.doctor_chambers dc
    join public.practice_locations pl
      on pl.id = dc.practice_location_id
    where dc.id = chamber_id
  ),
  local_days as (
    select d::date as local_day
    from pg_catalog.generate_series(
      local_start_date::timestamp,
      local_end_date::timestamp,
      interval '1 day'
    ) d
  ),
  local_candidates as (
    select distinct
      (
        ld.local_day::timestamp
        + h.start_time
        + (step.n * interval '30 minutes')
      ) as local_start,
      cc.timezone
    from local_days ld
    cross join chamber_context cc
    join public.doctor_chamber_hours h
      on h.doctor_chamber_id = chamber_id
     and h.weekday = extract(dow from ld.local_day)::integer
    cross join lateral (
      select gs as n
      from pg_catalog.generate_series(
        0,
        greatest(
          -1,
          floor(
            extract(epoch from (h.end_time - h.start_time))
            / 1800
          )::integer - 1
        )
      ) gs
    ) step
    where
      ld.local_day::timestamp
        + h.start_time
        + (step.n * interval '30 minutes')
        + interval '30 minutes'
      <= ld.local_day::timestamp + h.end_time
  ),
  resolved as (
    select distinct
      public.resolve_public_local_instant(
        lc.local_start,
        lc.timezone
      ) as slot_start
    from local_candidates lc
  )
  select
    r.slot_start as starts_at,
    r.slot_start + interval '30 minutes' as ends_at,
    1::integer as remaining_capacity
  from resolved r
  where r.slot_start is not null
    and public.public_slot_is_open(
      chamber_id,
      r.slot_start,
      evaluation_at
    )
  order by r.slot_start;

  perform public.emit_anon_audit_event(
    'PUBLIC_CHAMBER_AVAILABILITY',
    'SUCCESS',
    'doctor_chamber',
    chamber_id
  );
end $$;


-- ---------------------------------------------------------------------------
-- P0 anonymous RPC #2
-- ---------------------------------------------------------------------------

create or replace function public.create_public_booking(
  chamber_id uuid,
  requested_slot timestamptz,
  contact_name text,
  phone_raw text default null,
  email text default null,
  locale text default null
)
returns table (
  public_booking_ref uuid
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  chamber_context record;
  generated_ref uuid;
  appointment_key uuid;
  source_value public.appointment_source;
  normalized_phone_raw text;
  normalized_phone_e164 text;
  normalized_email text;
  normalized_locale text;
  collision_constraint text;
begin
  perform public.require_public_ingress_context();

  if not public.consume_anon_rate_limit(
    'CREATE_PUBLIC_BOOKING'
  ) then
    perform public.emit_anon_audit_event(
      'CREATE_PUBLIC_BOOKING',
      'RATE_LIMITED',
      'doctor_chamber',
      chamber_id
    );
    return;
  end if;

  normalized_phone_raw := nullif(btrim(phone_raw), '');
  normalized_email := nullif(lower(btrim(email)), '');
  normalized_locale := nullif(btrim(locale), '');

  if chamber_id is null
     or requested_slot is null
     or contact_name is null
     or length(btrim(contact_name)) not between 1 and 200
     or (
       normalized_phone_raw is null
       and normalized_email is null
     )
     or (
       normalized_phone_raw is not null
       and length(normalized_phone_raw) > 64
     )
     or (
       normalized_email is not null
       and length(normalized_email) not between 3 and 320
     )
     or (
       normalized_locale is not null
       and length(normalized_locale) > 32
     ) then
    perform public.emit_anon_audit_event(
      'CREATE_PUBLIC_BOOKING',
      'VALIDATION_FAILURE',
      'doctor_chamber',
      chamber_id
    );
    return;
  end if;

  source_value :=
    current_setting('dd.public_source_channel')::public.appointment_source;

  select *
  into chamber_context
  from public.lock_public_booking_chamber(chamber_id);

  if chamber_context.owner_doctor_id is null then
    perform public.emit_anon_audit_event(
      'CREATE_PUBLIC_BOOKING',
      'NOT_FOUND',
      'doctor_chamber',
      chamber_id
    );
    return;
  end if;

  -- Recheck the exact requested slot AFTER chamber serialization.
  if not public.public_slot_is_open(
    chamber_id,
    requested_slot,
    clock_timestamp()
  ) then
    perform public.emit_anon_audit_event(
      'CREATE_PUBLIC_BOOKING',
      'VALIDATION_FAILURE',
      'doctor_chamber',
      chamber_id
    );
    return;
  end if;

  -- Only a caller-supplied already-canonical international number is copied
  -- into phone_e164. Local numbers are not guessed or digits-normalized.
  normalized_phone_e164 :=
    case
      when normalized_phone_raw ~ '^\+[1-9][0-9]{1,14}$'
        then normalized_phone_raw
      else null
    end;

  appointment_key := null;
  generated_ref := null;

  for attempt in 1..3 loop
    generated_ref := pg_catalog.gen_random_uuid();

    begin
      insert into public.appointments(
        owner_doctor_id,
        owner_profession,
        practice_location_id,
        doctor_chamber_id,
        clinical_patient_id,
        health_subject_id,
        booked_by_profile_id,
        scheduled_at,
        session_date,
        duration_minutes,
        visit_type,
        mode,
        source_channel,
        status,
        public_booking_ref
      )
      values (
        chamber_context.owner_doctor_id,
        'DOCTOR',
        chamber_context.practice_location_id,
        chamber_id,
        null,
        null,
        null,
        requested_slot,
        (requested_slot at time zone chamber_context.timezone_name)::date,
        30,
        'GENERAL_CONSULTATION',
        'IN_PERSON',
        source_value,
        'SCHEDULED',
        generated_ref
      )
      returning id into appointment_key;

      exit;

    exception
      when unique_violation then
        get stacked diagnostics
          collision_constraint = CONSTRAINT_NAME;

        if collision_constraint <> 'appointments_public_booking_ref_key' then
          raise;
        end if;

        appointment_key := null;
        generated_ref := null;
    end;
  end loop;

  if appointment_key is null or generated_ref is null then
    raise exception 'PUBLIC_BOOKING_REFERENCE_ALLOCATION_FAILED'
      using errcode='P0001';
  end if;

  insert into public.public_booking_contacts(
    appointment_id,
    contact_name,
    phone_raw,
    phone_e164,
    phone_country_hint,
    email,
    locale,
    lifecycle_status
  )
  values (
    appointment_key,
    btrim(contact_name),
    normalized_phone_raw,
    normalized_phone_e164,
    case
      when normalized_phone_raw is not null
        then chamber_context.country_code
      else null
    end,
    normalized_email,
    normalized_locale,
    'ACTIVE'
  );

  perform public.emit_anon_audit_event(
    'CREATE_PUBLIC_BOOKING',
    'SUCCESS',
    'public_booking',
    null
  );

  public_booking_ref := generated_ref;
  return next;
end $$;


-- ---------------------------------------------------------------------------
-- P0 anonymous RPC #3
-- ---------------------------------------------------------------------------

create or replace function public.public_booking_status(
  booking_reference uuid
)
returns table (
  status public.appointment_status,
  scheduled_for timestamptz,
  location_name text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  result_status public.appointment_status;
  result_scheduled_at timestamptz;
  result_location_name text;
begin
  perform public.require_public_ingress_context();

  if not public.consume_anon_rate_limit(
    'PUBLIC_BOOKING_STATUS'
  ) then
    perform public.emit_anon_audit_event(
      'PUBLIC_BOOKING_STATUS',
      'RATE_LIMITED',
      'public_booking',
      null
    );
    return;
  end if;

  if booking_reference is null then
    perform public.emit_anon_audit_event(
      'PUBLIC_BOOKING_STATUS',
      'VALIDATION_FAILURE',
      'public_booking',
      null
    );
    return;
  end if;

  select
    a.status,
    a.scheduled_at,
    pl.name
  into
    result_status,
    result_scheduled_at,
    result_location_name
  from public.appointments a
  join public.practice_locations pl
    on pl.id = a.practice_location_id
  where a.public_booking_ref = booking_reference
    and a.source_channel in ('PUBLIC_WEB','PUBLIC_APP');

  if not found then
    perform public.emit_anon_audit_event(
      'PUBLIC_BOOKING_STATUS',
      'NOT_FOUND',
      'public_booking',
      null
    );
    return;
  end if;

  perform public.emit_anon_audit_event(
    'PUBLIC_BOOKING_STATUS',
    'SUCCESS',
    'public_booking',
    null
  );

  status := result_status;
  scheduled_for := result_scheduled_at;
  location_name := result_location_name;
  return next;
end $$;




-- ---------------------------------------------------------------------------
-- RLS-safe read authority for public_booking_contacts.
--
-- Structural ownership grants the owning doctor custodial read.
-- Operational read also extends only to ACTIVE exact-location
-- RECEPTIONIST / LOCATION_ADMIN memberships.
-- No patient/subject/contact value participates in authority.
-- ---------------------------------------------------------------------------

create or replace function public.can_read_public_booking_contact(
  appointment_key uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.appointments a
    where a.id = appointment_key
      and (
        a.owner_doctor_id = public.current_doctor_id()
        or exists (
          select 1
          from public.practice_memberships pm
          where pm.practice_location_id =
                  a.practice_location_id
            and pm.profile_id =
                  public.current_profile_id()
            and pm.status = 'ACTIVE'
            and pm.role in (
              'RECEPTIONIST',
              'LOCATION_ADMIN'
            )
        )
      )
  )
$$;


-- ---------------------------------------------------------------------------
-- Authenticated operational correction of anonymous-booking contact PII.
--
-- Authority:
--   * owning doctor;
--   * ACTIVE exact-location RECEPTIONIST;
--   * ACTIVE exact-location LOCATION_ADMIN.
--
-- RESOLVED/PURGE_ELIGIBLE contact rows are frozen from normal correction.
-- Audit carries only bounded changed-field action codes, never contact values.
-- ---------------------------------------------------------------------------

create or replace function public.correct_public_booking_contact(
  appointment_key uuid,
  new_contact_name text,
  new_phone_raw text default null,
  new_email text default null,
  new_locale text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_profile uuid;
  actor_doctor uuid;
  owner_doctor uuid;
  location_key uuid;
  lifecycle text;
  old_name text;
  old_phone text;
  old_email text;
  old_locale text;
  normalized_name text;
  normalized_phone text;
  normalized_phone_e164 text;
  normalized_email text;
  normalized_locale text;
  country_hint text;
  authorized boolean := false;
  changed_any boolean := false;
begin
  actor_profile := public.current_profile_id();

  if actor_profile is null then
    raise exception 'AUTHENTICATION_REQUIRED' using errcode='42501';
  end if;

  select
    a.owner_doctor_id,
    a.practice_location_id,
    c.lifecycle_status,
    c.contact_name,
    c.phone_raw,
    c.email,
    c.locale
  into
    owner_doctor,
    location_key,
    lifecycle,
    old_name,
    old_phone,
    old_email,
    old_locale
  from public.appointments a
  join public.public_booking_contacts c
    on c.appointment_id = a.id
  where a.id = appointment_key
    and a.source_channel in ('PUBLIC_WEB','PUBLIC_APP')
  for update of c;

  if not found then
    raise exception 'PUBLIC_BOOKING_NOT_FOUND' using errcode='P0001';
  end if;

  actor_doctor := public.current_doctor_id();

  authorized :=
    actor_doctor = owner_doctor
    or exists (
      select 1
      from public.practice_memberships pm
      where pm.practice_location_id = location_key
        and pm.profile_id = actor_profile
        and pm.status = 'ACTIVE'
        and pm.role in ('RECEPTIONIST','LOCATION_ADMIN')
    );

  if not authorized then
    raise exception 'PUBLIC_BOOKING_CONTACT_AUTHORITY_REQUIRED'
      using errcode='42501';
  end if;

  if lifecycle in ('RESOLVED','PURGE_ELIGIBLE') then
    raise exception 'PUBLIC_BOOKING_CONTACT_FROZEN'
      using errcode='P0001';
  end if;

  normalized_name := nullif(btrim(new_contact_name), '');
  normalized_phone := nullif(btrim(new_phone_raw), '');
  normalized_email := nullif(lower(btrim(new_email)), '');
  normalized_locale := nullif(btrim(new_locale), '');

  if normalized_name is null
     or length(normalized_name) > 200
     or (normalized_phone is null and normalized_email is null)
     or (
       normalized_phone is not null
       and length(normalized_phone) > 64
     )
     or (
       normalized_email is not null
       and length(normalized_email) not between 3 and 320
     )
     or (
       normalized_locale is not null
       and length(normalized_locale) > 32
     ) then
    raise exception 'PUBLIC_BOOKING_CONTACT_INVALID'
      using errcode='22023';
  end if;

  normalized_phone_e164 :=
    case
      when normalized_phone ~ '^\+[1-9][0-9]{1,14}$'
        then normalized_phone
      else null
    end;

  select
    case
      when normalized_phone is not null then pl.country_code
      else null
    end
  into country_hint
  from public.practice_locations pl
  where pl.id = location_key;

  if normalized_name is distinct from old_name then
    changed_any := true;
    perform public.emit_audit_event(
      'PUBLIC_BOOKING_CONTACT.NAME_CHANGED',
      'public_booking_contacts',
      appointment_key,
      null
    );
  end if;

  if normalized_phone is distinct from old_phone then
    changed_any := true;
    perform public.emit_audit_event(
      'PUBLIC_BOOKING_CONTACT.PHONE_CHANGED',
      'public_booking_contacts',
      appointment_key,
      null
    );
  end if;

  if normalized_email is distinct from old_email then
    changed_any := true;
    perform public.emit_audit_event(
      'PUBLIC_BOOKING_CONTACT.EMAIL_CHANGED',
      'public_booking_contacts',
      appointment_key,
      null
    );
  end if;

  if normalized_locale is distinct from old_locale then
    changed_any := true;
    perform public.emit_audit_event(
      'PUBLIC_BOOKING_CONTACT.LOCALE_CHANGED',
      'public_booking_contacts',
      appointment_key,
      null
    );
  end if;

  update public.public_booking_contacts
  set
    contact_name = normalized_name,
    phone_raw = normalized_phone,
    phone_e164 = normalized_phone_e164,
    phone_country_hint = country_hint,
    email = normalized_email,
    locale = normalized_locale,
    updated_at = clock_timestamp()
  where appointment_id = appointment_key;

  if not changed_any then
    perform public.emit_audit_event(
      'PUBLIC_BOOKING_CONTACT.NO_CHANGE',
      'public_booking_contacts',
      appointment_key,
      null
    );
  end if;

  return appointment_key;
end $$;


-- ---------------------------------------------------------------------------
-- Explicit human-confirmed linkage to an EXISTING doctor-owned patient.
--
-- LOCATION_ADMIN is intentionally excluded.
-- The destination doctor is derived from the trusted appointment row.
-- No contact value is copied into clinical data.
-- ---------------------------------------------------------------------------


-- ---------------------------------------------------------------------------
-- Human-confirmation candidate search for an existing clinical patient.
--
-- Authority derives only from the trusted PUBLIC_WEB/PUBLIC_APP appointment:
-- owning doctor or ACTIVE exact-location RECEPTIONIST.
--
-- Search remains inside that appointment owner's clinical repository.
-- Phone signal is exact +E164 only. Name aid is exact normalized equality.
-- No fuzzy phone, global patient lookup, automatic match, or owner input.
-- ---------------------------------------------------------------------------

create or replace function public.search_public_booking_patient_candidates(
  appointment_key uuid,
  exact_phone_e164 text default null,
  exact_name text default null
)
returns table (
  clinical_patient_id uuid,
  patient_number text,
  full_name text,
  phone_e164 text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  actor_profile uuid;
  actor_doctor uuid;
  owner_doctor uuid;
  owner_profile uuid;
  location_key uuid;
  appointment_state public.appointment_status;
  lifecycle text;
  phone_key text;
  name_key text;
  authorized boolean := false;
begin
  actor_profile := public.current_profile_id();

  if actor_profile is null then
    raise exception 'AUTHENTICATION_REQUIRED'
      using errcode='42501';
  end if;

  select
    a.owner_doctor_id,
    pp.profile_id,
    a.practice_location_id,
    a.status,
    c.lifecycle_status
  into
    owner_doctor,
    owner_profile,
    location_key,
    appointment_state,
    lifecycle
  from public.appointments a
  join public.professional_profiles pp
    on pp.id = a.owner_doctor_id
   and pp.profession = 'DOCTOR'
  join public.public_booking_contacts c
    on c.appointment_id = a.id
  where a.id = appointment_key
    and a.source_channel in ('PUBLIC_WEB','PUBLIC_APP');

  if not found then
    raise exception 'PUBLIC_BOOKING_NOT_FOUND'
      using errcode='P0001';
  end if;

  actor_doctor := public.current_doctor_id();

  authorized :=
    coalesce(actor_doctor = owner_doctor, false)
    or exists (
      select 1
      from public.practice_memberships pm
      where pm.practice_location_id = location_key
        and pm.profile_id = actor_profile
        and pm.status = 'ACTIVE'
        and pm.role = 'RECEPTIONIST'
    );

  if not authorized then
    raise exception 'PUBLIC_BOOKING_PATIENT_AUTHORITY_REQUIRED'
      using errcode='42501';
  end if;

  if not public.has_capability(owner_profile, 'DOCTOR') then
    raise exception 'PRACTICE_AUTHORITY_REQUIRED'
      using errcode='42501';
  end if;

  if appointment_state in ('CANCELLED','NO_SHOW')
     or lifecycle <> 'ACTIVE' then
    raise exception 'PUBLIC_BOOKING_NOT_SEARCHABLE'
      using errcode='P0001';
  end if;

  phone_key := nullif(btrim(exact_phone_e164), '');

  name_key :=
    nullif(
      lower(
        btrim(
          regexp_replace(
            exact_name,
            '\s+',
            ' ',
            'g'
          )
        )
      ),
      ''
    );

  if phone_key is null and name_key is null then
    raise exception 'PATIENT_SEARCH_CRITERIA_REQUIRED'
      using errcode='22023';
  end if;

  if phone_key is not null
     and phone_key !~ '^\+[1-9][0-9]{1,14}$' then
    raise exception 'PATIENT_PHONE_E164_REQUIRED'
      using errcode='22023';
  end if;

  return query
  select
    cp.id,
    cp.patient_number,
    cp.full_name,
    cp.phone_e164
  from public.clinical_patients cp
  where cp.owner_doctor_id = owner_doctor
    and cp.deleted_at is null
    and cp.merged_into_id is null
    and (
      phone_key is null
      or cp.phone_e164 = phone_key
    )
    and (
      name_key is null
      or cp.name_normalized = name_key
    )
  order by cp.patient_number
  limit 20;
end $$;


create or replace function public.resolve_public_booking_patient(
  appointment_key uuid,
  patient_key uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_profile uuid;
  actor_doctor uuid;
  owner_doctor uuid;
  owner_profile uuid;
  location_key uuid;
  existing_patient uuid;
  lifecycle text;
  appointment_state public.appointment_status;
  authorized boolean := false;
begin
  actor_profile := public.current_profile_id();

  if actor_profile is null then
    raise exception 'AUTHENTICATION_REQUIRED' using errcode='42501';
  end if;

  select
    a.owner_doctor_id,
    pp.profile_id,
    a.practice_location_id,
    a.clinical_patient_id,
    a.status,
    c.lifecycle_status
  into
    owner_doctor,
    owner_profile,
    location_key,
    existing_patient,
    appointment_state,
    lifecycle
  from public.appointments a
  join public.professional_profiles pp
    on pp.id = a.owner_doctor_id
   and pp.profession = 'DOCTOR'
  join public.public_booking_contacts c
    on c.appointment_id = a.id
  where a.id = appointment_key
    and a.source_channel in ('PUBLIC_WEB','PUBLIC_APP')
  for update of a, c;

  if not found then
    raise exception 'PUBLIC_BOOKING_NOT_FOUND' using errcode='P0001';
  end if;

  actor_doctor := public.current_doctor_id();

  authorized :=
    coalesce(actor_doctor = owner_doctor, false)
    or exists (
      select 1
      from public.practice_memberships pm
      where pm.practice_location_id = location_key
        and pm.profile_id = actor_profile
        and pm.status = 'ACTIVE'
        and pm.role = 'RECEPTIONIST'
    );

  if not authorized then
    raise exception 'PUBLIC_BOOKING_PATIENT_AUTHORITY_REQUIRED'
      using errcode='42501';
  end if;

  if not public.has_capability(owner_profile, 'DOCTOR') then
    raise exception 'PRACTICE_AUTHORITY_REQUIRED'
      using errcode='42501';
  end if;

  if appointment_state in ('CANCELLED','NO_SHOW') then
    raise exception 'PUBLIC_BOOKING_NOT_RESOLVABLE'
      using errcode='P0001';
  end if;

  if not exists (
    select 1
    from public.clinical_patients cp
    where cp.id = patient_key
      and cp.owner_doctor_id = owner_doctor
      and cp.deleted_at is null
  ) then
    raise exception 'CLINICAL_PATIENT_NOT_FOUND'
      using errcode='P0001';
  end if;

  if existing_patient is not null
     and existing_patient is distinct from patient_key then
    raise exception 'PUBLIC_BOOKING_ALREADY_RESOLVED'
      using errcode='P0001';
  end if;

  update public.appointments
  set clinical_patient_id = patient_key
  where id = appointment_key
    and clinical_patient_id is null;

  update public.public_booking_contacts
  set
    lifecycle_status = 'RESOLVED',
    resolved_at = coalesce(resolved_at, clock_timestamp()),
    updated_at = clock_timestamp()
  where appointment_id = appointment_key
    and lifecycle_status <> 'PURGE_ELIGIBLE';

  perform public.emit_audit_event(
    'PUBLIC_BOOKING_PATIENT.RESOLVED',
    'appointments',
    appointment_key,
    null
  );

  return patient_key;
end $$;


-- ---------------------------------------------------------------------------
-- Explicit human-confirmed registration of a NEW doctor-owned clinical patient
-- from an existing public booking.
--
-- Caller supplies the confirmed clinical values. Nothing is silently copied
-- from public_booking_contacts.
-- Destination owner doctor derives only from the locked appointment context.
-- ---------------------------------------------------------------------------

create or replace function public.register_public_booking_patient(
  appointment_key uuid,
  patient_name text,
  confirmed_phone_raw text default null,
  confirmed_email text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_profile uuid;
  actor_doctor uuid;
  owner_doctor uuid;
  owner_profile uuid;
  location_key uuid;
  existing_patient uuid;
  lifecycle text;
  appointment_state public.appointment_status;
  authorized boolean := false;
  normalized_name text;
  normalized_phone text;
  normalized_phone_e164 text;
  normalized_email text;
  country_hint text;
  next_number integer;
  prefix text;
  patient_number text;
  result uuid;
begin
  actor_profile := public.current_profile_id();

  if actor_profile is null then
    raise exception 'AUTHENTICATION_REQUIRED' using errcode='42501';
  end if;

  select
    a.owner_doctor_id,
    pp.profile_id,
    a.practice_location_id,
    a.clinical_patient_id,
    a.status,
    c.lifecycle_status
  into
    owner_doctor,
    owner_profile,
    location_key,
    existing_patient,
    appointment_state,
    lifecycle
  from public.appointments a
  join public.professional_profiles pp
    on pp.id = a.owner_doctor_id
   and pp.profession = 'DOCTOR'
  join public.public_booking_contacts c
    on c.appointment_id = a.id
  where a.id = appointment_key
    and a.source_channel in ('PUBLIC_WEB','PUBLIC_APP')
  for update of a, c;

  if not found then
    raise exception 'PUBLIC_BOOKING_NOT_FOUND' using errcode='P0001';
  end if;

  actor_doctor := public.current_doctor_id();

  authorized :=
    coalesce(actor_doctor = owner_doctor, false)
    or exists (
      select 1
      from public.practice_memberships pm
      where pm.practice_location_id = location_key
        and pm.profile_id = actor_profile
        and pm.status = 'ACTIVE'
        and pm.role = 'RECEPTIONIST'
    );

  if not authorized then
    raise exception 'PUBLIC_BOOKING_PATIENT_AUTHORITY_REQUIRED'
      using errcode='42501';
  end if;

  if not public.has_capability(owner_profile, 'DOCTOR') then
    raise exception 'PRACTICE_AUTHORITY_REQUIRED'
      using errcode='42501';
  end if;

  if appointment_state in ('CANCELLED','NO_SHOW')
     or existing_patient is not null
     or lifecycle in ('RESOLVED','PURGE_ELIGIBLE') then
    raise exception 'PUBLIC_BOOKING_NOT_REGISTRABLE'
      using errcode='P0001';
  end if;

  normalized_name := nullif(btrim(patient_name), '');
  normalized_phone := nullif(btrim(confirmed_phone_raw), '');
  normalized_email := nullif(lower(btrim(confirmed_email)), '');

  if normalized_name is null
     or length(normalized_name) > 200
     or (
       normalized_phone is not null
       and length(normalized_phone) > 64
     )
     or (
       normalized_email is not null
       and length(normalized_email) not between 3 and 320
     ) then
    raise exception 'CLINICAL_PATIENT_INPUT_INVALID'
      using errcode='22023';
  end if;

  normalized_phone_e164 :=
    case
      when normalized_phone ~ '^\+[1-9][0-9]{1,14}$'
        then normalized_phone
      else null
    end;

  select
    case
      when normalized_phone is not null then pl.country_code
      else null
    end
  into country_hint
  from public.practice_locations pl
  where pl.id = location_key;

  select
    pp.patient_number_seq,
    pp.patient_number_prefix
  into
    next_number,
    prefix
  from public.professional_profiles pp
  where pp.id = owner_doctor
  for update;

  if not found then
    raise exception 'PRACTICE_DOCTOR_NOT_FOUND'
      using errcode='P0001';
  end if;

  patient_number :=
    prefix || '-' || lpad(next_number::text, 6, '0');

  update public.professional_profiles
  set patient_number_seq = next_number + 1
  where id = owner_doctor;

  insert into public.clinical_patients(
    owner_doctor_id,
    patient_number,
    full_name,
    phone_raw,
    phone_e164,
    email
  )
  values (
    owner_doctor,
    patient_number,
    normalized_name,
    normalized_phone,
    normalized_phone_e164,
    normalized_email
  )
  returning id into result;

  update public.appointments
  set clinical_patient_id = result
  where id = appointment_key;

  update public.public_booking_contacts
  set
    lifecycle_status = 'RESOLVED',
    resolved_at = clock_timestamp(),
    updated_at = clock_timestamp()
  where appointment_id = appointment_key;

  perform public.emit_audit_event(
    'PUBLIC_BOOKING_PATIENT.REGISTERED',
    'appointments',
    appointment_key,
    null
  );

  return result;
end $$;


-- Public booking creation is stricter than its long-lived appointment shape.
-- Patient/subject linkage and status may change later through authorized
-- operational workflows, while source/chamber/ref provenance remains stable.
create or replace function public.enforce_public_appointment_invariants()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT'
     and new.source_channel in ('PUBLIC_WEB','PUBLIC_APP') then

    if new.public_booking_ref is null
       or new.doctor_chamber_id is null
       or new.clinical_patient_id is not null
       or new.health_subject_id is not null
       or new.booked_by_profile_id is not null
       or new.duration_minutes <> 30
       or new.visit_type <> 'GENERAL_CONSULTATION'
       or new.mode <> 'IN_PERSON'
       or new.status <> 'SCHEDULED' then
      raise exception 'PUBLIC_BOOKING_CREATION_INVALID'
        using errcode='23514';
    end if;
  end if;

  if tg_op = 'UPDATE'
     and new.source_channel in ('PUBLIC_WEB','PUBLIC_APP')
     and old.source_channel not in ('PUBLIC_WEB','PUBLIC_APP') then
    raise exception 'PUBLIC_BOOKING_SOURCE_IMMUTABLE'
      using errcode='23514';
  end if;

  if tg_op = 'UPDATE'
     and old.source_channel in ('PUBLIC_WEB','PUBLIC_APP') then

    if new.source_channel is distinct from old.source_channel then
      raise exception 'PUBLIC_BOOKING_SOURCE_IMMUTABLE'
        using errcode='23514';
    end if;

    if new.public_booking_ref is distinct from old.public_booking_ref then
      raise exception 'PUBLIC_BOOKING_REF_IMMUTABLE'
        using errcode='23514';
    end if;

    if new.doctor_chamber_id is distinct from old.doctor_chamber_id
       or new.owner_doctor_id is distinct from old.owner_doctor_id
       or new.practice_location_id is distinct from old.practice_location_id then
      raise exception 'PUBLIC_BOOKING_CHAMBER_CONTEXT_IMMUTABLE'
        using errcode='23514';
    end if;

    if new.booked_by_profile_id is not null then
      raise exception 'PUBLIC_BOOKING_PROFILE_PROVENANCE_INVALID'
        using errcode='23514';
    end if;
  end if;

  return new;
end $$;

create trigger appointments_public_invariants
before insert or update on public.appointments
for each row execute function public.enforce_public_appointment_invariants();


create or replace function public.allocate_queue_token(chamber_key uuid, queue_date date, appointment_key uuid)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare doctor uuid; token integer;
begin
  doctor := public.current_doctor_id();
  if doctor is null or not public.has_capability(public.current_profile_id(), 'DOCTOR') then raise exception 'PRACTICE_AUTHORITY_REQUIRED' using errcode='42501'; end if;
  if not exists (select 1 from public.appointments a where a.id=appointment_key and a.doctor_chamber_id=chamber_key and a.owner_doctor_id=doctor and a.session_date=queue_date and a.status in ('ARRIVED','IN_CONSULTATION')) then
    raise exception 'QUEUE_APPOINTMENT_CONTEXT_INVALID' using errcode='P0001';
  end if;
  insert into public.queue_token_counters as qtc(doctor_chamber_id, session_date, next_token) values (chamber_key, queue_date, 2)
  on conflict (doctor_chamber_id, session_date) do update set next_token=qtc.next_token+1
  returning next_token-1 into token;
  insert into public.queue_entries(appointment_id, doctor_chamber_id, practice_location_id, session_date, queue_token)
  select appointment_key, a.doctor_chamber_id, a.practice_location_id, queue_date, token from public.appointments a where a.id=appointment_key;
  return token;
exception when unique_violation then
  raise exception 'QUEUE_TOKEN_ALREADY_ALLOCATED' using errcode='P0001';
end $$;

revoke all on function public.create_professional_profile(text, profession), public.create_health_subject(text, subject_kind, text), public.create_clinical_patient(text, uuid), public.open_encounter(uuid, uuid), public.open_prescription(uuid) from public, anon;