-- =============================================================================
-- Medicine suggestions (Stage 7B).
--
-- The doctor's OWN previously finalised wording, and nothing else. There is no
-- catalogue behind this and it does not pretend to be one: it is an
-- accelerator over what this doctor has already written and signed.
--
-- Deliberately NOT a source of truth. Choosing a suggestion copies text into
-- the current draft's fields; it stores no reference, so a finalised
-- prescription can never change because a later one was written differently.
-- =============================================================================

create or replace function public.prescription_item_suggestions(
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
  v_q      text := nullif(btrim(coalesce(p_query, '')), '');
begin
  if v_doctor is null then
    raise exception 'not a doctor' using errcode = '42501';
  end if;

  return query
    /**
     * One row per distinct wording, most recently used first. `distinct on`
     * keeps the LATEST version of each medicine's wording — a doctor who has
     * refined how they write a line wants the refined one back, not the first
     * time they ever typed it.
     */
    select distinct on (lower(btrim(i.display_name)))
      i.display_name, i.brand_name, i.generic_name, i.strength_text, i.dose_text,
      i.dosage_form, i.route, i.schedule_text, i.duration_text, i.quantity_text,
      i.food_relation, i.is_prn, i.instructions, i.substitution_allowed,
      p.finalized_at,
      (select count(*)::integer
         from public.prescription_items i2
         join public.prescriptions p2 on p2.id = i2.prescription_id
        where p2.owner_doctor_id = v_doctor
          and p2.status = 'FINALIZED'
          and lower(btrim(i2.display_name)) = lower(btrim(i.display_name)))
    from public.prescription_items i
    join public.prescriptions p on p.id = i.prescription_id
    where p.owner_doctor_id = v_doctor
      and p.status = 'FINALIZED'
      and (
        v_q is null
        or i.display_name ilike '%' || v_q || '%'
        or i.generic_name ilike '%' || v_q || '%'
        or i.brand_name  ilike '%' || v_q || '%'
      )
    order by lower(btrim(i.display_name)), p.finalized_at desc
    limit greatest(1, least(coalesce(p_limit, 8), 25));
end;
$$;

revoke all on function public.prescription_item_suggestions(text, integer) from public, anon;
grant execute on function public.prescription_item_suggestions(text, integer) to authenticated;
