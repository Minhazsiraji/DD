-- =============================================================================
-- Prescription templates + doctor signature storage.
--
-- A template is part of the doctor's professional identity. It is owned by the
-- doctor, not by a location: moving between chambers must not lose it.
--
-- Signatures are a private storage object. A signature image is effectively a
-- reusable authorisation mark — it must never be publicly addressable.
-- =============================================================================

alter table public.prescription_templates enable row level security;
alter table public.prescription_templates force row level security;
revoke all on public.prescription_templates from anon;

/** Does the caller own this template? */
create or replace function public.owns_template(target_template uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.prescription_templates t
    where t.id = target_template
      and t.owner_doctor_id = public.current_doctor_id()
  );
$$;

revoke all on function public.owns_template(uuid) from public, anon;
grant execute on function public.owns_template(uuid) to authenticated;

-- Doctor-only, all four verbs. Staff never see or edit prescription layout.
drop policy if exists prescription_templates_select on public.prescription_templates;
create policy prescription_templates_select
  on public.prescription_templates for select to authenticated
  using (owner_doctor_id = public.current_doctor_id());

drop policy if exists prescription_templates_insert on public.prescription_templates;
create policy prescription_templates_insert
  on public.prescription_templates for insert to authenticated
  with check (owner_doctor_id = public.current_doctor_id());

drop policy if exists prescription_templates_update on public.prescription_templates;
create policy prescription_templates_update
  on public.prescription_templates for update to authenticated
  using (owner_doctor_id = public.current_doctor_id())
  with check (owner_doctor_id = public.current_doctor_id());

drop policy if exists prescription_templates_delete on public.prescription_templates;
create policy prescription_templates_delete
  on public.prescription_templates for delete to authenticated
  using (owner_doctor_id = public.current_doctor_id());

grant select, insert, update, delete on public.prescription_templates to authenticated;

-- -----------------------------------------------------------------------------
-- "AT MOST one default per (doctor, location)" enforced in the DATABASE.
--
-- Not "exactly one": deleting the default leaves zero, and that is a valid
-- state — a doctor may deliberately keep no custom default. Resolution falls
-- back (location -> global -> built-in); see 0006 and resolveTemplateForLocation.
--
-- Doing this in application code alone means two tabs, or a retry, can leave a
-- doctor with two defaults and a prescription that renders unpredictably.
-- Partial unique indexes cover the two cases separately because NULL is not
-- comparable in a unique index.
-- -----------------------------------------------------------------------------
create unique index if not exists prescription_templates_one_default_per_location
  on public.prescription_templates (owner_doctor_id, practice_location_id)
  where is_default and practice_location_id is not null;

create unique index if not exists prescription_templates_one_global_default
  on public.prescription_templates (owner_doctor_id)
  where is_default and practice_location_id is null;

/**
 * Promote a template to default, clearing the previous one in the same scope.
 * A single transaction, so there is never a moment with zero or two defaults.
 */
create or replace function public.set_default_template(target_template uuid)
returns void
language plpgsql
volatile
security invoker
set search_path = public, pg_temp
as $$
declare
  v_doctor   uuid := public.current_doctor_id();
  v_location uuid;
begin
  select practice_location_id into v_location
  from public.prescription_templates
  where id = target_template and owner_doctor_id = v_doctor;

  if not found then
    raise exception 'template not found' using errcode = '42501';
  end if;

  update public.prescription_templates
     set is_default = false, updated_at = now()
   where owner_doctor_id = v_doctor
     and is_default
     and practice_location_id is not distinct from v_location;

  update public.prescription_templates
     set is_default = true, updated_at = now()
   where id = target_template;
end;
$$;

revoke all on function public.set_default_template(uuid) from public, anon;
grant execute on function public.set_default_template(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Signature storage — PRIVATE bucket.
--
-- Path convention: <auth.uid()>/signature.<ext>. The first path segment is the
-- owner, which is what every policy below checks.
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'doctor-assets', 'doctor-assets', false, 2097152,
  array['image/png','image/jpeg','image/webp']
)
on conflict (id) do update set
  public             = false,           -- never let this flip to public
  file_size_limit    = 2097152,
  allowed_mime_types = array['image/png','image/jpeg','image/webp'];

drop policy if exists doctor_assets_select on storage.objects;
create policy doctor_assets_select
  on storage.objects for select to authenticated
  using (
    bucket_id = 'doctor-assets'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists doctor_assets_insert on storage.objects;
create policy doctor_assets_insert
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'doctor-assets'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists doctor_assets_update on storage.objects;
create policy doctor_assets_update
  on storage.objects for update to authenticated
  using (
    bucket_id = 'doctor-assets'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists doctor_assets_delete on storage.objects;
create policy doctor_assets_delete
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'doctor-assets'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
