/**
 * Review bundle v4 — the doctor's own prescription layout, frozen.
 *
 * v2 added `clinicalDate` so the printed age could not depend on the reader's
 * clock. v3 added investigations and advice. v4 adds the thing that decides
 * WHAT APPEARS AT ALL: the doctor's module configuration, resolved at the
 * moment of approval and frozen with the content it selected.
 *
 * The existing invariant does the rest, unchanged:
 *
 *     IF THE APPROVED DIGEST COVERS IT, FINALISATION PRESERVES IT.
 *
 * `review_bundle_snapshot` stores this whole object, so a doctor who reorders
 * their template next month cannot alter a prescription signed today — the old
 * one carries its own `sections`, in its own order, with its own labels.
 *
 * THE BUNDLE CONTAINS ONLY WHAT PRINTS.
 *
 * A module the doctor chose not to print contributes NOTHING here. That is not
 * an optimisation: the finalised snapshot is what reception sees at handover,
 * and a doctor who records an examination but keeps it off the paper has said
 * something about who should read it. Unprinted clinical text has no business
 * in the object handed across a desk.
 *
 * Empty sections are dropped at BUILD time, so "omit the heading when there is
 * nothing to say" is frozen into the snapshot rather than re-decided by every
 * renderer that ever reads it.
 */

-- -----------------------------------------------------------------------------
-- Helpers, defined before the builder that uses them.
-- -----------------------------------------------------------------------------

/** The built-in heading for a module, when the doctor has not renamed it. */
create or replace function public.rx_module_label(m public.rx_module)
returns text
language sql
immutable
as $$
  select case m
    when 'CHIEF_COMPLAINT'     then 'Chief Complaint'
    when 'SYMPTOMS'            then 'Symptoms'
    when 'HISTORY'             then 'History'
    when 'VITALS'              then 'Vitals'
    when 'EXAMINATION'         then 'Examination'
    when 'ASSESSMENT'          then 'Assessment'
    when 'DIAGNOSIS'           then 'Diagnosis'
    when 'INVESTIGATIONS'      then 'Investigations / Tests'
    when 'ADVICE'              then 'Advice'
    when 'NEXT_VISIT'          then 'Next Visit'
    when 'ALLERGY'             then 'Allergies'
    when 'LONG_TERM_MEDICINES' then 'Long-term Medicines'
  end;
$$;

revoke all on function public.rx_module_label(public.rx_module) from public, anon, authenticated;

/** A free-text section, or NULL when the doctor wrote nothing. */
create or replace function public.rx_text_section(body text)
returns jsonb
language sql
immutable
as $$
  select case
    when nullif(btrim(coalesce(body, '')), '') is null then null
    else jsonb_build_object('kind', 'text', 'text', btrim(body))
  end;
$$;

revoke all on function public.rx_text_section(text) from public, anon, authenticated;

/**
 * A recorded measurement, printed the way it was recorded.
 *
 * THIS EXISTS BECAUSE `trim(trailing '.0' from ...)` IS NOT A SUFFIX STRIP.
 * `trim` takes a SET OF CHARACTERS, so '160.0' loses the '0', then the '.',
 * then the next '0' — and prints as "16". A 100 kg patient printed as "1 kg".
 * Caught by reading a real bundle, not by reading the code.
 *
 * `regexp_replace(…, '\.0$', '')` removes exactly one trailing ".0" and leaves
 * everything else alone: 38.4 stays 38.4, 160.0 becomes 160, 100.0 becomes 100.
 * The recorded value is never rounded, rescaled or reinterpreted.
 */
create or replace function public.rx_measure(value numeric, unit text)
returns text
language sql
immutable
as $$
  select case
    when value is null then null
    else regexp_replace(value::text, '\.0$', '') || unit
  end;
$$;

revoke all on function public.rx_measure(numeric, text) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- The builder.
-- -----------------------------------------------------------------------------

create or replace function public.prescription_review_bundle(
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

  -- A printable feature must carry its printable CONTENT, or it cannot print.
  if (v_template ->> 'showClinicLogo')::boolean then
    raise exception 'TEMPLATE_LOGO_UNSUPPORTED' using errcode = '22023';
  end if;

  -- The encounter's clinic day in the LOCATION's timezone. Never `finalized_at`,
  -- which is written BY finalisation and would make every approval refuse itself.
  v_date := public.session_date_for(v_rx.practice_location_id, v_enc.started_at);

  select coalesce(jsonb_agg(to_jsonb(i) order by i.position), '[]'::jsonb) into v_items
  from (
    select position, display_name, brand_name, generic_name, strength_text,
           dose_text, dosage_form, route, schedule_text, duration_text,
           quantity_text, food_relation, is_prn, instructions, substitution_allowed
    from public.prescription_items
    where prescription_id = p_prescription_id
  ) i;

  /**
   * Walk the doctor's printable modules IN THEIR ORDER, resolving each one's
   * content. `doctor_rx_modules()` supplies defaults for anything never
   * touched, so a doctor who has not opened the settings screen still gets a
   * sensible prescription.
   */
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
      -- The note and the date are one statement: "with reports · 28 Aug 2026".
      v_content := public.rx_text_section(
        concat_ws(' · ',
          nullif(btrim(coalesce(v_enc.next_visit_note, '')), ''),
          to_char(v_enc.next_visit_on, 'FMDD Mon YYYY')));

    elsif v_mod.module = 'VITALS' then
      /**
       * COMPACT INLINE, frozen AS RENDERED: label/value pairs already carrying
       * their units, with anything unrecorded simply absent. A placeholder like
       * "BP —" claims something was measured and found empty, which is not what
       * a blank field means.
       *
       * NO BMI. `docs/architecture.md` records an intent that BMI be computed
       * rather than stored, but no formula, rounding rule or missing-height
       * behaviour exists anywhere in this system — so producing one here would
       * be inventing a clinical value at print time.
       */
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
      -- Requests, never results. There is no results module, and a printed line
      -- that looked like one would be the most dangerous thing on this page.
      select case when count(*) = 0 then null
             else jsonb_build_object('kind', 'list',
                    'items', jsonb_agg(
                      jsonb_build_object('text', x.name, 'note', x.note) order by x.position))
             end
        into v_content
      from public.encounter_investigations x where x.encounter_id = v_rx.encounter_id;

    elsif v_mod.module = 'ALLERGY' then
      /**
       * PATIENT-LEVEL, AND THEREFORE FROZEN BY COPYING.
       *
       * A patient's allergy list changes after the prescription is signed.
       * Rendering a historical prescription from today's rows would make the
       * paper disagree with itself over time, so the VALUES are copied here and
       * the snapshot keeps them. Reached only when the doctor turned printing
       * on; the module is off by default.
       */
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
      -- Frozen for the same reason as allergies.
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

    -- Nothing to say: no heading, no empty block, nothing in the snapshot.
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
    -- 4: the doctor's module configuration, resolved and frozen, plus the
    --    two-column layout it is written for. v3 snapshots keep their own
    --    full-width-below-Rx layout forever.
    'schemaVersion', 4,
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
    'items', v_items,
    'sections', v_sections);

  -- jsonb normalises key order, so the same content always hashes the same.
  return jsonb_build_object(
    'bundle', v_bundle,
    'digest', encode(sha256(convert_to(v_bundle::text, 'UTF8')), 'hex'),
    'expectedSignaturePath', v_sig_path,
    'version', v_rx.version);
end;
$$;

revoke all on function public.prescription_review_bundle(uuid, uuid, uuid) from public, anon;
grant execute on function public.prescription_review_bundle(uuid, uuid, uuid) to authenticated;
