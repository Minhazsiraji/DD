/**
 * The prescription prints the medicines, the tests, and the advice.
 *
 * A doctor writes three things in one consultation and the patient carries one
 * piece of paper. Printing only the medicines meant the investigations were
 * ordered in Doctor's Diary and then written again by hand — and the advice,
 * which is the part a patient actually follows, was not on the paper at all.
 *
 * WHY THIS BELONGS IN THE BUNDLE AND NOWHERE ELSE
 *
 * The bundle is what the doctor approves and what the digest covers. Anything
 * printable that is not in it is a value nobody approved, that can change after
 * approval, and that a reprint years later would render differently. So the
 * investigations and the advice are snapshotted here, at the same instant as
 * the medicines, and become permanent with them.
 *
 * SCHEMA VERSION 3
 *
 * v2 adds `clinicalDate`; v3 adds `investigations` and `advice`. Bundles
 * already finalised stay at their own version and are NEVER rebuilt — a
 * finalised prescription is a photograph, and re-taking it to add sections
 * would change a document a doctor signed. The client supports both and
 * renders a v2 snapshot exactly as it always did.
 *
 * ORDERS ARE NOT RESULTS
 *
 * `encounter_investigations` records what was ASKED FOR. There is no results
 * module and this does not invent one: the printed section lists requests, and
 * the bundle carries no status, no value and no interpretation.
 *
 * ONLY THIS ENCOUNTER
 *
 * The orders come from `v_rx.encounter_id` — today's consultation. A previous
 * visit's tests must never reappear on a new prescription unless the doctor
 * orders them again today, which would make them rows of this encounter.
 */

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
  v_template jsonb;
  v_items    jsonb;
  v_invest   jsonb;
  v_sig      jsonb;
  v_sig_path text;
  v_enc      public.encounters%rowtype;
  v_date     date;
  v_bundle   jsonb;
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

  v_template := public.resolve_prescription_template(
    v_rx.owner_doctor_id, v_rx.practice_location_id, p_template_id);

  -- A printable feature must carry its printable CONTENT, or it cannot print.
  -- No trusted logo identity exists in this bundle, so the switch fails closed
  -- rather than printing an unattested image that could change afterwards.
  if (v_template ->> 'showClinicLogo')::boolean then
    raise exception 'TEMPLATE_LOGO_UNSUPPORTED' using errcode = '22023';
  end if;

  -- The prescription's own date: the encounter's start, in the LOCATION's
  -- timezone. Never `finalized_at` — written BY finalisation, so a bundle
  -- holding it would hash differently before and after and refuse itself.
  select * into v_enc from public.encounters where id = v_rx.encounter_id;
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
   * Investigations ORDERED IN THIS CONSULTATION, in the doctor's own order.
   *
   * `name` and `note` only. No status and no result: the note is the clinical
   * reason the test was asked for, and nothing here may imply it came back.
   */
  select coalesce(jsonb_agg(to_jsonb(x) order by x.position), '[]'::jsonb) into v_invest
  from (
    select position, name, note
    from public.encounter_investigations
    where encounter_id = v_rx.encounter_id
  ) x;

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
    -- 2: adds `clinicalDate`, so the printed age cannot depend on the reader's
    --    clock. 3: adds `investigations` and `advice`, so the tests and the
    --    instructions the patient follows are approved and printed with the
    --    medicines instead of being written out again by hand.
    'schemaVersion', 3,
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
    'investigations', v_invest,
    -- Today's advice, exactly as the doctor typed it. Bangla and every other
    -- script pass through untouched; `nullif` keeps whitespace from printing
    -- an empty heading.
    'advice', to_jsonb(nullif(btrim(coalesce(v_enc.advice, '')), '')));

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
