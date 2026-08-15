-- =============================================================================
-- Hardening for the doctor-profile / prescription-template module.
--
-- 1. Doctor identity updates become ONE transaction.
-- 2. A location-scoped template requires an active DOCTOR role at that location.
-- =============================================================================

/**
 * Update the whole doctor identity atomically.
 *
 * `profiles` and `doctor_profiles` were previously written as two separate
 * statements, so a failure on the second left the doctor's NAME changed while
 * their qualifications and BMDC number did not — a split identity that prints
 * on prescriptions. A plpgsql body is one transaction, so both land or neither
 * does.
 *
 * SECURITY INVOKER: RLS still applies, so a caller can only ever write their
 * own rows. The function exists for atomicity, not to escalate privilege.
 *
 * `patient_number_seq` is deliberately never written here — it is owned by
 * next_patient_number() and overwriting it would re-issue numbers that already
 * exist on paper.
 */
create or replace function public.update_doctor_identity(
  p_full_name              text,
  p_phone                  text,
  p_qualification          text,
  p_specialization         text,
  p_designation            text,
  p_bmdc_registration_no   text,
  p_patient_number_prefix  text
)
returns table (doctor_id uuid, created boolean, prefix_changed boolean)
language plpgsql
volatile
security invoker
set search_path = public, pg_temp
as $$
declare
  v_user      uuid := auth.uid();
  v_existing  public.doctor_profiles%rowtype;
  v_id        uuid;
  v_created   boolean := false;
  v_changed   boolean := false;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  update public.profiles
     set full_name  = p_full_name,
         phone      = p_phone,
         updated_at = now()
   where id = v_user;

  if not found then
    raise exception 'profile not found' using errcode = '42501';
  end if;

  select * into v_existing from public.doctor_profiles where user_id = v_user;

  if found then
    v_changed := v_existing.patient_number_prefix is distinct from p_patient_number_prefix;

    update public.doctor_profiles
       set qualification         = p_qualification,
           specialization        = p_specialization,
           designation           = p_designation,
           bmdc_registration_no  = p_bmdc_registration_no,
           patient_number_prefix = p_patient_number_prefix,
           updated_at            = now()
     where id = v_existing.id
    returning id into v_id;
  else
    insert into public.doctor_profiles
      (user_id, qualification, specialization, designation,
       bmdc_registration_no, patient_number_prefix)
    values
      (v_user, p_qualification, p_specialization, p_designation,
       p_bmdc_registration_no, p_patient_number_prefix)
    returning id into v_id;

    v_created := true;
  end if;

  return query select v_id, v_created, v_changed;
end;
$$;

revoke all on function public.update_doctor_identity(
  text, text, text, text, text, text, text) from public, anon;
grant execute on function public.update_doctor_identity(
  text, text, text, text, text, text, text) to authenticated;

-- -----------------------------------------------------------------------------
-- A location-scoped template requires a DOCTOR role AT that location.
--
-- The previous policy only checked template ownership, and the application only
-- checked that the user held *some* membership. A doctor who is merely
-- RECEPTIONIST at a hospital could therefore attach a prescription template to
-- that hospital — a layout carrying their name and BMDC number, scoped to a
-- place they do not practise as a doctor.
--
-- A template with practice_location_id IS NULL stays unrestricted: it applies
-- wherever the doctor works and names no location.
-- -----------------------------------------------------------------------------
create or replace function public.may_scope_template_to(target_location uuid)
returns boolean
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select target_location is null
      or public.has_location_role(target_location, array['DOCTOR']::public.location_role[]);
$$;

revoke all on function public.may_scope_template_to(uuid) from public, anon;
grant execute on function public.may_scope_template_to(uuid) to authenticated;

drop policy if exists prescription_templates_insert on public.prescription_templates;
create policy prescription_templates_insert
  on public.prescription_templates for insert to authenticated
  with check (
    owner_doctor_id = public.current_doctor_id()
    and public.may_scope_template_to(practice_location_id)
  );

drop policy if exists prescription_templates_update on public.prescription_templates;
create policy prescription_templates_update
  on public.prescription_templates for update to authenticated
  using (owner_doctor_id = public.current_doctor_id())
  with check (
    owner_doctor_id = public.current_doctor_id()
    and public.may_scope_template_to(practice_location_id)
  );

-- -----------------------------------------------------------------------------
-- Default semantics, stated correctly.
--
-- The partial unique indexes enforce AT MOST ONE default per scope. They do not
-- and cannot enforce "exactly one" — deleting the default leaves zero, which is
-- a legitimate state a doctor may want.
--
-- Resolution is therefore a FALLBACK CHAIN, implemented in
-- resolveTemplateForLocation():
--     location default -> global default -> built-in system template
-- Nothing auto-promotes a replacement; a doctor who deletes their default gets
-- the built-in layout, not an arbitrary one of their own.
-- -----------------------------------------------------------------------------
comment on index public.prescription_templates_one_default_per_location is
  'At most one default per (doctor, location). Zero is valid — see resolveTemplateForLocation.';
comment on index public.prescription_templates_one_global_default is
  'At most one global default per doctor. Zero is valid — see resolveTemplateForLocation.';
