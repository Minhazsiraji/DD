-- ---------------------------------------------------------------------------
-- Stage 7C-3D correction — the prescription being corrected is the AUTHORITY.
--
-- THE PROBLEM THIS FIXES
--
-- Starting a correction took two identifiers from the browser: the prescription
-- the doctor clicked, and the encounter to write against. The server checked
-- replacement lineage using the first and performed the write using the second,
-- so the two halves of one clinical relationship were caller-controlled
-- independently. A modified client could say "I am correcting V1" while the
-- write acted on a different encounter entirely.
--
-- Nothing was cross-doctor: ownership and location were re-checked on both
-- paths. But "which prescription is this a correction OF" is a clinical fact,
-- and a clinical fact must not be assembled from two things the browser sent.
--
-- There was a second, quieter version of the same hole. `open_prescription`
-- took a `p_replacement_reason`, and supplying it turned an ordinary open into
-- a correction of whatever it decided was the newest unreplaced finalised
-- prescription on that encounter. That door is closed here too, by removing the
-- parameter rather than by asking callers not to use it — an unused default is
-- not a control.
--
-- AND IT WAS ALSO WRONG ABOUT CHAINS
--
-- "Newest unreplaced finalised on this encounter" is an inference. With
-- V1 → V2 → V3 all on one encounter it happens to give the right answer, but
-- it is not the answer the doctor gave: they clicked a specific sheet. The new
-- function replaces exactly the row it was handed, so every edge is explicit.
-- ---------------------------------------------------------------------------

/**
 * Open (or resume) THIS ENCOUNTER's prescription. No corrections here.
 *
 * The reason parameter is gone. A caller who wants to correct a finalised
 * prescription must name that prescription, through
 * `start_prescription_correction` — which is the whole point.
 */
drop function if exists public.open_prescription(uuid, uuid, text);
drop function if exists public.open_prescription(uuid, uuid);

