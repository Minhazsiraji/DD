-- Booking settings: two gaps closed.
--
-- The settings themselves shipped in 0030 and work. An audit against the
-- pilot's requirements found two things missing, and one of them is a hole.
--
-- GAP A — MEMBERSHIP WAS NEVER CHECKED.
--
-- `save_doctor_booking_settings` verified that the chamber belongs to the
-- doctor and that the location is active. It never verified that the doctor
-- still has an ACTIVE membership at that location. `practice_location_members`
-- appeared zero times across every booking-settings function.
--
-- So a doctor whose membership had ended or been suspended could still switch
-- public booking on there — and the public path would then take bookings from
-- strangers into a chamber they no longer practise at. Chamber ownership is a
-- historical fact; membership is the current one, and enabling an anonymous
-- write path is a present-tense act.
--
-- THE ASYMMETRY IS DELIBERATE: membership is required to ENABLE, never to
-- DISABLE. A doctor who has left must always be able to shut the door behind
-- them, and a safety control that can be locked out by the condition it
-- protects against is not a safety control.
--
-- GAP B — NOBODY RECORDED WHO OPENED THE DOOR.
--
-- Nothing wrote an audit row when public booking was turned on. For a switch
-- that exposes an anonymous write path into the appointment book, "who enabled
-- this, and when?" had no answer.
--
-- The row is written INSIDE this function, in the same transaction as the
-- setting. ADR 0007 and CLAUDE.md are explicit that `emitAudit` swallows
-- failures by design and is the wrong mechanism where the audit must not be
-- lost. If the audit cannot be written, the setting does not change.
--
-- Only `save_doctor_booking_settings` is replaced. The closed-date functions
-- are untouched: they cannot open a booking path, and blocking a departed
-- doctor from marking a date closed would work against the same safety
-- reasoning as above.

create or replace function public.save_doctor_booking_settings(
  p_chamber_id uuid,
  p_enabled boolean,
  p_mode text,
  p_slot_minutes integer,
  p_max_patients integer,
  p_window_days integer,
  p_lead_minutes integer,
  p_fee numeric default null,
  p_currency text default 'BDT'
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_doctor uuid := public.current_doctor_id();
  v_location uuid;
  v_was_enabled boolean;
  v_id uuid;
begin
  if v_doctor is null then
    raise exception 'DOCTOR_REQUIRED';
  end if;

  /*
   * The chamber must be the caller's, and the location comes FROM the chamber
   * rather than from the caller. Knowing a chamber id proves nothing, and
   * accepting a location id alongside it would let the two disagree.
   */
  select dc.practice_location_id into v_location
  from public.doctor_chambers dc
  where dc.id = p_chamber_id and dc.doctor_profile_id = v_doctor;

  if v_location is null then
    raise exception 'CHAMBER_NOT_FOUND';
  end if;

  if p_mode not in ('TOKEN', 'TIME_SLOT') then
    raise exception 'INVALID_MODE';
  end if;
  if p_slot_minutes is null or p_slot_minutes < 5 or p_slot_minutes > 180 then
    raise exception 'INVALID_SLOT_MINUTES';
  end if;
  if p_max_patients is null or p_max_patients < 1 or p_max_patients > 500 then
    raise exception 'INVALID_MAX_PATIENTS';
  end if;
  if p_window_days is null or p_window_days < 1 or p_window_days > 180 then
    raise exception 'INVALID_WINDOW';
  end if;
  if p_lead_minutes is null or p_lead_minutes < 0 or p_lead_minutes > 10080 then
    raise exception 'INVALID_LEAD';
  end if;
  if p_fee is not null and (p_fee < 0 or p_fee > 1000000) then
    raise exception 'INVALID_FEE';
  end if;
  if p_currency is null or p_currency !~ '^[A-Z]{3}$' then
    raise exception 'INVALID_CURRENCY';
  end if;

  if p_enabled then
    -- GAP A. Present-tense membership, not historical chamber ownership.
    if not exists (
      select 1 from public.practice_location_members m
      where m.practice_location_id = v_location
        and m.user_id = v_user
        and m.role = 'DOCTOR'
        and m.status = 'ACTIVE'
    ) then
      raise exception 'NOT_ACTIVE_AT_LOCATION';
    end if;

    if not exists (
      select 1 from public.doctor_chamber_hours h where h.chamber_id = p_chamber_id
    ) then
      raise exception 'NO_VISITING_HOURS';
    end if;

    if not exists (
      select 1 from public.practice_locations pl
      where pl.id = v_location and pl.is_active = true
    ) then
      raise exception 'LOCATION_INACTIVE';
    end if;
  end if;

  select bs.booking_enabled into v_was_enabled
  from public.doctor_booking_settings bs
  where bs.doctor_chamber_id = p_chamber_id;

  insert into public.doctor_booking_settings (
    doctor_profile_id, doctor_chamber_id, booking_enabled, booking_mode,
    slot_minutes, max_patients, booking_window_days, min_lead_minutes,
    consultation_fee, currency
  ) values (
    v_doctor, p_chamber_id, p_enabled, p_mode,
    p_slot_minutes, p_max_patients, p_window_days, p_lead_minutes,
    p_fee, p_currency
  )
  on conflict (doctor_chamber_id) do update set
    booking_enabled = excluded.booking_enabled,
    booking_mode = excluded.booking_mode,
    slot_minutes = excluded.slot_minutes,
    max_patients = excluded.max_patients,
    booking_window_days = excluded.booking_window_days,
    min_lead_minutes = excluded.min_lead_minutes,
    consultation_fee = excluded.consultation_fee,
    currency = excluded.currency,
    updated_at = now()
  returning id into v_id;

  /*
   * GAP B. Same transaction as the write — if this fails, the setting does not
   * change. The action distinguishes the moment the door opened or closed from
   * an ordinary tuning of slot length, because those are different questions
   * asked of an audit log.
   */
  insert into public.audit_events (
    practice_location_id, actor_id, action, resource_type, resource_id, meta
  ) values (
    v_location,
    v_user,
    case
      when p_enabled and coalesce(v_was_enabled, false) = false then 'PUBLIC_BOOKING_ENABLED'
      when not p_enabled and coalesce(v_was_enabled, false) = true then 'PUBLIC_BOOKING_DISABLED'
      else 'BOOKING_SETTINGS_UPDATED'
    end,
    'doctor_booking_settings',
    v_id,
    jsonb_build_object(
      'chamberId', p_chamber_id,
      'wasEnabled', v_was_enabled,
      'nowEnabled', p_enabled,
      'mode', p_mode,
      'slotMinutes', p_slot_minutes,
      'maxPatients', p_max_patients,
      'bookingWindowDays', p_window_days,
      'minLeadMinutes', p_lead_minutes,
      'currency', p_currency
    )
  );

  return v_id;
end;
$$;

revoke all on function public.save_doctor_booking_settings(uuid, boolean, text, integer, integer, integer, integer, numeric, text)
  from public, anon;
grant execute on function public.save_doctor_booking_settings(uuid, boolean, text, integer, integer, integer, integer, numeric, text)
  to authenticated;

-- What this file still does not do: it writes no clinical row, reads no
-- patient, and never touches `profile_visibility`. Enabling booking makes a
-- chamber bookable; it does not make a doctor findable.
