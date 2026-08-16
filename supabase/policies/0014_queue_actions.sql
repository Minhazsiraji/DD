-- =============================================================================
-- Queue actions. These functions ARE the write path for queue_entries.
--
-- Each is SECURITY DEFINER with a pinned search_path and authorises explicitly,
-- because a DEFINER function does not inherit RLS. Each writes its queue_event
-- in the same transaction, so the entry and its history cannot disagree.
--
-- None of these change appointment status. Calling a patient is an
-- ANNOUNCEMENT, not a state change (ADR 0009) — starting and finishing the
-- consultation stay with set_appointment_status(), so there is exactly one way
-- to move a patient through their day.
-- =============================================================================

-- The earlier forms took only an appointment id, so they could act on a
-- patient at ANY location the caller was allowed into — not the one they were
-- working in. `create or replace` with the new signature would leave those as
-- granted overloads, so they are dropped outright.
drop function if exists public.call_patient(uuid, text);
drop function if exists public.skip_patient(uuid, text);
drop function if exists public.set_queue_priority(uuid, public.priority_reason, text);
drop function if exists public.clear_queue_priority(uuid);

/**
 * Get or create the queue row for an appointment, having checked the caller may
 * act on it. Rows are lazy so arriving stays a single write.
 *
 * Locks the appointment for the rest of the transaction: two assistants
 * pressing "call" at the same moment must not both increment from the same
 * count, and the lock is what serialises them.
 */
create or replace function public.queue_entry_for(
  target_appointment uuid,
  expected_location  uuid
)
returns public.queue_entries
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_appt  public.appointments%rowtype;
  v_entry public.queue_entries%rowtype;
begin
  select * into v_appt from public.appointments
   where id = target_appointment for update;

  /**
   * The appointment must belong to the location the caller is WORKING IN, not
   * merely to one they are allowed into.
   *
   * Someone who runs the desk at two clinics could otherwise act on a patient
   * at clinic B while the screen — and the audit event the application writes
   * afterwards — say clinic A. The RPC would authorise it quite correctly, and
   * the resulting history would name the wrong place.
   *
   * `expected_location` comes from the server's session context, never from a
   * client field.
   */
  -- Same message whether it is missing, not yours, or somewhere else: which
  -- appointment ids exist and where is not something to probe for.
  if not found
     or v_appt.practice_location_id is distinct from expected_location
     or not public.may_manage_appointments(v_appt.owner_doctor_id,
                                           v_appt.practice_location_id) then
    raise exception 'appointment not found' using errcode = '42501';
  end if;

  /**
   * Queue actions require ARRIVED.
   *
   * Once the consultation starts the patient is no longer IN the queue — they
   * are the reason it is moving. Calling, skipping or reprioritising someone
   * already with the doctor is meaningless at best and, in the case of skip,
   * actively wrong: it would show a patient as passed over while they are
   * sitting in the room.
   *
   * They stay VISIBLE in get_queue() as the current patient. Visible and
   * mutable are different things, and the boundary belongs here rather than in
   * a hidden button — the RPC is granted to every front-desk user.
   */
  if v_appt.status = 'IN_CONSULTATION' then
    raise exception 'that patient is already with the doctor' using errcode = '22023';
  end if;

  if v_appt.status <> 'ARRIVED' then
    raise exception 'that patient is not in the queue' using errcode = '22023';
  end if;

  insert into public.queue_entries (appointment_id, practice_location_id, session_date)
  values (target_appointment, v_appt.practice_location_id, v_appt.session_date)
  on conflict (appointment_id) do update set updated_at = now()
  returning * into v_entry;

  return v_entry;
end;
$$;

-- Drop the old single-argument form so no location-blind path survives.
drop function if exists public.queue_entry_for(uuid);
revoke all on function public.queue_entry_for(uuid, uuid) from public, anon, authenticated;

/** Announce a patient. Repeatable — being called twice is normal. */
create or replace function public.call_patient(
  p_appointment_id uuid,
  p_practice_location_id uuid,
  p_note           text default null
)
returns integer
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_entry public.queue_entries%rowtype;
  v_was_skipped boolean;
  v_count integer;
