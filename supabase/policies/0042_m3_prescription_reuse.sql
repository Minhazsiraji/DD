-- ---------------------------------------------------------------------------
-- M3-BF-01 — atomic/idempotent historical prescription reuse.
--
-- Additive after frozen 0041. A FINALIZED source is read canonically; a DRAFT
-- target is locked through the existing M2 prescription_for_update() CAS. The
-- source is never modified and a correction successor can never be populated
-- by this path.
-- ---------------------------------------------------------------------------

create table if not exists public.prescription_reuse_operations (
  id                     uuid primary key default gen_random_uuid(),
  actor_profile_id       uuid not null,
  doctor_profile_id      uuid not null,
  source_prescription_id uuid not null,
  target_prescription_id uuid not null,
  practice_location_id   uuid not null,
  idempotency_key        text not null,
  request_fingerprint    text not null,
  expected_version       integer not null,
  result_version         integer not null,
  inserted_count         integer not null check (inserted_count > 0),
  result                 jsonb not null,
  created_at             timestamptz not null default clock_timestamp(),
  constraint prescription_reuse_idempotency_key_length
    check (char_length(idempotency_key) between 8 and 128),
  constraint prescription_reuse_actor_key_unique
    unique (actor_profile_id, idempotency_key),
  constraint prescription_reuse_source_fk
    foreign key (source_prescription_id) references public.prescriptions(id) on delete restrict,
  constraint prescription_reuse_target_fk
    foreign key (target_prescription_id) references public.prescriptions(id) on delete restrict
);

create index if not exists prescription_reuse_target_created_idx
  on public.prescription_reuse_operations (target_prescription_id, created_at desc);

alter table public.prescription_reuse_operations enable row level security;
alter table public.prescription_reuse_operations force row level security;

-- Durable receipt state is internal to the SECURITY DEFINER transaction. It is
-- not a browser read/write surface and service_role is not a DD shortcut.
revoke all on public.prescription_reuse_operations
  from public, anon, authenticated, service_role;

