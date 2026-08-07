-- =============================================================================
-- Rename clinic-as-location concepts to practice locations.
--
-- A doctor may practise in a hospital, a clinic, a diagnostic centre, their own
-- chamber, or by telemedicine. Calling that a "clinic" would force every other
-- kind of place to masquerade as one, so this is renamed BEFORE patient tables
-- exist and the cost is still trivial.
--
-- The two concepts are now unambiguous and stay separate permanently:
--   owner_doctor_id       whose patient is this?
--   practice_location_id  where did this event happen?
--
-- Written as ALTER ... RENAME rather than drop/recreate so existing rows,
-- grants and policies survive. Safe to run once; not idempotent.
-- =============================================================================

begin;

-- ---- Roles -----------------------------------------------------------------
alter type public.clinic_role rename to location_role;
alter type public.location_role rename value 'CLINIC_ADMIN' to 'LOCATION_ADMIN';

-- ---- Location type ---------------------------------------------------------
-- Rebuilt rather than renamed: a new value is being added AND one renamed, and
-- swapping the column type does both atomically without ALTER TYPE ADD VALUE
-- (which cannot be used later in the same transaction).
create type public.location_type as enum (
  'PERSONAL_CHAMBER',
  'CLINIC',
  'HOSPITAL',
  'TELEMEDICINE',
  'OTHER'
);

alter table public.clinics alter column type drop default;

alter table public.clinics
  alter column type type public.location_type
  using (
    case type::text
      when 'OWN_CHAMBER' then 'PERSONAL_CHAMBER'
      else type::text
    end
  )::public.location_type;

alter table public.clinics
  alter column type set default 'PERSONAL_CHAMBER';

drop type public.clinic_type;

-- ---- Tables and columns ----------------------------------------------------
alter table public.clinics        rename to practice_locations;
alter table public.clinic_members rename to practice_location_members;

alter table public.practice_location_members
  rename column clinic_id to practice_location_id;

alter table public.audit_events
  rename column clinic_id to practice_location_id;

-- ---- Indexes ---------------------------------------------------------------
alter index if exists clinics_created_by_idx
  rename to practice_locations_created_by_idx;
alter index if exists clinic_members_clinic_user_role_key
  rename to practice_location_members_location_user_role_key;
alter index if exists clinic_members_user_idx
  rename to practice_location_members_user_idx;
alter index if exists clinic_members_clinic_idx
  rename to practice_location_members_location_idx;
alter index if exists audit_events_clinic_occurred_idx
  rename to audit_events_location_occurred_idx;

commit;

-- NOTE: the SECURITY DEFINER helper functions store their bodies as text and
-- still reference the OLD table names. They are recreated by re-running
-- supabase/policies/0001_rls.sql, which must happen immediately after this.
