-- ---------------------------------------------------------------------------
-- M3 Prescription V2 backend foundation.
--
-- Additive only. Frozen 0041 correction behavior is intentionally untouched.
-- This file provides three bounded surfaces:
--   1. atomic/idempotent reuse of immutable FINALIZED prescription items;
--   2. truthful Recent/Frequent signed-medicine history semantics;
--   3. durable two-stage native-print operational audit.
-- ---------------------------------------------------------------------------

-- =============================================================================
-- M3-BF-01 — historical prescription reuse
-- =============================================================================

create table if not exists public.prescription_reuse_operations (
  id                   uuid primary key default gen_random_uuid(),
  actor_profile_id     uuid not null,
  doctor_profile_id    uuid not null,
  source_prescription_id uuid not null,
  target_prescription_id uuid not null,
  practice_location_id uuid not null,
  idempotency_key      text not null,
  request_fingerprint  text not null,
  expected_version     integer not null,
  result_version       integer not null,
  inserted_count       integer not null check (inserted_count > 0),
  result               jsonb not null,
  created_at           timestamptz not null default clock_timestamp(),
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

-- The receipt is transaction/idempotency state, never a browser data surface.
revoke all on public.prescription_reuse_operations
  from public, anon, authenticated, service_role;

create or replace function public.reuse_finalized_prescription_items(
  p_source_prescription_id uuid,
  p_target_prescription_id uuid,
  p_practice_location_id uuid,
  p_expected_version integer,
  p_copy_mode text,
  p_selected_item_ids uuid[] default null,
  p_append_confirmed boolean default false,
  p_idempotency_key text default null
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

  -- Selection order is not authority: source position is. Sort ids only to make
  -- semantically identical retries fingerprint identically.
  v_request := jsonb_build_object(
    'sourcePrescriptionId', p_source_prescription_id,
    'targetPrescriptionId', p_target_prescription_id,
    'practiceLocationId', p_practice_location_id,
    'expectedVersion', p_expected_version,
    'copyMode', v_mode,
    'selectedItemIds', to_jsonb(v_selected),
    'appendConfirmed', coalesce(p_append_confirmed, false)
  );
  v_fingerprint := encode(digest(v_request::text, 'sha256'), 'hex');

  -- Same actor+key is one operation. This lock also makes response-loss retries
  -- deterministic while the original transaction is still completing.
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

  -- Existing M2 helper is the authoritative destination CAS. It locks the row,
  -- proves current Doctor ownership, current operational location, DRAFT state,
  -- current practice membership and expected version.
  select * into v_target
  from public.prescription_for_update(
    p_target_prescription_id,
    p_practice_location_id,
    p_expected_version
  );

  -- A correction successor is deliberately blank and may never be populated by
  -- whole/selected historical reuse.
  if v_target.replaces_prescription_id is not null then
    raise exception 'CORRECTION_SUCCESSOR_REUSE_FORBIDDEN' using errcode = 'P0001';
  end if;

  -- Source is re-read canonically. Cross-location Doctor history is allowed;
  -- only ownership, same patient and immutable valid finalization are relevant.
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

  -- One INSERT ... SELECT preserves source position order, generates entirely
  -- new ids, and copies medicine fields only. No finalization/signature/digest/
  -- lineage metadata exists on an item and no source id is reused.
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
         coalesce(jsonb_agg(jsonb_build_object('itemId', id, 'position', position)
                            order by position), '[]'::jsonb)
    into v_inserted_count, v_inserted
  from inserted;

  if v_inserted_count = 0 then
    raise exception 'SOURCE_PRESCRIPTION_EMPTY' using errcode = '22023';
  end if;

  update public.prescriptions
  set version = version + 1, updated_at = now()
  where id = v_target.id
  returning version into v_next_version;

  -- Keep the existing doctor-only clinical event stream truthful: each newly
  -- created line is an ITEM_ADDED event, while the aggregate version advances
  -- exactly once for the atomic reuse operation.
  insert into public.prescription_events (prescription_id, event_type, detail, actor_id)
  select v_target.id,
         'ITEM_ADDED'::public.prescription_event_type,
         jsonb_build_object(
           'itemId', e.value ->> 'itemId',
           'position', (e.value ->> 'position')::integer,
           'version', v_next_version,
           'reusedFromPrescriptionId', v_source.id
         ),
         v_actor
  from jsonb_array_elements(v_inserted) as e(value);

  -- Location administrators may read operational audit, so never put medicine
  -- names/doses or the cross-location source prescription id in it.
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

-- =============================================================================
-- M3-BF-02 — Recent / Frequent signed medicine history
-- =============================================================================

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
  with history as (
    select i.*,
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
      and (
        v_q is null
        or i.display_name ilike '%' || v_q || '%'
        or i.brand_name ilike '%' || v_q || '%'
        or i.generic_name ilike '%' || v_q || '%'
      )
  ), ranked as (
    select h.*,
           row_number() over (
             partition by h.normalized_name
             order by h.finalized_at desc, h.source_prescription_id desc,
                      h.position asc, h.id asc
           ) as wording_rank,
           max(h.finalized_at) over (partition by h.normalized_name) as latest_use,
           count(distinct h.source_prescription_id) over (
             partition by h.normalized_name
           )::integer as distinct_rx_count
    from history h
  )
  select r.display_name, r.brand_name, r.generic_name, r.strength_text,
         r.dose_text, r.dosage_form, r.route, r.schedule_text, r.duration_text,
         r.quantity_text, r.food_relation, r.is_prn, r.instructions,
         r.substitution_allowed, r.latest_use, r.distinct_rx_count
  from ranked r
  where r.wording_rank = 1
  order by
    case when v_order = 'RECENT' then r.latest_use end desc,
    case when v_order = 'RECENT' then r.distinct_rx_count end desc,
    case when v_order = 'FREQUENT' then r.distinct_rx_count end desc,
    case when v_order = 'FREQUENT' then r.latest_use end desc,
    r.normalized_name asc
  limit greatest(1, least(coalesce(p_limit, 8), 25));
end;
$$;

revoke all on function public.prescription_signed_medicine_history(text, text, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.prescription_signed_medicine_history(text, text, integer)
  to authenticated;

-- =============================================================================
-- M3-BF-03 — durable two-stage native-print operations
-- =============================================================================

create table if not exists public.prescription_print_operations (
  id                            uuid primary key default gen_random_uuid(),
  prescription_id               uuid not null,
  finalized_prescription_version integer not null,
  snapshot_schema_version       integer not null,
  review_digest                 text not null,
  practice_location_id          uuid not null,
  actor_profile_id              uuid not null,
  actor_display_name            text not null,
  actor_display_ref             text not null,
  authorization_basis           text not null,
  doctor_profile_id             uuid,
  practice_membership_id        uuid,
  initiated_at                  timestamptz not null default clock_timestamp(),
  confirmed_at                  timestamptz,
  confirmed_copy_count          integer,
  idempotency_key               text not null,
  request_fingerprint           text not null,
  constraint prescription_print_prescription_fk
    foreign key (prescription_id) references public.prescriptions(id) on delete restrict,
  constraint prescription_print_authorization_basis
    check (authorization_basis in ('DOCTOR_OWNER', 'LOCATION_STAFF')),
  constraint prescription_print_authority_shape
    check (
      (authorization_basis = 'DOCTOR_OWNER'
       and doctor_profile_id is not null and practice_membership_id is null)
      or
      (authorization_basis = 'LOCATION_STAFF'
       and doctor_profile_id is null and practice_membership_id is not null)
    ),
  constraint prescription_print_confirmation_shape
    check (
      (confirmed_at is null and confirmed_copy_count is null)
      or
      (confirmed_at is not null and confirmed_copy_count between 1 and 100)
    ),
  constraint prescription_print_idempotency_key_length
    check (char_length(idempotency_key) between 8 and 128),
  constraint prescription_print_actor_key_unique
    unique (actor_profile_id, idempotency_key)
);

create index if not exists prescription_print_rx_initiated_idx
  on public.prescription_print_operations (prescription_id, initiated_at desc);
create index if not exists prescription_print_location_initiated_idx
  on public.prescription_print_operations (practice_location_id, initiated_at desc);

alter table public.prescription_print_operations enable row level security;
alter table public.prescription_print_operations force row level security;

-- No browser CRUD. Reads and writes are bounded RPCs below.
revoke all on public.prescription_print_operations
  from public, anon, authenticated, service_role;

create or replace function public.initiate_prescription_print(
  p_prescription_id uuid,
  p_practice_location_id uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor       uuid := auth.uid();
  v_doctor      uuid := public.current_doctor_id();
  v_key         text := btrim(coalesce(p_idempotency_key, ''));
  v_rx          public.prescriptions%rowtype;
  v_profile_name text;
  v_basis       text;
  v_membership  uuid;
  v_display_ref text;
  v_request     jsonb;
  v_fingerprint text;
  v_existing    public.prescription_print_operations%rowtype;
  v_operation   uuid;
  v_result      jsonb;
begin
  if v_actor is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if char_length(v_key) < 8 or char_length(v_key) > 128 then
    raise exception 'INVALID_IDEMPOTENCY_KEY' using errcode = '22023';
  end if;

  v_request := jsonb_build_object(
    'prescriptionId', p_prescription_id,
    'practiceLocationId', p_practice_location_id
  );
  v_fingerprint := encode(digest(v_request::text, 'sha256'), 'hex');

  perform pg_advisory_xact_lock(
    hashtextextended('rx:print:key:' || v_actor::text || ':' || v_key, 0)
  );

  select * into v_existing
  from public.prescription_print_operations
  where actor_profile_id = v_actor and idempotency_key = v_key;

  if found then
    if v_existing.request_fingerprint is distinct from v_fingerprint then
      raise exception 'IDEMPOTENCY_KEY_CONFLICT' using errcode = 'P0001';
    end if;
    return jsonb_build_object(
      'operationId', v_existing.id,
      'prescriptionId', v_existing.prescription_id,
      'initiatedAt', v_existing.initiated_at,
      'confirmedAt', v_existing.confirmed_at,
      'confirmedCopyCount', v_existing.confirmed_copy_count
    );
  end if;

  select * into v_rx
  from public.prescriptions
  where id = p_prescription_id
    and practice_location_id = p_practice_location_id;

  if not found
     or v_rx.status <> 'FINALIZED'
     or v_rx.finalized_at is null
     or v_rx.review_digest is null
     or v_rx.snapshot_schema_version is null
     or v_rx.review_bundle_snapshot is null then
    raise exception 'prescription not found' using errcode = '42501';
  end if;

  -- The current frozen runtime has no selectable Identity Context. Record only
  -- the authority it can prove now: owner Doctor or exact-location staff.
  if v_doctor is not null and v_rx.owner_doctor_id = v_doctor then
    v_basis := 'DOCTOR_OWNER';
    v_display_ref := 'DOC-' || upper(substr(encode(digest(v_doctor::text, 'sha256'), 'hex'), 1, 8));
  else
    if not public.may_hand_over_prescription(v_rx.id) then
      raise exception 'prescription not found' using errcode = '42501';
    end if;

    select m.id into v_membership
    from public.practice_location_members m
    where m.practice_location_id = v_rx.practice_location_id
      and m.user_id = v_actor
      and m.status = 'ACTIVE'
      and m.role in (
        'RECEPTIONIST'::public.location_role,
        'LOCATION_ADMIN'::public.location_role
      )
    order by m.role::text, m.id
    limit 1;

    if v_membership is null then
      raise exception 'prescription not found' using errcode = '42501';
    end if;

    v_basis := 'LOCATION_STAFF';
    -- Display-only opaque membership reference. It is not authority and it does
    -- not expose the auth UUID.
    v_display_ref := 'MEM-' || upper(substr(encode(digest(v_membership::text, 'sha256'), 'hex'), 1, 8));
  end if;

  select nullif(btrim(full_name), '') into v_profile_name
  from public.profiles where id = v_actor;
  if v_profile_name is null then
    raise exception 'actor profile not found' using errcode = '42501';
  end if;

  insert into public.prescription_print_operations (
    prescription_id,
    finalized_prescription_version,
    snapshot_schema_version,
    review_digest,
    practice_location_id,
    actor_profile_id,
    actor_display_name,
    actor_display_ref,
    authorization_basis,
    doctor_profile_id,
    practice_membership_id,
    idempotency_key,
    request_fingerprint
  ) values (
    v_rx.id,
    v_rx.version,
    v_rx.snapshot_schema_version,
    v_rx.review_digest,
    v_rx.practice_location_id,
    v_actor,
    v_profile_name,
    v_display_ref,
    v_basis,
    case when v_basis = 'DOCTOR_OWNER' then v_doctor else null end,
    case when v_basis = 'LOCATION_STAFF' then v_membership else null end,
    v_key,
    v_fingerprint
  )
  returning id into v_operation;

  perform public.log_prescription_audit(
    v_rx.id,
    v_rx.practice_location_id,
    'prescription.print_initiated',
    jsonb_build_object('printOperationId', v_operation, 'authorizationBasis', v_basis)
  );

  select jsonb_build_object(
    'operationId', o.id,
    'prescriptionId', o.prescription_id,
    'initiatedAt', o.initiated_at,
    'confirmedAt', o.confirmed_at,
    'confirmedCopyCount', o.confirmed_copy_count
  ) into v_result
  from public.prescription_print_operations o
  where o.id = v_operation;

  return v_result;
end;
$$;

revoke all on function public.initiate_prescription_print(uuid, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.initiate_prescription_print(uuid, uuid, text)
  to authenticated;

create or replace function public.confirm_prescription_print(
  p_operation_id uuid,
  p_copy_count integer
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor      uuid := auth.uid();
  v_operation  public.prescription_print_operations%rowtype;
  v_rx         public.prescriptions%rowtype;
  v_result     jsonb;
begin
  if v_actor is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_copy_count is null or p_copy_count < 1 or p_copy_count > 100 then
    raise exception 'INVALID_PRINT_COPY_COUNT' using errcode = '22023';
  end if;

  select * into v_operation
  from public.prescription_print_operations
  where id = p_operation_id
  for update;

  if not found or v_operation.actor_profile_id is distinct from v_actor then
    raise exception 'print operation not found' using errcode = '42501';
  end if;

  -- Response-loss retry after a successful confirmation is idempotent. A later
  -- contradictory count is not allowed to rewrite operational history.
  if v_operation.confirmed_at is not null then
    if v_operation.confirmed_copy_count = p_copy_count then
      return jsonb_build_object(
        'operationId', v_operation.id,
        'prescriptionId', v_operation.prescription_id,
        'initiatedAt', v_operation.initiated_at,
        'confirmedAt', v_operation.confirmed_at,
        'confirmedCopyCount', v_operation.confirmed_copy_count
      );
    end if;
    raise exception 'PRINT_CONFIRMATION_CONFLICT' using errcode = 'P0001';
  end if;

  select * into v_rx
  from public.prescriptions
  where id = v_operation.prescription_id
    and practice_location_id = v_operation.practice_location_id;

  if not found
     or v_rx.status <> 'FINALIZED'
     or v_rx.version is distinct from v_operation.finalized_prescription_version
     or v_rx.snapshot_schema_version is distinct from v_operation.snapshot_schema_version
     or v_rx.review_digest is distinct from v_operation.review_digest then
    raise exception 'PRINT_FINALIZED_REFERENCE_INVALID' using errcode = 'P0001';
  end if;

  -- Re-prove the same authority path at confirmation time. Revocation leaves
  -- the operation truthfully initiated/unconfirmed.
  if v_operation.authorization_basis = 'DOCTOR_OWNER' then
    if public.current_doctor_id() is distinct from v_operation.doctor_profile_id
       or v_rx.owner_doctor_id is distinct from v_operation.doctor_profile_id then
      raise exception 'PRINT_AUTHORITY_REVOKED' using errcode = '42501';
    end if;
  elsif v_operation.authorization_basis = 'LOCATION_STAFF' then
    if not exists (
      select 1 from public.practice_location_members m
      where m.id = v_operation.practice_membership_id
        and m.practice_location_id = v_operation.practice_location_id
        and m.user_id = v_actor
        and m.status = 'ACTIVE'
        and m.role in (
          'RECEPTIONIST'::public.location_role,
          'LOCATION_ADMIN'::public.location_role
        )
    ) or not public.may_hand_over_prescription(v_rx.id) then
      raise exception 'PRINT_AUTHORITY_REVOKED' using errcode = '42501';
    end if;
  else
    raise exception 'PRINT_AUTHORITY_INVALID' using errcode = 'P0001';
  end if;

  update public.prescription_print_operations
  set confirmed_at = clock_timestamp(),
      confirmed_copy_count = p_copy_count
  where id = v_operation.id
  returning * into v_operation;

  perform public.log_prescription_audit(
    v_rx.id,
    v_operation.practice_location_id,
    'prescription.print_confirmed',
    jsonb_build_object(
      'printOperationId', v_operation.id,
      'confirmedCopyCount', p_copy_count,
      'authorizationBasis', v_operation.authorization_basis
    )
  );

  v_result := jsonb_build_object(
    'operationId', v_operation.id,
    'prescriptionId', v_operation.prescription_id,
    'initiatedAt', v_operation.initiated_at,
    'confirmedAt', v_operation.confirmed_at,
    'confirmedCopyCount', v_operation.confirmed_copy_count
  );
  return v_result;
end;
$$;

revoke all on function public.confirm_prescription_print(uuid, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.confirm_prescription_print(uuid, integer)
  to authenticated;

create or replace function public.prescription_print_history(
  p_prescription_id uuid,
  p_practice_location_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor       uuid := auth.uid();
  v_doctor      uuid := public.current_doctor_id();
  v_rx          public.prescriptions%rowtype;
  v_membership  uuid;
  v_latest_init jsonb;
  v_latest_conf jsonb;
  v_operations  jsonb;
  v_total       integer;
begin
  if v_actor is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select * into v_rx
  from public.prescriptions
  where id = p_prescription_id
    and practice_location_id = p_practice_location_id
    and status = 'FINALIZED';

  if not found then
    raise exception 'prescription not found' using errcode = '42501';
  end if;

  if not (v_doctor is not null and v_rx.owner_doctor_id = v_doctor) then
    if not public.may_hand_over_prescription(v_rx.id) then
      raise exception 'prescription not found' using errcode = '42501';
    end if;

    select m.id into v_membership
    from public.practice_location_members m
    where m.practice_location_id = v_rx.practice_location_id
      and m.user_id = v_actor
      and m.status = 'ACTIVE'
      and m.role in (
        'RECEPTIONIST'::public.location_role,
        'LOCATION_ADMIN'::public.location_role
      )
    order by m.role::text, m.id
    limit 1;

    if v_membership is null then
      raise exception 'prescription not found' using errcode = '42501';
    end if;
  end if;

  select jsonb_build_object(
    'operationId', o.id,
    'initiatedAt', o.initiated_at,
    'confirmedAt', o.confirmed_at,
    'confirmedCopyCount', o.confirmed_copy_count,
    'actorName', o.actor_display_name,
    'actorDisplayId', o.actor_display_ref,
    'authorizationBasis', o.authorization_basis
  ) into v_latest_init
  from public.prescription_print_operations o
  where o.prescription_id = v_rx.id
  order by o.initiated_at desc, o.id desc
  limit 1;

  select jsonb_build_object(
    'operationId', o.id,
    'initiatedAt', o.initiated_at,
    'confirmedAt', o.confirmed_at,
    'confirmedCopyCount', o.confirmed_copy_count,
    'actorName', o.actor_display_name,
    'actorDisplayId', o.actor_display_ref,
    'authorizationBasis', o.authorization_basis
  ) into v_latest_conf
  from public.prescription_print_operations o
  where o.prescription_id = v_rx.id and o.confirmed_at is not null
  order by o.confirmed_at desc, o.id desc
  limit 1;

  select coalesce(sum(o.confirmed_copy_count), 0)::integer into v_total
  from public.prescription_print_operations o
  where o.prescription_id = v_rx.id and o.confirmed_at is not null;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'operationId', o.id,
        'initiatedAt', o.initiated_at,
        'confirmedAt', o.confirmed_at,
        'confirmedCopyCount', o.confirmed_copy_count,
        'actorName', o.actor_display_name,
        'actorDisplayId', o.actor_display_ref,
        'authorizationBasis', o.authorization_basis
      ) order by o.initiated_at desc, o.id desc
    ),
    '[]'::jsonb
  ) into v_operations
  from public.prescription_print_operations o
  where o.prescription_id = v_rx.id;

  return jsonb_build_object(
    'prescriptionId', v_rx.id,
    'latestInitiation', coalesce(v_latest_init, 'null'::jsonb),
    'latestConfirmedPrint', coalesce(v_latest_conf, 'null'::jsonb),
    'totalConfirmedCopies', v_total,
    'operations', v_operations
  );
end;
$$;

revoke all on function public.prescription_print_history(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.prescription_print_history(uuid, uuid)
  to authenticated;
