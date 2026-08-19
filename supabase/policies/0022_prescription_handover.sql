-- ---------------------------------------------------------------------------
-- Stage 7C-3C — handing a finalised prescription to the patient.
--
-- Reception and location admins already have a read path to finalised
-- paperwork, and Stage 7A defined it: `may_hand_over_prescription`. This file
-- does not widen that. It narrows what comes back through it, and gives the
-- print path a way to resolve the frozen signature that does not run the
-- doctor's bundle builder.
--
-- The principle throughout: the front desk is authorised to HAND OVER a
-- document, not to read the clinical reasoning behind it.
-- ---------------------------------------------------------------------------

/**
 * A finalised prescription, with the caller's own privilege deciding the shape.
 *
 * WHY `replacementReason` IS NOT RETURNED TO THE FRONT DESK
 *
 * It is free text a doctor wrote about why a prescription was replaced, and in
 * practice it reads "wrong dose", "allergy discovered", "changed after the
 * blood report". None of that is needed to find a document, print it and give
 * it to the patient — and a receptionist standing at a desk with other patients
 * behind them is exactly the wrong place for it to appear.
 *
 * It is omitted HERE rather than in React. The staff screen never rendered it,
 * but the RPC still put it on the wire, into the server response, and into
 * anything that logged one. A field the front desk may not see must not be
 * SENT to the front desk; hiding it in a component is a presentation choice,
 * and presentation choices are not access control.
 *
 * The decision is made from PROVEN identity — `current_doctor_id()` against the
 * row's owner — never from a parameter. A caller-supplied "am I staff?" flag
 * would be a privilege the caller chooses for themselves, which is not a
 * privilege at all.
 *
 * `replacesPrescriptionId` stays for everyone: the front desk may legitimately
 * need to know a sheet supersedes an earlier one, so the patient is not sent
 * away holding both. That is lineage, not reasoning.
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
  v_rx    public.prescriptions%rowtype;
  v_owner boolean;
begin
  select * into v_rx from public.prescriptions
   where id = p_prescription_id and practice_location_id = p_practice_location_id;

  /**
   * `coalesce(..., false)`: `current_doctor_id()` is NULL for a receptionist,
   * so `owner_doctor_id = NULL` is NULL rather than false, and `not (NULL or
   * false)` is NULL — a guard that never fires. This exact trap once handed a
   * DRAFT to the front desk.
   */
  v_owner := coalesce(v_rx.owner_doctor_id = public.current_doctor_id(), false);

  -- Missing, not-yours, elsewhere and still-DRAFT all answer identically, so
  -- the id space cannot be probed for what exists.
  if not found
     or v_rx.status <> 'FINALIZED'
     or not (v_owner or public.may_hand_over_prescription(v_rx.id)) then
    raise exception 'prescription not found' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'id', v_rx.id,
    'status', v_rx.status,
    'finalizedAt', v_rx.finalized_at,
    /**
     * Owner-only, for the same reason as the reason text: which member of staff
     * approved it is internal accountability, not something the front desk
     * needs in order to print a sheet.
     */
    'finalizedBy', case when v_owner then to_jsonb(v_rx.finalized_by) else 'null'::jsonb end,
    'encounterId', v_rx.encounter_id,
    'patientId', v_rx.patient_id,
    'replacesPrescriptionId', v_rx.replaces_prescription_id,
    'replacementReason',
      case when v_owner then to_jsonb(v_rx.replacement_reason) else 'null'::jsonb end,
    'viewerIsOwner', v_owner,
    'reviewDigest', v_rx.review_digest,
    'snapshotSchemaVersion', v_rx.snapshot_schema_version,
    'signatureAssetPath', v_rx.signature_asset_path,
    -- The approved document itself. Everything PRINTABLE is inside it, and it
    -- is byte-identical for every reader — that is the handover guarantee.
    'bundle', v_rx.review_bundle_snapshot);
end;
$$;

revoke all on function public.finalized_prescription_detail(uuid, uuid) from public, anon;
grant execute on function public.finalized_prescription_detail(uuid, uuid) to authenticated;

