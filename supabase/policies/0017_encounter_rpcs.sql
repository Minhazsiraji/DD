-- =============================================================================
-- Encounter writes. These functions ARE the write path.
--
-- Each is SECURITY DEFINER with a pinned search_path and restates every rule it
-- bypasses, because a DEFINER function does not inherit RLS. Each writes its
-- encounter_event in the same transaction, so the record and its clinical
-- history cannot disagree.
--
-- Every clinical mutation is a COMPARE-AND-SWAP on `version`. Last-write-wins
-- would let one of two open tabs silently discard the other's notes, and nobody
-- would know which (ADR 0010).
-- =============================================================================

-- =============================================================================
-- THE PATCH CONTRACT
--
-- Three cases that must stay distinguishable:
--
--   key absent            leave it alone
--   key present, value    set it
--   key present, null     CLEAR it
--
-- `coalesce(p_new, existing)` collapses the first and third into one, which
-- meant a doctor who mistyped a blood pressure could never remove it — the
-- record would carry a wrong clinical value forever. A jsonb patch keeps
-- "untouched" and "cleared" apart because absence and null are different
-- things in JSON, and every key is whitelisted and type-checked below rather
-- than trusted.
--
-- No sentinel values. -1 is not "no pulse", and 0 is a real temperature reading
-- in the wrong unit, not an empty field.
-- =============================================================================

create or replace function public.assert_patch_shape(p_patch jsonb, p_allowed text[])
returns void
language plpgsql
immutable
as $$
declare
  v_key text;
begin
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'PATCH_INVALID' using errcode = '22023';
  end if;

  if p_patch = '{}'::jsonb then
    raise exception 'PATCH_EMPTY' using errcode = '22023';
  end if;

  -- An unknown key is a caller bug, and silently dropping it would let a typo
  -- read back as a successful save that changed nothing.
  for v_key in select jsonb_object_keys(p_patch) loop
    if not (v_key = any (p_allowed)) then
      raise exception 'PATCH_UNKNOWN_FIELD' using errcode = '22023';
    end if;
  end loop;
end;
$$;

create or replace function public.patch_text(p_patch jsonb, p_key text, p_current text)
returns text
language plpgsql
immutable
as $$
declare
  v jsonb;
begin
  if not (p_patch ? p_key) then return p_current; end if;
  v := p_patch -> p_key;
  if jsonb_typeof(v) = 'null' then return null; end if;
  if jsonb_typeof(v) <> 'string' then
    raise exception 'PATCH_INVALID' using errcode = '22023';
  end if;
  -- A textarea the doctor emptied arrives as ""; that is the clear it looks like.
  return nullif(btrim(p_patch ->> p_key), '');
end;
$$;

create or replace function public.patch_numeric(p_patch jsonb, p_key text, p_current numeric)
returns numeric
language plpgsql
immutable
as $$
declare
  v jsonb;
begin
  if not (p_patch ? p_key) then return p_current; end if;
  v := p_patch -> p_key;
  if jsonb_typeof(v) = 'null' then return null; end if;
  if jsonb_typeof(v) <> 'number' then
    raise exception 'PATCH_INVALID' using errcode = '22023';
  end if;
  return (p_patch ->> p_key)::numeric;
end;
$$;

create or replace function public.patch_int(p_patch jsonb, p_key text, p_current integer)
returns integer
language plpgsql
immutable
as $$
declare
  v jsonb;
  n numeric;
begin
  if not (p_patch ? p_key) then return p_current; end if;
  v := p_patch -> p_key;
  if jsonb_typeof(v) = 'null' then return null; end if;
  if jsonb_typeof(v) <> 'number' then
    raise exception 'PATCH_INVALID' using errcode = '22023';
  end if;
  n := (p_patch ->> p_key)::numeric;
  -- Reject 72.4 rather than rounding it: a pulse that silently changes value
  -- between what was typed and what was stored is worse than a rejection.
  if n <> trunc(n) then
    raise exception 'PATCH_INVALID' using errcode = '22023';
  end if;
  return n::integer;
end;
$$;

-- Pure helpers, called only from the DEFINER functions below.
revoke all on function public.assert_patch_shape(jsonb, text[]) from public, anon, authenticated;
revoke all on function public.patch_text(jsonb, text, text)      from public, anon, authenticated;
revoke all on function public.patch_numeric(jsonb, text, numeric) from public, anon, authenticated;
revoke all on function public.patch_int(jsonb, text, integer)     from public, anon, authenticated;

