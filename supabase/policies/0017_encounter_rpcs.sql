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
  end if;

  /**
   * Serialise on the identity key before looking, so two simultaneous opens
   * cannot both find nothing and both insert. "Check then insert in one
   * transaction" does not serialise two transactions.
   */
  perform pg_advisory_xact_lock(hashtextextended(
    coalesce(p_appointment_id::text, v_doctor::text || '|' || p_patient_id::text), 0));

  if p_appointment_id is not null then
    select id into v_id from public.encounters
     where appointment_id = p_appointment_id and status = 'DRAFT';
  else
    select id into v_id from public.encounters
     where owner_doctor_id = v_doctor and patient_id = p_patient_id
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
 * Save the free-text sections and vitals.
 *
 * NULL means "leave unchanged"; the empty string means "cleared". Without that
 * distinction a partial save would silently wipe sections the doctor had not
 * touched in this tab.
 */
create or replace function public.save_encounter_sections(
  p_encounter_id         uuid,
  p_practice_location_id uuid,
  p_expected_version     integer,
  p_chief_complaints     text default null,
  p_present_illness      text default null,
  p_past_history         text default null,
  p_examination          text default null,
  p_assessment           text default null,
  p_advice               text default null,
  p_vital_height_cm      numeric default null,
  p_vital_weight_kg      numeric default null,
  p_vital_temperature_c  numeric default null,
  p_vital_pulse_bpm      integer default null,
  p_vital_systolic       integer default null,
  p_vital_diastolic      integer default null,
  p_vital_resp_rate      integer default null,
  p_vital_spo2           integer default null
)
returns integer
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_enc     public.encounters%rowtype;
  v_changed text[] := '{}';
  v_next    integer;
begin
  v_enc := public.encounter_for_update(p_encounter_id, p_practice_location_id, p_expected_version);

  /**
   * array_append, not `||`. With an unknown-typed literal on the right, `||`
   * resolves to array_cat and Postgres tries to parse the section name AS an
   * array — which fails at runtime, not at create time.
   */
  if p_chief_complaints is not null then v_changed := array_append(v_changed, 'chiefComplaints'); end if;
  if p_present_illness  is not null then v_changed := array_append(v_changed, 'presentIllness');  end if;
  if p_past_history     is not null then v_changed := array_append(v_changed, 'pastHistory');     end if;
  if p_examination      is not null then v_changed := array_append(v_changed, 'examination');     end if;
  if p_assessment       is not null then v_changed := array_append(v_changed, 'assessment');      end if;
  if p_advice           is not null then v_changed := array_append(v_changed, 'advice');          end if;

  update public.encounters set
    chief_complaints    = coalesce(p_chief_complaints, chief_complaints),
    present_illness     = coalesce(p_present_illness, present_illness),
    past_history        = coalesce(p_past_history, past_history),
    examination         = coalesce(p_examination, examination),
    assessment          = coalesce(p_assessment, assessment),
    advice              = coalesce(p_advice, advice),
    vital_height_cm     = coalesce(p_vital_height_cm, vital_height_cm),
    vital_weight_kg     = coalesce(p_vital_weight_kg, vital_weight_kg),
    vital_temperature_c = coalesce(p_vital_temperature_c, vital_temperature_c),
    vital_pulse_bpm     = coalesce(p_vital_pulse_bpm, vital_pulse_bpm),
    vital_systolic      = coalesce(p_vital_systolic, vital_systolic),
    vital_diastolic     = coalesce(p_vital_diastolic, vital_diastolic),
    vital_resp_rate     = coalesce(p_vital_resp_rate, vital_resp_rate),
    vital_spo2          = coalesce(p_vital_spo2, vital_spo2),
    version             = version + 1,
    updated_at          = now()
  where id = p_encounter_id
  returning version into v_next;

  -- Clinical history: doctor-only, so section NAMES are safe to record here.
  insert into public.encounter_events (encounter_id, event_type, detail, actor_id)
  values (p_encounter_id, 'SECTIONS_UPDATED',
          jsonb_build_object('sections', to_jsonb(v_changed), 'version', v_next),
          auth.uid());

  return v_next;
end;
$$;

revoke all on function public.save_encounter_sections(
  uuid, uuid, integer, text, text, text, text, text, text,
  numeric, numeric, numeric, integer, integer, integer, integer, integer)
  from public, anon;
grant execute on function public.save_encounter_sections(
  uuid, uuid, integer, text, text, text, text, text, text,
  numeric, numeric, numeric, integer, integer, integer, integer, integer)
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
