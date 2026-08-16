-- =============================================================================
-- Duplicate protection for reception's walk-in registration.
--
-- Two things are in tension here:
--
--   Reception must not create a second record for someone the doctor already
--   has — a split history is the thing patient identity exists to prevent.
--
--   Reception must not learn that a doctor's chamber-only patient EXISTS.
--   Cross-location visibility is the boundary ADR 0001 draws, and "no match
--   found" versus "a match you may not see" is itself information.
--
-- So the check runs inside the database, over the doctor's WHOLE repository,
-- and returns detail only for patients reception may already see. Everything
-- else is reduced to a count.
-- =============================================================================

/**
 * Duplicate candidates for a walk-in, split by what the caller may know.
 *
 *   visible      full detail — patients already linked to a location where the
 *                caller is an active member, so reception can compare and judge
 *   hidden_count how many further matches the DOCTOR has that the caller may
 *                not see. A number only: no name, no id, no location, nothing.
 */
create or replace function public.check_walkin_duplicates(
  p_owner_doctor_id      uuid,
  p_practice_location_id uuid,
  p_name_normalized      text,
  p_phone_normalized     text
)
returns table (visible jsonb, hidden_count integer)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller uuid := auth.uid();
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
  with candidates as (
    select p.id, p.patient_number, p.full_name, p.phone,
           exists (
             select 1
             from public.patient_location_links l
             join public.practice_location_members m
               on m.practice_location_id = l.practice_location_id
             where l.patient_id = p.id
               and m.user_id = v_caller
               and m.status = 'ACTIVE'
           ) as caller_may_see
    from public.patients p
    where p.owner_doctor_id = p_owner_doctor_id
      and (
        (p_phone_normalized is not null and p_phone_normalized <> ''
          and p.phone_normalized = p_phone_normalized)
        or p.name_normalized = p_name_normalized
      )
  )
  select
    coalesce(
      (select jsonb_agg(jsonb_build_object(
                'id', c.id, 'patientNumber', c.patient_number,
                'fullName', c.full_name, 'phone', c.phone))
       from candidates c where c.caller_may_see),
      '[]'::jsonb),
    (select count(*)::int from candidates c where not c.caller_may_see);
end;
$$;

revoke all on function public.check_walkin_duplicates(uuid, uuid, text, text)
  from public, anon;
grant execute on function public.check_walkin_duplicates(uuid, uuid, text, text)
  to authenticated;

/**
 * Registration now REFUSES a probable duplicate, in the database.
 *
 * Putting the check in the action would make it advisory: the RPC is granted to
 * every authenticated user, so anything the client can skip is not a control.
 *
 * The two refusals differ on purpose:
 *
 *   hidden matches  -> no override at all. Reception cannot see the record and
 *                      therefore cannot judge whether this is the same person.
 *                      Only the doctor can, so the desk is told to ask.
 *   visible matches -> override allowed, because reception HAS the information
 *                      to compare — two people genuinely share a name and a
 *                      household phone, and blocking outright would make the
 *                      product wrong in a common case.
 *
 * The check runs in the same transaction as the insert, so a failure raises and
 * nothing is written: fail-closed by construction, not by convention.
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
  v_number  text;
  v_patient uuid;
  v_visible jsonb;
  v_hidden  integer;
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

  select d.visible, d.hidden_count into v_visible, v_hidden
  from public.check_walkin_duplicates(
         p_owner_doctor_id, p_practice_location_id,
         p_name_normalized, p_phone_normalized) d;

  if v_hidden > 0 then
    raise exception 'DUPLICATE_NEEDS_DOCTOR' using errcode = '23505';
  end if;

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

-- The old 17-argument form had no duplicate guard. Dropped so it cannot be
-- called instead of the checked one.
drop function if exists public.register_patient_for_doctor(
  uuid, uuid, text, text, date, public.dob_precision, integer, date, public.sex,
  text, text, text, text, text, text, text, text);

revoke all on function public.register_patient_for_doctor(
  uuid, uuid, text, text, date, public.dob_precision, integer, date, public.sex,
  text, text, text, text, text, text, text, text, boolean) from public, anon;
grant execute on function public.register_patient_for_doctor(
  uuid, uuid, text, text, date, public.dob_precision, integer, date, public.sex,
  text, text, text, text, text, text, text, text, boolean) to authenticated;
