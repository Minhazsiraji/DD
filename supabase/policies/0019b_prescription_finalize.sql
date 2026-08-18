-- =============================================================================
-- Finalisation and reads, on a TRUSTED boundary.
--
-- EVERYTHING PRINTABLE IS BUILT FROM AUTHORITATIVE ROWS. The browser supplies
-- identifiers and nothing else: it never hands us doctor qualifications, a
-- patient identity, a chamber address, a layout or a signature reference to
-- store. The first version of this file took that JSON on trust, which meant a
-- modified client could finalise a prescription carrying a BMDC number and a
-- patient name of its own invention — and it would have looked authentic
-- forever, because a finalised prescription is exactly what nobody re-checks.
-- =============================================================================

/**
 * Which template prints here — the SQL twin of resolveTemplateForLocation().
 *
 * SCOPE is enforced, not merely ownership: a layout scoped to Location B has no
 * business printing above a prescription written at Location A. When the caller
 * names none, the documented fallback runs in trusted code rather than the
 * caller passing "no template" plus a layout of their choosing.
 *
 *     location default -> global default -> built-in system template
 */
create or replace function public.resolve_prescription_template(
  p_owner_doctor_id uuid,
  p_location_id     uuid,
  p_template_id     uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  t        public.prescription_templates%rowtype;
  v_source text;
begin
  if p_template_id is not null then
    select * into t from public.prescription_templates
     where id = p_template_id and owner_doctor_id = p_owner_doctor_id;

    -- Not the doctor's, or scoped to somewhere else entirely.
    if not found
       or (t.practice_location_id is not null and t.practice_location_id <> p_location_id) then
      raise exception 'TEMPLATE_NOT_AVAILABLE' using errcode = '22023';
    end if;
    v_source := case when t.practice_location_id is null then 'global' else 'location' end;
  else
    select * into t from public.prescription_templates
     where owner_doctor_id = p_owner_doctor_id and is_default
       and practice_location_id = p_location_id;
    v_source := 'location';

    if not found then
      select * into t from public.prescription_templates
       where owner_doctor_id = p_owner_doctor_id and is_default
         and practice_location_id is null;
      v_source := 'global';
    end if;
  end if;

  if t.id is null then
    -- The floor of the chain. Mirrors SYSTEM_TEMPLATE in features/doctor/schema.ts.
    return jsonb_build_object(
      'source', 'system', 'templateId', null, 'name', 'Standard (built-in)',
      'paperSize', 'A4', 'marginMm', 15, 'baseFontPt', 11,
      'showHeader', true, 'showClinicLogo', false,
      'clinicNameOverride', null, 'headerNote', null,
      'showQualification', true, 'showSpecialization', true,
      'showDesignation', true, 'showBmdc', true,
      'showChamberAddress', true, 'showChamberPhone', true,
      'showFooter', true, 'footerText', null, 'showSignature', true);
  end if;

  return jsonb_build_object(
    'source', v_source, 'templateId', t.id, 'name', t.name,
    'paperSize', t.paper_size, 'marginMm', t.margin_mm, 'baseFontPt', t.base_font_pt,
    'showHeader', t.show_header, 'showClinicLogo', t.show_clinic_logo,
    'clinicNameOverride', t.clinic_name_override, 'headerNote', t.header_note,
    'showQualification', t.show_qualification, 'showSpecialization', t.show_specialization,
    'showDesignation', t.show_designation, 'showBmdc', t.show_bmdc,
    'showChamberAddress', t.show_chamber_address, 'showChamberPhone', t.show_chamber_phone,
    'showFooter', t.show_footer, 'footerText', t.footer_text,
    'showSignature', t.show_signature);
end;
$$;

revoke all on function public.resolve_prescription_template(uuid, uuid, uuid)
  from public, anon, authenticated;

/** The path a frozen signature must live at. COMPUTED, never chosen. */
create or replace function public.prescription_signature_path(
  p_doctor_user_id  uuid,
  p_prescription_id uuid
)
returns text
language sql
immutable
as $$
  select p_doctor_user_id::text || '/' || p_prescription_id::text || '/signature';
$$;

revoke all on function public.prescription_signature_path(uuid, uuid) from public, anon;
grant execute on function public.prescription_signature_path(uuid, uuid) to authenticated;

/**
 * The exact renderable content, from the record.
 *
 * The digest covers every printable input — doctor identity, patient identity,
 * location, the whole resolved layout, the frozen signature's identity, and
 * each medicine line IN ORDER. Finalisation rebuilds this and refuses if the
 * digest moved, so a template edited in another tab between review and approval
 * produces a refusal rather than a silent substitution of what prints above a
 * signature.
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

  /**
   * A printable feature must carry its printable CONTENT, or it cannot print.
   *
   * `showClinicLogo` is a real template switch with no asset behind it: there
   * is no trusted logo identity in this bundle, so nothing can attest what
   * would be drawn. Rendering nothing would be a silent lie; rendering the
   * location's current logo — if one ever existed — would put an unattested
   * image on an approved prescription and let it change afterwards.
   *
   * So it fails closed here, where BOTH review and finalisation pass. When
   * logos are built they must be frozen exactly like signatures, with their
   * identity inside this bundle and therefore inside the digest.
   */
  if (v_template ->> 'showClinicLogo')::boolean then
    raise exception 'TEMPLATE_LOGO_UNSUPPORTED' using errcode = '22023';
  end if;

  /**
   * The prescription's own date, and the only date anything printable may use.
   *
   * Taken from the ENCOUNTER's start — the day the patient was actually seen —
   * converted through the LOCATION's timezone, the same rule appointments use
   * for `session_date`. `timestamptz::date` in the session's zone would file a
   * late-evening Dhaka consultation under the previous day.
   *
   * Deliberately NOT `finalized_at`: that is written BY finalisation, so a
   * bundle containing it would hash differently before and after approval and
   * every finalisation would refuse itself with REVIEW_STALE.
   *
   * Everything printable that depends on time — the patient's age above all —
   * is computed from this value, so it is inside the digest and inside the
   * finalised snapshot. A prescription printed a year later shows the age the
   * patient was on the day it was written.
   */
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
   * The signature's IDENTITY, read from storage — not a path the caller named.
   * Null when the layout hides it or the doctor has none, so the digest
   * distinguishes "signed" from "deliberately unsigned".
   */
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
    -- 2: adds `clinicalDate`. A v1 bundle computed the printed age from the
    -- reader's clock, so the same digest could render two different ages.
    'schemaVersion', 2,
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
    'items', v_items);

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

