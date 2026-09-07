-- ---------------------------------------------------------------------------
-- M3-BF-02 — Recent/Frequent signed medicine history.
--
-- This is a new bounded read RPC rather than a semantic rewrite of the frozen
-- Stage 7B function. It is Doctor-owned FINALIZED history only, with truthful
-- distinct-prescription usage counts and genuinely separate Recent/Frequent
-- ordering. It performs no clinical write.
--
-- Signed medicine content comes exclusively from the immutable finalized
-- review_bundle_snapshot -> 'items'. Live prescription_items rows are not a
-- source for wording, search, frequency, recency or latest signed wording.
-- ---------------------------------------------------------------------------

create or replace function public.prescription_signed_medicine_history(
  p_order text default 'RECENT',
  p_query text default null,
  p_limit integer default 8
)
returns table (
  display_name         text,
  brand_name           text,
  generic_name         text,
  strength_text        text,
  dose_text            text,
  dosage_form          text,
  route                text,
  schedule_text        text,
  duration_text        text,
  quantity_text        text,
  food_relation        text,
  is_prn               boolean,
  instructions         text,
  substitution_allowed boolean,
  last_used            timestamptz,
  times_used           integer
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_doctor uuid := public.current_doctor_id();
  v_order  text := upper(btrim(coalesce(p_order, 'RECENT')));
  v_q      text := nullif(btrim(coalesce(p_query, '')), '');
begin
  if v_doctor is null then
    raise exception 'not a doctor' using errcode = '42501';
  end if;
  if v_order not in ('RECENT', 'FREQUENT') then
    raise exception 'INVALID_HISTORY_ORDER' using errcode = '22023';
  end if;

  return query
  with eligible_prescriptions as (
    select
      p.id as source_prescription_id,
      p.finalized_at,
      p.review_bundle_snapshot -> 'items' as signed_items
    from public.prescriptions p
    where p.owner_doctor_id = v_doctor
      and p.status = 'FINALIZED'
      and p.finalized_at is not null
      and p.review_digest is not null
      and p.snapshot_schema_version is not null
      and p.review_bundle_snapshot is not null
      and jsonb_typeof(p.review_bundle_snapshot -> 'items') = 'array'
      and jsonb_array_length(p.review_bundle_snapshot -> 'items') > 0
      -- A malformed snapshot is never allowed to fall back to live rows or
      -- partially become signed-history authority. Exclude the whole Rx if any
      -- signed medicine item is not a canonical object representation.
      and not exists (
        select 1
        from jsonb_array_elements(
          case
            when jsonb_typeof(p.review_bundle_snapshot -> 'items') = 'array'
              then p.review_bundle_snapshot -> 'items'
            else '[]'::jsonb
          end
        ) as bad(item)
        where jsonb_typeof(bad.item) <> 'object'
           or jsonb_typeof(bad.item -> 'display_name') <> 'string'
           or nullif(btrim(bad.item ->> 'display_name'), '') is null
           or jsonb_typeof(bad.item -> 'position') <> 'number'
           or coalesce(bad.item ->> 'position', '') !~ '^[0-9]{1,9}$'
           or (
             bad.item ? 'brand_name'
             and jsonb_typeof(bad.item -> 'brand_name') not in ('string', 'null')
           )
           or (
             bad.item ? 'generic_name'
             and jsonb_typeof(bad.item -> 'generic_name') not in ('string', 'null')
           )
           or (
             bad.item ? 'strength_text'
             and jsonb_typeof(bad.item -> 'strength_text') not in ('string', 'null')
           )
           or (
             bad.item ? 'dose_text'
             and jsonb_typeof(bad.item -> 'dose_text') not in ('string', 'null')
           )
           or (
             bad.item ? 'dosage_form'
             and jsonb_typeof(bad.item -> 'dosage_form') not in ('string', 'null')
           )
           or (
             bad.item ? 'route'
             and jsonb_typeof(bad.item -> 'route') not in ('string', 'null')
           )
           or (
             bad.item ? 'schedule_text'
             and jsonb_typeof(bad.item -> 'schedule_text') not in ('string', 'null')
           )
           or (
             bad.item ? 'duration_text'
             and jsonb_typeof(bad.item -> 'duration_text') not in ('string', 'null')
           )
           or (
             bad.item ? 'quantity_text'
             and jsonb_typeof(bad.item -> 'quantity_text') not in ('string', 'null')
           )
           or (
             bad.item ? 'food_relation'
             and jsonb_typeof(bad.item -> 'food_relation') not in ('string', 'null')
           )
           or (
             bad.item ? 'instructions'
             and jsonb_typeof(bad.item -> 'instructions') not in ('string', 'null')
           )
           or (
             bad.item ? 'is_prn'
             and jsonb_typeof(bad.item -> 'is_prn') not in ('boolean', 'null')
           )
           or (
             bad.item ? 'substitution_allowed'
             and jsonb_typeof(bad.item -> 'substitution_allowed') not in ('boolean', 'null')
           )
      )
  ), eligible_history as (
    select
      ep.source_prescription_id,
      ep.finalized_at,
      item.value ->> 'display_name' as display_name,
      item.value ->> 'brand_name' as brand_name,
      item.value ->> 'generic_name' as generic_name,
      item.value ->> 'strength_text' as strength_text,
      item.value ->> 'dose_text' as dose_text,
      item.value ->> 'dosage_form' as dosage_form,
      item.value ->> 'route' as route,
      item.value ->> 'schedule_text' as schedule_text,
      item.value ->> 'duration_text' as duration_text,
      item.value ->> 'quantity_text' as quantity_text,
      item.value ->> 'food_relation' as food_relation,
      case
        when jsonb_typeof(item.value -> 'is_prn') = 'boolean'
          then (item.value ->> 'is_prn')::boolean
        else null
      end as is_prn,
      item.value ->> 'instructions' as instructions,
      case
        when jsonb_typeof(item.value -> 'substitution_allowed') = 'boolean'
          then (item.value ->> 'substitution_allowed')::boolean
        else null
      end as substitution_allowed,
      (item.value ->> 'position')::bigint as signed_position,
      item.ordinality::bigint as signed_ordinality,
      lower(btrim(item.value ->> 'display_name')) as normalized_name
    from eligible_prescriptions ep
    cross join lateral jsonb_array_elements(ep.signed_items)
      with ordinality as item(value, ordinality)
  ), matched_names as (
    -- Search is lexical only over frozen signed wording. A historical signed
    -- brand/generic spelling may discover the normalized medicine name, but the
    -- returned wording below is always from the latest eligible signed snapshot,
    -- not necessarily the particular historical item that matched the query.
    select distinct h.normalized_name
    from eligible_history h
    where v_q is null
       or h.display_name ilike '%' || v_q || '%'
       or h.brand_name ilike '%' || v_q || '%'
       or h.generic_name ilike '%' || v_q || '%'
  ), stats as (
    select
      h.normalized_name,
      max(h.finalized_at) as latest_use,
      count(distinct h.source_prescription_id)::integer as distinct_rx_count
    from eligible_history h
    join matched_names m on m.normalized_name = h.normalized_name
    group by h.normalized_name
  ), latest_wording as (
    select distinct on (h.normalized_name)
      h.normalized_name,
      h.display_name,
      h.brand_name,
      h.generic_name,
      h.strength_text,
      h.dose_text,
      h.dosage_form,
      h.route,
      h.schedule_text,
      h.duration_text,
      h.quantity_text,
      h.food_relation,
      h.is_prn,
      h.instructions,
      h.substitution_allowed
    from eligible_history h
    join matched_names m on m.normalized_name = h.normalized_name
    order by h.normalized_name,
             h.finalized_at desc,
             h.source_prescription_id desc,
             h.signed_position asc,
             h.signed_ordinality asc
  )
  select
    l.display_name,
    l.brand_name,
    l.generic_name,
    l.strength_text,
    l.dose_text,
    l.dosage_form,
    l.route,
    l.schedule_text,
    l.duration_text,
    l.quantity_text,
    l.food_relation,
    l.is_prn,
    l.instructions,
    l.substitution_allowed,
    s.latest_use,
    s.distinct_rx_count
  from latest_wording l
  join stats s on s.normalized_name = l.normalized_name
  order by
    case when v_order = 'RECENT' then s.latest_use end desc,
    case when v_order = 'RECENT' then s.distinct_rx_count end desc,
    case when v_order = 'FREQUENT' then s.distinct_rx_count end desc,
    case when v_order = 'FREQUENT' then s.latest_use end desc,
    l.normalized_name asc
  limit greatest(1, least(coalesce(p_limit, 8), 25));
end;
$$;

revoke all on function public.prescription_signed_medicine_history(text, text, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.prescription_signed_medicine_history(text, text, integer)
  to authenticated;
