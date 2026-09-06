-- ---------------------------------------------------------------------------
-- Prescription correction window hardening.
--
-- Additive follow-on to 0024_correction_trust_boundary.sql. The finalized
-- prescription remains immutable; this function only controls whether a new,
-- blank correction successor may be initiated.
--
-- Security invariant: correction authorization is decided from canonical
-- database state and database time AFTER serialization on the prescription.
-- Client clocks, timezones, stale pages, and caller-supplied timestamps are not
-- inputs to this decision.
-- ---------------------------------------------------------------------------

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
  v_doctor        uuid := public.current_doctor_id();
  v_rx            public.prescriptions%rowtype;
  v_reason        text := nullif(btrim(coalesce(p_replacement_reason, '')), '');
  v_authorized_at timestamptz;
  v_id            uuid;
  v_draft         uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if v_doctor is null then
    raise exception 'only a doctor can write a prescription' using errcode = '42501';
  end if;

  -- The prescription identity is the correction serialization identity. Take
  -- this lock before reading any record state used to authorize the correction.
  -- A request that began before expiry but waits here until after expiry must
  -- be judged at the later, authoritative instant.
  perform pg_advisory_xact_lock(
    hashtextextended('rx:correct:' || p_prescription_id::text, 0)
  );

  -- Canonical re-read after serialization. Missing, not-yours, elsewhere and
  -- not-finalized intentionally remain indistinguishable to callers.
  select * into v_rx
  from public.prescriptions
  where id = p_prescription_id;

  if not found
     or v_rx.owner_doctor_id is distinct from v_doctor
     or v_rx.practice_location_id is distinct from p_practice_location_id
     or v_rx.status <> 'FINALIZED' then
    raise exception 'prescription not found' using errcode = '42501';
  end if;

  -- A FINALIZED row without its canonical finalization instant is impossible
  -- state for this workflow. Fail closed; never infer from created/updated time.
  if v_rx.finalized_at is null then
    raise exception 'PRESCRIPTION_FINALIZATION_STATE_INVALID' using errcode = 'P0001';
  end if;

  -- Sample wall-clock database time only after correction serialization and the
  -- canonical state check. `>` makes exactly +48:00:00 valid and the first
  -- instant after it expired.
  v_authorized_at := clock_timestamp();
  if v_authorized_at > v_rx.finalized_at + interval '48 hours' then
    raise exception 'CORRECTION_WINDOW_EXPIRED' using errcode = 'P0001';
  end if;

  -- Within the open window, preserve 0024's idempotency: two tabs serialize and
  -- the later caller receives the already-created linear successor.
  select id into v_id
  from public.prescriptions
  where replaces_prescription_id = p_prescription_id;

  if v_id is not null then
    return v_id;
  end if;

  -- Preserve the existing reason contract. A retry that found an existing
  -- successor above is navigation, not a second correction initiation.
  if v_reason is null then
    raise exception 'PRESCRIPTION_REPLACEMENT_NEEDS_REASON' using errcode = '22023';
  end if;

  select id into v_draft
  from public.prescriptions
  where encounter_id = v_rx.encounter_id
    and status = 'DRAFT';

  if v_draft is not null then
    raise exception 'PRESCRIPTION_DRAFT_IN_PROGRESS' using errcode = 'P0001';
  end if;

  -- Runtime correction successors intentionally start BLANK. Do not copy
  -- prescription_items here; M3 copy/reuse UX is outside this security slice.
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
    v_id,
    'REPLACEMENT_STARTED'::public.prescription_event_type,
    jsonb_build_object('encounterId', v_rx.encounter_id, 'replaces', p_prescription_id),
    auth.uid()
  );

  perform public.log_prescription_audit(
    v_id,
    p_practice_location_id,
    'prescription.replacement_started',
    jsonb_build_object('encounterId', v_rx.encounter_id, 'replaces', p_prescription_id)
  );

  return v_id;
end;
$$;

-- Keep only the bounded, trusted signature browser-callable. Historical paths
-- that could infer or initiate an unbounded correction stay physically closed.
drop function if exists public.start_prescription_correction(uuid, text);
drop function if exists public.open_prescription(uuid, uuid, text);

revoke all on function public.start_prescription_correction(uuid, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.start_prescription_correction(uuid, uuid, text)
  to authenticated;