/**
 * What is waiting to be handed over here — and ONLY that.
 *
 * A CROSS-DOCTOR DISCLOSURE, FOUND AND CLOSED IN 7C-3C.
 *
 * The row filter used to be `owner_doctor_id = current_doctor_id() OR
 * may_see_patient(patient_id)`, and `may_see_patient` is true for any ACTIVE
 * member of a location the patient is linked to. So a SECOND DOCTOR at the same
 * hospital — who owns none of it and runs no front desk — received another
 * doctor's prescription ids and patient ids, which join straight to names and
 * patient numbers through the ordinary `patients` policy. Reproduced with the
 * RPC alone, no UI involved: Dr B at the same hospital listed both of Dr A's
 * finalised prescriptions and both patients by name.
 *
 * That contradicts the tenancy rule this project treats as final — each doctor
 * has a completely separate repository, and sharing a building is not a
 * clinical relationship. It went unnoticed because nothing in the app called
 * this function until the handover screen did; the function was granted to
 * `authenticated` the whole time, so it was reachable regardless.
 *
 * The filter is now the SAME predicate that grants the detail: you own it, or
 * you may hand it over. That makes the list and the detail agree exactly —
 * everything listed can be opened, and nothing that cannot be opened is
 * listed. A list that shows more than it will open is a disclosure with extra
 * steps, and a count is still a disclosure.
 *
 * The location gate is unchanged: it decides whether you may ask at all.
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
    or public.has_location_role(p_practice_location_id,
                                array['LOCATION_ADMIN']::public.location_role[])
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
        -- `coalesce`: current_doctor_id() is NULL for a receptionist, and
        -- `x = NULL` is NULL, which an OR would carry all the way out.
        coalesce(p.owner_doctor_id = public.current_doctor_id(), false)
        or public.may_hand_over_prescription(p.id)
      )
    order by p.finalized_at desc;
end;
$$;

revoke all on function public.finalized_prescriptions_at(uuid, uuid) from public, anon;
grant execute on function public.finalized_prescriptions_at(uuid, uuid) to authenticated;

/**
 * Where this prescription's frozen signature lives — for a caller who may
 * already read the prescription.
 *
 * WHY THIS EXISTS
 *
 * The print path used to get the path by calling `prescription_review_bundle`,
 * which is owner-only and rebuilds a bundle from TODAY's doctor, patient,
 * location and template rows. Two things were wrong with that. Reception could
 * not print a signed prescription at all — the builder refused them, so the
 * signature block came back empty on the one copy that matters. And for the
 * doctor it re-derived a document that had already been approved and frozen,
 * which is precisely the "reassemble from live rows" mistake the finalised read
 * exists to prevent.
 *
 * So the path is RESOLVED, never accepted. There is no parameter a caller can
 * point somewhere else, and the answer for a finalised prescription is the
 * column written at finalisation — the approved object, not a recomputed guess
 * at where one ought to be.
 *
 * A DRAFT resolves to the deterministic freeze path, because the doctor's
 * review screen shows the signature it is about to approve. Only the owner ever
 * reaches that branch: `may_hand_over_prescription` requires FINALIZED.
 */
create or replace function public.prescription_frozen_signature_path(
  p_prescription_id uuid
)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_rx      public.prescriptions%rowtype;
  v_doc_uid uuid;
begin
  select * into v_rx from public.prescriptions where id = p_prescription_id;

  if not found
     or not (
       coalesce(v_rx.owner_doctor_id = public.current_doctor_id(), false)
       or public.may_hand_over_prescription(v_rx.id)
     ) then
    raise exception 'prescription not found' using errcode = '42501';
  end if;

  -- Finalised: the path that was approved, or NULL if this prescription is
  -- deliberately unsigned. Never a computed fallback — a fallback would hand
  -- out a URL for an object nobody attested.
  if v_rx.status = 'FINALIZED' then
    return v_rx.signature_asset_path;
  end if;

  select user_id into v_doc_uid from public.doctor_profiles where id = v_rx.owner_doctor_id;
  return public.prescription_signature_path(v_doc_uid, p_prescription_id);
end;
$$;

revoke all on function public.prescription_frozen_signature_path(uuid) from public, anon;
grant execute on function public.prescription_frozen_signature_path(uuid) to authenticated;
