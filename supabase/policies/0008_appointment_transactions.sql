-- =============================================================================
-- The appointment state machine.
--
-- The WRITE FUNCTIONS that used to live here (create_appointment,
-- set_appointment_status, reschedule_appointment) moved to 0011 when direct
-- table writes were revoked in 0010. They were SECURITY INVOKER and relied on
-- RLS to authorise; they are now SECURITY DEFINER and authorise explicitly,
-- because RLS governs which rows you may touch, not which code path touches
-- them.
--
-- Only the transition rule stays here — it is a pure predicate with no
-- privileges of its own.
-- =============================================================================

/**
 * The only legal transitions. Kept in the DATABASE rather than only in
 * TypeScript because reception, the doctor and (later) the queue screen all
 * mutate the same rows, and a check that lives in one client is not a check.
 */
create or replace function public.appointment_transition_allowed(
  from_status public.appointment_status,
  to_status   public.appointment_status
)
returns boolean
language sql
immutable
as $$
  select case from_status
    when 'SCHEDULED'       then to_status in ('CONFIRMED','ARRIVED','CANCELLED','NO_SHOW')
    when 'CONFIRMED'       then to_status in ('ARRIVED','CANCELLED','NO_SHOW')
    when 'ARRIVED'         then to_status in ('IN_CONSULTATION','CANCELLED','NO_SHOW')
    when 'IN_CONSULTATION' then to_status in ('COMPLETED','CANCELLED')
    -- COMPLETED, CANCELLED and NO_SHOW are terminal. A patient who returns gets
    -- a NEW appointment; reopening one would rewrite what already happened.
    else false
  end;
$$;