/**
 * Approve the prescription. ONE transaction, and it fails entirely if any step
 * fails (ADR 0011 §6).
 *
 * The caller supplies IDENTIFIERS ONLY: which prescription, which location,
 * which version it read, which template the doctor chose, and the digest of the
 * bundle it showed them.
 *
 * TRANSACTIONAL BOUNDARY, STATED HONESTLY: Postgres cannot copy a storage
 * object, so the signature is frozen by a server-only step BEFORE this call. It
 * copies the doctor's signature to `prescription-assets/<user>/<rx>/signature`
 * — a path computed by the database and never chosen by the caller. This
 * function VERIFIES that object exists and records its trusted identity. If the
 * copy lands and finalisation then fails, the orphan is harmless: it sits at a
 * path unique to this prescription, nothing may overwrite it, and a retry
 * re-uses it. That is what makes the step idempotent rather than merely
 * repeatable.
 */
create or replace function public.finalize_prescription(
  p_prescription_id      uuid,
  p_practice_location_id uuid,
  p_expected_version     integer,
  p_template_id          uuid,
  p_review_digest        text
)
returns integer
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_rx     public.prescriptions%rowtype;
  v_doc    public.doctor_profiles%rowtype;
  v_review jsonb;
  v_bundle jsonb;
  v_items  integer;
  v_bad    integer;
  v_next   integer;
