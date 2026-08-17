-- =============================================================================
-- Prescription writes. These functions ARE the write path.
--
-- Each is SECURITY DEFINER with a pinned search_path and restates every rule it
-- bypasses. Each writes its prescription_event AND its operational audit row in
-- the same transaction, so the record and its history cannot disagree.
--
-- The prescription carries its OWN version. It never reads or increments
-- `encounters.version` (ADR 0011 §1).
-- =============================================================================

/**
 * The operational trail for one prescription mutation.
 *
 * IDs, action, version, field names. NEVER a medicine name, dose, schedule or
 * instruction — which drug a patient was given is clinical, and this table is
 * readable by location administrators.
 */
create or replace function public.log_prescription_audit(
  p_prescription_id      uuid,
  p_practice_location_id uuid,
  p_action               text,
  p_meta                 jsonb
)
returns void
language sql
volatile
security definer
set search_path = public, pg_temp
as $$
  insert into public.audit_events (
    practice_location_id, actor_id, action, resource_type, resource_id, meta
  ) values (
    p_practice_location_id, auth.uid(), p_action, 'prescription', p_prescription_id,
    coalesce(p_meta, '{}'::jsonb)
  );
$$;

revoke all on function public.log_prescription_audit(uuid, uuid, text, jsonb)
  from public, anon, authenticated;

/**
 * Load a DRAFT prescription for mutation, having proved the caller may.
 *
 * Locks the single row for the rest of the transaction. Ungranted: reachable
 * only from the write functions below.
 */
create or replace function public.prescription_for_update(
  target            uuid,
  expected_location uuid,
  expected_version  integer
)
returns public.prescriptions
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_rx public.prescriptions%rowtype;
begin
  select * into v_rx from public.prescriptions where id = target for update;

  -- One answer for missing, not-yours and elsewhere alike: which prescription
  -- ids exist and who holds them is not something to probe for.
  if not found
     or v_rx.owner_doctor_id is distinct from public.current_doctor_id()
     or v_rx.practice_location_id is distinct from expected_location then
    raise exception 'prescription not found' using errcode = '42501';
  end if;

  /**
   * Owning it is not enough — the doctor must still PRACTISE here.
   *
   * A doctor who has left a hospital keeps their patients and their records,
   * but must not go on writing and signing prescriptions on that hospital's
   * paper. Ownership plus a location id the caller supplied would have let
   * them.
   */
  if not public.doctor_practises_at(v_rx.owner_doctor_id, expected_location) then
    raise exception 'prescription not found' using errcode = '42501';
  end if;

  -- A finalised prescription is never reopened. Corrections are a NEW
  -- prescription linked to this one (ADR 0011 §3).
  if v_rx.status <> 'DRAFT' then
    raise exception 'PRESCRIPTION_NOT_DRAFT' using errcode = '22023';
  end if;

  /**
   * Stale-tab guard. NOT SQLSTATE 40001 — that means "serialization failure,
   * retrying may succeed", and PostgREST retries it. This refusal is
   * deterministic and must be answered by a human, not by a retry loop.
   */
  if expected_version is not null and v_rx.version <> expected_version then
    raise exception 'PRESCRIPTION_VERSION_CONFLICT';
  end if;

  return v_rx;
end;
$$;

revoke all on function public.prescription_for_update(uuid, uuid, integer)
  from public, anon, authenticated;

/**
 * Start a prescription for an encounter, or RESUME the one already open.
 *
 * IDENTITY IS DERIVED, NEVER SUPPLIED. The caller names an encounter; the
 * doctor, patient and location are read FROM IT. A caller is never asked for
 * them, so it can never name someone else's.
 *
 * If the encounter already has a FINALIZED prescription, the new draft must
 * continue that chain — one logical prescription per encounter for the pilot.
 */
