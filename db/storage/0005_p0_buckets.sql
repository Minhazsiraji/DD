insert into storage.buckets (id, name, public)
values
  ('doctor-profile-photos', 'doctor-profile-photos', false),
  ('doctor-signatures', 'doctor-signatures', false),
  ('prescription-assets', 'prescription-assets', false),
  ('clinical-documents', 'clinical-documents', false),
  ('personal-health-documents', 'personal-health-documents', false),
  ('community-media', 'community-media', false),
  ('verification-evidence', 'verification-evidence', false)
on conflict (id) do update set public = excluded.public;

create policy private_objects_no_anon on storage.objects for all to anon using (false) with check (false);
create policy private_objects_owner_path on storage.objects for select to authenticated
using (bucket_id in ('doctor-profile-photos', 'doctor-signatures') and split_part(name, '/', 1) = auth.uid()::text);
create policy private_objects_owner_write on storage.objects for insert to authenticated
with check (bucket_id in ('doctor-profile-photos', 'doctor-signatures') and split_part(name, '/', 1) = auth.uid()::text);
create policy frozen_prescription_assets_no_delete on storage.objects for delete to authenticated using (false);