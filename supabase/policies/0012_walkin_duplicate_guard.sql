-- =============================================================================
-- Duplicate protection for reception's walk-in registration.
--
-- PRIVACY WINS OVER PERFECT DEDUPLICATION.
--
-- An earlier version returned a count of matches the caller could not see. That
-- removed the identity details but kept the fact of EXISTENCE — and since this
-- RPC is executable by any front-desk user, reception could probe names and
-- phone numbers to learn whether a doctor has a matching private patient.
-- Withholding it in the UI closes nothing.
--
-- So the check now searches ONLY patients the caller is already allowed to see,
-- and behaves identically whether or not a chamber-only match exists. A duplicate
-- created against a private record is a real cost, accepted deliberately: it is
-- repairable by the doctor later, whereas a disclosure is not.
--
-- Two further controls live here because they cannot live in the client:
--   * normalisation is DERIVED in the database, never taken from the caller
--   * registration serialises on the identity key, so two simultaneous
--     registrations of the same person cannot both pass the check
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Canonical normalisation.
--
-- Mirrors normalizeName/normalizePhone in src/features/patients/identity.ts.
-- The two are held together by shared test vectors (scripts/normalization-
-- vectors.mjs) asserted on BOTH sides — if they drift, duplicate detection
-- silently stops matching records created through the other path.
-- -----------------------------------------------------------------------------
create or replace function public.normalize_patient_name(input text)
returns text
language plpgsql
immutable
set search_path = pg_catalog, pg_temp
as $$
declare
  s        text;
  previous text;
begin
  if input is null then return null; end if;

  -- Decompose, drop combining accents, lowercase.
  s := lower(regexp_replace(normalize(input, NFKD), E'[\\u0300-\\u036F]', '', 'g'));
  -- Punctuation to spaces, then collapse. Runs BEFORE honorific stripping, so
  -- "Md." has already become "md " by the time the loop sees it.
  s := regexp_replace(s, '[^[:alnum:][:space:]]', ' ', 'g');
  s := btrim(regexp_replace(s, '[[:space:]]+', ' ', 'g'));

  -- Repeatedly, so "Md. Alhaj Rahim" reduces fully.
  loop
    previous := s;
    s := btrim(regexp_replace(
           s, '^(md|mohammad|muhammad|mohd|mr|mrs|ms|miss|dr|prof|alhaj|hajj)[[:space:]]+',
           '', 'i'));
    exit when s = previous or length(s) = 0;
  end loop;

  return s;
end;
$$;

create or replace function public.normalize_patient_phone(input text)
returns text
language plpgsql
immutable
set search_path = pg_catalog, pg_temp
as $$
declare
  digits text;
begin
  if input is null then return null; end if;
  digits := regexp_replace(input, '[^0-9]', '', 'g');
  if length(digits) = 0 then return null; end if;

  -- +8801711000124 / 8801711000124 / 01711000124 all fold to 01711000124.
  if left(digits, 3) = '880' and length(digits) >= 12 then
    return '0' || substr(digits, 4);
  end if;
  if length(digits) = 10 and left(digits, 1) = '1' then
    return '0' || digits;
  end if;
  return digits;
end;
$$;

grant execute on function public.normalize_patient_name(text)  to authenticated;
grant execute on function public.normalize_patient_phone(text) to authenticated;

-- -----------------------------------------------------------------------------
-- Duplicate candidates the caller may actually see.
-- -----------------------------------------------------------------------------
drop function if exists public.check_walkin_duplicates(uuid, uuid, text, text);

/**
 * Matches for a walk-in, restricted to patients the CALLER could already find
 * by searching. Chamber-only patients are neither searched nor signalled: this
 * function must return exactly the same thing whether or not one exists.
 *
 * Takes the RAW name and phone. Normalisation is derived here, so a caller
 * cannot hand over honest details with dishonest search keys and slip past.
 */