create or replace function public.reuse_finalized_prescription_items(
  p_source_prescription_id uuid,
  p_target_prescription_id uuid,
  p_practice_location_id   uuid,
  p_expected_version       integer,
  p_copy_mode              text,
  p_selected_item_ids      uuid[] default null,
  p_append_confirmed       boolean default false,
  p_idempotency_key        text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor              uuid := auth.uid();
  v_doctor             uuid := public.current_doctor_id();
  v_target             public.prescriptions%rowtype;
  v_source             public.prescriptions%rowtype;
  v_mode               text := upper(btrim(coalesce(p_copy_mode, '')));
  v_key                text := btrim(coalesce(p_idempotency_key, ''));
  v_selected           uuid[] := '{}'::uuid[];
  v_selected_count     integer := 0;
  v_selected_distinct  integer := 0;
  v_source_match_count integer := 0;
  v_source_items       jsonb := '[]'::jsonb;
  v_target_count       integer := 0;
  v_base_position      integer := 0;
  v_inserted_count     integer := 0;
  v_inserted           jsonb := '[]'::jsonb;
  v_next_version       integer;
  v_request            jsonb;
  v_fingerprint        text;
  v_existing           public.prescription_reuse_operations%rowtype;
  v_result             jsonb;
begin
  if v_actor is null or v_doctor is null then
    raise exception 'only an authenticated doctor can reuse a prescription'
      using errcode = '42501';
  end if;

  if char_length(v_key) < 8 or char_length(v_key) > 128 then
    raise exception 'INVALID_IDEMPOTENCY_KEY' using errcode = '22023';
  end if;

  if p_expected_version is null or p_expected_version < 1 then
    raise exception 'INVALID_EXPECTED_VERSION' using errcode = '22023';
  end if;

  if v_mode not in ('ALL', 'SELECTED') then
    raise exception 'INVALID_REUSE_MODE' using errcode = '22023';
  end if;

  select coalesce(array_agg(x order by x), '{}'::uuid[]),
         count(*)::integer,
         count(distinct x)::integer
    into v_selected, v_selected_count, v_selected_distinct
  from unnest(coalesce(p_selected_item_ids, '{}'::uuid[])) as u(x);

  if v_selected_count <> v_selected_distinct then
    raise exception 'DUPLICATE_SELECTED_ITEM_ID' using errcode = '22023';
  end if;
  if v_mode = 'SELECTED' and v_selected_count = 0 then
    raise exception 'SELECTED_ITEMS_REQUIRED' using errcode = '22023';
  end if;
  if v_mode = 'ALL' and v_selected_count <> 0 then
    raise exception 'SELECTED_ITEMS_NOT_ALLOWED_FOR_ALL' using errcode = '22023';
  end if;

  -- Selection order is not authority: source position is. Sorting the ids makes
  -- semantically identical retries produce the same canonical fingerprint.
  v_request := jsonb_build_object(
    'sourcePrescriptionId', p_source_prescription_id,
    'targetPrescriptionId', p_target_prescription_id,
    'practiceLocationId', p_practice_location_id,
    'expectedVersion', p_expected_version,
    'copyMode', v_mode,
    'selectedItemIds', to_jsonb(v_selected),
    'appendConfirmed', coalesce(p_append_confirmed, false)
  );
  v_fingerprint := encode(sha256(convert_to(v_request::text, 'UTF8')), 'hex');

  -- One actor+key is one logical request, including a response-loss retry that
  -- arrives while the original transaction is still completing.
  perform pg_advisory_xact_lock(
    hashtextextended('rx:reuse:key:' || v_actor::text || ':' || v_key, 0)
  );

  select * into v_existing
  from public.prescription_reuse_operations
  where actor_profile_id = v_actor and idempotency_key = v_key;

  if found then
    if v_existing.request_fingerprint is distinct from v_fingerprint then
      raise exception 'IDEMPOTENCY_KEY_CONFLICT' using errcode = 'P0001';
    end if;
    return v_existing.result;
  end if;

  -- Existing frozen M2 helper is the target authority/CAS. It locks the row,
  -- verifies Doctor ownership, current destination location, DRAFT status,
  -- active practice at that location and exact expected version.
  select * into v_target
  from public.prescription_for_update(
    p_target_prescription_id,
    p_practice_location_id,
    p_expected_version
  );

  if v_target.replaces_prescription_id is not null then
    raise exception 'CORRECTION_SUCCESSOR_REUSE_FORBIDDEN' using errcode = 'P0001';
  end if;

  -- Cross-location source history is legitimate for the same Doctor. Source
  -- location therefore is NOT compared with the current destination location.
  select * into v_source
  from public.prescriptions
  where id = p_source_prescription_id;

  if not found
     or v_source.owner_doctor_id is distinct from v_doctor
     or v_source.patient_id is distinct from v_target.patient_id
     or v_source.status <> 'FINALIZED' then
    raise exception 'source prescription not found' using errcode = '42501';
  end if;

  if v_source.finalized_at is null
     or v_source.review_digest is null
     or v_source.snapshot_schema_version is null
     or v_source.review_bundle_snapshot is null then
    raise exception 'PRESCRIPTION_FINALIZATION_STATE_INVALID' using errcode = 'P0001';
  end if;

  -- The selected item ids live on the row model, but the medicine values being
  -- reused must still be the exact immutable values the Doctor finalized. M2's
  -- browser write path already refuses FINALIZED mutation; this comparison also
  -- fails closed if privileged/manual drift ever made live item rows disagree
  -- with the frozen approved review bundle.
  select coalesce(jsonb_agg(to_jsonb(i) order by i.position), '[]'::jsonb)
    into v_source_items
  from (
    select position, display_name, brand_name, generic_name, strength_text,
           dose_text, dosage_form, route, schedule_text, duration_text,
           quantity_text, food_relation, is_prn, instructions,
           substitution_allowed
    from public.prescription_items
    where prescription_id = v_source.id
  ) i;

  if v_source_items is distinct from (v_source.review_bundle_snapshot -> 'items') then
    raise exception 'PRESCRIPTION_FINALIZATION_STATE_INVALID' using errcode = 'P0001';
  end if;

  if v_mode = 'SELECTED' then
    select count(*)::integer into v_source_match_count
    from public.prescription_items i
    where i.prescription_id = v_source.id and i.id = any(v_selected);

    if v_source_match_count <> v_selected_count then
      raise exception 'SELECTED_ITEM_NOT_IN_SOURCE' using errcode = '42501';
    end if;
  else
    select count(*)::integer into v_source_match_count
    from public.prescription_items i
    where i.prescription_id = v_source.id;

    if v_source_match_count = 0 then
      raise exception 'SOURCE_PRESCRIPTION_EMPTY' using errcode = '22023';
    end if;
  end if;

  select count(*)::integer, coalesce(max(position), 0)::integer
    into v_target_count, v_base_position
  from public.prescription_items
  where prescription_id = v_target.id;

  if v_target_count > 0 and not coalesce(p_append_confirmed, false) then
    raise exception 'APPEND_CONFIRMATION_REQUIRED' using errcode = 'P0001';
  end if;

  -- One INSERT ... SELECT is the all-or-nothing clinical copy. New UUIDs are
  -- generated for every destination item; source order is preserved; selected
  -- mode never trusts client order; existing target rows remain before copies.
  with chosen as (
    select i.*,
           row_number() over (order by i.position, i.id)::integer as ordinal
    from public.prescription_items i
    where i.prescription_id = v_source.id
      and (v_mode = 'ALL' or i.id = any(v_selected))
  ), inserted as (
    insert into public.prescription_items (
      id, prescription_id, display_name, brand_name, generic_name, strength_text,
      dose_text, dosage_form, route, schedule_text, duration_text, quantity_text,
      food_relation, is_prn, instructions, substitution_allowed, position
    )
    select gen_random_uuid(), v_target.id,
           c.display_name, c.brand_name, c.generic_name, c.strength_text,
           c.dose_text, c.dosage_form, c.route, c.schedule_text, c.duration_text,
           c.quantity_text, c.food_relation, c.is_prn, c.instructions,
           c.substitution_allowed, v_base_position + c.ordinal
    from chosen c
    order by c.ordinal
    returning id, position
  )
  select count(*)::integer,
         coalesce(
           jsonb_agg(jsonb_build_object('itemId', id, 'position', position)
                     order by position),
           '[]'::jsonb
         )
    into v_inserted_count, v_inserted
  from inserted;

  if v_inserted_count = 0 then
    raise exception 'SOURCE_PRESCRIPTION_EMPTY' using errcode = '22023';
  end if;

  update public.prescriptions
  set version = version + 1, updated_at = now()
  where id = v_target.id
  returning version into v_next_version;

  -- Doctor-only clinical history may retain source lineage; operational audit
  -- below deliberately does not expose source Rx id or medicine content.
  insert into public.prescription_events (prescription_id, event_type, detail, actor_id)
  select v_target.id,
         'ITEM_ADDED'::public.prescription_event_type,
         jsonb_build_object(
           'itemId', e.value -> 'itemId',
           'position', (e.value ->> 'position')::integer,
           'version', v_next_version,
           'reusedFromPrescriptionId', v_source.id
         ),
         v_actor
  from jsonb_array_elements(v_inserted) as e(value);

  perform public.log_prescription_audit(
    v_target.id,
    p_practice_location_id,
    'prescription.items_reused',
    jsonb_build_object(
      'copyMode', v_mode,
      'insertedCount', v_inserted_count,
      'version', v_next_version
    )
  );

  v_result := jsonb_build_object(
    'targetPrescriptionId', v_target.id,
    'version', v_next_version,
    'insertedCount', v_inserted_count
  );

  insert into public.prescription_reuse_operations (
    actor_profile_id, doctor_profile_id,
    source_prescription_id, target_prescription_id, practice_location_id,
    idempotency_key, request_fingerprint, expected_version,
    result_version, inserted_count, result
  ) values (
    v_actor, v_doctor,
    v_source.id, v_target.id, p_practice_location_id,
    v_key, v_fingerprint, p_expected_version,
    v_next_version, v_inserted_count, v_result
  );

  return v_result;
end;
$$;

revoke all on function public.reuse_finalized_prescription_items(
  uuid, uuid, uuid, integer, text, uuid[], boolean, text
) from public, anon, authenticated, service_role;
grant execute on function public.reuse_finalized_prescription_items(
  uuid, uuid, uuid, integer, text, uuid[], boolean, text
) to authenticated;
