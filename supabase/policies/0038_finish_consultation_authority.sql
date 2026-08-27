-- =============================================================================
-- 0038 — C-006. One usable way to finish a visit, enforced by grant.
--
-- THE BYPASS.
--
-- `set_appointment_status` is granted to `authenticated` and is the desk's
-- ordinary tool: arrived, confirmed, cancelled, no-show. It also accepted
-- IN_CONSULTATION -> COMPLETED, and the appointments screen offered exactly
-- that as a button labelled "Finish consultation".
--
-- Pressed, it completed the APPOINTMENT and nothing else. The patient left the
-- live queue, the day moved on, and the encounter stayed DRAFT — a visit that
-- had plainly happened, recorded as still in progress, with no screen showing
-- anything wrong. Reception and the location admin could do it too.
--
-- THE FIX IS A GRANT, NOT A FLAG.
--
-- The transition still exists in the state machine, because the clinical
-- orchestrator genuinely needs it. What changes is WHO CAN REACH IT:
--
--     apply_appointment_status   does the work. Granted to NOBODY.
--     set_appointment_status     the desk's entry point. Refuses this one
--                                transition, delegates everything else.
--     finish_consultation        the clinical orchestrator. Reaches the work
--                                directly, as its definer.
--
-- A transaction-local flag would have been simpler and would not have been a
-- control: it can be set by whoever is asking. A privilege cannot.
--
-- The public signature gains NO parameter. `set_appointment_status` still takes
-- four arguments and there is nothing a caller can pass to unlock the
-- transition — a defaulted parameter is still a parameter a caller may supply.
-- =============================================================================

/**
 * The whole of the old `set_appointment_status`, moved intact.
 *
 * Every rule it had is still here and still applies: the row lock that stops
 * two clicks taking two tokens, the identical message for missing and
 * not-yours, the idempotent no-op, the transition table, the reason
 * requirement, the token allocation and the event row.
 *
 * `p_allow_clinical_completion` is the ONE addition, and it is reachable only
 * because this function is granted to nobody.
 */
create or replace function public.apply_appointment_status(
  p_appointment_id            uuid,
  p_to_status                 public.appointment_status,
  p_reason                    public.cancellation_reason,
  p_note                      text,
  p_allow_clinical_completion boolean
)
returns public.appointment_status
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_appt  public.appointments%rowtype;
  v_event public.appointment_event_type;
  v_token integer;
begin
  /**
   * FOR UPDATE is load-bearing and was lost once when this moved to DEFINER.
   *
   * Without it two callers acting on the SAME appointment both read the old
   * status, both judge their transition legal, and both write an event — so one
   * click can mark a patient arrived while another cancels them, leaving a row
   * that agrees with neither history. Two arrival clicks would likewise take two
   * tokens. The lock makes the second caller re-read after the first commits,
   * where the idempotent check and the transition rule then apply.
   */
  select * into v_appt from public.appointments where id = p_appointment_id for update;

  -- Same message whether it is missing or merely not yours: "which appointment
  -- ids exist" is not something an outsider should be able to probe.
  if not found or not public.may_manage_appointments(v_appt.owner_doctor_id,
                                                     v_appt.practice_location_id) then
    raise exception 'appointment not found' using errcode = '42501';
  end if;

  if v_appt.status = p_to_status then
    return v_appt.status;               -- idempotent; a double-click is not an error
  end if;

  /**
   * C-006. Finishing a visit is a CLINICAL act, and this is the operational
   * door.
   *
   * Checked AFTER the authorisation check, so it can never be used to discover
   * which appointment ids exist, and AFTER the idempotent return, so asking to
   * complete an already-completed appointment is still a harmless no-op.
   *
   * 42501 rather than 22023: this is a refusal of AUTHORITY, not of shape. The
   * caller is not allowed to take this route, whatever they send.
   */
  if not p_allow_clinical_completion
     and v_appt.status = 'IN_CONSULTATION'
     and p_to_status = 'COMPLETED' then
    raise exception 'FINISH_VIA_CONSULTATION' using errcode = '42501';
  end if;

  if not public.appointment_transition_allowed(v_appt.status, p_to_status) then
    raise exception 'cannot move an appointment from % to %', v_appt.status, p_to_status
      using errcode = '22023';
  end if;

  if p_to_status = 'CANCELLED' and p_reason is null then
    raise exception 'a cancellation needs a reason' using errcode = '22023';
  end if;

  v_event := case p_to_status
    when 'CONFIRMED'       then 'CONFIRMED'
    when 'ARRIVED'         then 'ARRIVED'
    when 'IN_CONSULTATION' then 'CONSULTATION_STARTED'
    when 'COMPLETED'       then 'COMPLETED'
    when 'CANCELLED'       then 'CANCELLED'
    when 'NO_SHOW'         then 'NO_SHOW'
  end::public.appointment_event_type;

  -- Allocated from the shared counter, never from max()+1, and only if this
  -- appointment has not already been given one.
  if p_to_status = 'ARRIVED' and v_appt.token_number is null then
    v_token := public.allocate_token(v_appt.practice_location_id, v_appt.session_date);
  end if;

  update public.appointments set
    status                  = p_to_status,
    token_number            = coalesce(v_token, token_number),
    arrived_at              = case when p_to_status = 'ARRIVED'         then now() else arrived_at end,
    consultation_started_at = case when p_to_status = 'IN_CONSULTATION' then now() else consultation_started_at end,
    completed_at            = case when p_to_status = 'COMPLETED'       then now() else completed_at end,
    cancelled_at            = case when p_to_status in ('CANCELLED','NO_SHOW') then now() else cancelled_at end,
    cancellation_reason     = coalesce(p_reason, cancellation_reason),
    cancellation_note       = coalesce(nullif(btrim(coalesce(p_note, '')), ''), cancellation_note),
    updated_at              = now()
  where id = p_appointment_id;

  insert into public.appointment_events (
    appointment_id, practice_location_id, event_type, from_status, to_status, actor_id, note
  ) values (
    p_appointment_id, v_appt.practice_location_id, v_event, v_appt.status, p_to_status,
    auth.uid(), nullif(btrim(coalesce(p_note, '')), '')
  );

  return p_to_status;
