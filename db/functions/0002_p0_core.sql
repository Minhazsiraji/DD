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
  select pp.profile_id, 'DOCTOR', 'CREDENTIAL', pc.id, pp.id, coalesce(pc.verified_at, clock_timestamp()), pc.expires_at
  from public.professional_credentials pc
  join public.professional_profiles pp on pp.id = pc.professional_profile_id and pp.profession = 'DOCTOR'
  where pp.profile_id = subject_profile_id and pc.profession = 'DOCTOR' and pc.verification_status = 'VERIFIED'
  order by pc.verified_at desc nulls last limit 1;
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