-- =============================================================================
-- Doctor's Diary — Patients RLS (Phase 3)
--
-- OWNERSHIP (ADR 0001/0002):
--   patients.owner_doctor_id is THE boundary. Each doctor has a completely
--   separate repository. The same human seen by two doctors is two records.
--
--   patient_account_id is NEVER referenced in any policy here. Joining
--   authorization on it is exactly how one doctor's records would become
--   reachable from another's.
--
-- STAFF:
--   Non-owner staff reach a patient only through patient_location_links for a
--   location where they are an ACTIVE member — so a receptionist at a hospital
--   cannot see who the doctor treats at their private chamber.
--
-- Idempotent. Run with `npm run db:policies`, verify with `npm run db:verify`.
-- =============================================================================

-- Trigram indexes make ILIKE '%term%' fast enough to type into.
create extension if not exists pg_trgm with schema extensions;

create index if not exists patients_name_trgm
  on public.patients using gin (name_normalized extensions.gin_trgm_ops);
create index if not exists patients_number_trgm
  on public.patients using gin (patient_number extensions.gin_trgm_ops);
create index if not exists patients_phone_trgm
  on public.patients using gin (phone_normalized extensions.gin_trgm_ops);

-- -----------------------------------------------------------------------------
-- Helpers
-- -----------------------------------------------------------------------------

/** The caller's own doctor_profiles.id, or null if they are not a doctor. */
create or replace function public.current_doctor_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select d.id from public.doctor_profiles d where d.user_id = auth.uid() limit 1;
$$;

/** Does the caller own this patient (i.e. is the treating doctor)? */
create or replace function public.owns_patient(target_patient uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.patients p
    where p.id = target_patient
      and p.owner_doctor_id = public.current_doctor_id()
  );
$$;

/**
 * Can the caller reach this patient at all — as owning doctor, or as staff at a
 * location the patient is linked to?
 */
create or replace function public.can_access_patient(target_patient uuid)
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
    );
$$;

