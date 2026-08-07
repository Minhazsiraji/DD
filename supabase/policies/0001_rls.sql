-- =============================================================================
-- Doctor's Diary — Row Level Security
--
-- TENANCY (final). Two orthogonal concepts, permanently separate:
--
--   owner_doctor_id        whose patient is this?      (Phase 3)
--   practice_location_id   where did this event happen?
--
-- Doctor's Diary is a DOCTOR-OWNED personal clinical repository:
--   • each doctor has a completely separate patient repository
--   • the same human seen by two doctors is TWO records, never merged
--   • within one doctor's repository, visits at a hospital, a clinic and a
--     personal chamber form ONE continuous timeline
--   • STAFF access is scoped to a practice location
--
-- These policies are the SECOND line of defence. Application code authorizes
-- every mutation; RLS is what catches the bug in that code.
--
-- Idempotent — re-run after any change, then `npm run db:verify`.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Helpers
--
-- SECURITY DEFINER is REQUIRED. A policy on practice_location_members that
-- queries practice_location_members recurses infinitely; definer rights break
-- the cycle. Both are locked down: search_path pinned, execute granted only to
-- authenticated.
--
-- NOTE: function bodies are stored as text, so any table rename must be
-- followed by re-running this file or these silently break.
-- -----------------------------------------------------------------------------

-- Legacy names from before the practice-location rename. CASCADE is safe and
-- deliberate: the only dependents are policies, and every one of them is
-- recreated further down this same file.
drop function if exists public.has_clinic_role(uuid, public.location_role[]) cascade;
drop function if exists public.shares_clinic_with(uuid) cascade;
-- Same signature but its parameter was renamed (target_clinic -> target_location),
-- and CREATE OR REPLACE cannot rename an input parameter.
drop function if exists public.is_active_member(uuid) cascade;

create or replace function public.is_active_member(target_location uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.practice_location_members m
    where m.practice_location_id = target_location
      and m.user_id              = auth.uid()
      and m.status               = 'ACTIVE'
  );
$$;

create or replace function public.has_location_role(
  target_location uuid,
  allowed public.location_role[]
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.practice_location_members m
    where m.practice_location_id = target_location
      and m.user_id              = auth.uid()
      and m.status               = 'ACTIVE'
      and m.role                 = any(allowed)
  );
$$;

-- True when the caller shares at least one active practice location with
-- `other_user`. Used only for showing colleagues' names — never clinical data.
create or replace function public.shares_location_with(other_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.practice_location_members mine
    join public.practice_location_members theirs
      on theirs.practice_location_id = mine.practice_location_id
    where mine.user_id   = auth.uid()
      and mine.status    = 'ACTIVE'
      and theirs.user_id = other_user
      and theirs.status  = 'ACTIVE'
  );
$$;

revoke all on function public.is_active_member(uuid)                          from public, anon;
revoke all on function public.has_location_role(uuid, public.location_role[]) from public, anon;
revoke all on function public.shares_location_with(uuid)                      from public, anon;
grant execute on function public.is_active_member(uuid)                          to authenticated;
grant execute on function public.has_location_role(uuid, public.location_role[]) to authenticated;
grant execute on function public.shares_location_with(uuid)                      to authenticated;

-- -----------------------------------------------------------------------------
-- Enable RLS everywhere. Default-deny: RLS on with no matching policy returns
-- zero rows, which is the safe failure.
-- -----------------------------------------------------------------------------

alter table public.profiles                  enable row level security;
alter table public.doctor_profiles           enable row level security;
alter table public.practice_locations        enable row level security;
alter table public.practice_location_members enable row level security;
alter table public.audit_events              enable row level security;

alter table public.profiles                  force row level security;
alter table public.doctor_profiles           force row level security;
alter table public.practice_locations        force row level security;
alter table public.practice_location_members force row level security;
alter table public.audit_events              force row level security;

revoke all on public.profiles                  from anon;
revoke all on public.doctor_profiles           from anon;
revoke all on public.practice_locations        from anon;
revoke all on public.practice_location_members from anon;
revoke all on public.audit_events              from anon;

-- -----------------------------------------------------------------------------
-- profiles
-- -----------------------------------------------------------------------------

drop policy if exists profiles_select_self_or_colleague on public.profiles;
create policy profiles_select_self_or_colleague
  on public.profiles for select to authenticated
  using (id = auth.uid() or public.shares_location_with(id));

drop policy if exists profiles_insert_self on public.profiles;
create policy profiles_insert_self
  on public.profiles for insert to authenticated
  with check (id = auth.uid());

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self
  on public.profiles for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- -----------------------------------------------------------------------------
-- doctor_profiles — the identity that will OWN patients in Phase 3.
-- -----------------------------------------------------------------------------

drop policy if exists doctor_profiles_select on public.doctor_profiles;
create policy doctor_profiles_select
  on public.doctor_profiles for select to authenticated
  using (user_id = auth.uid() or public.shares_location_with(user_id));

drop policy if exists doctor_profiles_insert_self on public.doctor_profiles;
create policy doctor_profiles_insert_self
  on public.doctor_profiles for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists doctor_profiles_update_self on public.doctor_profiles;
create policy doctor_profiles_update_self
  on public.doctor_profiles for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- -----------------------------------------------------------------------------
