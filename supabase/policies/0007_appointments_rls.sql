-- =============================================================================
-- Appointments (Stage 4).
--
-- Two access shapes, deliberately different:
--
--   The OWNING DOCTOR sees their appointments across every location they work
--   at — that longitudinal view is the product (ADR 0001).
--
--   RECEPTION and LOCATION ADMIN see appointments AT THEIR LOCATION only,
--   whoever the doctor is, because that is what running a front desk requires.
--
-- A second DOCTOR at the same hospital sees nothing. Cross-doctor visibility is
-- forbidden, and holding a DOCTOR role at a shared location is not consent to
-- read a colleague's book.
-- =============================================================================

alter table public.appointments        enable row level security;
alter table public.appointments        force  row level security;
alter table public.appointment_events  enable row level security;
alter table public.appointment_events  force  row level security;

revoke all on public.appointments       from anon;
revoke all on public.appointment_events from anon;

/**
 * Does `target_doctor` actually practise at `target_location`?
 *
 * SECURITY DEFINER: the caller is often a receptionist who cannot read
 * membership rows at all (location_member: NONE in the matrix). Without definer
 * rights the check would silently return false and reception could never book.
 * It answers one narrow boolean and leaks nothing else.
 */
create or replace function public.doctor_practises_at(
  target_doctor uuid,
  target_location uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.doctor_profiles d
    join public.practice_location_members m on m.user_id = d.user_id
    where d.id = target_doctor
      and m.practice_location_id = target_location
      and m.role = 'DOCTOR'
      and m.status = 'ACTIVE'
  );
$$;

revoke all on function public.doctor_practises_at(uuid, uuid) from public, anon;
grant execute on function public.doctor_practises_at(uuid, uuid) to authenticated;

/** May the caller work the desk at this location? */
create or replace function public.runs_front_desk_at(target_location uuid)
returns boolean
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select public.has_location_role(
    target_location,
    array['RECEPTIONIST', 'LOCATION_ADMIN']::public.location_role[]
  );
$$;

revoke all on function public.runs_front_desk_at(uuid) from public, anon;
grant execute on function public.runs_front_desk_at(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- appointments
-- -----------------------------------------------------------------------------
drop policy if exists appointments_select on public.appointments;
create policy appointments_select
  on public.appointments for select to authenticated
  using (
    owner_doctor_id = public.current_doctor_id()
    or public.runs_front_desk_at(practice_location_id)
  );

/**
 * Booking. The owning doctor must practise where the appointment is, and so
 * must the doctor a receptionist books for — otherwise the desk at one clinic
 * could push appointments into a doctor's private chamber.
 */
drop policy if exists appointments_insert on public.appointments;
create policy appointments_insert
  on public.appointments for insert to authenticated
  with check (
    public.doctor_practises_at(owner_doctor_id, practice_location_id)
    and (
      owner_doctor_id = public.current_doctor_id()
      or public.runs_front_desk_at(practice_location_id)
    )
  );

drop policy if exists appointments_update on public.appointments;
create policy appointments_update
  on public.appointments for update to authenticated
  using (
    owner_doctor_id = public.current_doctor_id()
    or public.runs_front_desk_at(practice_location_id)
  )
  with check (
    public.doctor_practises_at(owner_doctor_id, practice_location_id)
    and (
      owner_doctor_id = public.current_doctor_id()
      or public.runs_front_desk_at(practice_location_id)
    )
  );

-- NO DELETE POLICY, and the grant is REVOKED. Appointments are cancelled, not
-- deleted: the event history below must keep its subject.
--
-- The revoke is not redundant. Supabase's default privileges hand `authenticated`
-- every verb on a newly created table, so simply omitting DELETE from the grant
-- below leaves the privilege sitting there — one careless future policy away
-- from being usable.
grant select, insert, update on public.appointments to authenticated;
revoke delete on public.appointments from authenticated;

-- -----------------------------------------------------------------------------
-- appointment_events — append-only, exactly like audit_events
-- -----------------------------------------------------------------------------
drop policy if exists appointment_events_select on public.appointment_events;
create policy appointment_events_select
  on public.appointment_events for select to authenticated
  using (
    exists (
      select 1 from public.appointments a
      where a.id = appointment_id
        and (
          a.owner_doctor_id = public.current_doctor_id()
          or public.runs_front_desk_at(a.practice_location_id)
        )
    )
  );

drop policy if exists appointment_events_insert on public.appointment_events;
create policy appointment_events_insert
  on public.appointment_events for insert to authenticated
  with check (
    exists (
      select 1 from public.appointments a
      where a.id = appointment_id
        and a.practice_location_id = appointment_events.practice_location_id
        and (
          a.owner_doctor_id = public.current_doctor_id()
          or public.runs_front_desk_at(a.practice_location_id)
        )
    )
  );

-- Append-only: no UPDATE or DELETE policy AND no grant. Both are required —
-- a missing policy alone would still leave the grant dangling for a future
-- policy to accidentally satisfy.
grant select, insert on public.appointment_events to authenticated;
revoke update, delete on public.appointment_events from authenticated;
