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
     * Two steps, and the order of them is the whole point.
     *
     * INNER: `distinct on` keeps the LATEST wording of each medicine — a doctor
     * who has refined how they write a line wants the refined one back, not the
     * first time they ever typed it. `distinct on` dictates its own ORDER BY,
     * so that inner order is by NAME and can only be by name.
     *
     * OUTER: re-order by when it was actually last used, and only then LIMIT.
     * Ordering and limiting in one step returned the alphabetically earliest
     * eight medicines while calling them the most recent eight.
     */
    select s.display_name, s.brand_name, s.generic_name, s.strength_text, s.dose_text,
           s.dosage_form, s.route, s.schedule_text, s.duration_text, s.quantity_text,
           s.food_relation, s.is_prn, s.instructions, s.substitution_allowed,
           s.last_used, s.times_used
    from (
      select distinct on (lower(btrim(i.display_name)))
        i.display_name, i.brand_name, i.generic_name, i.strength_text, i.dose_text,
        i.dosage_form, i.route, i.schedule_text, i.duration_text, i.quantity_text,
        i.food_relation, i.is_prn, i.instructions, i.substitution_allowed,
        p.finalized_at as last_used,
        (select count(*)::integer
           from public.prescription_items i2
           join public.prescriptions p2 on p2.id = i2.prescription_id
          where p2.owner_doctor_id = v_doctor
            and p2.status = 'FINALIZED'
            and lower(btrim(i2.display_name)) = lower(btrim(i.display_name))) as times_used
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
    ) s
    order by s.last_used desc, s.times_used desc, lower(btrim(s.display_name))
    limit greatest(1, least(coalesce(p_limit, 8), 25));
end;
$$;

revoke all on function public.prescription_item_suggestions(text, integer) from public, anon;
grant execute on function public.prescription_item_suggestions(text, integer) to authenticated;