-- practice_locations
-- -----------------------------------------------------------------------------

-- The `created_by` branch is REQUIRED, not a convenience.
-- INSERT ... RETURNING (which supabase-js does whenever .select() is chained)
-- applies SELECT policies to the new row. During onboarding the creator is not
-- a member yet — membership is inserted next — so without this the insert fails
-- with the misleading "new row violates row-level security policy".
drop policy if exists clinics_select_members on public.practice_locations;
drop policy if exists practice_locations_select_members on public.practice_locations;
create policy practice_locations_select_members
  on public.practice_locations for select to authenticated
  using (public.is_active_member(id) or created_by = auth.uid());

drop policy if exists clinics_insert_authenticated on public.practice_locations;
drop policy if exists practice_locations_insert_authenticated on public.practice_locations;
create policy practice_locations_insert_authenticated
  on public.practice_locations for insert to authenticated
  with check (created_by = auth.uid());

drop policy if exists clinics_update_admin on public.practice_locations;
drop policy if exists practice_locations_update_admin on public.practice_locations;
create policy practice_locations_update_admin
  on public.practice_locations for update to authenticated
  using (public.has_location_role(id, array['LOCATION_ADMIN']::public.location_role[]))
  with check (public.has_location_role(id, array['LOCATION_ADMIN']::public.location_role[]));

-- No delete policy. Locations are deactivated (is_active = false), never
-- dropped — their clinical history must survive.

-- -----------------------------------------------------------------------------
-- practice_location_members  ← the authorization join. Getting this wrong
-- breaks every other boundary in the product.
-- -----------------------------------------------------------------------------

drop policy if exists clinic_members_select on public.practice_location_members;
drop policy if exists practice_location_members_select on public.practice_location_members;
create policy practice_location_members_select
  on public.practice_location_members for select to authenticated
  using (user_id = auth.uid() or public.is_active_member(practice_location_id));

-- Bootstrap: the creator seeds their OWN membership rows.
-- A solo doctor holds two roles at their own chamber (DOCTOR + LOCATION_ADMIN),
-- so several inserts must be allowed — but only rows for themselves, and only
-- while nobody else is a member. Once they hold LOCATION_ADMIN the first branch
-- takes over and they can add staff normally.
drop policy if exists clinic_members_insert on public.practice_location_members;
drop policy if exists practice_location_members_insert on public.practice_location_members;
create policy practice_location_members_insert
  on public.practice_location_members for insert to authenticated
  with check (
    public.has_location_role(
      practice_location_id,
      array['LOCATION_ADMIN']::public.location_role[]
    )
    or (
      user_id = auth.uid()
      and exists (
        select 1 from public.practice_locations l
        where l.id = practice_location_id and l.created_by = auth.uid()
      )
      -- No OTHER user may already be a member. Prevents self-insertion into
      -- somebody else's location.
      and not exists (
        select 1 from public.practice_location_members existing
        where existing.practice_location_id
                = practice_location_members.practice_location_id
          and existing.user_id <> auth.uid()
      )
    )
  );

drop policy if exists clinic_members_update_admin on public.practice_location_members;
drop policy if exists practice_location_members_update_admin on public.practice_location_members;
create policy practice_location_members_update_admin
  on public.practice_location_members for update to authenticated
  using (
    public.has_location_role(
      practice_location_id, array['LOCATION_ADMIN']::public.location_role[]
    )
  )
  with check (
    public.has_location_role(
      practice_location_id, array['LOCATION_ADMIN']::public.location_role[]
    )
  );

drop policy if exists clinic_members_delete_admin on public.practice_location_members;
drop policy if exists practice_location_members_delete_admin on public.practice_location_members;
create policy practice_location_members_delete_admin
  on public.practice_location_members for delete to authenticated
  using (
    public.has_location_role(
      practice_location_id, array['LOCATION_ADMIN']::public.location_role[]
    )
  );

-- -----------------------------------------------------------------------------
-- audit_events — APPEND ONLY
--
-- Deliberately NO update and NO delete policy, and the grants are revoked
-- below. Not even a location admin may alter the trail.
-- -----------------------------------------------------------------------------

drop policy if exists audit_events_insert_member on public.audit_events;
create policy audit_events_insert_member
  on public.audit_events for insert to authenticated
  with check (
    actor_id = auth.uid()
    and (
      practice_location_id is null
      or public.is_active_member(practice_location_id)
    )
  );

drop policy if exists audit_events_select on public.audit_events;
create policy audit_events_select
  on public.audit_events for select to authenticated
  using (
    actor_id = auth.uid()
    or (
      practice_location_id is not null
      and public.has_location_role(
        practice_location_id, array['LOCATION_ADMIN']::public.location_role[]
      )
    )
  );

revoke update, delete on public.audit_events from authenticated;

-- -----------------------------------------------------------------------------
-- Table grants. RLS filters rows; grants decide which verbs exist at all.
-- -----------------------------------------------------------------------------

grant select, insert, update on public.profiles                  to authenticated;
grant select, insert, update on public.doctor_profiles           to authenticated;
grant select, insert, update on public.practice_locations        to authenticated;
grant select, insert, update, delete on public.practice_location_members to authenticated;
grant select, insert on public.audit_events                      to authenticated;
