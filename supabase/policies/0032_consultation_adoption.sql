-- =============================================================================
-- 0032 — Consultation adoption: Symptoms and Next Visit become writable.
--
-- `encounters.symptoms`, `.next_visit_note` and `.next_visit_on` were added with
-- Prescription V2 and the review bundle already prints them. Until now nothing
-- could WRITE them, so the SYMPTOMS and NEXT_VISIT modules could only ever
-- print empty. This closes that.
--
-- The write goes through the SAME boundary as every other clinical note —
-- `save_encounter_sections`, one version, one patch, one audit row. There is no
-- second write path and no shadow storage: a follow-up date is part of the
-- consultation, not a thing beside it.
-- =============================================================================

/**
 * A CALENDAR DATE, TAKEN LITERALLY.
 *
 * `next_visit_on` is a `date`, and that is the whole point: "come back on the
 * 2nd" is a day on a wall calendar, not an instant. So this accepts EXACTLY
 * `YYYY-MM-DD` and nothing else.
 *
 * The refusal is the control. `'2026-09-02T00:00:00Z'::date` and
 * `'2026-09-02T23:30:00+06'::date` both parse, and both resolve through the
 * SESSION timezone — so a doctor in Dhaka choosing the 2nd could have the 1st
 * stored, and nothing would look wrong anywhere. A timestamp reaching this
 * function means the caller has already converted a date it should not have
 * touched, so it is rejected rather than coerced.
 *
 * There is no "in N days" arithmetic here or anywhere else. The date the doctor
 * chose is the date that is stored.
 */
create or replace function public.patch_date(p_patch jsonb, p_key text, p_current date)
returns date
language plpgsql
immutable
as $$
declare
  v jsonb;
  s text;
begin
  if not (p_patch ? p_key) then return p_current; end if;
  v := p_patch -> p_key;
  if jsonb_typeof(v) = 'null' then return null; end if;
  if jsonb_typeof(v) <> 'string' then
    raise exception 'PATCH_INVALID' using errcode = '22023';
  end if;

  -- A date field the doctor cleared arrives as ""; that is the clear it looks like.
  s := btrim(p_patch ->> p_key);
  if s = '' then return null; end if;

  if s !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception 'PATCH_DATE_INVALID' using errcode = '22023';
  end if;

  -- Still cast, so 2026-02-31 is refused by the calendar rather than stored.
  return s::date;
end;
$$;

revoke all on function public.patch_date(jsonb, text, date) from public, anon, authenticated;

/**
 * The draft write, now carrying the two modules that had no way in.
 *
 * `symptoms` is a section like any other. `next_visit_note` and `next_visit_on`
 * are two halves of one statement — "with reports · 2 Sep 2026" — and either
 * may stand alone: a date with no note, or a note with no date. Neither is
 * mandatory, and an absent follow-up is absent rather than invented.
 *
 * Everything else is unchanged, including the audit rule: FIELD NAMES and the
 * version, never the values.
 */
create or replace function public.save_encounter_sections(
  p_encounter_id         uuid,
  p_practice_location_id uuid,
  p_expected_version     integer,
  p_patch                jsonb
)
returns integer
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_fields text[];
  v_next   integer;
begin
  -- Validate the shape BEFORE taking the row lock: a malformed patch is a
  -- caller bug and should not hold a clinical row while it is rejected.
  perform public.assert_patch_shape(p_patch, array[
    'chiefComplaints', 'symptoms', 'presentIllness', 'pastHistory',
    'examination', 'assessment', 'advice',
    'nextVisitNote', 'nextVisitOn',
    'vitalHeightCm', 'vitalWeightKg', 'vitalTemperatureC', 'vitalPulseBpm',
    'vitalSystolic', 'vitalDiastolic', 'vitalRespRate', 'vitalSpo2']);
  perform public.assert_vital_ranges(p_patch);

  perform public.encounter_for_update(p_encounter_id, p_practice_location_id, p_expected_version);

  select array_agg(k order by k) into v_fields from jsonb_object_keys(p_patch) as k;

  /**
   * The unqualified column on the right of each `=` is the row's CURRENT value,
   * which is what "absent means untouched" needs.
   */
  update public.encounters set
    chief_complaints    = public.patch_text(p_patch, 'chiefComplaints', chief_complaints),
    symptoms            = public.patch_text(p_patch, 'symptoms', symptoms),
    present_illness     = public.patch_text(p_patch, 'presentIllness', present_illness),
    past_history        = public.patch_text(p_patch, 'pastHistory', past_history),
    examination         = public.patch_text(p_patch, 'examination', examination),
    assessment          = public.patch_text(p_patch, 'assessment', assessment),
    advice              = public.patch_text(p_patch, 'advice', advice),
    next_visit_note     = public.patch_text(p_patch, 'nextVisitNote', next_visit_note),
    next_visit_on       = public.patch_date(p_patch, 'nextVisitOn', next_visit_on),
    vital_height_cm     = public.patch_numeric(p_patch, 'vitalHeightCm', vital_height_cm),
    vital_weight_kg     = public.patch_numeric(p_patch, 'vitalWeightKg', vital_weight_kg),
    vital_temperature_c = public.patch_numeric(p_patch, 'vitalTemperatureC', vital_temperature_c),
    vital_pulse_bpm     = public.patch_int(p_patch, 'vitalPulseBpm', vital_pulse_bpm),
    vital_systolic      = public.patch_int(p_patch, 'vitalSystolic', vital_systolic),
    vital_diastolic     = public.patch_int(p_patch, 'vitalDiastolic', vital_diastolic),
    vital_resp_rate     = public.patch_int(p_patch, 'vitalRespRate', vital_resp_rate),
    vital_spo2          = public.patch_int(p_patch, 'vitalSpo2', vital_spo2),
    version             = version + 1,
    updated_at          = now()
  where id = p_encounter_id
  returning version into v_next;

  /**
   * Field NAMES and the version — never the values, not even here. This table
   * is doctor-only and may carry clinical detail, but a change log that
   * accumulates every keystroke of every note is a second copy of the record
   * with none of its protections.
   */
  insert into public.encounter_events (encounter_id, event_type, detail, actor_id)
  values (p_encounter_id, 'SECTIONS_UPDATED',
          jsonb_build_object('fields', to_jsonb(v_fields), 'version', v_next),
          auth.uid());

  -- Field names and the version. No text, no vital VALUES.
  perform public.log_encounter_audit(
    p_encounter_id, p_practice_location_id, 'encounter.sections_updated',
    jsonb_build_object('fields', to_jsonb(v_fields), 'version', v_next));

  return v_next;
end;
$$;

revoke all on function public.save_encounter_sections(uuid, uuid, integer, jsonb)
  from public, anon;
grant execute on function public.save_encounter_sections(uuid, uuid, integer, jsonb)
  to authenticated;
