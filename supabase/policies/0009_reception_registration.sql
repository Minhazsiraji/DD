-- =============================================================================
-- Reception registers a patient FOR a selected doctor. Implements ADR 0008.
--
-- The patient INSERT policy is deliberately NOT relaxed. `owner_doctor_id` is
-- the ownership boundary for the whole product (ADR 0001), and a policy
-- permissive enough to let a receptionist choose that value is a policy that
-- lets them write into any doctor's repository.
--
-- So ownership is established HERE, by the database, from membership rows the
-- caller does not control.
-- =============================================================================

/**
 * Doctors a receptionist may book or register for at a given location.
 *
 * SECURITY DEFINER because reception holds `location_member: NONE` and cannot
 * read membership rows directly. It returns names and ids only — never contact
 * details, never anything about the doctors' patients.
 */
create or replace function public.doctors_at_location(target_location uuid)
returns table (doctor_id uuid, user_id uuid, full_name text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select d.id, d.user_id, p.full_name
  from public.practice_location_members m
  join public.doctor_profiles d on d.user_id = m.user_id
  join public.profiles p        on p.id      = d.user_id
  where m.practice_location_id = target_location
    and m.role   = 'DOCTOR'
    and m.status = 'ACTIVE'
    -- The CALLER must themselves be active at this location. Without this the
    -- function would list any clinic's doctors to anyone who guessed an id.
    and public.is_active_member(target_location)
  order by p.full_name;
$$;

revoke all on function public.doctors_at_location(uuid) from public, anon;
grant execute on function public.doctors_at_location(uuid) to authenticated;

/**
 * Allocate the next patient number for a doctor, WITHOUT any authorisation.
 *
 * The single UPDATE ... RETURNING is what makes numbering race-free; duplicating
 * that statement in a second function is how the two would eventually drift, so
 * it lives here once and both callers use it:
 *
 *   next_patient_number()          — checks you are that doctor, then delegates
 *   register_patient_for_doctor()  — has already checked the desk relationship
 *
 * NOT granted to anyone. It is callable only from inside SECURITY DEFINER
 * functions that have done their own checks first.
 */
create or replace function public.allocate_patient_number(target_doctor uuid)
returns text
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_prefix text;
  v_seq    integer;
begin
  update public.doctor_profiles
     set patient_number_seq = patient_number_seq + 1,
         updated_at = now()
   where id = target_doctor
  returning patient_number_prefix, patient_number_seq
       into v_prefix, v_seq;

  if v_prefix is null then
    raise exception 'no such doctor: %', target_doctor using errcode = '42501';
  end if;

  return v_prefix || '-' || lpad(v_seq::text, 6, '0');
end;
$$;

revoke all on function public.allocate_patient_number(uuid) from public, anon, authenticated;

/**
 * Re-defined here to delegate, so the race-free UPDATE ... RETURNING exists in
 * exactly one place. The authorisation rule is unchanged: you may only allocate
 * a number for yourself.
 */
create or replace function public.next_patient_number(target_doctor uuid)
returns text
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1 from public.doctor_profiles
    where id = target_doctor and user_id = auth.uid()
  ) then
    raise exception 'not authorised to allocate a patient number for doctor %', target_doctor
      using errcode = '42501';
  end if;

  return public.allocate_patient_number(target_doctor);
end;
$$;

revoke all on function public.next_patient_number(uuid) from public, anon;
grant execute on function public.next_patient_number(uuid) to authenticated;

/**
 * Register a patient on behalf of a doctor at the caller's location.
 *
 * SECURITY DEFINER — it must write a row the caller could not write themselves.
 * Everything that makes that safe is checked inside:
 *
 *   1. the CALLER is an active RECEPTIONIST or LOCATION_ADMIN at the location
 *   2. the SELECTED DOCTOR is an active DOCTOR at that same location
 *   3. owner_doctor_id comes from (2), never from the payload's own claim
 *   4. created_by records the receptionist — "who typed it" and "whose patient
 *      it is" are different facts and both must survive
 *
 * Reception may write demographics and contact details ONLY. No conditions, no
 * medications, no alerts, no private notes — consistent with the column
 * isolation in 0004. Allergies are excluded too: reception may READ an allergy
 * as a safety flag but recording one is a clinical act.
 */
