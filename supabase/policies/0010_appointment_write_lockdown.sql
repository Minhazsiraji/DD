-- =============================================================================
-- Appointments: the RPCs become the ONLY write path.
--
-- RLS decides which ROWS you may touch. It says nothing about which CODE PATH
-- does the touching — so while `authenticated` held INSERT/UPDATE on
-- appointments, anyone who satisfied a policy could:
--
--   • set status directly, skipping the state machine entirely
--   • move an appointment's date without a reschedule record
--   • swap the patient or the doctor on an existing row
--   • create an appointment with no CREATED event
--   • forge appointment_events, or leave the row and its history disagreeing
--
-- The transactional functions were therefore a convention, not a control. This
-- file removes the direct privileges and moves the authorisation INTO the
-- functions, which become SECURITY DEFINER with a pinned search_path.
--
-- SELECT is untouched: reads still go through RLS, which is the right tool for
-- reads.
-- =============================================================================

-- 1. Take away the direct write privileges. --------------------------------
revoke insert, update, delete on public.appointments       from authenticated;
revoke insert, update, delete on public.appointment_events from authenticated;
revoke all on public.appointment_token_counters            from authenticated, anon;

-- The write POLICIES go too. Leaving them behind would suggest a supported
-- direct-write path that no longer exists, and a future GRANT would silently
-- re-open it.
drop policy if exists appointments_insert       on public.appointments;
drop policy if exists appointments_update       on public.appointments;
drop policy if exists appointment_events_insert on public.appointment_events;

alter table public.appointment_token_counters enable row level security;
alter table public.appointment_token_counters force  row level security;
-- No policies and no grants: reachable only from SECURITY DEFINER functions.

-- 2. Authorisation, now that RLS is no longer doing it for writes. ---------

/**
 * May the caller act on appointments for this doctor at this location?
 *
 * The owning doctor may act anywhere they practise; front-desk staff may act
 * at their own location only. Identical in effect to the SELECT policy — it is
 * spelled out here because the DEFINER functions no longer get RLS for free,
 * and an implicit check is not a check.
 */
create or replace function public.may_manage_appointments(
  target_doctor   uuid,
  target_location uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    (
      exists (
        select 1 from public.doctor_profiles d
        where d.id = target_doctor and d.user_id = auth.uid()
      )
      and public.doctor_practises_at(target_doctor, target_location)
    )
    or exists (
      select 1 from public.practice_location_members m
      where m.practice_location_id = target_location
        and m.user_id = auth.uid()
        and m.role in ('RECEPTIONIST', 'LOCATION_ADMIN')
        and m.status = 'ACTIVE'
    );
$$;

revoke all on function public.may_manage_appointments(uuid, uuid) from public, anon;
grant execute on function public.may_manage_appointments(uuid, uuid) to authenticated;

/**
 * Can the caller see this patient at all?
 *
 * Replicates the `patients` SELECT policy, because a DEFINER function bypasses
 * it. Without this the desk could book a patient it is not allowed to know
 * exists — a doctor's chamber-only patients must stay invisible at the hospital.
 */
create or replace function public.may_see_patient(target_patient uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.patients p
    join public.doctor_profiles d on d.id = p.owner_doctor_id
    where p.id = target_patient and d.user_id = auth.uid()
  )
  or exists (
    select 1
    from public.patient_location_links l
    join public.practice_location_members m
      on m.practice_location_id = l.practice_location_id
    where l.patient_id = target_patient
      and m.user_id = auth.uid()
      and m.status = 'ACTIVE'
  );
$$;

revoke all on function public.may_see_patient(uuid) from public, anon;
grant execute on function public.may_see_patient(uuid) to authenticated;

/**
 * The clinic day an instant belongs to, in the LOCATION's timezone.
 *
 * `scheduled_for::date` uses the session timezone, so a 12:30am Dhaka
 * appointment reads as the previous day in a UTC session and would be filed
 * into — and take a token from — the wrong session.
 */
create or replace function public.session_date_for(
  target_location uuid,
  at              timestamptz
)
returns date
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select (at at time zone coalesce(
            (select l.timezone from public.practice_locations l where l.id = target_location),
            'Asia/Dhaka'))::date;
$$;

revoke all on function public.session_date_for(uuid, timestamptz) from public, anon;
grant execute on function public.session_date_for(uuid, timestamptz) to authenticated;

/**
 * "2026-09-01T15:30" as typed by a receptionist -> the actual instant.
 *
 * The conversion must happen in the LOCATION's timezone. `new Date("…T15:30")`
 * in JavaScript resolves in the RUNTIME's zone — on Vercel that is UTC, so a
 * 3:30pm Dhaka slot would be stored as 9:30pm Dhaka and the patient would be
 * told the wrong time.
 */
create or replace function public.local_time_to_instant(
  target_location uuid,
  local_value     text
)
returns timestamptz
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select (local_value::timestamp) at time zone coalesce(
           (select l.timezone from public.practice_locations l where l.id = target_location),
           'Asia/Dhaka');
$$;

revoke all on function public.local_time_to_instant(uuid, text) from public, anon;
grant execute on function public.local_time_to_instant(uuid, text) to authenticated;

-- 3. Token allocation that actually serialises. ----------------------------

/**
 * Hand out the next token for a location's clinic day.
 *
 * `select max(token_number) + 1` was wrong even with `FOR UPDATE` on the
 * appointment being checked in: two receptionists checking in two DIFFERENT
 * patients lock different rows, read the same maximum, and issue the same
 * token. Incrementing one shared counter row serialises them — the second
 * caller blocks on the first until it commits.
 *
 * The partial unique index below is the backstop that would turn any remaining
 * race into a loud error rather than two patients holding token 7.
 */
create or replace function public.allocate_token(
  target_location uuid,
  target_session  date
)
returns integer
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_token integer;
begin
  insert into public.appointment_token_counters (practice_location_id, session_date, last_token)
  values (target_location, target_session, 1)
  on conflict (practice_location_id, session_date) do update
    set last_token = public.appointment_token_counters.last_token + 1,
        updated_at = now()
  returning last_token into v_token;

  return v_token;
end;
$$;

revoke all on function public.allocate_token(uuid, date) from public, anon, authenticated;

create unique index if not exists appointments_token_per_session
  on public.appointments (practice_location_id, session_date, token_number)
  where token_number is not null;
