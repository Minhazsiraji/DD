-- =============================================================================
-- 0039 — One doctor cannot read another doctor's patient.
--
-- THE LEAK.
--
-- `patients_select` and `can_access_patient()` both allow anyone who is an
-- ACTIVE member of a location the patient is linked to. Neither constrains the
-- member's ROLE — so a SECOND DOCTOR at the same hospital matched, and read the
-- first doctor's patient. Reproduced under a real authenticated session: Dr B,
-- `current_doctor_id()` correctly resolving to Dr B's own profile, selecting
-- Dr A's patient row and getting it.
--
-- That is the tenancy rule inverted. `patients.owner_doctor_id` is the
-- ownership boundary: the same human seen by two doctors is TWO records, and
-- cross-doctor sharing must be explicit, consented and audited — never ambient.
--
-- WHAT IT REACHED.
--
--   patients            select
--   patient_allergies   select          } through can_access_patient()
--   patient_contacts    select, insert, update
--
-- Encounters were NOT affected: `encounters_select` is `owner_doctor_id =
-- current_doctor_id()` with no second branch, and `may_open_encounter` requires
-- `owns_patient`, so Dr B could neither read nor create one.
--
-- THE FIX IS ALREADY IN THIS CODEBASE.
--
-- `can_access_patient_as(patient, allowed_role[])` — added by
-- `0004_clinical_column_isolation.sql` — is the same predicate WITH
-- `m.role = any(allowed)`. It was written for exactly this reason and these two
-- older callers were never moved onto it. This moves them.
--
-- An ALLOWLIST, not `role <> 'DOCTOR'`. They are equivalent for today's three
-- roles and they differ on the fourth: a role added later is refused by an
-- allowlist and admitted by an exclusion. The failure has to be the safe one.
--
-- WHAT THIS DOES NOT DO. It grants nothing. Reception and location admins keep
-- exactly the access they had; no platform-owner bypass is introduced; no
-- location membership is widened to clinical reads; RLS stays on and forced.
-- =============================================================================

/**
 * Staff at a location the patient is linked to — operational roles only.
 *
 * Delegates rather than repeating the predicate, so there is now ONE definition
 * of "staff at this patient's location" in the database. The duplicate is what
 * allowed the two copies to drift in the first place.
 */
create or replace function public.can_access_patient(target_patient uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.can_access_patient_as(
    target_patient,
    array['RECEPTIONIST', 'LOCATION_ADMIN']::public.location_role[]
  );
$$;

revoke all on function public.can_access_patient(uuid) from public, anon;
grant execute on function public.can_access_patient(uuid) to authenticated;

/**
 * The owning doctor, or operational staff where the patient is seen.
 *
 * The staff branch is INLINE rather than a call to `can_access_patient_as`,
 * deliberately: that function reaches `owns_patient`, which selects from
 * `patients` — and `patients` has RLS FORCED, so calling it from inside
 * `patients`' own SELECT policy would recurse. The predicate below is the same
 * rule written where it cannot.
 */
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
        -- The whole fix. Another DOCTOR at this location is not staff here;
        -- they are a different repository.
        and m.role = any (array['RECEPTIONIST', 'LOCATION_ADMIN']::public.location_role[])
    )
  );

/**
 * `DOCTOR` IN AN ALLOWLIST IS ALWAYS A MISTAKE HERE.
 *
 * These two named `array['DOCTOR', 'RECEPTIONIST']`. `can_access_patient_as`
 * already ORs `owns_patient(...)` FIRST, so the owning doctor is admitted by
 * that branch and never needed the role — which means listing DOCTOR added
 * nothing for the owner and admitted ONLY OTHER DOCTORS. An allergy list is
 * clinical content, and the contacts one is a WRITE.
 *
 * `DOCTOR` is removed and nothing else changes: RECEPTIONIST stays, and
 * LOCATION_ADMIN is deliberately NOT added — that would widen access under
 * cover of a security fix.
 */
drop policy if exists patient_allergies_select on public.patient_allergies;
create policy patient_allergies_select
  on public.patient_allergies for select to authenticated
  using (
    public.can_access_patient_as(patient_id, array['RECEPTIONIST']::public.location_role[])
  );

drop policy if exists patient_contacts_update_staff on public.patient_contacts;
create policy patient_contacts_update_staff
  on public.patient_contacts for update to authenticated
  using (
    public.can_access_patient_as(patient_id, array['RECEPTIONIST']::public.location_role[])
  );