create or replace function public.register_patient_for_doctor(
  p_owner_doctor_id      uuid,
  p_practice_location_id uuid,
  p_full_name            text,
  p_name_normalized      text,
  p_dob                  date,
  p_dob_precision        public.dob_precision,
  p_approx_age_years     integer,
  p_age_recorded_on      date,
  p_sex                  public.sex,
  p_phone                text,
  p_phone_normalized     text,
  p_email                text,
  p_address              text,
  p_district             text,
  p_contact_name         text default null,
  p_contact_phone        text default null,
  p_contact_relationship text default null
)
returns table (patient_id uuid, patient_number text)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller  uuid := auth.uid();
  v_number  text;
  v_patient uuid;
begin
  if v_caller is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  -- (1) The caller runs the desk here.
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

  -- (2) The selected doctor actually practises here.
  if not public.doctor_practises_at(p_owner_doctor_id, p_practice_location_id) then
    raise exception 'that doctor does not practise at this location'
      using errcode = '42501';
  end if;

  -- Both authorisation checks above have passed, so this uses the unguarded
  -- allocator directly — next_patient_number() would reject us for not being
  -- the doctor, which is exactly the check this path replaces with its own.
  v_number := public.allocate_patient_number(p_owner_doctor_id);

  insert into public.patients (
    owner_doctor_id, patient_number, full_name, name_normalized,
    dob, dob_precision, approx_age_years, age_recorded_on, sex,
    phone, phone_normalized, email, address, district, created_by
  ) values (
    p_owner_doctor_id, v_number, p_full_name, p_name_normalized,
    p_dob, coalesce(p_dob_precision, 'AGE_ONLY'), p_approx_age_years,
    p_age_recorded_on, coalesce(p_sex, 'UNKNOWN'),
    p_phone, p_phone_normalized, p_email, p_address, p_district, v_caller
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

  /**
   * Audit inside the transaction. Registration by a third party is exactly the
   * case where "who entered this?" must never be lost, so it does not go
   * through the fire-and-forget emitAudit path.
   */
  insert into public.audit_events (
    practice_location_id, actor_id, action, resource_type, resource_id, meta
  ) values (
    p_practice_location_id, v_caller, 'patient.registered_by_reception',
    'patient', v_patient,
    jsonb_build_object('ownerDoctorId', p_owner_doctor_id, 'byReception', true)
  );

  return query select v_patient, v_number;
end;
$$;

revoke all on function public.register_patient_for_doctor(
  uuid, uuid, text, text, date, public.dob_precision, integer, date, public.sex,
  text, text, text, text, text, text, text, text) from public, anon;
grant execute on function public.register_patient_for_doctor(
  uuid, uuid, text, text, date, public.dob_precision, integer, date, public.sex,
  text, text, text, text, text, text, text, text) to authenticated;

/**
 * Duplicate detection INSIDE one doctor's repository, for reception.
 *
 * Reception cannot query `patients` across doctors, and must not: searching
 * every doctor to spot a duplicate would disclose that another doctor's patient
 * exists, which ADR 0001 forbids outright. This is scoped to the selected
 * doctor and returns the minimum needed to say "is this the same person?".
 */
create or replace function public.find_duplicates_for_doctor(
  p_owner_doctor_id  uuid,
  p_practice_location_id uuid,
  p_name_normalized  text,
  p_phone_normalized text
)
returns table (patient_id uuid, patient_number text, full_name text, phone text)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1 from public.practice_location_members m
    where m.practice_location_id = p_practice_location_id
      and m.user_id = auth.uid()
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
    select p.id, p.patient_number, p.full_name, p.phone
    from public.patients p
    where p.owner_doctor_id = p_owner_doctor_id
      and (
        (p_phone_normalized is not null and p.phone_normalized = p_phone_normalized)
        or p.name_normalized = p_name_normalized
      )
    limit 10;
end;
$$;

revoke all on function public.find_duplicates_for_doctor(uuid, uuid, text, text)
  from public, anon;
grant execute on function public.find_duplicates_for_doctor(uuid, uuid, text, text)
  to authenticated;