create function public.open_prescription(
  p_encounter_id         uuid,
  p_practice_location_id uuid
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_doctor uuid := public.current_doctor_id();
  v_enc    public.encounters%rowtype;
  v_id     uuid;
  v_final  uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if v_doctor is null then
    raise exception 'only a doctor can write a prescription' using errcode = '42501';
  end if;

  select * into v_enc from public.encounters where id = p_encounter_id;
  if not found
     or v_enc.owner_doctor_id is distinct from v_doctor
     or v_enc.practice_location_id is distinct from p_practice_location_id then
    raise exception 'encounter not found' using errcode = '42501';
  end if;

  -- Serialise on the encounter before looking, so two simultaneous opens cannot
  -- both find nothing and both insert.
  perform pg_advisory_xact_lock(hashtextextended('rx:' || p_encounter_id::text, 0));

  select id into v_id from public.prescriptions
   where encounter_id = p_encounter_id and status = 'DRAFT';
  if v_id is not null then
    return v_id;                    -- resume; this is what the doctor meant
  end if;

  /**
   * A finalised prescription already exists and there is no draft, so the only
   * thing this could mean is a correction — and a correction must name the
   * sheet it corrects. Refused with a distinct token so the UI can say where to
   * go, rather than silently creating one against an inferred original.
   */
  select id into v_final from public.prescriptions
   where encounter_id = p_encounter_id and status = 'FINALIZED'
   limit 1;

  if v_final is not null then
    raise exception 'PRESCRIPTION_ALREADY_FINALIZED' using errcode = 'P0001';
  end if;

  insert into public.prescriptions (
    encounter_id, owner_doctor_id, patient_id, practice_location_id, created_by
  ) values (
    p_encounter_id, v_enc.owner_doctor_id, v_enc.patient_id, v_enc.practice_location_id,
    auth.uid()
  )
  returning id into v_id;

  insert into public.prescription_events (prescription_id, event_type, detail, actor_id)
  values (v_id, 'CREATED'::public.prescription_event_type,
          jsonb_build_object('encounterId', p_encounter_id), auth.uid());

  perform public.log_prescription_audit(
    v_id, p_practice_location_id, 'prescription.created',
    jsonb_build_object('encounterId', p_encounter_id));

  return v_id;
end;
$$;

revoke all on function public.open_prescription(uuid, uuid) from public, anon;
grant execute on function public.open_prescription(uuid, uuid) to authenticated;

/**
 * Correct ONE named finalised prescription.
 *
 * Everything about the new draft is derived from the row this is handed — the
 * encounter, the patient, the owning doctor, the location. The caller supplies
 * the prescription id and a reason, and nothing else; there is no second
 * identifier for the two to disagree about.
 *
 * IDEMPOTENT, because the alternative is two corrections of one prescription
 * and nobody able to say which one the patient is holding. The advisory lock is
 * taken on the PRESCRIPTION BEING REPLACED — that is the identity the unique
 * index protects — so two tabs serialise and the second finds the first's work.
 * The unique index on `replaces_prescription_id` is still the authority; this
 * only avoids racing it for no reason.
 */
create or replace function public.start_prescription_correction(
  p_prescription_id      uuid,
  p_practice_location_id uuid,
  p_replacement_reason   text
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_doctor uuid := public.current_doctor_id();
  v_rx     public.prescriptions%rowtype;
  v_reason text := nullif(btrim(coalesce(p_replacement_reason, '')), '');
  v_id     uuid;
  v_draft  uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if v_doctor is null then
    raise exception 'only a doctor can write a prescription' using errcode = '42501';
  end if;

  /**
   * 1–4. Resolve by ID, and require all four things of it. Missing, not-yours,
   * elsewhere and not-finalised answer identically, so the id space cannot be
   * probed for what exists.
   */
  select * into v_rx from public.prescriptions where id = p_prescription_id;
  if not found
     or v_rx.owner_doctor_id is distinct from v_doctor
     or v_rx.practice_location_id is distinct from p_practice_location_id
     or v_rx.status <> 'FINALIZED' then
    raise exception 'prescription not found' using errcode = '42501';
  end if;

  -- 6. Serialise on the row being replaced, before looking.
  perform pg_advisory_xact_lock(hashtextextended('rx:correct:' || p_prescription_id::text, 0));

  -- 7. Already corrected? That correction IS the answer, draft or finalised.
  select id into v_id from public.prescriptions
   where replaces_prescription_id = p_prescription_id;
  if v_id is not null then
    return v_id;
  end if;

  /**
   * The reason is checked AFTER the idempotent branch on purpose: a doctor
   * arriving at an existing correction should be taken to it, not asked to
   * justify one that already exists.
   */
  if v_reason is null then
    raise exception 'PRESCRIPTION_REPLACEMENT_NEEDS_REASON' using errcode = '22023';
  end if;

  /**
   * One DRAFT per encounter is a unique index, and a loose draft that is not
   * this correction would make the insert fail on a constraint the doctor
   * cannot interpret. Say what is actually in the way instead.
   */
  select id into v_draft from public.prescriptions
   where encounter_id = v_rx.encounter_id and status = 'DRAFT';
  if v_draft is not null then
    raise exception 'PRESCRIPTION_DRAFT_IN_PROGRESS' using errcode = 'P0001';
  end if;

  -- 8–9. Blank, and pointing at exactly the row that was named. Every field is
  -- copied from THAT row — none of it is a parameter.
  insert into public.prescriptions (
    encounter_id, owner_doctor_id, patient_id, practice_location_id,
    replaces_prescription_id, replacement_reason, created_by
  ) values (
    v_rx.encounter_id, v_rx.owner_doctor_id, v_rx.patient_id, v_rx.practice_location_id,
    p_prescription_id, v_reason, auth.uid()
  )
  returning id into v_id;

  insert into public.prescription_events (prescription_id, event_type, detail, actor_id)
  values (
    v_id, 'REPLACEMENT_STARTED'::public.prescription_event_type,
    -- Ids only. The reason is clinical reasoning and is not operational metadata.
    jsonb_build_object('encounterId', v_rx.encounter_id, 'replaces', p_prescription_id),
    auth.uid());

  perform public.log_prescription_audit(
    v_id, p_practice_location_id, 'prescription.replacement_started',
    jsonb_build_object('encounterId', v_rx.encounter_id, 'replaces', p_prescription_id));

  return v_id;   -- 10
end;
$$;

revoke all on function public.start_prescription_correction(uuid, uuid, text)
  from public, anon;
grant execute on function public.start_prescription_correction(uuid, uuid, text)
  to authenticated;