begin
  -- 1-4. Lock, version CAS, still-DRAFT, ownership AND active practice.
  v_rx := public.prescription_for_update(
    p_prescription_id, p_practice_location_id, p_expected_version);

  select * into v_doc from public.doctor_profiles where id = v_rx.owner_doctor_id for update;

  -- 5. Validate the contents. An empty prescription is not a prescription.
  select count(*) into v_items from public.prescription_items
   where prescription_id = p_prescription_id;
  if v_items = 0 then
    raise exception 'PRESCRIPTION_EMPTY' using errcode = '22023';
  end if;

  select count(*) into v_bad from public.prescription_items
   where prescription_id = p_prescription_id and btrim(display_name) = '';
  if v_bad > 0 then
    raise exception 'PRESCRIPTION_ITEM_INVALID' using errcode = '22023';
  end if;

  -- 6. Rebuild exactly what the doctor was shown. Template scope is enforced
  --    inside the resolver, so a layout belonging to another location cannot
  --    reach this prescription at all.
  v_review := public.prescription_review_bundle(
    p_prescription_id, p_practice_location_id, p_template_id);
  v_bundle := v_review -> 'bundle';

  if p_review_digest is null or (v_review ->> 'digest') is distinct from p_review_digest then
    -- Something printable moved between review and approval. Refuse, never
    -- substitute: the doctor approves what prints, or nothing does.
    raise exception 'REVIEW_STALE' using errcode = '22023';
  end if;

  -- The frozen signature must actually EXIST before this is called immutable.
  if (v_bundle -> 'template' ->> 'showSignature')::boolean
     and v_doc.signature_url is not null
     and v_bundle -> 'signature' = 'null'::jsonb then
    raise exception 'SIGNATURE_NOT_FROZEN' using errcode = '22023';
  end if;

  /**
   * 7-8. Store ONLY what trusted code built, and mark it approved.
   *
   * `review_bundle_snapshot` is the WHOLE approved document — the same
   * `v_bundle` whose digest just matched, stored entire rather than picked
   * over. The columns beneath it are a projection kept for querying.
   *
   * Storing the whole thing is the correction that matters: `clinicalDate` was
   * added to the bundle in schema v2, the digest covered it, the doctor
   * approved it, and finalisation dropped it because there was no column for
   * it. A finalised prescription would then have had to recompute the printed
   * date from `encounters.started_at` — a live row — which is precisely what
   * that version existed to stop. Any future field is now preserved without
   * anyone remembering to add anything.
   */
  update public.prescriptions set
    status                  = 'FINALIZED',
    finalized_at            = now(),
    finalized_by            = auth.uid(),
    template_id             = nullif(v_bundle -> 'template' ->> 'templateId', '')::uuid,
    review_bundle_snapshot  = v_bundle,
    snapshot_schema_version = (v_bundle ->> 'schemaVersion')::integer,
    doctor_snapshot         = v_bundle -> 'doctor',
    location_snapshot       = v_bundle -> 'location',
    patient_snapshot        = v_bundle -> 'patient',
    template_snapshot       = v_bundle -> 'template',
    items_snapshot          = v_bundle -> 'items',
    signature_snapshot      = v_bundle -> 'signature',
    signature_asset_path    = v_bundle -> 'signature' ->> 'path',
    review_digest           = v_review ->> 'digest',
    version                 = version + 1,
    updated_at              = now()
  where id = p_prescription_id
  returning version into v_next;

  -- 9. Clinical history.
  insert into public.prescription_events (prescription_id, event_type, detail, actor_id)
  values (p_prescription_id, 'FINALIZED',
          jsonb_build_object('items', v_items, 'version', v_next,
                             'templateSource', v_bundle -> 'template' ->> 'source'),
          auth.uid());

  -- 10. Operational trail. Counts, ids and the digest — never a medicine.
  perform public.log_prescription_audit(
    p_prescription_id, p_practice_location_id, 'prescription.finalized',
    jsonb_build_object('items', v_items, 'version', v_next,
                       'encounterId', v_rx.encounter_id,
                       'reviewDigest', v_review ->> 'digest'));

  -- 11. Any failure above aborted the whole thing.
  return v_next;
end;
$$;

revoke all on function public.finalize_prescription(uuid, uuid, integer, uuid, text)
  from public, anon;
