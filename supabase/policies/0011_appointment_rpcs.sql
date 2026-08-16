-- =============================================================================
-- The appointment write API. These functions ARE the write path (see 0010).
--
-- Every one of them is SECURITY DEFINER with a pinned search_path, and every
-- one does its own authorisation first. They no longer inherit RLS, so nothing
-- here may assume a policy will catch a mistake.
--
-- Per ADR 0007, each mutation and its appointment_event share one transaction:
-- a plpgsql body is atomic, so the row and its history cannot disagree.
-- =============================================================================

/** Book an appointment and record its CREATED event. */
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
security definer
set search_path = public, pg_temp
as $$
declare
  v_id      uuid;
  v_session date;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  -- (1) May the caller book for this doctor, here?
  if not public.may_manage_appointments(p_owner_doctor_id, p_practice_location_id) then
    raise exception 'you cannot book appointments for that doctor at this location'
      using errcode = '42501';
  end if;

  -- (2) Does the doctor actually practise here? Checked separately from (1)
  --     because front-desk staff pass (1) for ANY doctor id they name.
  if not public.doctor_practises_at(p_owner_doctor_id, p_practice_location_id) then
    raise exception 'that doctor does not practise at this location'
      using errcode = '42501';
  end if;

  -- (3) Is the patient even visible to the caller? A DEFINER function bypasses
  --     the patients policy, so the chamber-only rule must be re-stated.
  if not public.may_see_patient(p_patient_id) then
    raise exception 'that patient is not on file at this location'
      using errcode = '42501';
  end if;

  -- (4) And do they belong to the doctor being booked?
  if not exists (
    select 1 from public.patients p
    where p.id = p_patient_id and p.owner_doctor_id = p_owner_doctor_id
  ) then
    raise exception 'that patient belongs to a different doctor' using errcode = '42501';
  end if;

  if p_scheduled_for is null then
    raise exception 'an appointment needs a date and time' using errcode = '22023';
  end if;

  v_session := public.session_date_for(p_practice_location_id, p_scheduled_for);

  insert into public.appointments (
    owner_doctor_id, practice_location_id, patient_id, scheduled_for, session_date,
    duration_minutes, visit_type, reason, rescheduled_from_id, created_by
  ) values (
    p_owner_doctor_id, p_practice_location_id, p_patient_id, p_scheduled_for, v_session,
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
 * Move an appointment to a new status, writing the matching event.
 *
 * Timestamps are stamped here, not supplied by the caller, so "arrived at"
 * always means the moment the desk actually pressed the button.
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
declare
  v_appt  public.appointments%rowtype;
  v_event public.appointment_event_type;
  v_token integer;
begin
  select * into v_appt from public.appointments where id = p_appointment_id;

  -- Same message whether it is missing or merely not yours: "which appointment
  -- ids exist" is not something an outsider should be able to probe.
  if not found or not public.may_manage_appointments(v_appt.owner_doctor_id,
                                                     v_appt.practice_location_id) then
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

revoke all on function public.set_appointment_status(
  uuid, public.appointment_status, public.cancellation_reason, text) from public, anon;
grant execute on function public.set_appointment_status(
  uuid, public.appointment_status, public.cancellation_reason, text) to authenticated;

/**
 * Reschedule = cancel the original (reason RESCHEDULED) and create a linked
 * successor, in ONE transaction.
 *
 * Deliberately not an in-place date change: "originally due on the 3rd, moved
 * twice" is a question clinics ask, and a mutated row cannot answer it.
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
security definer
set search_path = public, pg_temp
as $$
declare
  v_appt public.appointments%rowtype;
  v_new  uuid;
begin
  select * into v_appt from public.appointments where id = p_appointment_id for update;

  if not found or not public.may_manage_appointments(v_appt.owner_doctor_id,
                                                     v_appt.practice_location_id) then
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
