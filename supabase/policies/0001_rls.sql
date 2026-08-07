-- =============================================================================
-- Doctor's Diary — Phase 2 Row Level Security
--
-- Tenancy is HYBRID (docs/architecture.md §2):
--   • patient IDENTITY is doctor-owned  (Phase 3)
--   • every clinical EVENT is clinic-scoped
--
-- These policies are the SECOND line of defence. Application code must still
-- authorize every mutation. RLS is what catches the bug in that code.
--
-- Run after the Drizzle migration. Idempotent.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Helpers
--
-- SECURITY DEFINER is REQUIRED here. A policy on clinic_members that itself
-- queries clinic_members recurses infinitely; a definer-rights function breaks
-- the cycle. Both are locked down: no search_path injection, execute granted
-- only to authenticated.
-- -----------------------------------------------------------------------------

create or replace function public.is_active_member(target_clinic uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.clinic_members cm
    where cm.clinic_id = target_clinic
      and cm.user_id   = auth.uid()
      and cm.status    = 'ACTIVE'
  );
$$;

create or replace function public.has_clinic_role(
  target_clinic uuid,
  allowed public.clinic_role[]
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.clinic_members cm
    where cm.clinic_id = target_clinic
      and cm.user_id   = auth.uid()
      and cm.status    = 'ACTIVE'
      and cm.role      = any(allowed)
  );
$$;

-- True when the caller shares at least one active clinic with `other_user`.
create or replace function public.shares_clinic_with(other_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.clinic_members mine
    join public.clinic_members theirs on theirs.clinic_id = mine.clinic_id
    where mine.user_id   = auth.uid()
      and mine.status    = 'ACTIVE'
      and theirs.user_id = other_user
      and theirs.status  = 'ACTIVE'
  );
$$;

revoke all on function public.is_active_member(uuid)                      from public, anon;
revoke all on function public.has_clinic_role(uuid, public.clinic_role[]) from public, anon;
revoke all on function public.shares_clinic_with(uuid)                    from public, anon;
grant execute on function public.is_active_member(uuid)                      to authenticated;
grant execute on function public.has_clinic_role(uuid, public.clinic_role[]) to authenticated;
grant execute on function public.shares_clinic_with(uuid)                    to authenticated;

-- -----------------------------------------------------------------------------
-- Enable RLS everywhere. Default-deny: a table with RLS on and no matching
-- policy returns zero rows, which is the safe failure mode.
-- -----------------------------------------------------------------------------

alter table public.profiles         enable row level security;
alter table public.doctor_profiles  enable row level security;
alter table public.clinics          enable row level security;
alter table public.clinic_members   enable row level security;
alter table public.audit_events     enable row level security;

alter table public.profiles         force row level security;
alter table public.doctor_profiles  force row level security;
alter table public.clinics          force row level security;
alter table public.clinic_members   force row level security;
alter table public.audit_events     force row level security;

-- Nothing is reachable by anonymous callers.
revoke all on public.profiles        from anon;
revoke all on public.doctor_profiles from anon;
revoke all on public.clinics         from anon;
revoke all on public.clinic_members  from anon;
revoke all on public.audit_events    from anon;

-- -----------------------------------------------------------------------------
-- profiles
-- -----------------------------------------------------------------------------

drop policy if exists profiles_select_self_or_colleague on public.profiles;
create policy profiles_select_self_or_colleague
  on public.profiles for select to authenticated
  using (id = auth.uid() or public.shares_clinic_with(id));

drop policy if exists profiles_insert_self on public.profiles;
create policy profiles_insert_self
  on public.profiles for insert to authenticated
  with check (id = auth.uid());

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self
  on public.profiles for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- No delete policy: profiles die with auth.users via ON DELETE CASCADE.

-- -----------------------------------------------------------------------------
-- doctor_profiles
-- -----------------------------------------------------------------------------

drop policy if exists doctor_profiles_select on public.doctor_profiles;
create policy doctor_profiles_select
  on public.doctor_profiles for select to authenticated
  using (user_id = auth.uid() or public.shares_clinic_with(user_id));

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
-- clinics
-- -----------------------------------------------------------------------------

drop policy if exists clinics_select_members on public.clinics;
create policy clinics_select_members
  on public.clinics for select to authenticated
  using (public.is_active_member(id));

