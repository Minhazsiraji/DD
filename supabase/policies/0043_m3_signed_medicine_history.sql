-- ---------------------------------------------------------------------------
-- M3-BF-02 — Recent/Frequent signed medicine history.
--
-- This is a new bounded read RPC rather than a semantic rewrite of the frozen
-- Stage 7B function. It is Doctor-owned FINALIZED history only, with truthful
-- distinct-prescription usage counts and genuinely separate Recent/Frequent
-- ordering. It performs no clinical write.
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
  with eligible_history as (
    select
      i.id,
      i.display_name,
      i.brand_name,
      i.generic_name,
      i.strength_text,
      i.dose_text,
      i.dosage_form,
      i.route,
      i.schedule_text,
      i.duration_text,
      i.quantity_text,
      i.food_relation,
      i.is_prn,
      i.instructions,
      i.substitution_allowed,
      i.position,
      p.id as source_prescription_id,
      p.finalized_at,
      lower(btrim(i.display_name)) as normalized_name
    from public.prescription_items i
    join public.prescriptions p on p.id = i.prescription_id
    where p.owner_doctor_id = v_doctor
      and p.status = 'FINALIZED'
      and p.finalized_at is not null
      and p.review_digest is not null
      and p.snapshot_schema_version is not null
      and p.review_bundle_snapshot is not null
  ), matched_names as (
    -- Search is lexical only. A historical brand/generic spelling may discover
    -- the normalized medicine name, but the returned wording below is always
    -- the latest signed wording for that medicine, not necessarily the row that
    -- happened to match the search text.
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
             h.position asc,
             h.id asc
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
