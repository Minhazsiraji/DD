-- =============================================================================
-- Pilot prescription clinic/chamber logo identity.
--
-- The current clinic logo is mutable stationery. A finalized prescription is
-- not. Every upload gets a fresh immutable Storage path; the location points at
-- which path future prescriptions should use. This migration wraps the already
-- accepted Fahrenheit review builder, adds the exact logo object identity to a
-- v5 bundle, then recomputes the digest over that final printable object.
-- =============================================================================

alter table public.practice_locations
  add column if not exists prescription_logo_path text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'clinic-assets', 'clinic-assets', false, 2097152,
  array['image/png','image/jpeg','image/webp']
)
on conflict (id) do update set
  public = false,
  file_size_limit = 2097152,
  allowed_mime_types = array['image/png','image/jpeg','image/webp'];

-- No authenticated Storage policies are granted for clinic-assets. Uploads and
-- signed URLs stay behind reviewed server actions after role/Rx checks.

do $$
begin
  if to_regprocedure('public.prescription_review_bundle_v4_fahrenheit(uuid,uuid,uuid)') is null then
    alter function public.prescription_review_bundle(uuid, uuid, uuid)
      rename to prescription_review_bundle_v4_fahrenheit;
  end if;
end
$$;

revoke all on function public.prescription_review_bundle_v4_fahrenheit(uuid, uuid, uuid)
  from public, anon, authenticated;

create or replace function public.prescription_review_bundle(
  p_prescription_id      uuid,
  p_practice_location_id uuid,
  p_template_id          uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_envelope  jsonb;
  v_bundle    jsonb;
  v_logo_path text;
  v_logo      jsonb;
begin
  -- All clinical authority, ownership, template selection, signature identity,
  -- module ordering and Fahrenheit transformation stay in the accepted builder.
  v_envelope := public.prescription_review_bundle_v4_fahrenheit(
    p_prescription_id,
    p_practice_location_id,
    p_template_id
  );
  v_bundle := v_envelope -> 'bundle';

  if (v_bundle -> 'template' ->> 'showClinicLogo')::boolean then
    select l.prescription_logo_path
      into v_logo_path
    from public.practice_locations l
    where l.id = p_practice_location_id;

    if nullif(btrim(coalesce(v_logo_path, '')), '') is null then
      raise exception 'CLINIC_LOGO_UNAVAILABLE' using errcode = '22023';
    end if;

    select jsonb_build_object(
             'objectId', o.id,
             'path', o.name,
             'size', o.metadata ->> 'size',
             'mimetype', o.metadata ->> 'mimetype'
           )
      into v_logo
    from storage.objects o
    where o.bucket_id = 'clinic-assets'
      and o.name = v_logo_path;

    if v_logo is null then
      raise exception 'CLINIC_LOGO_UNAVAILABLE' using errcode = '22023';
    end if;
  end if;

  -- v5 is the accepted v4/Fahrenheit printable object plus one attested asset.
  v_bundle := jsonb_set(v_bundle, '{schemaVersion}', '5'::jsonb, true);
  v_bundle := jsonb_set(v_bundle, '{clinicLogo}', coalesce(v_logo, 'null'::jsonb), true);

  return jsonb_build_object(
    'bundle', v_bundle,
    'digest', encode(sha256(convert_to(v_bundle::text, 'UTF8')), 'hex'),
    'expectedSignaturePath', v_envelope ->> 'expectedSignaturePath',
    'version', (v_envelope ->> 'version')::integer
  );
end;
$$;

revoke all on function public.prescription_review_bundle(uuid, uuid, uuid)
  from public, anon;
grant execute on function public.prescription_review_bundle(uuid, uuid, uuid)
  to authenticated;

-- Resolve only the clinic logo path this caller is already allowed to read on
-- the prescription. Finalized documents read the immutable snapshot, never the
-- location's current logo pointer.
create or replace function public.prescription_clinic_logo_asset_path(
  p_prescription_id uuid
)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_rx   public.prescriptions%rowtype;
  v_path text;
begin
  select * into v_rx
  from public.prescriptions
  where id = p_prescription_id;

  if not found
     or not (
       coalesce(v_rx.owner_doctor_id = public.current_doctor_id(), false)
       or public.may_hand_over_prescription(v_rx.id)
     ) then
    raise exception 'prescription not found' using errcode = '42501';
  end if;

  if v_rx.status = 'FINALIZED' then
    return nullif(v_rx.review_bundle_snapshot -> 'clinicLogo' ->> 'path', '');
  end if;

  select l.prescription_logo_path
    into v_path
  from public.practice_locations l
  where l.id = v_rx.practice_location_id;

  return v_path;
end;
$$;

revoke all on function public.prescription_clinic_logo_asset_path(uuid)
  from public, anon;
grant execute on function public.prescription_clinic_logo_asset_path(uuid)
  to authenticated;
