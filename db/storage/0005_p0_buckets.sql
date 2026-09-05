insert into storage.buckets (id, name, public)
values
  ('doctor-profile-photos', 'doctor-profile-photos', false),
  ('doctor-signatures', 'doctor-signatures', false),
  ('prescription-assets', 'prescription-assets', false)
on conflict (id) do update set public = excluded.public;

-- P0 has only three storage families. Later-phase buckets are deliberately
-- absent until their owning tables/features exist.
drop policy if exists private_objects_no_anon on storage.objects;
drop policy if exists private_objects_owner_path on storage.objects;
drop policy if exists private_objects_owner_write on storage.objects;
drop policy if exists frozen_prescription_assets_no_delete on storage.objects;
drop policy if exists private_objects_no_authenticated_direct on storage.objects;
drop policy if exists p0_doctor_assets_read on storage.objects;
drop policy if exists p0_doctor_assets_insert on storage.objects;
drop policy if exists p0_doctor_assets_delete on storage.objects;
drop policy if exists p0_prescription_assets_read on storage.objects;

create policy private_objects_no_anon
on storage.objects for all to anon
using (false) with check (false);

-- The object name is resolved back to the owned professional profile row.
-- The path alone never grants access.
create policy p0_doctor_assets_read
on storage.objects for select to authenticated
using (public.may_write_doctor_asset(bucket_id, name));
create policy p0_doctor_assets_insert
on storage.objects for insert to authenticated
with check (
  bucket_id in ('doctor-profile-photos','doctor-signatures')
  and public.may_write_doctor_asset(bucket_id, name)
);

create policy p0_doctor_assets_delete
on storage.objects for delete to authenticated
using (
  bucket_id in ('doctor-profile-photos','doctor-signatures')
  and public.may_write_doctor_asset(bucket_id, name)
);

-- Frozen prescription assets are written only by the trusted server freeze
-- adapter (non-overwriting). Browser actors can read only after the path is
-- frozen into an authorised FINALIZED prescription; there is no UPDATE or
-- DELETE policy on this bucket.
create policy p0_prescription_assets_read
on storage.objects for select to authenticated
using (
  bucket_id='prescription-assets'
  and public.may_read_prescription_asset(name)
);
