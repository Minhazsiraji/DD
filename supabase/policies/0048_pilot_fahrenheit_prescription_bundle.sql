/**
 * Pilot Fahrenheit prescription boundary.
 *
 * Authoritative encounter storage remains `vital_temperature_c`; this policy
 * changes only the printable value frozen into NEW review bundles. Existing
 * finalised snapshots are never rebuilt and therefore remain byte-for-byte as
 * the doctor approved them.
 *
 * We do not edit 0029 in place. On first apply, its builder is preserved under
 * a private/revoked legacy name and this wrapper becomes the public RPC. Policy
 * re-application is idempotent: when the legacy helper already exists, 0029's
 * freshly re-created public function is simply replaced by this wrapper again.
 */

do $$
begin
  if to_regprocedure('public.prescription_review_bundle_v4_celsius(uuid,uuid,uuid)') is null then
    alter function public.prescription_review_bundle(uuid, uuid, uuid)
      rename to prescription_review_bundle_v4_celsius;
  end if;
end
$$;

revoke all on function public.prescription_review_bundle_v4_celsius(uuid, uuid, uuid)
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
  v_envelope jsonb;
  v_bundle   jsonb;
  v_sections jsonb;
begin
  -- All authority, ownership, module selection, signature attestation and
  -- printable-content decisions remain in the accepted 0029 builder.
  v_envelope := public.prescription_review_bundle_v4_celsius(
    p_prescription_id,
    p_practice_location_id,
    p_template_id
  );

  v_bundle := v_envelope -> 'bundle';

  /**
   * Change one presentation boundary only: the T pair inside the frozen VITALS
   * module. The legacy builder emits a numeric value followed by the literal
   * unit `°C`. Anything that does not exactly match that contract is left
   * untouched rather than guessed at.
   */
  select coalesce(jsonb_agg(
    case
      when section ->> 'module' = 'VITALS'
       and section ->> 'kind' = 'pairs'
      then jsonb_set(
        section,
        '{pairs}',
        coalesce((
          select jsonb_agg(
            case
              when pair ->> 'label' = 'T'
               and pair ->> 'value' ~ '^-?[0-9]+(\.[0-9]+)?°C$'
              then jsonb_set(
                pair,
                '{value}',
                to_jsonb(
                  regexp_replace(
                    round(
                      (((regexp_replace(pair ->> 'value', '°C$', ''))::numeric * 9.0 / 5.0) + 32.0),
                      1
                    )::text,
                    '\.0$',
                    ''
                  ) || '°F'
                ),
                true
              )
              else pair
            end
            order by pair_ord
          )
          from jsonb_array_elements(section -> 'pairs') with ordinality as p(pair, pair_ord)
        ), '[]'::jsonb),
        true
      )
      else section
    end
    order by section_ord
  ), '[]'::jsonb)
  into v_sections
  from jsonb_array_elements(coalesce(v_bundle -> 'sections', '[]'::jsonb))
       with ordinality as s(section, section_ord);

  v_bundle := jsonb_set(v_bundle, '{sections}', v_sections, true);

  -- The doctor must approve the exact Fahrenheit-bearing object that will be
  -- finalised. Recompute the digest after transformation; never reuse 0029's
  -- digest, which covered the pre-transformation Celsius object.
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
