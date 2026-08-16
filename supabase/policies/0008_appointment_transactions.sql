-- =============================================================================
-- Appointment state machine and booking, as transactions.
--
-- Per ADR 0007, appointment status changes are "transactional where practical,
-- but not blocking": the status change and its appointment_event share one
-- transaction, so the history can never disagree with the row it describes.
-- These are NOT the fail-closed clinical finalisations — those come later and
-- take the same shape.
-- =============================================================================

/**
 * The only legal transitions. Kept in the DATABASE rather than only in TypeScript
 * because reception, the doctor and (later) the queue screen all mutate the same
 * rows, and a check that lives in one client is not a check.
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

/** Book an appointment and record its CREATED event in one transaction. */
create or replace function public.create_appointment(
  p_owner_doctor_id      uuid,
  p_practice_location_id uuid,
  p_patient_id           uuid,
  p_scheduled_for        timestamptz,
  p_duration_minutes     integer,
  p_visit_type           public.visit_type,
  p_reason               text,
  p_rescheduled_from     uuid default null
)
returns uuid
language plpgsql
volatile
security invoker
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  /**
   * The patient must belong to the doctor the appointment is for. RLS on
   * `patients` would hide another doctor's patient from a doctor, but a
   * RECEPTIONIST can legitimately see patients at their location — so without
   * this check the desk could book Doctor A's patient into Doctor B's clinic
   * and thereby disclose that the patient exists. See ADR 0001.
   */
  if not exists (select 1 from public.patients p where p.id = p_patient_id) then
    /**
     * RLS hid the row entirely. For reception this is the ordinary case of a
     * patient who has never attended THIS location — the doctor's chamber-only
     * patients are invisible here by design. Say that, rather than blaming
     * ownership, which sent me looking in the wrong place once already.
     */
    raise exception 'that patient is not on file at this location'
      using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.patients p
    where p.id = p_patient_id and p.owner_doctor_id = p_owner_doctor_id
  ) then
    raise exception 'that patient belongs to a different doctor' using errcode = '42501';
  end if;

  insert into public.appointments (
    owner_doctor_id, practice_location_id, patient_id, scheduled_for,
    duration_minutes, visit_type, reason, rescheduled_from_id, created_by
  ) values (
    p_owner_doctor_id, p_practice_location_id, p_patient_id, p_scheduled_for,
    coalesce(p_duration_minutes, 15), coalesce(p_visit_type, 'NEW'),
    nullif(btrim(coalesce(p_reason, '')), ''), p_rescheduled_from, auth.uid()
  )
  returning id into v_id;

  insert into public.appointment_events (
    appointment_id, practice_location_id, event_type, to_status, actor_id
  ) values (
    v_id, p_practice_location_id, 'CREATED', 'SCHEDULED', auth.uid()
  );

  return v_id;
end;
$$;

revoke all on function public.create_appointment(
  uuid, uuid, uuid, timestamptz, integer, public.visit_type, text, uuid)
  from public, anon;
grant execute on function public.create_appointment(
  uuid, uuid, uuid, timestamptz, integer, public.visit_type, text, uuid)
  to authenticated;

/**
 * Move an appointment to a new status, writing the matching event in the same
 * transaction. Timestamps are set here rather than by the caller so "arrived at"
 * always means the moment the desk actually pressed the button.
 *
 * The token number is allocated on ARRIVAL, not at booking, so it reflects the
 * order people actually turned up in — which is what a waiting room believes.
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
security invoker
set search_path = public, pg_temp
as $$
declare
  v_appt   public.appointments%rowtype;
  v_event  public.appointment_event_type;
  v_token  integer;
begin
  -- FOR UPDATE: two receptionists pressing "Arrived" at once must not both
  -- allocate a token.
  select * into v_appt from public.appointments
   where id = p_appointment_id for update;

  if not found then
    raise exception 'appointment not found' using errcode = '42501';
  end if;

  if v_appt.status = p_to_status then
    return v_appt.status;               -- idempotent; a double-click is not an error
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

  if p_to_status = 'ARRIVED' then
    select coalesce(max(token_number), 0) + 1 into v_token
    from public.appointments
    where practice_location_id = v_appt.practice_location_id
      and scheduled_for::date  = v_appt.scheduled_for::date;
  end if;

  update public.appointments set
    status                 = p_to_status,
    token_number           = coalesce(v_token, token_number),
    arrived_at             = case when p_to_status = 'ARRIVED'         then now() else arrived_at end,
    consultation_started_at= case when p_to_status = 'IN_CONSULTATION' then now() else consultation_started_at end,
    completed_at           = case when p_to_status = 'COMPLETED'       then now() else completed_at end,
    cancelled_at           = case when p_to_status in ('CANCELLED','NO_SHOW') then now() else cancelled_at end,
    cancellation_reason    = coalesce(p_reason, cancellation_reason),
    cancellation_note      = coalesce(nullif(btrim(coalesce(p_note, '')), ''), cancellation_note),
    updated_at             = now()
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

revoke all on function public.set_appointment_status(
  uuid, public.appointment_status, public.cancellation_reason, text) from public, anon;
grant execute on function public.set_appointment_status(
  uuid, public.appointment_status, public.cancellation_reason, text) to authenticated;

/**
 * Reschedule = cancel the old appointment (reason RESCHEDULED) and create a new
 * one linked back to it, in ONE transaction.
 *
 * Deliberately not an in-place date change: "this patient was originally due on
 * the 3rd and has now been moved twice" is a real question a clinic asks, and a
 * mutated row cannot answer it.
 */
create or replace function public.reschedule_appointment(
  p_appointment_id   uuid,
  p_scheduled_for    timestamptz,
  p_duration_minutes integer default null,
  p_note             text default null
)
returns uuid
language plpgsql
volatile
security invoker
set search_path = public, pg_temp
as $$
declare
  v_appt public.appointments%rowtype;
  v_new  uuid;
begin
  select * into v_appt from public.appointments where id = p_appointment_id for update;

  if not found then
    raise exception 'appointment not found' using errcode = '42501';
  end if;

  if v_appt.status in ('COMPLETED','CANCELLED','NO_SHOW') then
    raise exception 'cannot reschedule an appointment that is already %', v_appt.status
      using errcode = '22023';
  end if;

  update public.appointments set
    status              = 'CANCELLED',
    cancelled_at        = now(),
    cancellation_reason = 'RESCHEDULED',
    cancellation_note   = nullif(btrim(coalesce(p_note, '')), ''),
    updated_at          = now()
  where id = p_appointment_id;

  insert into public.appointment_events (
    appointment_id, practice_location_id, event_type, from_status, to_status, actor_id, note
  ) values (
    p_appointment_id, v_appt.practice_location_id, 'RESCHEDULED', v_appt.status, 'CANCELLED',
    auth.uid(), nullif(btrim(coalesce(p_note, '')), '')
  );

  v_new := public.create_appointment(
    v_appt.owner_doctor_id, v_appt.practice_location_id, v_appt.patient_id,
    p_scheduled_for, coalesce(p_duration_minutes, v_appt.duration_minutes),
    v_appt.visit_type, v_appt.reason, p_appointment_id
  );

  return v_new;
end;
$$;

revoke all on function public.reschedule_appointment(uuid, timestamptz, integer, text)
  from public, anon;
grant execute on function public.reschedule_appointment(uuid, timestamptz, integer, text)
  to authenticated;
