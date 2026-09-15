-- =============================================================================
-- Pilot prescription clinic/chamber logo identity.
--
-- The current clinic logo is mutable stationery. A finalized prescription is
-- not. Every upload therefore gets a fresh immutable Storage path; the location
-- only points at which path future prescriptions should use. The review bundle
-- copies the selected object's identity into schema v5, and finalization stores
-- that whole bundle. Replacing a clinic logo later cannot change an old Rx.
-- =============================================================================

alter table public.practice_locations
  add column if not exists prescription_logo_path text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'clinic-assets', 'clinic-assets', false, 2097152,
  array['image/png','image/jpeg','image/webp']
)
on conflict (id) do update set
  public = false,
  file_size_limit = 2097152,
  allowed_mime_types = array['image/png','image/jpeg','image/webp'];

-- No authenticated Storage policies are granted for clinic-assets. Uploads and
-- signed URLs go through reviewed server actions after location-role checks.

create or replace function public.prescription_review_bundle_v4_celsius(
  p_prescription_id      uuid,
  p_practice_location_id uuid,
  p_template_id          uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_rx       public.prescriptions%rowtype;
  v_doc      public.doctor_profiles%rowtype;
  v_user     public.profiles%rowtype;
  v_loc      public.practice_locations%rowtype;
  v_pat      public.patients%rowtype;
  v_enc      public.encounters%rowtype;
  v_template jsonb;
  v_items    jsonb;
  v_sections jsonb := '[]'::jsonb;
  v_sig      jsonb;
  v_sig_path text;
  v_logo     jsonb;
  v_date     date;
  v_bundle   jsonb;
  v_mod      record;
  v_label    text;
  v_content  jsonb;
  v_vitals   jsonb;
begin
  select * into v_rx from public.prescriptions where id = p_prescription_id;
  if not found
     or v_rx.owner_doctor_id is distinct from public.current_doctor_id()
     or v_rx.practice_location_id is distinct from p_practice_location_id then
    raise exception 'prescription not found' using errcode = '42501';
  end if;

  select * into v_doc  from public.doctor_profiles    where id = v_rx.owner_doctor_id;
  select * into v_user from public.profiles           where id = v_doc.user_id;
  select * into v_loc  from public.practice_locations where id = v_rx.practice_location_id;
  select * into v_pat  from public.patients           where id = v_rx.patient_id;
  select * into v_enc  from public.encounters         where id = v_rx.encounter_id;

  v_template := public.resolve_prescription_template(
    v_rx.owner_doctor_id, v_rx.practice_location_id, p_template_id);

  -- A logo-enabled layout must carry the exact immutable object it will print.
  if (v_template ->> 'showClinicLogo')::boolean then
    if nullif(btrim(coalesce(v_loc.prescription_logo_path, '')), '') is null then
      raise exception 'CLINIC_LOGO_UNAVAILABLE' using errcode = '22023';
    end if;

    select jsonb_build_object(
             'objectId', o.id, 'path', o.name,
             'size', o.metadata ->> 'size', 'mimetype', o.metadata ->> 'mimetype')
      into v_logo
    from storage.objects o
    where o.bucket_id = 'clinic-assets'
      and o.name = v_loc.prescription_logo_path;

    if v_logo is null then
      raise exception 'CLINIC_LOGO_UNAVAILABLE' using errcode = '22023';
    end if;
  end if;

  v_date := public.session_date_for(v_rx.practice_location_id, v_enc.started_at);

  select coalesce(jsonb_agg(to_jsonb(i) order by i.position), '[]'::jsonb) into v_items
  from (
    select position, display_name, brand_name, generic_name, strength_text,
           dose_text, dosage_form, route, schedule_text, duration_text,
           quantity_text, food_relation, is_prn, instructions, substitution_allowed
    from public.prescription_items
    where prescription_id = p_prescription_id
  ) i;

  for v_mod in select * from public.doctor_rx_modules() where show_on_print
  loop
    v_content := null;
    v_label := coalesce(v_mod.print_label, public.rx_module_label(v_mod.module));

    if v_mod.module = 'CHIEF_COMPLAINT' then
      v_content := public.rx_text_section(v_enc.chief_complaints);

    elsif v_mod.module = 'SYMPTOMS' then
      v_content := public.rx_text_section(v_enc.symptoms);

    elsif v_mod.module = 'HISTORY' then
      v_content := public.rx_text_section(
        concat_ws(E'\n', nullif(btrim(coalesce(v_enc.present_illness, '')), ''),
                         nullif(btrim(coalesce(v_enc.past_history, '')), '')));

    elsif v_mod.module = 'EXAMINATION' then
      v_content := public.rx_text_section(v_enc.examination);

    elsif v_mod.module = 'ASSESSMENT' then
      v_content := public.rx_text_section(v_enc.assessment);

    elsif v_mod.module = 'ADVICE' then
      v_content := public.rx_text_section(v_enc.advice);

    elsif v_mod.module = 'NEXT_VISIT' then
      v_content := public.rx_text_section(
        concat_ws(' · ',
          nullif(btrim(coalesce(v_enc.next_visit_note, '')), ''),
          to_char(v_enc.next_visit_on, 'FMDD Mon YYYY')));

    elsif v_mod.module = 'VITALS' then
      select coalesce(jsonb_agg(p order by ord), '[]'::jsonb) into v_vitals
      from (
        select 1 as ord, jsonb_build_object('label', 'BP',
                 'value', v_enc.vital_systolic || '/' || v_enc.vital_diastolic) as p
          where v_enc.vital_systolic is not null and v_enc.vital_diastolic is not null
        union all
        select 2, jsonb_build_object('label', 'P', 'value', v_enc.vital_pulse_bpm::text)
          where v_enc.vital_pulse_bpm is not null
        union all
        select 3, jsonb_build_object('label', 'T',
                 'value', public.rx_measure(v_enc.vital_temperature_c, '°C'))
          where v_enc.vital_temperature_c is not null
        union all
        select 4, jsonb_build_object('label', 'RR', 'value', v_enc.vital_resp_rate::text)
          where v_enc.vital_resp_rate is not null
        union all
        select 5, jsonb_build_object('label', 'SpO₂', 'value', v_enc.vital_spo2 || '%')
          where v_enc.vital_spo2 is not null
        union all
        select 6, jsonb_build_object('label', 'Wt',
                 'value', public.rx_measure(v_enc.vital_weight_kg, ' kg'))
          where v_enc.vital_weight_kg is not null
        union all
        select 7, jsonb_build_object('label', 'Ht',
                 'value', public.rx_measure(v_enc.vital_height_cm, ' cm'))
          where v_enc.vital_height_cm is not null
      ) rows;

      if jsonb_array_length(v_vitals) > 0 then
        v_content := jsonb_build_object('kind', 'pairs', 'pairs', v_vitals);
      end if;

    elsif v_mod.module = 'DIAGNOSIS' then
      select case when count(*) = 0 then null
             else jsonb_build_object('kind', 'list',
                    'items', jsonb_agg(jsonb_build_object('text', d.label) order by d.position))
             end
        into v_content
      from public.encounter_diagnoses d where d.encounter_id = v_rx.encounter_id;

    elsif v_mod.module = 'INVESTIGATIONS' then
      select case when count(*) = 0 then null
             else jsonb_build_object('kind', 'list',
                    'items', jsonb_agg(
                      jsonb_build_object('text', x.name, 'note', x.note) order by x.position))
             end
        into v_content
      from public.encounter_investigations x where x.encounter_id = v_rx.encounter_id;

    elsif v_mod.module = 'ALLERGY' then
      select case when count(*) = 0 then null
             else jsonb_build_object('kind', 'list',
                    'items', jsonb_agg(
                      jsonb_build_object('text', a.substance, 'note', a.reaction)
                      order by a.substance))
             end
        into v_content
      from public.patient_allergies a
      where a.patient_id = v_rx.patient_id and a.is_active;

    elsif v_mod.module = 'LONG_TERM_MEDICINES' then
      select case when count(*) = 0 then null
             else jsonb_build_object('kind', 'list',
                    'items', jsonb_agg(
                      jsonb_build_object('text', m.name,
                        'note', nullif(concat_ws(' · ', m.dose, m.frequency), ''))
                      order by m.name))
             end
        into v_content
      from public.patient_medications m
      where m.patient_id = v_rx.patient_id and m.is_active;
    end if;

    if v_content is not null then
      v_sections := v_sections || jsonb_build_array(
        jsonb_build_object('module', v_mod.module, 'label', v_label) || v_content);
    end if;
  end loop;

  v_sig_path := public.prescription_signature_path(v_doc.user_id, p_prescription_id);
  if (v_template ->> 'showSignature')::boolean and v_doc.signature_url is not null then
    select jsonb_build_object(
             'objectId', o.id, 'path', o.name,
             'size', o.metadata ->> 'size', 'mimetype', o.metadata ->> 'mimetype')
      into v_sig
    from storage.objects o
    where o.bucket_id = 'prescription-assets' and o.name = v_sig_path;
  end if;

  v_bundle := jsonb_build_object(
    -- v5 is v4 plus the immutable clinic-logo object identity.
    'schemaVersion', 5,
    'layout', 'two-column',
    'prescriptionId', v_rx.id,
    'encounterId', v_rx.encounter_id,
    'clinicalDate', v_date,
    'doctor', jsonb_build_object(
      'fullName', v_user.full_name, 'qualification', v_doc.qualification,
      'specialization', v_doc.specialization, 'designation', v_doc.designation,
      'bmdcRegistrationNo', v_doc.bmdc_registration_no),
    'location', jsonb_build_object(
      'name', v_loc.name, 'address', v_loc.address,
      'district', v_loc.district, 'phone', v_loc.phone),
    'patient', jsonb_build_object(
      'fullName', v_pat.full_name, 'patientNumber', v_pat.patient_number,
      'sex', v_pat.sex, 'dob', v_pat.dob, 'dobPrecision', v_pat.dob_precision,
      'approxAgeYears', v_pat.approx_age_years, 'ageRecordedOn', v_pat.age_recorded_on),
    'template', v_template,
    'signature', coalesce(v_sig, 'null'::jsonb),
    'clinicLogo', coalesce(v_logo, 'null'::jsonb),
    'items', v_items,
    'sections', v_sections);

  return jsonb_build_object(
    'bundle', v_bundle,
    'digest', encode(sha256(convert_to(v_bundle::text, 'UTF8')), 'hex'),
    'expectedSignaturePath', v_sig_path,
    'version', v_rx.version);
end;
$$;

revoke all on function public.prescription_review_bundle_v4_celsius(uuid, uuid, uuid)
  from public, anon, authenticated;

-- Resolve only the logo path this caller is already allowed to print.
create or replace function public.prescription_clinic_logo_asset_path(
  p_prescription_id uuid
)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_rx   public.prescriptions%rowtype;
  v_path text;
begin
  select * into v_rx from public.prescriptions where id = p_prescription_id;

  if not found
     or not (
       coalesce(v_rx.owner_doctor_id = public.current_doctor_id(), false)
       or public.may_hand_over_prescription(v_rx.id)
     ) then
    raise exception 'prescription not found' using errcode = '42501';
  end if;

  if v_rx.status = 'FINALIZED' then
    return nullif(v_rx.review_bundle_snapshot -> 'clinicLogo' ->> 'path', '');
  end if;

  select prescription_logo_path into v_path
  from public.practice_locations
  where id = v_rx.practice_location_id;

  return v_path;
end;
$$;

revoke all on function public.prescription_clinic_logo_asset_path(uuid)
  from public, anon;
grant execute on function public.prescription_clinic_logo_asset_path(uuid)
  to authenticated;