grant execute on function public.finalize_prescription(uuid, uuid, integer, uuid, text)
  to authenticated;

-- -----------------------------------------------------------------------------
-- Reads. Every one takes the ACTIVE location, because that is the boundary the
-- tables themselves cannot express.
-- -----------------------------------------------------------------------------

/** The doctor's own prescriptions, at one location or across all of them. */
create or replace function public.prescriptions_for_doctor(
  p_practice_location_id uuid default null,
  p_patient_id           uuid default null
)
returns table (
  prescription_id uuid,
  encounter_id    uuid,
  patient_id      uuid,
  status          public.prescription_status,
  version         integer,
  finalized_at    timestamptz,
  item_count      integer
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_doctor uuid := public.current_doctor_id();
begin
  if v_doctor is null then
    raise exception 'not a doctor' using errcode = '42501';
  end if;

  return query
    select p.id, p.encounter_id, p.patient_id, p.status, p.version, p.finalized_at,
           (select count(*)::integer from public.prescription_items i
             where i.prescription_id = p.id)
    from public.prescriptions p
    where p.owner_doctor_id = v_doctor
      and (p_practice_location_id is null or p.practice_location_id = p_practice_location_id)
      and (p_patient_id is null or p.patient_id = p_patient_id)
    order by p.created_at desc;
end;
$$;

revoke all on function public.prescriptions_for_doctor(uuid, uuid) from public, anon;
grant execute on function public.prescriptions_for_doctor(uuid, uuid) to authenticated;

/**
 * The handover list.
 *
 * Bound to the ACTIVE location the caller passes — and with direct SELECT
 * revoked there is no way around this function, which is what turns the scoping
 * from a convention into a rule.
 */
create or replace function public.finalized_prescriptions_at(
  p_practice_location_id uuid,
  p_patient_id           uuid default null
)
returns table (
  prescription_id uuid,
  encounter_id    uuid,
  patient_id      uuid,
  finalized_at    timestamptz,
  item_count      integer
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  -- Same answer whether the location does not exist or is simply not theirs.
  if not (
    public.runs_front_desk_at(p_practice_location_id)
    or public.has_location_role(p_practice_location_id, array['LOCATION_ADMIN']::public.location_role[])
    or public.doctor_practises_at(public.current_doctor_id(), p_practice_location_id)
  ) then
    raise exception 'location not found' using errcode = '42501';
  end if;

  return query
    select p.id, p.encounter_id, p.patient_id, p.finalized_at,
           (select count(*)::integer from public.prescription_items i
             where i.prescription_id = p.id)
    from public.prescriptions p
    where p.practice_location_id = p_practice_location_id
      and p.status = 'FINALIZED'
      and (p_patient_id is null or p.patient_id = p_patient_id)
      and (
        p.owner_doctor_id = public.current_doctor_id()
        or public.may_see_patient(p.patient_id)
      )
    order by p.finalized_at desc;
end;
$$;

revoke all on function public.finalized_prescriptions_at(uuid, uuid) from public, anon;
grant execute on function public.finalized_prescriptions_at(uuid, uuid) to authenticated;

/**
 * One prescription with its medicine lines.
 *
 * Items are reachable ONLY through here, so a caller cannot query around the
 * parent's authorisation by selecting `prescription_items` on its own.
 */
create or replace function public.prescription_detail(
  p_prescription_id      uuid,
  p_practice_location_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_rx    public.prescriptions%rowtype;
  v_items jsonb;
begin
  select * into v_rx from public.prescriptions
   where id = p_prescription_id and practice_location_id = p_practice_location_id;

  -- Missing, not yours, or somewhere else: one answer, so the id space cannot
  -- be probed for what exists.
  /**
   * `coalesce(..., false)`, because for a receptionist `current_doctor_id()` is
   * NULL — and `owner_doctor_id = NULL` is NULL, not false. `not (NULL or
   * false)` is NULL, so the guard never fired and a DRAFT was handed to the
   * front desk. The same three-valued-logic trap as `if not v_found`.
   */
  if not found
     or not (
       coalesce(v_rx.owner_doctor_id = public.current_doctor_id(), false)
       or public.may_hand_over_prescription(v_rx.id)
     ) then
    raise exception 'prescription not found' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(to_jsonb(i) order by i.position), '[]'::jsonb) into v_items
  from public.prescription_items i where i.prescription_id = p_prescription_id;

  return jsonb_build_object(
    'id', v_rx.id, 'status', v_rx.status, 'version', v_rx.version,
    'encounterId', v_rx.encounter_id, 'patientId', v_rx.patient_id,
    'finalizedAt', v_rx.finalized_at,
    'replacesPrescriptionId', v_rx.replaces_prescription_id,
    'replacementReason', v_rx.replacement_reason,
    /**
     * The approved document, for a FINALIZED prescription. Null while DRAFT,
     * because there is nothing approved to show — the composer reads `items`.
     */
    'reviewBundleSnapshot', v_rx.review_bundle_snapshot,
    'reviewDigest', v_rx.review_digest,
    'snapshotSchemaVersion', v_rx.snapshot_schema_version,
    'doctorSnapshot', v_rx.doctor_snapshot,
    'locationSnapshot', v_rx.location_snapshot,
    'patientSnapshot', v_rx.patient_snapshot,
    'templateSnapshot', v_rx.template_snapshot,
    'signatureSnapshot', v_rx.signature_snapshot,
    'items', v_items);
end;
$$;

/**
 * A finalised prescription, read ONLY from what was approved.
 *
 * Deliberately separate from `prescription_detail`, which is the composer's
 * read and returns LIVE `prescription_items`. Stage 7C-3 renders history from
 * this, so the renderer has no way to reach today's doctor, patient, location
 * or template rows even by accident — the immutability is structural rather
 * than something the caller has to be careful about.
 *
 * Returns nothing for a DRAFT: there is no approved document yet, and inventing
 * one from live rows is the whole mistake this exists to prevent.
 */
create or replace function public.finalized_prescription_detail(
  p_prescription_id      uuid,
  p_practice_location_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_rx public.prescriptions%rowtype;
begin
  select * into v_rx from public.prescriptions
   where id = p_prescription_id and practice_location_id = p_practice_location_id;

  -- Same single answer for missing, not-yours and elsewhere.
  if not found
     or v_rx.status <> 'FINALIZED'
     or not (
       coalesce(v_rx.owner_doctor_id = public.current_doctor_id(), false)
       or public.may_hand_over_prescription(v_rx.id)
     ) then
    raise exception 'prescription not found' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'id', v_rx.id,
    'status', v_rx.status,
    'finalizedAt', v_rx.finalized_at,
    'finalizedBy', v_rx.finalized_by,
    'encounterId', v_rx.encounter_id,
    'patientId', v_rx.patient_id,
    'replacesPrescriptionId', v_rx.replaces_prescription_id,
    'replacementReason', v_rx.replacement_reason,
    'reviewDigest', v_rx.review_digest,
    'snapshotSchemaVersion', v_rx.snapshot_schema_version,
    'signatureAssetPath', v_rx.signature_asset_path,
    -- The approved document itself. Everything printable is inside it.
    'bundle', v_rx.review_bundle_snapshot);
end;
$$;

revoke all on function public.finalized_prescription_detail(uuid, uuid) from public, anon;
grant execute on function public.finalized_prescription_detail(uuid, uuid) to authenticated;

revoke all on function public.prescription_detail(uuid, uuid) from public, anon;
grant execute on function public.prescription_detail(uuid, uuid) to authenticated;

/**
 * The old ten-argument finaliser, which accepted browser-supplied doctor,
 * location, patient and template JSON and a caller-chosen signature path.
 *
 * DROPPED, not superseded. `create or replace` on a changed signature makes an
 * OVERLOAD that keeps its grant, and callers keep resolving to it by arity — so
 * the fabricated-snapshot hole would still be fully reachable.
 */
drop function if exists public.finalize_prescription(
  uuid, uuid, integer, uuid, integer, jsonb, jsonb, jsonb, jsonb, text);
