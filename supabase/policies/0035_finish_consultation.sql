-- =============================================================================
-- 0035 — Finishing a consultation closes the visit, not just the notes.
--
-- THE BUG THIS FIXES (C-001).
--
-- `close_encounter` closes the ENCOUNTER. The live queue is not built from
-- encounters — `get_queue` reads `appointments` where the status is ARRIVED or
-- IN_CONSULTATION. So finishing a consultation left the appointment sitting at
-- IN_CONSULTATION, and that status sorts FIRST in the queue:
--
--     order by case when a.status = 'IN_CONSULTATION' then 0 else 1 end, ...
--
-- The patient the doctor had just finished with therefore stayed pinned to the
-- top of the Live Queue permanently, and the next waiting patient could never
-- reach it. A chamber day stops after one patient.
--
-- WHAT THIS IS, AND WHAT IT IS NOT.
--
-- It is an ORCHESTRATOR and nothing more. It contains no rule of its own: it
-- calls `close_encounter` for the clinical lifecycle and `set_appointment_status`
-- for the operational one, in that order, in one transaction. Each keeps its
-- own authorisation, its own lock, its own transition rules, its own event row
-- and its own audit row.
--
-- `close_encounter` is deliberately NOT taught about appointments. A clinical
-- closure that silently rewrote operational state would mean the two lifecycles
-- could never diverge again — and they must be able to: a visit can be closed
-- clinically while the appointment is cancelled, and an appointment exists for
-- walk-ins that have none at all.
-- =============================================================================

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
   * Clinical closure first, through the function that owns it. It re-checks
   * location and ownership, enforces the version, writes its own event and
   * fails closed with its audit in this same transaction (ADR 0007). Nothing
   * here repeats or relaxes any of that.
   */
  v_enc_status := public.close_encounter(
    p_encounter_id, p_practice_location_id, p_expected_version, 'COMPLETED');

  if v_appointment is not null then
    /**
     * Locked before deciding, so the status this reads is the status
     * `set_appointment_status` will act on. Same transaction, so its own
     * FOR UPDATE is a re-entrant no-op.
     */
    select status into v_appt_status
    from public.appointments
    where id = v_appointment
    for update;

    /**
     * ONLY from IN_CONSULTATION. `appointment_transition_allowed` treats
     * COMPLETED, CANCELLED and NO_SHOW as terminal, and does not permit
     * ARRIVED -> COMPLETED at all — so calling blindly would raise and roll
     * back the clinical closure with it.
     *
     * A doctor must always be able to finish writing a visit. If the
     * appointment was cancelled at the desk while they were still typing, the
     * notes still close and the appointment is left exactly as the desk set
     * it; the patient is already out of the queue by that route.
     */
    if v_appt_status = 'IN_CONSULTATION' then
      v_appt_status := public.set_appointment_status(v_appointment, 'COMPLETED');
    end if;
  end if;

  /**
   * Both outcomes, so the caller can say what actually happened rather than
   * assume. `appointmentStatus` is null for a walk-in, which had none.
   */
  return jsonb_build_object(
    'encounterStatus',   v_enc_status,
    'appointmentId',     v_appointment,
    'appointmentStatus', v_appt_status);
end;
$$;

revoke all on function public.finish_consultation(uuid, uuid, integer) from public, anon;
grant execute on function public.finish_consultation(uuid, uuid, integer) to authenticated;