create or replace function public.check_walkin_duplicates(
  p_owner_doctor_id      uuid,
  p_practice_location_id uuid,
  p_full_name            text,
  p_phone                text
)
returns table (visible jsonb)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller uuid := auth.uid();
  v_name   text := public.normalize_patient_name(p_full_name);
  v_phone  text := public.normalize_patient_phone(p_phone);
begin
  if v_caller is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.practice_location_members m
    where m.practice_location_id = p_practice_location_id
      and m.user_id = v_caller
      and m.role in ('RECEPTIONIST', 'LOCATION_ADMIN')
      and m.status = 'ACTIVE'
  ) then
    raise exception 'you do not run the front desk at that location'
      using errcode = '42501';
  end if;

  if not public.doctor_practises_at(p_owner_doctor_id, p_practice_location_id) then
    raise exception 'that doctor does not practise at this location'
      using errcode = '42501';
  end if;

  return query
  select coalesce(
    (select jsonb_agg(jsonb_build_object(
              'id', p.id, 'patientNumber', p.patient_number,
              'fullName', p.full_name, 'phone', p.phone))
     from public.patients p
     where p.owner_doctor_id = p_owner_doctor_id
       and (
         (v_phone is not null and p.phone_normalized = v_phone)
         or p.name_normalized = v_name
       )
       -- The visibility rule, restated: a DEFINER function bypasses the
       -- patients policy, so the caller's own reach must be re-checked.
       and exists (
         select 1
         from public.patient_location_links l
         join public.practice_location_members m
           on m.practice_location_id = l.practice_location_id
         where l.patient_id = p.id
           and m.user_id = v_caller
           and m.status = 'ACTIVE'
       )),
    '[]'::jsonb);
end;
$$;

revoke all on function public.check_walkin_duplicates(uuid, uuid, text, text)
  from public, anon;
grant execute on function public.check_walkin_duplicates(uuid, uuid, text, text)
  to authenticated;

-- -----------------------------------------------------------------------------
-- Registration.
-- -----------------------------------------------------------------------------

-- Older forms took caller-supplied normalised values, which made the guard
-- bypassable. Dropped so no unchecked entry point survives.
drop function if exists public.register_patient_for_doctor(
  uuid, uuid, text, text, date, public.dob_precision, integer, date, public.sex,
  text, text, text, text, text, text, text, text);
drop function if exists public.register_patient_for_doctor(
  uuid, uuid, text, text, date, public.dob_precision, integer, date, public.sex,
  text, text, text, text, text, text, text, text, boolean);

/**
 * Register a patient on behalf of a doctor at the caller's location.
 *
 * SECURITY DEFINER — it writes a row the caller could not write themselves.
 * Everything that makes that safe is checked inside:
 *
 *   1. the CALLER is an active RECEPTIONIST or LOCATION_ADMIN here
 *   2. the SELECTED DOCTOR is an active DOCTOR here
 *   3. owner_doctor_id comes from (2), never from the payload's own claim
 *   4. created_by records the receptionist — "who typed it" and "whose patient
 *      it is" are different facts and both must survive
 *   5. name and phone search keys are DERIVED here, not accepted
 *   6. registration serialises on the identity key before checking
 *
 * On (6): "check and insert in one transaction" does NOT serialise two
 * transactions. Both can read no-candidate and both insert. The advisory locks
 * are transaction-scoped and taken in a fixed order (name, then phone) so two
 * callers cannot deadlock against each other.
 */
create or replace function public.register_patient_for_doctor(
  p_owner_doctor_id      uuid,
  p_practice_location_id uuid,
  p_full_name            text,
  p_dob                  date,
  p_dob_precision        public.dob_precision,
  p_approx_age_years     integer,
  p_age_recorded_on      date,
  p_sex                  public.sex,
  p_phone                text,
  p_email                text,
  p_address              text,
  p_district             text,
  p_contact_name         text default null,
  p_contact_phone        text default null,
  p_contact_relationship text default null,
  p_confirmed_not_duplicate boolean default false
)
returns table (patient_id uuid, patient_number text)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller  uuid := auth.uid();
  v_name    text := public.normalize_patient_name(p_full_name);
  v_phone   text := public.normalize_patient_phone(p_phone);
  v_number  text;
  v_patient uuid;
  v_visible jsonb;
