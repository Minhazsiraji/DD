-- ---------------------------------------------------------------------------
-- Alpha History Integration — the doctor's own longitudinal patient history.
--
-- The clinical modules were built and the patient's timeline was never
-- connected to them, so the screen a doctor opens for a returning patient said
-- "Prescription isn't built yet" about a module that had been finished for
-- weeks. This is the read that closes that gap for prescriptions.
--
-- WHY A NEW FUNCTION RATHER THAN THE EXISTING ONES
--
-- `prescriptions_for_doctor` is the right SHAPE — doctor-owned, optional
-- location, optional patient — but it returns no `practice_location_id`, and
-- the timeline's location filter must compare ids, never names. `finalized_
-- prescriptions_at` is the wrong shape entirely: it is bound to ONE location
-- because handover is an operational, location-scoped act, whereas history is
-- longitudinal by definition. Widening either would change an accepted Stage 7
-- contract; adding a read beside them changes nothing.
--
-- TENANCY
--
-- Ownership, never location membership. A second doctor at the same hospital
-- gets nothing here — sharing a building is not a clinical relationship — and
-- reception gets nothing at all, because they have no `current_doctor_id()`.
-- That is the same rule the `encounters` SELECT policy already applies, so
-- consultations need no function of their own: RLS answers them directly.
-- ---------------------------------------------------------------------------

/**
 * Finalised prescriptions for one patient, across the doctor's own locations.
 *
 * DRAFTS ARE ABSENT. A draft is not something that was issued to anybody, and
 * a history that lists it invites a doctor to believe a patient is holding
 * paper that was never printed.
 *
 * `finalized_at` is returned so the timeline can sort by when the prescription
 * was ISSUED. Sorting by `created_at` would move an old event when a draft
 * begun months ago is finally approved, and sorting by "now" would move every
 * event on every page load.
 */
create or replace function public.patient_prescription_history(
  p_patient_id           uuid,
  p_practice_location_id uuid default null
)
returns table (
  prescription_id  uuid,
  encounter_id     uuid,
  location_id      uuid,
  location_name    text,
  finalized_at     timestamptz,
  item_count       integer,
  replaces_id      uuid,
  superseded_by    uuid
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_doctor uuid := public.current_doctor_id();
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  /**
   * Doctor-only, and it refuses rather than returning an empty set: an empty
   * list would tell reception "this patient has no prescriptions", which is a
   * different and false statement.
   */
  if v_doctor is null then
    raise exception 'not a doctor' using errcode = '42501';
  end if;

  return query
    select p.id, p.encounter_id, p.practice_location_id, l.name, p.finalized_at,
           (select count(*)::integer from public.prescription_items i
             where i.prescription_id = p.id),
           p.replaces_prescription_id,
           (select r.id from public.prescriptions r
             where r.replaces_prescription_id = p.id)
    from public.prescriptions p
    join public.practice_locations l on l.id = p.practice_location_id
    where p.owner_doctor_id = v_doctor
      and p.patient_id = p_patient_id
      and p.status = 'FINALIZED'
      and (p_practice_location_id is null
           or p.practice_location_id = p_practice_location_id)
    order by p.finalized_at desc;

  /**
   * NO `replacement_reason` column, deliberately. The reason is clinical
   * reasoning and belongs only in the prescription's own lineage view, where
   * 7C-3C and 7C-3D put it behind an ownership check. A timeline summary is
   * read over a doctor's shoulder at a desk.
   */
end;
$$;

revoke all on function public.patient_prescription_history(uuid, uuid) from public, anon;
grant execute on function public.patient_prescription_history(uuid, uuid) to authenticated;

/**
 * Where one of the caller's OWN prescriptions was written.
 *
 * WHY THIS IS NEEDED
 *
 * The finalised read is scoped to the location the caller is working in, and
 * rightly so: handover is a location-scoped act, and reception at one clinic
 * has no business with another's paperwork. History is the opposite shape. The
 * tenancy rule says the owning doctor sees their full longitudinal history
 * ACROSS ALL OF THEIR OWN LOCATIONS, so a timeline entry for a prescription
 * written at the hospital must open even while the doctor has their chamber
 * active. Before this, it answered "not found" — the timeline offered a link to
 * a permanent clinical record and the record refused to appear.
 *
 * It widens nothing. It answers only for a prescription the caller already
 * owns, and it returns a LOCATION ID — not the prescription, not its contents.
 * The finalised read still runs afterwards and still applies every one of its
 * own checks; this only tells the page which location to ask about.
 *
 * Missing, not-yours and not-finalised are one answer, so the id space cannot
 * be probed.
 */
create or replace function public.prescription_owner_location(
  p_prescription_id uuid
)
returns uuid
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_location uuid;
begin
  select p.practice_location_id into v_location
  from public.prescriptions p
  where p.id = p_prescription_id
    and p.status = 'FINALIZED'
    -- OWNERSHIP ONLY. Never location membership, and never a parameter.
    and coalesce(p.owner_doctor_id = public.current_doctor_id(), false);

  if v_location is null then
    raise exception 'prescription not found' using errcode = '42501';
  end if;

  return v_location;
end;
$$;

revoke all on function public.prescription_owner_location(uuid) from public, anon;
grant execute on function public.prescription_owner_location(uuid) to authenticated;
