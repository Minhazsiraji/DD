-- ---------------------------------------------------------------------------
-- Stage 7C-3D — corrections, lineage, and not handing over the wrong sheet.
--
-- A finalised prescription is never edited. A correction is a NEW prescription
-- that points back at the one it replaces, and `open_prescription` has carried
-- that flow since Stage 7A: it takes the advisory lock, resumes an existing
-- draft, finds the newest unreplaced finalised prescription on the encounter,
-- demands a reason, and writes the lineage. None of that changes here.
--
-- What this file adds is the READ side of lineage — and closes one hole the
-- 7C-3C privacy fix missed.
-- ---------------------------------------------------------------------------

/**
 * THE HOLE 7C-3C LEFT OPEN.
 *
 * `finalized_prescription_detail` stopped sending `replacementReason` to the
 * front desk. `prescription_detail` did not, and its guard is the same
 * `owns OR may_hand_over` — so a receptionist calling it directly on a
 * FINALISED prescription still received "wrong dose — allergy discovered".
 *
 * It went unnoticed because the staff ROUTE no longer calls it. But the
 * function is granted to `authenticated`, so the route is not the boundary; the
 * function is. Fixing one of two doors is not fixing the door.
 *
 * Same rule as before: decided from proven identity, never from a parameter.
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
  v_owner boolean;
begin
  select * into v_rx from public.prescriptions
   where id = p_prescription_id and practice_location_id = p_practice_location_id;

  /**
   * `coalesce(..., false)`: `current_doctor_id()` is NULL for a receptionist,
   * so `owner_doctor_id = NULL` is NULL rather than false, and `not (NULL or
   * false)` is NULL — a guard that never fires. This trap once handed a DRAFT
   * to the front desk.
   */
  v_owner := coalesce(v_rx.owner_doctor_id = public.current_doctor_id(), false);

  if not found or not (v_owner or public.may_hand_over_prescription(v_rx.id)) then
    raise exception 'prescription not found' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(to_jsonb(i) order by i.position), '[]'::jsonb) into v_items
  from public.prescription_items i where i.prescription_id = p_prescription_id;

  return jsonb_build_object(
    'id', v_rx.id, 'status', v_rx.status, 'version', v_rx.version,
    'encounterId', v_rx.encounter_id, 'patientId', v_rx.patient_id,
    'finalizedAt', v_rx.finalized_at,
    'replacesPrescriptionId', v_rx.replaces_prescription_id,
    -- Clinical reasoning. The desk hands over paperwork; it does not read why.
    'replacementReason',
      case when v_owner then to_jsonb(v_rx.replacement_reason) else 'null'::jsonb end,
    'viewerIsOwner', v_owner,
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

revoke all on function public.prescription_detail(uuid, uuid) from public, anon;
grant execute on function public.prescription_detail(uuid, uuid) to authenticated;

/**
 * Which prescription supersedes this one, and which one it corrects.
 *
 * WHY THE READER'S PRIVILEGE SHAPES THE ANSWER
 *
 * The two audiences want different things from lineage, and only one of them is
 * clinical. The owning doctor is reading their own correction history, reason
 * included. The front desk needs exactly one operational fact — "there is a
 * newer sheet, here it is" — so that a patient is not handed a superseded
 * prescription. They never get the reason, and they only get the replacement's
 * ID IF THEY MAY HAND THAT REPLACEMENT OVER. Otherwise the link would be an
 * id they cannot open, which is a disclosure that buys them nothing.
 *
 * `replaces_prescription_id` is unique where not null, so "replaced by" is at
 * most one row. That constraint is the authority; this only reads it.
 */
create or replace function public.prescription_lineage(
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
  v_rx        public.prescriptions%rowtype;
  v_owner     boolean;
  v_next      public.prescriptions%rowtype;
  v_prev      public.prescriptions%rowtype;
  v_next_json jsonb := 'null'::jsonb;
  v_prev_json jsonb := 'null'::jsonb;
begin
  select * into v_rx from public.prescriptions
   where id = p_prescription_id and practice_location_id = p_practice_location_id;

  v_owner := coalesce(v_rx.owner_doctor_id = public.current_doctor_id(), false);

  if not found or not (v_owner or public.may_hand_over_prescription(v_rx.id)) then
    raise exception 'prescription not found' using errcode = '42501';
  end if;

  select * into v_next from public.prescriptions
   where replaces_prescription_id = p_prescription_id;

  if found then
    /**
     * Staff learn a newer sheet EXISTS whatever its state — that is the whole
     * safety point — but they are only handed its id once it is something they
     * could actually open. A draft correction is not theirs to know about
     * beyond "do not hand this one over yet".
     */
    v_next_json := jsonb_build_object(
      'id', case when v_owner or public.may_hand_over_prescription(v_next.id)
                 then to_jsonb(v_next.id) else 'null'::jsonb end,
      'status', v_next.status,
      'finalizedAt', v_next.finalized_at,
      -- Owner only: it is clinical reasoning, and it is on the REPLACEMENT row.
      'reason', case when v_owner then to_jsonb(v_next.replacement_reason)
                     else 'null'::jsonb end);
  end if;

  if v_rx.replaces_prescription_id is not null then
    select * into v_prev from public.prescriptions where id = v_rx.replaces_prescription_id;
    if found then
      v_prev_json := jsonb_build_object(
        'id', case when v_owner or public.may_hand_over_prescription(v_prev.id)
                   then to_jsonb(v_prev.id) else 'null'::jsonb end,
        'status', v_prev.status,
        'finalizedAt', v_prev.finalized_at);
    end if;
  end if;

  return jsonb_build_object(
    'viewerIsOwner', v_owner,
    'replacedBy', v_next_json,
    'replaces', v_prev_json,
    -- This prescription's OWN reason — why it was written. Owner only.
    'reason', case when v_owner then to_jsonb(v_rx.replacement_reason)
                   else 'null'::jsonb end);
end;
$$;

revoke all on function public.prescription_lineage(uuid, uuid) from public, anon;
grant execute on function public.prescription_lineage(uuid, uuid) to authenticated;

/**
 * The handover list, now saying which sheets are superseded.
 *
 * THE SCENARIO THIS EXISTS FOR
 *
 * V1 is finalised and printed. The doctor corrects it; V2 is finalised. Both are
 * FINALIZED prescriptions at the same location, so both appear on the front
 * desk's list — and nothing distinguished them. A receptionist reading two rows
 * for the same patient, minutes apart, has no way to know which one the patient
 * should leave with. Handing over V1 is handing over the dose that was
 * corrected.
 *
 * V1 is NOT hidden and NOT deleted: history stays complete, and a doctor asking
 * "what did we give her on the 19th?" must still find it. It is MARKED. The
 * screen can then present one as current and one as superseded, which is the
 * smallest distinction that makes the mistake hard.
 *
 * `superseded_by` is an id only when the reader may open it, for the same
 * reason as in `prescription_lineage`.
 */
drop function if exists public.finalized_prescriptions_at(uuid, uuid);

create function public.finalized_prescriptions_at(
  p_practice_location_id uuid,
  p_patient_id           uuid default null
)
returns table (
  prescription_id uuid,
  encounter_id    uuid,
  patient_id      uuid,
  finalized_at    timestamptz,
  item_count      integer,
  superseded_by   uuid,
  is_superseded   boolean
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
             where i.prescription_id = p.id),
           (select case
                     when coalesce(p.owner_doctor_id = public.current_doctor_id(), false)
                          or public.may_hand_over_prescription(r.id)
                     then r.id
                   end
              from public.prescriptions r
             where r.replaces_prescription_id = p.id),
           exists (select 1 from public.prescriptions r
                    where r.replaces_prescription_id = p.id)
    from public.prescriptions p
    where p.practice_location_id = p_practice_location_id
      and p.status = 'FINALIZED'
      and (p_patient_id is null or p.patient_id = p_patient_id)
      /**
       * 7C-3C: the same predicate that grants the DETAIL, so the list and the
       * detail agree exactly. `coalesce` because current_doctor_id() is NULL
       * for a receptionist and `x = NULL` is NULL, which an OR carries out.
       */
      and (
        coalesce(p.owner_doctor_id = public.current_doctor_id(), false)
        or public.may_hand_over_prescription(p.id)
      )
    order by p.finalized_at desc;
end;
$$;

revoke all on function public.finalized_prescriptions_at(uuid, uuid) from public, anon;
grant execute on function public.finalized_prescriptions_at(uuid, uuid) to authenticated;