begin
  if v_caller is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  if v_name is null or length(v_name) = 0 then
    raise exception 'a patient needs a name' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.practice_location_members m
    where m.practice_location_id = p_practice_location_id
      and m.user_id = v_caller
      and m.role in ('RECEPTIONIST', 'LOCATION_ADMIN')
      and m.status = 'ACTIVE'
  ) then
    raise exception 'you do not run the front desk at that location'
      using errcode = '42501';
  end if;

  if not public.doctor_practises_at(p_owner_doctor_id, p_practice_location_id) then
    raise exception 'that doctor does not practise at this location'
      using errcode = '42501';
  end if;

  -- (6) Serialise on the identity key BEFORE looking. Fixed order: name first,
  --     then phone, so concurrent callers queue rather than deadlock.
  perform pg_advisory_xact_lock(
    hashtextextended(p_owner_doctor_id::text || '|n|' || v_name, 0));
  if v_phone is not null then
    perform pg_advisory_xact_lock(
      hashtextextended(p_owner_doctor_id::text || '|p|' || v_phone, 0));
  end if;

  select d.visible into v_visible
  from public.check_walkin_duplicates(
         p_owner_doctor_id, p_practice_location_id, p_full_name, p_phone) d;

  if jsonb_array_length(coalesce(v_visible, '[]'::jsonb)) > 0
     and not coalesce(p_confirmed_not_duplicate, false) then
    raise exception 'DUPLICATE_VISIBLE' using errcode = '23505';
  end if;

  v_number := public.allocate_patient_number(p_owner_doctor_id);

  insert into public.patients (
    owner_doctor_id, patient_number, full_name, name_normalized,
    dob, dob_precision, approx_age_years, age_recorded_on, sex,
    phone, phone_normalized, email, address, district, created_by
  ) values (
    p_owner_doctor_id, v_number, p_full_name, v_name,
    p_dob, coalesce(p_dob_precision, 'AGE_ONLY'), p_approx_age_years,
    p_age_recorded_on, coalesce(p_sex, 'UNKNOWN'),
    p_phone, v_phone, p_email, p_address, p_district, v_caller
  )
  returning id into v_patient;

  insert into public.patient_location_links (patient_id, practice_location_id, first_seen_at)
  values (v_patient, p_practice_location_id, now())
  on conflict do nothing;

  if p_contact_name is not null or p_contact_phone is not null then
    insert into public.patient_contacts (patient_id, type, name, phone, relationship)
    values (v_patient, 'EMERGENCY', coalesce(p_contact_name, 'Not given'),
            p_contact_phone, p_contact_relationship);
  end if;

  insert into public.audit_events (
    practice_location_id, actor_id, action, resource_type, resource_id, meta
  ) values (
    p_practice_location_id, v_caller, 'patient.registered_by_reception',
    'patient', v_patient,
    jsonb_build_object(
      'ownerDoctorId', p_owner_doctor_id,
      'byReception', true,
      -- Counts only, never the matched patients themselves.
      'overrodeDuplicateWarning',
        jsonb_array_length(coalesce(v_visible, '[]'::jsonb)) > 0)
  );

  return query select v_patient, v_number;
end;
$$;

revoke all on function public.register_patient_for_doctor(
  uuid, uuid, text, date, public.dob_precision, integer, date, public.sex,
  text, text, text, text, text, text, text, boolean) from public, anon;
grant execute on function public.register_patient_for_doctor(
  uuid, uuid, text, date, public.dob_precision, integer, date, public.sex,
  text, text, text, text, text, text, text, boolean) to authenticated;