end;
$$;

/**
 * GRANTED TO NOBODY. This is the whole control.
 *
 * `authenticated` cannot execute it, so the only ways in are the two functions
 * below — both SECURITY DEFINER, both owned by this role, and only one of them
 * willing to complete a consultation.
 */
revoke all on function public.apply_appointment_status(
  uuid, public.appointment_status, public.cancellation_reason, text, boolean)
  from public, anon, authenticated;

/**
 * The desk's entry point, unchanged in signature and in every behaviour except
 * the one transition that is not the desk's to make.
 */
create or replace function public.set_appointment_status(
  p_appointment_id uuid,
  p_to_status      public.appointment_status,
  p_reason         public.cancellation_reason default null,
  p_note           text default null
)
returns public.appointment_status
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  -- `false`: this door never completes a consultation, for any caller. Doctor,
  -- receptionist and location admin alike — the difference between them is not
  -- the point, and making it the point would put a clinical act behind a role
  -- check instead of behind the orchestration that closes the encounter too.
  return public.apply_appointment_status(p_appointment_id, p_to_status, p_reason, p_note, false);
end;
$$;

revoke all on function public.set_appointment_status(
  uuid, public.appointment_status, public.cancellation_reason, text) from public, anon;
grant execute on function public.set_appointment_status(
  uuid, public.appointment_status, public.cancellation_reason, text) to authenticated;

/**
 * The clinical orchestrator — unchanged from 0035 except for the one line that
 * now reaches the internal function.
 *
 * It still contains no rule of its own. `close_encounter` owns the clinical
 * lifecycle; `apply_appointment_status` owns the operational one; this only
 * sequences them in a single transaction so a finished visit cannot leave a
 * DRAFT encounter or a patient stranded in the queue.
 */
create or replace function public.finish_consultation(
  p_encounter_id         uuid,
  p_practice_location_id uuid,
  p_expected_version     integer
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_appointment uuid;
  v_appt_status public.appointment_status;
  v_enc_status  public.encounter_status;
begin
  /**
   * The appointment comes from the ENCOUNTER, never from the caller.
   *
   * A caller-supplied appointment id is how finishing one patient's
   * consultation completes another patient's appointment — and the queue would
   * show exactly nothing wrong afterwards.
   */
  select appointment_id into v_appointment
  from public.encounters
  where id = p_encounter_id;

  /**
   * Clinical closure FIRST, and through the function that owns it. It re-checks
   * location and ownership, enforces the version, writes its own event and
   * fails closed with its audit in this same transaction (ADR 0007).
   *
   * Order matters for C-006: if the doctor may not close this encounter, this
   * raises and the appointment is never touched. There is no path here that
   * completes an appointment without a completed encounter.
   */
  v_enc_status := public.close_encounter(
    p_encounter_id, p_practice_location_id, p_expected_version, 'COMPLETED');

  if v_appointment is not null then
    -- Locked before deciding, so the status this reads is the status the write
    -- below acts on. Same transaction, so the inner FOR UPDATE is re-entrant.
    select status into v_appt_status
    from public.appointments
    where id = v_appointment
    for update;

    /**
     * ONLY from IN_CONSULTATION. COMPLETED, CANCELLED and NO_SHOW are terminal
     * and ARRIVED -> COMPLETED is not a legal transition, so calling blindly
     * would raise and roll the clinical closure back with it.
     *
     * A doctor must always be able to finish writing a visit. If the desk
     * cancelled while they were still typing, the notes still close and the
     * cancellation stands exactly as the desk set it.
     */
    if v_appt_status = 'IN_CONSULTATION' then
      -- `true`: the one caller allowed to make this transition, and only having
      -- already closed the encounter above.
      v_appt_status := public.apply_appointment_status(
        v_appointment, 'COMPLETED', null, null, true);
    end if;
  end if;

  return jsonb_build_object(
    'encounterStatus',   v_enc_status,
    'appointmentId',     v_appointment,
    'appointmentStatus', v_appt_status);
end;
$$;

revoke all on function public.finish_consultation(uuid, uuid, integer) from public, anon;
grant execute on function public.finish_consultation(uuid, uuid, integer) to authenticated;