create or replace function public.open_prescription(
  p_encounter_id         uuid,
  p_practice_location_id uuid,
  p_replacement_reason   text default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_doctor uuid := public.current_doctor_id();
  v_enc    public.encounters%rowtype;
  v_id     uuid;
  v_latest public.prescriptions%rowtype;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if v_doctor is null then
    raise exception 'only a doctor can write a prescription' using errcode = '42501';
  end if;

  select * into v_enc from public.encounters where id = p_encounter_id;
  if not found
     or v_enc.owner_doctor_id is distinct from v_doctor
     or v_enc.practice_location_id is distinct from p_practice_location_id then
    raise exception 'encounter not found' using errcode = '42501';
  end if;

  -- Serialise on the encounter before looking, so two simultaneous opens cannot
  -- both find nothing and both insert.
  perform pg_advisory_xact_lock(hashtextextended('rx:' || p_encounter_id::text, 0));

  select id into v_id from public.prescriptions
   where encounter_id = p_encounter_id and status = 'DRAFT';
  if v_id is not null then
    return v_id;                    -- resume; this is what the doctor meant
  end if;

  /**
   * A finalised prescription already exists, so this is a CORRECTION. It must
   * point at the newest finalised link and carry a reason — otherwise an
   * encounter grows parallel prescriptions and nobody can say which one the
   * patient is holding.
   */
  select * into v_latest from public.prescriptions
   where encounter_id = p_encounter_id and status = 'FINALIZED'
     and not exists (
       select 1 from public.prescriptions r where r.replaces_prescription_id = prescriptions.id
     )
   order by finalized_at desc
   limit 1;

  if found and nullif(btrim(coalesce(p_replacement_reason, '')), '') is null then
    raise exception 'PRESCRIPTION_REPLACEMENT_NEEDS_REASON' using errcode = '22023';
  end if;

  insert into public.prescriptions (
    encounter_id, owner_doctor_id, patient_id, practice_location_id,
    replaces_prescription_id, replacement_reason, created_by
  ) values (
    p_encounter_id, v_enc.owner_doctor_id, v_enc.patient_id, v_enc.practice_location_id,
    v_latest.id, nullif(btrim(coalesce(p_replacement_reason, '')), ''), auth.uid()
  )
  returning id into v_id;

  insert into public.prescription_events (prescription_id, event_type, detail, actor_id)
  values (
    v_id,
    case when v_latest.id is null then 'CREATED' else 'REPLACEMENT_STARTED' end
      ::public.prescription_event_type,
    jsonb_build_object('encounterId', p_encounter_id, 'replaces', v_latest.id),
    auth.uid()
  );

  perform public.log_prescription_audit(
    v_id, p_practice_location_id,
    case when v_latest.id is null then 'prescription.created' else 'prescription.replacement_started' end,
    jsonb_build_object('encounterId', p_encounter_id, 'replaces', v_latest.id));

  return v_id;
end;
$$;

revoke all on function public.open_prescription(uuid, uuid, text) from public, anon;
grant execute on function public.open_prescription(uuid, uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- Items
-- -----------------------------------------------------------------------------

/** The fields a caller may set. One representation per concept — no parallel
 *  structured schedule to disagree with the printable one (ADR 0011 §5). */
create or replace function public.prescription_item_fields()
returns text[]
language sql
immutable
as $$
  select array[
    'displayName', 'brandName', 'genericName', 'strengthText', 'doseText',
    'dosageForm', 'route', 'scheduleText', 'durationText', 'quantityText',
    'foodRelation', 'isPrn', 'instructions', 'substitutionAllowed']::text[];
$$;

revoke all on function public.prescription_item_fields() from public, anon, authenticated;

create or replace function public.add_prescription_item(
  p_prescription_id      uuid,
  p_practice_location_id uuid,
  p_expected_version     integer,
  p_patch                jsonb
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
  v_name text;
begin
  perform public.assert_patch_shape(p_patch, public.prescription_item_fields());

  v_name := public.patch_text(p_patch, 'displayName', null);
  if v_name is null then
    raise exception 'a medicine needs a name' using errcode = '22023';
  end if;

  perform public.prescription_for_update(p_prescription_id, p_practice_location_id, p_expected_version);

  select coalesce(max(position), 0) + 1 into v_pos
  from public.prescription_items where prescription_id = p_prescription_id;

  insert into public.prescription_items (
    prescription_id, display_name, brand_name, generic_name, strength_text,
    dose_text, dosage_form, route, schedule_text, duration_text, quantity_text,
    food_relation, is_prn, instructions, substitution_allowed, position
  ) values (
    p_prescription_id,
    v_name,
    public.patch_text(p_patch, 'brandName', null),
    public.patch_text(p_patch, 'genericName', null),
    public.patch_text(p_patch, 'strengthText', null),
    public.patch_text(p_patch, 'doseText', null),
    public.patch_text(p_patch, 'dosageForm', null),
    public.patch_text(p_patch, 'route', null),
    public.patch_text(p_patch, 'scheduleText', null),
    public.patch_text(p_patch, 'durationText', null),
    public.patch_text(p_patch, 'quantityText', null),
    public.patch_text(p_patch, 'foodRelation', null),
    coalesce(public.patch_bool(p_patch, 'isPrn', false), false),
    public.patch_text(p_patch, 'instructions', null),
    coalesce(public.patch_bool(p_patch, 'substitutionAllowed', true), true),
    v_pos
  )
  returning id into v_id;

  update public.prescriptions set version = version + 1, updated_at = now()
   where id = p_prescription_id returning version into v_next;

  -- Clinical history: doctor-only, so the medicine may be named here.
  insert into public.prescription_events (prescription_id, event_type, detail, actor_id)
  values (p_prescription_id, 'ITEM_ADDED',
          jsonb_build_object('itemId', v_id, 'displayName', v_name,
                             'position', v_pos, 'version', v_next),
          auth.uid());

  -- Operational: THAT a line was added. Never WHICH medicine.
  perform public.log_prescription_audit(
    p_prescription_id, p_practice_location_id, 'prescription.item_added',
    jsonb_build_object('itemId', v_id, 'position', v_pos, 'version', v_next));

  return v_id;
end;
$$;

revoke all on function public.add_prescription_item(uuid, uuid, integer, jsonb) from public, anon;
grant execute on function public.add_prescription_item(uuid, uuid, integer, jsonb) to authenticated;

create or replace function public.update_prescription_item(
  p_prescription_id      uuid,
  p_practice_location_id uuid,
  p_expected_version     integer,
  p_item_id              uuid,
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
  perform public.assert_patch_shape(p_patch, public.prescription_item_fields());

  if p_patch ? 'displayName' then
    v_name := public.patch_text(p_patch, 'displayName', null);
    if v_name is null then
      raise exception 'a medicine needs a name' using errcode = '22023';
    end if;
  end if;

  perform public.prescription_for_update(p_prescription_id, p_practice_location_id, p_expected_version);

  -- Scoped to the prescription: an id alone must not reach another one.
  -- `position` is deliberately untouched, so the line keeps its place.
  update public.prescription_items set
    display_name         = case when p_patch ? 'displayName' then v_name else display_name end,
    brand_name           = public.patch_text(p_patch, 'brandName', brand_name),
    generic_name         = public.patch_text(p_patch, 'genericName', generic_name),
    strength_text        = public.patch_text(p_patch, 'strengthText', strength_text),
    dose_text            = public.patch_text(p_patch, 'doseText', dose_text),
    dosage_form          = public.patch_text(p_patch, 'dosageForm', dosage_form),
    route                = public.patch_text(p_patch, 'route', route),
    schedule_text        = public.patch_text(p_patch, 'scheduleText', schedule_text),
    duration_text        = public.patch_text(p_patch, 'durationText', duration_text),
    quantity_text        = public.patch_text(p_patch, 'quantityText', quantity_text),
    food_relation        = public.patch_text(p_patch, 'foodRelation', food_relation),
    is_prn               = coalesce(public.patch_bool(p_patch, 'isPrn', is_prn), is_prn),
    instructions         = public.patch_text(p_patch, 'instructions', instructions),
    substitution_allowed = coalesce(
      public.patch_bool(p_patch, 'substitutionAllowed', substitution_allowed), substitution_allowed),
    updated_at           = now()
  where id = p_item_id and prescription_id = p_prescription_id;

  -- `found`, not a RETURNING variable: `returning true into v` leaves NULL when
  -- nothing matched, and `if not NULL` never runs — a scoping violation would
  -- return success having changed nothing.
  if not found then
    raise exception 'medicine not found' using errcode = '42501';
  end if;

  update public.prescriptions set version = version + 1, updated_at = now()
   where id = p_prescription_id returning version into v_next;

  select array_agg(k order by k) into v_fields from jsonb_object_keys(p_patch) as k;

  insert into public.prescription_events (prescription_id, event_type, detail, actor_id)
  values (p_prescription_id, 'ITEM_UPDATED',
          jsonb_build_object('itemId', p_item_id, 'fields', to_jsonb(v_fields),
                             'version', v_next),
          auth.uid());

  perform public.log_prescription_audit(
    p_prescription_id, p_practice_location_id, 'prescription.item_updated',
    jsonb_build_object('itemId', p_item_id, 'fields', to_jsonb(v_fields), 'version', v_next));

  return v_next;
end;
$$;

revoke all on function public.update_prescription_item(uuid, uuid, integer, uuid, jsonb)
  from public, anon;
grant execute on function public.update_prescription_item(uuid, uuid, integer, uuid, jsonb)
  to authenticated;

create or replace function public.remove_prescription_item(
  p_prescription_id      uuid,
  p_practice_location_id uuid,
  p_expected_version     integer,
  p_item_id              uuid
)
returns integer
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_removed public.prescription_items%rowtype;
  v_next    integer;
begin
  perform public.prescription_for_update(p_prescription_id, p_practice_location_id, p_expected_version);

  delete from public.prescription_items
   where id = p_item_id and prescription_id = p_prescription_id
  returning * into v_removed;

  if not found then
    raise exception 'medicine not found' using errcode = '42501';
  end if;

  -- Close the gap so ordering stays 1..n — the order a doctor wrote the lines
  -- in is part of the prescription.
  update public.prescription_items
     set position = position - 1, updated_at = now()
   where prescription_id = p_prescription_id and position > v_removed.position;

  update public.prescriptions set version = version + 1, updated_at = now()
   where id = p_prescription_id returning version into v_next;

  insert into public.prescription_events (prescription_id, event_type, detail, actor_id)
  values (p_prescription_id, 'ITEM_REMOVED',
          jsonb_build_object('itemId', p_item_id, 'displayName', v_removed.display_name,
                             'version', v_next),
          auth.uid());

  perform public.log_prescription_audit(
    p_prescription_id, p_practice_location_id, 'prescription.item_removed',
    jsonb_build_object('itemId', p_item_id, 'version', v_next));

  return v_next;
end;
$$;

revoke all on function public.remove_prescription_item(uuid, uuid, integer, uuid) from public, anon;
grant execute on function public.remove_prescription_item(uuid, uuid, integer, uuid) to authenticated;

/** Reordering is a clinical act — "take this one first" is an instruction. */
create or replace function public.move_prescription_item(
  p_prescription_id      uuid,
  p_practice_location_id uuid,
  p_expected_version     integer,
  p_item_id              uuid,
  p_to_position          integer
)
returns integer
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_from  integer;
  v_count integer;
  v_next  integer;
begin
  perform public.prescription_for_update(p_prescription_id, p_practice_location_id, p_expected_version);

  select position into v_from from public.prescription_items
   where id = p_item_id and prescription_id = p_prescription_id;
  if v_from is null then
    raise exception 'medicine not found' using errcode = '42501';
  end if;

  select count(*) into v_count from public.prescription_items
   where prescription_id = p_prescription_id;

  if p_to_position < 1 or p_to_position > v_count then
    raise exception 'POSITION_OUT_OF_RANGE' using errcode = '22023';
  end if;

  if p_to_position <> v_from then
    -- Park it outside the range first: the unique-ish ordering would otherwise
    -- collide with itself mid-shuffle.
    update public.prescription_items set position = 0 where id = p_item_id;

    if p_to_position < v_from then
      update public.prescription_items set position = position + 1, updated_at = now()
       where prescription_id = p_prescription_id
         and position >= p_to_position and position < v_from;
    else
      update public.prescription_items set position = position - 1, updated_at = now()
       where prescription_id = p_prescription_id
         and position > v_from and position <= p_to_position;
    end if;

    update public.prescription_items set position = p_to_position, updated_at = now()
     where id = p_item_id;
  end if;

  update public.prescriptions set version = version + 1, updated_at = now()
   where id = p_prescription_id returning version into v_next;

  insert into public.prescription_events (prescription_id, event_type, detail, actor_id)
  values (p_prescription_id, 'ITEM_MOVED',
          jsonb_build_object('itemId', p_item_id, 'from', v_from, 'to', p_to_position,
                             'version', v_next),
          auth.uid());

  perform public.log_prescription_audit(
    p_prescription_id, p_practice_location_id, 'prescription.item_moved',
    jsonb_build_object('itemId', p_item_id, 'from', v_from, 'to', p_to_position,
                       'version', v_next));

  return v_next;
end;
$$;

revoke all on function public.move_prescription_item(uuid, uuid, integer, uuid, integer)
  from public, anon;
grant execute on function public.move_prescription_item(uuid, uuid, integer, uuid, integer)
  to authenticated;

