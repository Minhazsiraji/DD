-- =============================================================================
-- Clinical isolation corrections.
--
-- Two leaks that the per-table split in 0002 did NOT close, both found by
-- running queries as an actual receptionist and location admin:
--
--   1. patients.notes was readable by any staff member allowed to see the
--      patient row. RLS filters ROWS, not COLUMNS — so "suspected malignancy"
--      in a free-text note was visible at the front desk. Fixed by moving the
--      column into its own doctor-only table (migration 0003).
--
--   2. Allergies used can_access_patient(), which admits EVERY active member —
--      including LOCATION_ADMIN, whom the permission matrix gives no clinical
--      access at all. An operational role does not need a drug-allergy list.
--
-- Idempotent.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Role-aware access helper.
--
-- can_access_patient() answers "may this person reach the patient at all".
-- This answers the narrower question the matrix actually asks: "...in one of
-- THESE roles". Needed because a single Postgres role (`authenticated`) backs
-- every application role, so column grants cannot distinguish them.
-- -----------------------------------------------------------------------------
create or replace function public.can_access_patient_as(
  target_patient uuid,
  allowed public.location_role[]
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    public.owns_patient(target_patient)
    or exists (
      select 1
      from public.patient_location_links l
      join public.practice_location_members m
        on m.practice_location_id = l.practice_location_id
      where l.patient_id = target_patient
        and m.user_id = auth.uid()
        and m.status  = 'ACTIVE'
        and m.role    = any(allowed)
    );
$$;

revoke all on function public.can_access_patient_as(uuid, public.location_role[])
  from public, anon;
grant execute on function public.can_access_patient_as(uuid, public.location_role[])
  to authenticated;

-- -----------------------------------------------------------------------------
-- patient_private_notes — DOCTOR ONLY, no exceptions.
-- -----------------------------------------------------------------------------

alter table public.patient_private_notes enable row level security;
alter table public.patient_private_notes force row level security;
revoke all on public.patient_private_notes from anon;

drop policy if exists patient_private_notes_select on public.patient_private_notes;
create policy patient_private_notes_select
  on public.patient_private_notes for select to authenticated
  using (public.owns_patient(patient_id));

drop policy if exists patient_private_notes_insert on public.patient_private_notes;
create policy patient_private_notes_insert
  on public.patient_private_notes for insert to authenticated
  with check (public.owns_patient(patient_id));

drop policy if exists patient_private_notes_update on public.patient_private_notes;
create policy patient_private_notes_update
  on public.patient_private_notes for update to authenticated
  using (public.owns_patient(patient_id))
  with check (public.owns_patient(patient_id));

drop policy if exists patient_private_notes_delete on public.patient_private_notes;
create policy patient_private_notes_delete
  on public.patient_private_notes for delete to authenticated
  using (public.owns_patient(patient_id));

grant select, insert, update, delete on public.patient_private_notes to authenticated;

-- -----------------------------------------------------------------------------
-- Allergies — the owning doctor, or a RECEPTIONIST at a linked location.
--
-- Reception handing over a prescription benefits from seeing a drug-allergy
-- flag. A location administrator is an operational role and gets nothing
-- clinical, matching src/lib/rbac/permissions.ts exactly.
-- -----------------------------------------------------------------------------
drop policy if exists patient_allergies_select on public.patient_allergies;
create policy patient_allergies_select
  on public.patient_allergies for select to authenticated
  using (
    public.can_access_patient_as(
      patient_id,
      array['DOCTOR','RECEPTIONIST']::public.location_role[]
    )
  );

-- -----------------------------------------------------------------------------
-- Contacts — administrative, so reception maintains them. Admins may read.
-- -----------------------------------------------------------------------------
drop policy if exists patient_contacts_select on public.patient_contacts;
create policy patient_contacts_select
  on public.patient_contacts for select to authenticated
  using (public.can_access_patient(patient_id));

drop policy if exists patient_contacts_write on public.patient_contacts;
create policy patient_contacts_write
  on public.patient_contacts for insert to authenticated
  with check (
    public.can_access_patient_as(
      patient_id,
      array['DOCTOR','RECEPTIONIST']::public.location_role[]
    )
  );

drop policy if exists patient_contacts_update_staff on public.patient_contacts;
create policy patient_contacts_update_staff
  on public.patient_contacts for update to authenticated
  using (
    public.can_access_patient_as(
      patient_id, array['DOCTOR','RECEPTIONIST']::public.location_role[]
    )
  )
  with check (
    public.can_access_patient_as(
      patient_id, array['DOCTOR','RECEPTIONIST']::public.location_role[]
    )
  );
