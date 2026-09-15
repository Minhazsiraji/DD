-- =============================================================================
-- M3 narrow UAT correction: clinic/chamber logo authority belongs to the
-- prescription's selected practice location, even when paper/layout settings
-- fall back to a global prescription template.
--
-- No schema/RLS/storage-policy change. This only replaces the canonical review
-- bundle resolver introduced by 0049. Finalized prescriptions still read their
-- immutable review_bundle_snapshot through prescription_clinic_logo_asset_path.
-- =============================================================================

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
  -- Preserve all accepted clinical authority, ownership, template selection,
  -- signature identity, module ordering and Fahrenheit transformation.
  v_envelope := public.prescription_review_bundle_v4_fahrenheit(
    p_prescription_id,
    p_practice_location_id,
    p_template_id
  );
  v_bundle := v_envelope -> 'bundle';

  -- Clinic/chamber identity follows the selected prescription location. A
  -- global template may supply paper/layout defaults, but must not suppress or
  -- substitute another location's logo.
  select l.prescription_logo_path
    into v_logo_path
  from public.practice_locations l
  where l.id = p_practice_location_id;

  if nullif(btrim(coalesce(v_logo_path, '')), '') is not null then
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

    -- A configured pointer must resolve to the exact immutable storage object.
    -- Fail closed rather than approving a bundle with a broken/mismatched logo.
    if v_logo is null then
      raise exception 'CLINIC_LOGO_UNAVAILABLE' using errcode = '22023';
    end if;
  else
    -- No configured logo is a valid stationery state. Attest null so review and
    -- print render cleanly without a broken image or placeholder.
    v_logo := null;
  end if;

  -- V5 is the accepted V4/Fahrenheit printable object plus one attested asset.
  -- The digest covers the exact logo identity (or explicit null) seen at review.
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