begin
  v_entry := public.queue_entry_for(p_appointment_id, p_practice_location_id);
  v_was_skipped := v_entry.skipped_at is not null;

  update public.queue_entries set
    called_at  = now(),
    call_count = call_count + 1,
    -- Calling someone who was skipped puts them back in the line. That IS the
    -- recall; a separate action would just be a second name for it.
    skipped_at = null,
    updated_at = now()
  where appointment_id = p_appointment_id
  returning call_count into v_count;

  insert into public.queue_events (appointment_id, practice_location_id, event_type, note, actor_id)
  values (p_appointment_id, v_entry.practice_location_id,
          (case when v_was_skipped then 'RECALLED' else 'CALLED' end)::public.queue_event_type,
          nullif(btrim(coalesce(p_note, '')), ''), auth.uid());

  return v_count;
end;
$$;

revoke all on function public.call_patient(uuid, uuid, text) from public, anon;
grant execute on function public.call_patient(uuid, uuid, text) to authenticated;

/**
 * They did not answer.
 *
 * The appointment stays ARRIVED: they are still here and still owed a
 * consultation. Marking them NO_SHOW would be a lie — that is for someone who
 * never came at all, and it is terminal.
 */
create or replace function public.skip_patient(
  p_appointment_id uuid,
  p_practice_location_id uuid,
  p_note           text default null
)
returns integer
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_entry public.queue_entries%rowtype;
  v_count integer;
begin
  v_entry := public.queue_entry_for(p_appointment_id, p_practice_location_id);

  if v_entry.skipped_at is not null then
    return v_entry.skip_count;          -- idempotent; a double-tap is not an error
  end if;

  update public.queue_entries set
    skipped_at = now(),
    skip_count = skip_count + 1,
    updated_at = now()
  where appointment_id = p_appointment_id
  returning skip_count into v_count;

  insert into public.queue_events (appointment_id, practice_location_id, event_type, note, actor_id)
  values (p_appointment_id, v_entry.practice_location_id, 'SKIPPED',
          nullif(btrim(coalesce(p_note, '')), ''), auth.uid());

  return v_count;
end;
$$;

revoke all on function public.skip_patient(uuid, uuid, text) from public, anon;
grant execute on function public.skip_patient(uuid, uuid, text) to authenticated;

/**
 * Move someone up the queue.
 *
 * The reason is REQUIRED by the database, not by the form. A queue that lets
 * people jump without recording why is a queue that will be accused of selling
 * the privilege, and the assistant who did it will have nothing to show.
 */
create or replace function public.set_queue_priority(
  p_appointment_id uuid,
  p_practice_location_id uuid,
  p_reason         public.priority_reason,
  p_note           text default null
)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_entry public.queue_entries%rowtype;
begin
  if p_reason is null then
    raise exception 'moving someone up the queue needs a reason' using errcode = '22023';
  end if;

  v_entry := public.queue_entry_for(p_appointment_id, p_practice_location_id);

  update public.queue_entries set
    priority        = 1,
    priority_reason = p_reason,
    priority_note   = nullif(btrim(coalesce(p_note, '')), ''),
    priority_set_by = auth.uid(),
    updated_at      = now()
  where appointment_id = p_appointment_id;

  insert into public.queue_events
    (appointment_id, practice_location_id, event_type, reason, note, actor_id)
  values (p_appointment_id, v_entry.practice_location_id, 'PRIORITY_SET',
          p_reason, nullif(btrim(coalesce(p_note, '')), ''), auth.uid());
end;
$$;

revoke all on function public.set_queue_priority(uuid, uuid, public.priority_reason, text)
  from public, anon;
grant execute on function public.set_queue_priority(uuid, uuid, public.priority_reason, text)
  to authenticated;

/** Put someone back in ordinary order. The reason they jumped stays in history. */
create or replace function public.clear_queue_priority(
  p_appointment_id uuid,
  p_practice_location_id uuid
)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_entry public.queue_entries%rowtype;
begin
  v_entry := public.queue_entry_for(p_appointment_id, p_practice_location_id);

  update public.queue_entries set
    priority        = 0,
    priority_reason = null,
    priority_note   = null,
    priority_set_by = auth.uid(),
    updated_at      = now()
  where appointment_id = p_appointment_id;

  insert into public.queue_events (appointment_id, practice_location_id, event_type, actor_id)
  values (p_appointment_id, v_entry.practice_location_id, 'PRIORITY_CLEARED', auth.uid());
end;
$$;

revoke all on function public.clear_queue_priority(uuid, uuid) from public, anon;
grant execute on function public.clear_queue_priority(uuid, uuid) to authenticated;