revoke all on function public.current_doctor_id()        from public, anon;
revoke all on function public.owns_patient(uuid)         from public, anon;
revoke all on function public.can_access_patient(uuid)   from public, anon;
grant execute on function public.current_doctor_id()      to authenticated;
grant execute on function public.owns_patient(uuid)       to authenticated;
grant execute on function public.can_access_patient(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Atomic patient-number allocation.
--
-- A read-then-write (SELECT seq, then UPDATE seq+1) races: two concurrent
-- registrations read the same value and issue the SAME patient number. A single
-- UPDATE ... RETURNING takes a row lock and cannot.
--
-- Gaps are possible if the surrounding insert fails. Gaps are harmless;
-- duplicates are not.
-- -----------------------------------------------------------------------------
create or replace function public.next_patient_number(target_doctor uuid)
returns text
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_prefix text;
  v_seq    integer;
begin
  update public.doctor_profiles
     set patient_number_seq = patient_number_seq + 1,
         updated_at = now()
   where id = target_doctor
     and user_id = auth.uid()          -- you may only allocate for yourself
  returning patient_number_prefix, patient_number_seq
       into v_prefix, v_seq;

  if v_prefix is null then
    raise exception 'not authorised to allocate a patient number for doctor %', target_doctor
      using errcode = '42501';
  end if;

  return v_prefix || '-' || lpad(v_seq::text, 6, '0');
end;
$$;

revoke all on function public.next_patient_number(uuid) from public, anon;
grant execute on function public.next_patient_number(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Enable RLS
-- -----------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array[
    'patients','patient_location_links','patient_contacts',
    'patient_allergies','patient_conditions','patient_medications','patient_alerts'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- patients
-- -----------------------------------------------------------------------------

drop policy if exists patients_select on public.patients;
create policy patients_select
  on public.patients for select to authenticated
  using (
    owner_doctor_id = public.current_doctor_id()
    or exists (
      select 1
      from public.patient_location_links l
      join public.practice_location_members m
        on m.practice_location_id = l.practice_location_id
      where l.patient_id = patients.id
        and m.user_id = auth.uid()
        and m.status  = 'ACTIVE'
    )
  );

-- Only a doctor creates patients in their OWN repository. `created_by` records
-- who typed it in, which may be a receptionist acting for the doctor later.
drop policy if exists patients_insert on public.patients;
create policy patients_insert
  on public.patients for insert to authenticated
  with check (owner_doctor_id = public.current_doctor_id());

drop policy if exists patients_update on public.patients;
create policy patients_update
  on public.patients for update to authenticated
  using (owner_doctor_id = public.current_doctor_id())
  with check (owner_doctor_id = public.current_doctor_id());

-- No delete policy. Patients are soft-deleted (deleted_at); a clinical record
-- is never destroyed.

-- -----------------------------------------------------------------------------
-- patient_location_links
-- -----------------------------------------------------------------------------

drop policy if exists patient_location_links_select on public.patient_location_links;
create policy patient_location_links_select
  on public.patient_location_links for select to authenticated
  using (
    public.owns_patient(patient_id)
    or public.is_active_member(practice_location_id)
  );

drop policy if exists patient_location_links_insert on public.patient_location_links;
create policy patient_location_links_insert
  on public.patient_location_links for insert to authenticated
  with check (
    public.owns_patient(patient_id)
    and public.is_active_member(practice_location_id)
  );

drop policy if exists patient_location_links_update on public.patient_location_links;
create policy patient_location_links_update
  on public.patient_location_links for update to authenticated
  using (public.owns_patient(patient_id))
  with check (public.owns_patient(patient_id));

-- -----------------------------------------------------------------------------
-- Clinical child tables — READ IS TABLE-SPECIFIC, NOT UNIFORM.
--
-- An earlier version applied can_access_patient() to all five tables in one
-- loop. That let a receptionist at a linked location read the patient's chronic
-- CONDITIONS and CURRENT MEDICATIONS — i.e. infer a diagnosis such as HIV from
-- an antiretroviral. Convenient to write, and a genuine privacy breach.
--
-- The line now drawn, and the reason for each:
--
--   allergies   staff READ   — a drug-allergy flag is a front-desk safety
--                              signal, and it is not a diagnosis
--   contacts    staff READ   — administrative; reception phones the family
--   conditions  DOCTOR ONLY  — a diagnosis
--   medications DOCTOR ONLY  — reveals the diagnosis by inference
--   alerts      DOCTOR ONLY  — free text, so it may contain anything
--
-- WRITE is the owning doctor everywhere. Contacts are the one exception:
-- reception maintains them, and they carry no clinical meaning.
-- -----------------------------------------------------------------------------

-- ---- Staff-readable: allergies (safety) -------------------------------------
drop policy if exists patient_allergies_select on public.patient_allergies;
create policy patient_allergies_select
  on public.patient_allergies for select to authenticated
  using (public.can_access_patient(patient_id));

-- ---- Staff-readable + writable: contacts (administrative) -------------------
drop policy if exists patient_contacts_select on public.patient_contacts;
create policy patient_contacts_select
  on public.patient_contacts for select to authenticated
  using (public.can_access_patient(patient_id));

drop policy if exists patient_contacts_write on public.patient_contacts;
create policy patient_contacts_write
  on public.patient_contacts for insert to authenticated
  with check (public.can_access_patient(patient_id));

drop policy if exists patient_contacts_update_staff on public.patient_contacts;
create policy patient_contacts_update_staff
  on public.patient_contacts for update to authenticated
  using (public.can_access_patient(patient_id))
  with check (public.can_access_patient(patient_id));

-- ---- Doctor-only reads ------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['patient_conditions','patient_medications','patient_alerts'] loop
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format($f$
      create policy %I on public.%I for select to authenticated
      using (public.owns_patient(patient_id))
    $f$, t || '_select', t);
  end loop;
end $$;

-- ---- Clinical writes: owning doctor only, on every child table --------------
do $$
declare t text;
begin
  foreach t in array array[
    'patient_allergies','patient_conditions','patient_medications','patient_alerts'
  ] loop
    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format($f$
      create policy %I on public.%I for insert to authenticated
      with check (public.owns_patient(patient_id))
    $f$, t || '_insert', t);

    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format($f$
      create policy %I on public.%I for update to authenticated
      using (public.owns_patient(patient_id))
      with check (public.owns_patient(patient_id))
    $f$, t || '_update', t);

    execute format('drop policy if exists %I on public.%I', t || '_delete', t);
    execute format($f$
      create policy %I on public.%I for delete to authenticated
      using (public.owns_patient(patient_id))
    $f$, t || '_delete', t);
  end loop;
end $$;

-- Legacy names from the uniform loop, if still present.
drop policy if exists patient_contacts_insert on public.patient_contacts;
drop policy if exists patient_contacts_update on public.patient_contacts;
drop policy if exists patient_contacts_delete on public.patient_contacts;
create policy patient_contacts_delete
  on public.patient_contacts for delete to authenticated
  using (public.owns_patient(patient_id));

-- -----------------------------------------------------------------------------
-- Grants. RLS filters rows; grants decide which verbs exist at all.
-- -----------------------------------------------------------------------------

grant select, insert, update on public.patients               to authenticated;
grant select, insert, update on public.patient_location_links to authenticated;

grant select, insert, update, delete on public.patient_contacts    to authenticated;
grant select, insert, update, delete on public.patient_allergies   to authenticated;
grant select, insert, update, delete on public.patient_conditions  to authenticated;
grant select, insert, update, delete on public.patient_medications to authenticated;
grant select, insert, update, delete on public.patient_alerts      to authenticated;
