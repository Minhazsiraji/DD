-- =============================================================================
-- 0040 — Close the remaining same-location cross-doctor linkage/write paths.
--
-- 0039 restored patient/allergy/contact READ isolation, but two older policies
-- still treated DOCTOR as an operational location role:
--
--   patient_location_links_select
--     owns patient OR any active member at the location
--     -> another doctor at the same hospital could enumerate the patient UUID
--        and patient/location relationship.
--
--   patient_contacts_write
--     can_access_patient_as(..., ['DOCTOR','RECEPTIONIST'])
--     -> owns_patient() already admits the owning doctor, so listing DOCTOR
--        admitted only OTHER doctors at the same location and allowed them to
--        insert contact rows onto another doctor's patient.
--
-- The rule is the same as 0039: ownership admits the owning doctor; location
-- membership admits only explicit operational roles. No staff authority is
-- widened here.
-- =============================================================================

/**
 * The owning doctor may see their own patient/location links. Operational desk
 * staff retain the same location-level visibility they had before. Another
 * doctor at the same location is a different clinical tenant and gets no link.
 */
drop policy if exists patient_location_links_select on public.patient_location_links;
create policy patient_location_links_select
  on public.patient_location_links for select to authenticated
  using (
    public.owns_patient(patient_id)
    or public.has_location_role(
      practice_location_id,
      array['RECEPTIONIST', 'LOCATION_ADMIN']::public.location_role[]
    )
  );

/**
 * Contact INSERT follows the same ownership + operational-role boundary.
 * `can_access_patient_as` checks owns_patient() first, so DOCTOR must not appear
 * in the allowlist: adding it grants a different doctor at the location access.
 */
drop policy if exists patient_contacts_write on public.patient_contacts;
create policy patient_contacts_write
  on public.patient_contacts for insert to authenticated
  with check (
    public.can_access_patient_as(
      patient_id,
      array['RECEPTIONIST']::public.location_role[]
    )
  );