/**
 * May the caller act clinically on this patient, here, right now?
 *
 * The ONLY answer that matters for an encounter: they are the owning doctor and
 * they practise at the location they are working in.
 */
create or replace function public.may_open_encounter(
  target_patient  uuid,
  target_location uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.owns_patient(target_patient)
     and public.doctor_practises_at(public.current_doctor_id(), target_location);
$$;

revoke all on function public.may_open_encounter(uuid, uuid) from public, anon;
grant execute on function public.may_open_encounter(uuid, uuid) to authenticated;

/**
 * Load a DRAFT encounter for mutation, having proved the caller may.
 *
 * Locks the single row for the rest of the transaction — the smallest lock that
 * works, and never held across user interaction.
 *
 * Ungranted: reachable only from the write functions below.
 */
create or replace function public.encounter_for_update(
  target_encounter uuid,
  expected_location uuid,
  expected_version integer
)
returns public.encounters
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_enc public.encounters%rowtype;
begin
  select * into v_enc from public.encounters where id = target_encounter for update;

  /**
   * One message for missing, not-yours and elsewhere alike. Distinguishing them
   * would tell a caller which encounter ids exist and who they belong to.
   */
  if not found
     or v_enc.owner_doctor_id is distinct from public.current_doctor_id()
     or v_enc.practice_location_id is distinct from expected_location then
    raise exception 'encounter not found' using errcode = '42501';
  end if;

  -- Terminal records reject clinical change. Corrections are Stage 9.
  if v_enc.status <> 'DRAFT' then
    raise exception 'ENCOUNTER_NOT_DRAFT' using errcode = '22023';
  end if;

  /**
   * The stale-tab guard. A save carrying an old version is REJECTED — never
   * merged, never allowed to overwrite. The caller gets a distinct code so the
   * UI can keep the doctor's unsaved text rather than discarding it.
   */
  if expected_version is not null and v_enc.version <> expected_version then
    raise exception 'ENCOUNTER_VERSION_CONFLICT' using errcode = '40001';
  end if;

  return v_enc;
end;
$$;

revoke all on function public.encounter_for_update(uuid, uuid, integer)
  from public, anon, authenticated;

/**
 * Start a consultation, or RESUME the one already open.
 *
 * Returning the existing draft rather than failing is deliberate: a doctor who
 * taps twice, or opens a second tab, means "get me into this consultation" —
 * not "create another one". The partial unique indexes make two impossible even
 * if two requests race.
 *
 * `p_appointment_id` is optional; an unscheduled walk-in has none.
 */
create or replace function public.open_encounter(
  p_patient_id           uuid,
  p_practice_location_id uuid,
  p_appointment_id       uuid default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_doctor uuid := public.current_doctor_id();
  v_appt   public.appointments%rowtype;
  v_id     uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if v_doctor is null then
    raise exception 'only a doctor can open a consultation' using errcode = '42501';
  end if;

  -- Ownership and location, from the database — never from the payload.
  if not public.may_open_encounter(p_patient_id, p_practice_location_id) then
    raise exception 'patient not found' using errcode = '42501';
  end if;

  /**
   * A linked appointment must agree on ALL THREE of doctor, patient and
   * location. Otherwise an encounter could attach itself to someone else's
   * appointment and inherit its operational context.
   */
  if p_appointment_id is not null then
    select * into v_appt from public.appointments where id = p_appointment_id;
    if not found
       or v_appt.owner_doctor_id      is distinct from v_doctor
       or v_appt.patient_id           is distinct from p_patient_id
       or v_appt.practice_location_id is distinct from p_practice_location_id then
      raise exception 'appointment not found' using errcode = '42501';
    end if;

    /**
     * The consultation must ALREADY have been started from the queue. Without
     * this, a clinical draft could be opened against an appointment that was
     * cancelled, never attended, or finished last month — a record of a
     * consultation that operationally never happened.
     *
     * This function does NOT move the appointment. Stage 4's state machine owns
     * that transition, and a second way into IN_CONSULTATION is precisely the
     * duplicated lifecycle ADR 0010 refuses.
     *
     * Deliberately distinct from 'appointment not found': the caller has
     * already been proved the owner, so they can see this status anyway. Naming
     * it discloses nothing and tells them what to do — start the consultation.
     */
    if v_appt.status <> 'IN_CONSULTATION' then
      raise exception 'APPOINTMENT_NOT_IN_CONSULTATION' using errcode = '22023';
    end if;
  end if;

  /**
   * Serialise on the identity key before looking, so two simultaneous opens
   * cannot both find nothing and both insert. "Check then insert in one
   * transaction" does not serialise two transactions.
   *
   * The unscheduled key carries the LOCATION, matching the unique index — a
   * lock on (doctor, patient) alone would serialise two different chambers
   * against each other for no reason, and would not serialise the thing the
   * index actually protects.
   */
  perform pg_advisory_xact_lock(hashtextextended(
    coalesce(
      p_appointment_id::text,
      v_doctor::text || '|' || p_patient_id::text || '|' || p_practice_location_id::text
    ), 0));

  if p_appointment_id is not null then
    select id into v_id from public.encounters
     where appointment_id = p_appointment_id and status = 'DRAFT';
  else
    -- Scoped to THIS location: a draft open at another location is a different
    -- occasion and must never be resumed here.
    select id into v_id from public.encounters
     where owner_doctor_id = v_doctor and patient_id = p_patient_id
       and practice_location_id = p_practice_location_id
       and appointment_id is null and status = 'DRAFT';
  end if;

  if v_id is not null then
    return v_id;                      -- resume; this is what the doctor meant
  end if;

  insert into public.encounters (
    owner_doctor_id, patient_id, practice_location_id, appointment_id, created_by
  ) values (
    v_doctor, p_patient_id, p_practice_location_id, p_appointment_id, auth.uid()
  )
  returning id into v_id;

  insert into public.encounter_events (encounter_id, event_type, detail, actor_id)
  values (v_id, 'CREATED',
          jsonb_build_object('appointmentLinked', p_appointment_id is not null),
          auth.uid());

  -- Operational trail: ids and field names only, never clinical values.
  insert into public.audit_events (
    practice_location_id, actor_id, action, resource_type, resource_id, meta
  ) values (
    p_practice_location_id, auth.uid(), 'encounter.created', 'encounter', v_id,
    jsonb_build_object('appointmentLinked', p_appointment_id is not null)
  );

  return v_id;
end;
$$;

revoke all on function public.open_encounter(uuid, uuid, uuid) from public, anon;
grant execute on function public.open_encounter(uuid, uuid, uuid) to authenticated;

/**
 * The seventeen-parameter positional version, where NULL meant "unchanged" and
 * a vital could therefore never be removed. DROPPED, not left beside the new
 * one: an old overload that still has EXECUTE is still a way in, and callers
 * would keep resolving to it by arity without anyone noticing.
 */
drop function if exists public.save_encounter_sections(
  uuid, uuid, integer, text, text, text, text, text, text,
  numeric, numeric, numeric, integer, integer, integer, integer, integer);

/**
 * Save the free-text sections and vitals.
 *
 * Takes a PATCH: absent means untouched, a value sets, JSON null clears. See
 * the contract at the top of this file.
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
    'chiefComplaints', 'presentIllness', 'pastHistory',
    'examination', 'assessment', 'advice',
    'vitalHeightCm', 'vitalWeightKg', 'vitalTemperatureC', 'vitalPulseBpm',
    'vitalSystolic', 'vitalDiastolic', 'vitalRespRate', 'vitalSpo2']);

  perform public.encounter_for_update(p_encounter_id, p_practice_location_id, p_expected_version);

  select array_agg(k order by k) into v_fields from jsonb_object_keys(p_patch) as k;

  /**
   * The unqualified column on the right of each `=` is the row's CURRENT value,
   * which is what "absent means untouched" needs.
   */
  update public.encounters set
    chief_complaints    = public.patch_text(p_patch, 'chiefComplaints', chief_complaints),
    present_illness     = public.patch_text(p_patch, 'presentIllness', present_illness),
    past_history        = public.patch_text(p_patch, 'pastHistory', past_history),
    examination         = public.patch_text(p_patch, 'examination', examination),
    assessment          = public.patch_text(p_patch, 'assessment', assessment),
    advice              = public.patch_text(p_patch, 'advice', advice),
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

  return v_next;
end;
$$;

revoke all on function public.save_encounter_sections(uuid, uuid, integer, jsonb)
  from public, anon;
grant execute on function public.save_encounter_sections(uuid, uuid, integer, jsonb)
  to authenticated;

-- -----------------------------------------------------------------------------
-- Diagnoses
-- -----------------------------------------------------------------------------
create or replace function public.add_encounter_diagnosis(
  p_encounter_id         uuid,
  p_practice_location_id uuid,
  p_expected_version     integer,
  p_label                text,
  p_certainty            public.diagnosis_certainty default 'PROVISIONAL',
  p_note                 text default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_id   uuid;
  v_pos  integer;
  v_next integer;
begin
  perform public.encounter_for_update(p_encounter_id, p_practice_location_id, p_expected_version);

  if p_label is null or btrim(p_label) = '' then
    raise exception 'a diagnosis needs a name' using errcode = '22023';
  end if;

  -- Appended in order; the row lock above makes the read-then-write safe.
  select coalesce(max(position), 0) + 1 into v_pos
  from public.encounter_diagnoses where encounter_id = p_encounter_id;

  insert into public.encounter_diagnoses (encounter_id, label, certainty, note, position)
  values (p_encounter_id, btrim(p_label), coalesce(p_certainty, 'PROVISIONAL'),
          nullif(btrim(coalesce(p_note, '')), ''), v_pos)
  returning id into v_id;

  update public.encounters set version = version + 1, updated_at = now()
   where id = p_encounter_id returning version into v_next;

  insert into public.encounter_events (encounter_id, event_type, detail, actor_id)
  values (p_encounter_id, 'DIAGNOSIS_ADDED',
          jsonb_build_object('diagnosisId', v_id, 'label', btrim(p_label),
                             'position', v_pos, 'version', v_next),
          auth.uid());

  return v_id;
end;
$$;

revoke all on function public.add_encounter_diagnosis(
  uuid, uuid, integer, text, public.diagnosis_certainty, text) from public, anon;
grant execute on function public.add_encounter_diagnosis(
  uuid, uuid, integer, text, public.diagnosis_certainty, text) to authenticated;

/**
 * Correct an existing diagnosis IN PLACE.
 *
 * Remove-and-re-add is not the same thing: it changes the row's identity, moves
 * it to the end of the list, and reads in the history as a diagnosis withdrawn
 * and a different one raised. A doctor fixing a typo in "Dengue fever" did
 * neither of those.
 *
 * `label` and `certainty` cannot be cleared — a diagnosis without a name is not
 * a diagnosis. `note` can.
 */
create or replace function public.update_encounter_diagnosis(
  p_encounter_id         uuid,
  p_practice_location_id uuid,
  p_expected_version     integer,
  p_diagnosis_id         uuid,
  p_patch                jsonb
)
returns integer
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_fields    text[];
  v_label     text;
  v_certainty public.diagnosis_certainty;
  v_next      integer;

begin
  perform public.assert_patch_shape(p_patch, array['label', 'certainty', 'note']);

  if p_patch ? 'label' then
    v_label := public.patch_text(p_patch, 'label', null);
    if v_label is null then
      raise exception 'a diagnosis needs a name' using errcode = '22023';
    end if;
  end if;

  if p_patch ? 'certainty' then
    -- Checked against the enum explicitly. A bare cast would surface Postgres's
    -- own "invalid input value for enum" text, which is not a contract the UI
    -- should ever be shown or have to parse.
    if jsonb_typeof(p_patch -> 'certainty') <> 'string'
       or not (p_patch ->> 'certainty' = any (
            enum_range(null::public.diagnosis_certainty)::text[])) then
      raise exception 'PATCH_INVALID' using errcode = '22023';
    end if;
    v_certainty := (p_patch ->> 'certainty')::public.diagnosis_certainty;
  end if;

  perform public.encounter_for_update(p_encounter_id, p_practice_location_id, p_expected_version);

  -- Scoped to the encounter: an id alone must not reach another consultation.
  -- `position` is deliberately untouched, so the row keeps its place.
  update public.encounter_diagnoses set
    label      = case when p_patch ? 'label'     then v_label     else label end,
    certainty  = case when p_patch ? 'certainty' then v_certainty else certainty end,
    note       = public.patch_text(p_patch, 'note', note),
    updated_at = now()
  where id = p_diagnosis_id and encounter_id = p_encounter_id;

  /**
   * `found`, not a RETURNING variable. `returning true into v_found` leaves
   * v_found NULL when nothing matched, and `if not NULL` is NULL — so the
   * branch never runs and a scoping violation returns SUCCESS having changed
   * nothing. This function guards exactly that case; it must not be the thing
   * that fails silently.
   */
  if not found then
    raise exception 'diagnosis not found' using errcode = '42501';
  end if;

  update public.encounters set version = version + 1, updated_at = now()
   where id = p_encounter_id returning version into v_next;

  select array_agg(k order by k) into v_fields from jsonb_object_keys(p_patch) as k;

  insert into public.encounter_events (encounter_id, event_type, detail, actor_id)
  values (p_encounter_id, 'DIAGNOSIS_UPDATED',
          jsonb_build_object('diagnosisId', p_diagnosis_id,
                             'fields', to_jsonb(v_fields), 'version', v_next),
          auth.uid());

  return v_next;
end;
$$;

revoke all on function public.update_encounter_diagnosis(uuid, uuid, integer, uuid, jsonb)
  from public, anon;
grant execute on function public.update_encounter_diagnosis(uuid, uuid, integer, uuid, jsonb)
  to authenticated;

create or replace function public.remove_encounter_diagnosis(
  p_encounter_id         uuid,
  p_practice_location_id uuid,
  p_expected_version     integer,
  p_diagnosis_id         uuid
)
returns integer
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_removed public.encounter_diagnoses%rowtype;
  v_next    integer;
begin
  perform public.encounter_for_update(p_encounter_id, p_practice_location_id, p_expected_version);

  -- Scoped to the encounter: an id alone must not reach another consultation.
  delete from public.encounter_diagnoses
   where id = p_diagnosis_id and encounter_id = p_encounter_id
  returning * into v_removed;

  if not found then
    raise exception 'diagnosis not found' using errcode = '42501';
  end if;

  -- Close the gap so ordering stays 1..n and stable for the prescription later.
  update public.encounter_diagnoses
     set position = position - 1, updated_at = now()
   where encounter_id = p_encounter_id and position > v_removed.position;

  update public.encounters set version = version + 1, updated_at = now()
   where id = p_encounter_id returning version into v_next;

  insert into public.encounter_events (encounter_id, event_type, detail, actor_id)
  values (p_encounter_id, 'DIAGNOSIS_REMOVED',
          jsonb_build_object('diagnosisId', p_diagnosis_id, 'label', v_removed.label,
                             'version', v_next),
          auth.uid());

  return v_next;
end;
$$;

revoke all on function public.remove_encounter_diagnosis(uuid, uuid, integer, uuid)
  from public, anon;
grant execute on function public.remove_encounter_diagnosis(uuid, uuid, integer, uuid)
  to authenticated;

-- -----------------------------------------------------------------------------
-- Investigations
-- -----------------------------------------------------------------------------
create or replace function public.add_encounter_investigation(
  p_encounter_id         uuid,
  p_practice_location_id uuid,
  p_expected_version     integer,
  p_name                 text,
  p_note                 text default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_id   uuid;
  v_pos  integer;
  v_next integer;
begin
  perform public.encounter_for_update(p_encounter_id, p_practice_location_id, p_expected_version);

  if p_name is null or btrim(p_name) = '' then
    raise exception 'an investigation needs a name' using errcode = '22023';
  end if;

  select coalesce(max(position), 0) + 1 into v_pos
  from public.encounter_investigations where encounter_id = p_encounter_id;

  insert into public.encounter_investigations (encounter_id, name, note, position)
  values (p_encounter_id, btrim(p_name), nullif(btrim(coalesce(p_note, '')), ''), v_pos)
  returning id into v_id;

  update public.encounters set version = version + 1, updated_at = now()
   where id = p_encounter_id returning version into v_next;

  insert into public.encounter_events (encounter_id, event_type, detail, actor_id)
  values (p_encounter_id, 'INVESTIGATION_ADDED',
          jsonb_build_object('investigationId', v_id, 'name', btrim(p_name),
                             'position', v_pos, 'version', v_next),
          auth.uid());

  return v_id;
end;
$$;

revoke all on function public.add_encounter_investigation(uuid, uuid, integer, text, text)
  from public, anon;
grant execute on function public.add_encounter_investigation(uuid, uuid, integer, text, text)
  to authenticated;

/**
 * Correct an existing investigation IN PLACE — same reasoning as diagnoses.
 * `name` cannot be cleared; `note` can.
 */
create or replace function public.update_encounter_investigation(
  p_encounter_id         uuid,
  p_practice_location_id uuid,
  p_expected_version     integer,
  p_investigation_id     uuid,
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
  v_name   text;
  v_next   integer;

begin
  perform public.assert_patch_shape(p_patch, array['name', 'note']);

  if p_patch ? 'name' then
    v_name := public.patch_text(p_patch, 'name', null);
    if v_name is null then
      raise exception 'an investigation needs a name' using errcode = '22023';
    end if;
  end if;

  perform public.encounter_for_update(p_encounter_id, p_practice_location_id, p_expected_version);

  update public.encounter_investigations set
    name       = case when p_patch ? 'name' then v_name else name end,
    note       = public.patch_text(p_patch, 'note', note),
    updated_at = now()
  where id = p_investigation_id and encounter_id = p_encounter_id;

  -- `found`, not a RETURNING variable — see update_encounter_diagnosis.
  if not found then
    raise exception 'investigation not found' using errcode = '42501';
  end if;

  update public.encounters set version = version + 1, updated_at = now()
   where id = p_encounter_id returning version into v_next;

  select array_agg(k order by k) into v_fields from jsonb_object_keys(p_patch) as k;

  insert into public.encounter_events (encounter_id, event_type, detail, actor_id)
  values (p_encounter_id, 'INVESTIGATION_UPDATED',
          jsonb_build_object('investigationId', p_investigation_id,
                             'fields', to_jsonb(v_fields), 'version', v_next),
          auth.uid());

  return v_next;
end;
$$;

revoke all on function public.update_encounter_investigation(uuid, uuid, integer, uuid, jsonb)
  from public, anon;
grant execute on function public.update_encounter_investigation(uuid, uuid, integer, uuid, jsonb)
  to authenticated;

create or replace function public.remove_encounter_investigation(
  p_encounter_id         uuid,
  p_practice_location_id uuid,
  p_expected_version     integer,
  p_investigation_id     uuid
)
returns integer
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_removed public.encounter_investigations%rowtype;
  v_next    integer;
begin
  perform public.encounter_for_update(p_encounter_id, p_practice_location_id, p_expected_version);

  delete from public.encounter_investigations
   where id = p_investigation_id and encounter_id = p_encounter_id
  returning * into v_removed;

  if not found then
    raise exception 'investigation not found' using errcode = '42501';
  end if;

  update public.encounter_investigations
     set position = position - 1, updated_at = now()
   where encounter_id = p_encounter_id and position > v_removed.position;

  update public.encounters set version = version + 1, updated_at = now()
   where id = p_encounter_id returning version into v_next;

  insert into public.encounter_events (encounter_id, event_type, detail, actor_id)
  values (p_encounter_id, 'INVESTIGATION_REMOVED',
          jsonb_build_object('investigationId', p_investigation_id, 'name', v_removed.name,
                             'version', v_next),
          auth.uid());

  return v_next;
end;
$$;

revoke all on function public.remove_encounter_investigation(uuid, uuid, integer, uuid)
  from public, anon;
grant execute on function public.remove_encounter_investigation(uuid, uuid, integer, uuid)
  to authenticated;

-- -----------------------------------------------------------------------------
-- Terminal transitions
-- -----------------------------------------------------------------------------

/**
 * Finish or abandon the consultation.
 *
 * Both are terminal: after this, clinical mutation is refused. Stage 9 adds the
 * immutable snapshot and the amendment path — this only closes the draft, and
 * deliberately does NOT touch the appointment, whose status is owned by Stage 4.
 */
create or replace function public.close_encounter(
  p_encounter_id         uuid,
  p_practice_location_id uuid,
  p_expected_version     integer,
  p_status               public.encounter_status
)
returns public.encounter_status
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  if p_status not in ('COMPLETED', 'CANCELLED') then
    raise exception 'an encounter can only be completed or cancelled'
      using errcode = '22023';
  end if;

  perform public.encounter_for_update(p_encounter_id, p_practice_location_id, p_expected_version);

  update public.encounters set
    status       = p_status,
    completed_at = case when p_status = 'COMPLETED' then now() else completed_at end,
    version      = version + 1,
    updated_at   = now()
  where id = p_encounter_id;

  insert into public.encounter_events (encounter_id, event_type, detail, actor_id)
  values (p_encounter_id,
          (case when p_status = 'COMPLETED' then 'COMPLETED' else 'CANCELLED' end)
            ::public.encounter_event_type,
          '{}'::jsonb, auth.uid());

  insert into public.audit_events (
    practice_location_id, actor_id, action, resource_type, resource_id, meta
  ) values (
    p_practice_location_id, auth.uid(), 'encounter.closed', 'encounter', p_encounter_id,
    jsonb_build_object('status', p_status)
  );

  return p_status;
end;
$$;

revoke all on function public.close_encounter(uuid, uuid, integer, public.encounter_status)
  from public, anon;
grant execute on function public.close_encounter(uuid, uuid, integer, public.encounter_status)
  to authenticated;
