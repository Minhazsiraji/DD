-- =============================================================================
-- Transactional patient creation and onboarding.
--
-- Both flows previously ran as a sequence of independent inserts from the
-- application. If a child insert failed, the parent row survived and the UI
-- still reported success — so a patient could be created with their ALLERGY
-- silently missing. That is the single worst silent failure in this product.
--
-- A plpgsql function body is one transaction: either every row lands or none
-- does. SECURITY INVOKER throughout, so RLS still applies to every statement —
-- these functions add atomicity, never privilege.
-- =============================================================================

create or replace function public.create_patient(
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
  p_blood_group          public.blood_group,
  p_weight_kg            numeric,
  p_height_cm            numeric,
  p_notes                text,
  p_allergies            text[],
  p_conditions           text[],
  p_medications          text[],
  p_alerts               text[],
  p_contact_name         text,
  p_contact_phone        text,
  p_contact_relationship text
)
returns table (patient_id uuid, patient_number text)
language plpgsql
volatile
security invoker
set search_path = public, pg_temp
as $$
declare
  v_doctor uuid := public.current_doctor_id();
  v_number text;
  v_id     uuid;
  v_item   text;
begin
  if v_doctor is null then
    raise exception 'only a doctor may register patients' using errcode = '42501';
  end if;

  v_number := public.next_patient_number(v_doctor);

  insert into public.patients (
    owner_doctor_id, patient_number, full_name, name_normalized,
    dob, dob_precision, approx_age_years, age_recorded_on, sex,
    phone, phone_normalized, email, address, district,
    blood_group, weight_kg, height_cm, created_by
  ) values (
    v_doctor, v_number, p_full_name, p_name_normalized,
    p_dob, p_dob_precision, p_approx_age_years, p_age_recorded_on, p_sex,
    p_phone, p_phone_normalized, p_email, p_address, p_district,
    p_blood_group, p_weight_kg, p_height_cm, auth.uid()
  )
  returning id into v_id;

  -- Notes are clinical free text and live in their own doctor-only table:
  -- RLS filters rows, not columns, so a note on the patients row would have
  -- been readable by any staff member allowed to see the patient at all.
  if coalesce(btrim(p_notes), '') <> '' then
    insert into public.patient_private_notes (patient_id, body, updated_by)
    values (v_id, p_notes, auth.uid());
  end if;

  if p_practice_location_id is not null then
    insert into public.patient_location_links (patient_id, practice_location_id)
    values (v_id, p_practice_location_id)
    on conflict do nothing;
  end if;

  foreach v_item in array coalesce(p_allergies, '{}') loop
    insert into public.patient_allergies (patient_id, substance, recorded_by)
    values (v_id, v_item, auth.uid());
  end loop;

  foreach v_item in array coalesce(p_conditions, '{}') loop
    insert into public.patient_conditions (patient_id, condition) values (v_id, v_item);
  end loop;

  foreach v_item in array coalesce(p_medications, '{}') loop
    insert into public.patient_medications (patient_id, name, source)
    values (v_id, v_item, 'REPORTED');
  end loop;

  foreach v_item in array coalesce(p_alerts, '{}') loop
    insert into public.patient_alerts (patient_id, message, created_by)
    values (v_id, v_item, auth.uid());
  end loop;

  if coalesce(btrim(p_contact_name), '') <> '' then
    insert into public.patient_contacts
      (patient_id, type, name, phone, relationship, is_primary)
    values (v_id, 'EMERGENCY', p_contact_name, p_contact_phone, p_contact_relationship, true);
  end if;

  return query select v_id, v_number;
end;
$$;

revoke all on function public.create_patient(
  uuid, text, text, date, public.dob_precision, integer, date, public.sex,
  text, text, text, text, text, public.blood_group, numeric, numeric, text,
  text[], text[], text[], text[], text, text, text
) from public, anon;

grant execute on function public.create_patient(
  uuid, text, text, date, public.dob_precision, integer, date, public.sex,
  text, text, text, text, text, public.blood_group, numeric, numeric, text,
  text[], text[], text[], text[], text, text, text
) to authenticated;

-- -----------------------------------------------------------------------------
-- Onboarding.
--
-- Also idempotent: a retry after a partial failure must not leave a second
-- practice location behind. Profile and doctor profile upsert; the location is
-- only created when the doctor has none.
-- -----------------------------------------------------------------------------
create or replace function public.complete_onboarding(
  p_full_name       text,
  p_qualification   text,
  p_specialization  text,
  p_bmdc            text,
  p_number_prefix   text,
  p_location_name   text,
  p_location_type   public.location_type,
  p_address         text,
  p_district        text,
  p_phone           text
)
returns uuid
language plpgsql
volatile
security invoker
set search_path = public, pg_temp
as $$
declare
  v_user     uuid := auth.uid();
  v_location uuid;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  insert into public.profiles (id, full_name)
  values (v_user, p_full_name)
  on conflict (id) do update set full_name = excluded.full_name;

  insert into public.doctor_profiles
    (user_id, qualification, specialization, bmdc_registration_no, patient_number_prefix)
  values (v_user, p_qualification, p_specialization, p_bmdc, p_number_prefix)
  on conflict (user_id) do update set
    qualification        = excluded.qualification,
    specialization       = excluded.specialization,
    bmdc_registration_no = excluded.bmdc_registration_no;

  -- Retry-safe: reuse an existing location rather than creating a duplicate.
  select l.id into v_location
  from public.practice_locations l
  join public.practice_location_members m on m.practice_location_id = l.id
  where m.user_id = v_user and m.status = 'ACTIVE'
  limit 1;

  if v_location is null then
    insert into public.practice_locations (name, type, address, district, phone, created_by)
    values (p_location_name, p_location_type, p_address, p_district, p_phone, v_user)
    returning id into v_location;

    insert into public.practice_location_members
      (practice_location_id, user_id, role, status)
    values (v_location, v_user, 'DOCTOR', 'ACTIVE'),
           (v_location, v_user, 'LOCATION_ADMIN', 'ACTIVE');
  end if;

  update public.profiles set onboarded_at = now() where id = v_user;

  return v_location;
end;
$$;

revoke all on function public.complete_onboarding(
  text, text, text, text, text, text, public.location_type, text, text, text
) from public, anon;

grant execute on function public.complete_onboarding(
  text, text, text, text, text, text, public.location_type, text, text, text
) to authenticated;
