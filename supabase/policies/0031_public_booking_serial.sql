-- =============================================================================
-- Premium public booking: privacy-safe confirmation + stable appointment serial.
--
-- The serial is DERIVED, not stored:
--   doctor + chamber + clinic day, ordered by immutable booking creation order.
-- Cancelled / no-show rows stay in the rank so later status changes never
-- renumber somebody else's appointment.
--
-- IMPORTANT: this is NOT the live queue token. Queue tokens remain arrival-time
-- operational state and this file does not alter live queue state or queue tables.
-- =============================================================================

create or replace function public.public_booking_confirmation(
  p_slug text,
  p_booking_ref uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_appointment_id uuid;
  v_doctor_id uuid;
  v_location_id uuid;
  v_session_date date;
  v_created_at timestamptz;
  v_scheduled_for timestamptz;
  v_status public.appointment_status;
  v_timezone text;
  v_doctor_name text;
  v_location_name text;
  v_serial integer;
begin
  if p_slug is null or btrim(p_slug) = '' or p_booking_ref is null then
    return null;
  end if;

  select
    a.id,
    a.owner_doctor_id,
    a.practice_location_id,
    a.session_date,
    a.created_at,
    a.scheduled_for,
    a.status,
    pl.timezone,
    pr.full_name,
    pl.name
  into
    v_appointment_id,
    v_doctor_id,
    v_location_id,
    v_session_date,
    v_created_at,
    v_scheduled_for,
    v_status,
    v_timezone,
    v_doctor_name,
    v_location_name
  from public.appointments a
  join public.doctor_profiles d on d.id = a.owner_doctor_id
  join public.profiles pr on pr.id = d.user_id
  join public.practice_locations pl on pl.id = a.practice_location_id
  where a.public_booking_ref = p_booking_ref
    and a.booking_source = 'PUBLIC'
    and d.profile_slug = lower(btrim(p_slug))
    and d.profile_visibility = 'PUBLIC'
  limit 1;

  if not found then
    return null;
  end if;

  select count(*)::int
  into v_serial
  from public.appointments x
  where x.owner_doctor_id = v_doctor_id
    and x.practice_location_id = v_location_id
    and x.session_date = v_session_date
    and (
      x.created_at < v_created_at
      or (x.created_at = v_created_at and x.id <= v_appointment_id)
    );

  return jsonb_build_object(
    'bookingRef', p_booking_ref,
    'serial', v_serial,
    'doctorName', v_doctor_name,
    'chamberName', v_location_name,
    'date', v_session_date,
    'localTime', to_char(v_scheduled_for at time zone v_timezone, 'HH24:MI'),
    'status', v_status
  );
end;
$$;

revoke all on function public.public_booking_confirmation(text, uuid) from public;
grant execute on function public.public_booking_confirmation(text, uuid) to anon, authenticated;