-- Anyone signed in may create a clinic (they become its first admin, in a
-- transaction in application code).
drop policy if exists clinics_insert_authenticated on public.clinics;
create policy clinics_insert_authenticated
  on public.clinics for insert to authenticated
  with check (created_by = auth.uid());

drop policy if exists clinics_update_admin on public.clinics;
create policy clinics_update_admin
  on public.clinics for update to authenticated
  using (public.has_clinic_role(id, array['CLINIC_ADMIN']::public.clinic_role[]))
  with check (public.has_clinic_role(id, array['CLINIC_ADMIN']::public.clinic_role[]));

-- No delete policy. Clinics are deactivated (is_active = false), never dropped —
-- their clinical history must survive.

-- -----------------------------------------------------------------------------
-- clinic_members  ← the authorization join. Getting this wrong breaks everything.
-- -----------------------------------------------------------------------------

drop policy if exists clinic_members_select on public.clinic_members;
create policy clinic_members_select
  on public.clinic_members for select to authenticated
  using (user_id = auth.uid() or public.is_active_member(clinic_id));

-- Bootstrap: the clinic creator seeds their OWN membership rows.
--
-- A solo doctor holds two roles at their own chamber (DOCTOR + CLINIC_ADMIN),
-- so this must permit several inserts — but only rows for themselves, and only
-- while nobody else is a member yet. Once they hold CLINIC_ADMIN the first
-- branch takes over and they can add staff normally.
drop policy if exists clinic_members_insert on public.clinic_members;
create policy clinic_members_insert
  on public.clinic_members for insert to authenticated
  with check (
    public.has_clinic_role(clinic_id, array['CLINIC_ADMIN']::public.clinic_role[])
    or (
      user_id = auth.uid()
      and exists (
        select 1 from public.clinics c
        where c.id = clinic_id and c.created_by = auth.uid()
      )
      -- No OTHER user may already be a member. Prevents self-insertion into
      -- somebody else's clinic.
      and not exists (
        select 1 from public.clinic_members existing
        where existing.clinic_id = clinic_members.clinic_id
          and existing.user_id <> auth.uid()
      )
    )
  );

drop policy if exists clinic_members_update_admin on public.clinic_members;
create policy clinic_members_update_admin
  on public.clinic_members for update to authenticated
  using (public.has_clinic_role(clinic_id, array['CLINIC_ADMIN']::public.clinic_role[]))
  with check (public.has_clinic_role(clinic_id, array['CLINIC_ADMIN']::public.clinic_role[]));

drop policy if exists clinic_members_delete_admin on public.clinic_members;
create policy clinic_members_delete_admin
  on public.clinic_members for delete to authenticated
  using (public.has_clinic_role(clinic_id, array['CLINIC_ADMIN']::public.clinic_role[]));

-- -----------------------------------------------------------------------------
-- audit_events — APPEND ONLY
--
-- There is deliberately NO update and NO delete policy, and the grants are
-- revoked below. Not even a clinic admin may alter the trail.
-- -----------------------------------------------------------------------------

drop policy if exists audit_events_insert_member on public.audit_events;
create policy audit_events_insert_member
  on public.audit_events for insert to authenticated
  with check (
    actor_id = auth.uid()
    and (clinic_id is null or public.is_active_member(clinic_id))
  );

-- Doctors read their own actions; clinic admins read their clinic's trail.
drop policy if exists audit_events_select on public.audit_events;
create policy audit_events_select
  on public.audit_events for select to authenticated
  using (
    actor_id = auth.uid()
    or (
      clinic_id is not null
      and public.has_clinic_role(clinic_id, array['CLINIC_ADMIN']::public.clinic_role[])
    )
  );

revoke update, delete on public.audit_events from authenticated;

-- -----------------------------------------------------------------------------
-- Table grants. RLS filters rows; grants decide which verbs exist at all.
-- -----------------------------------------------------------------------------

grant select, insert, update on public.profiles        to authenticated;
grant select, insert, update on public.doctor_profiles to authenticated;
grant select, insert, update on public.clinics         to authenticated;
grant select, insert, update, delete on public.clinic_members to authenticated;
grant select, insert on public.audit_events            to authenticated;
