-- ---------------------------------------------------------------------------
-- M3-BF-03 — durable operational prescription print history.
--
-- Permanent semantic rule:
--   PRINT_INITIATED != PRINT_CONFIRMED
-- Opening the native browser print dialog is not proof that paper was printed.
-- This ledger never changes the finalized prescription or its correction chain.
-- ---------------------------------------------------------------------------

create table if not exists public.prescription_print_operations (
  id                             uuid primary key default gen_random_uuid(),
  prescription_id                uuid not null,
  finalized_prescription_version integer not null,
  snapshot_schema_version        integer not null,
  review_digest                  text not null,
  practice_location_id           uuid not null,
  actor_profile_id               uuid not null,
  actor_display_name             text not null,
  actor_display_ref              text not null,
  authorization_basis            text not null,
  doctor_profile_id              uuid,
  practice_membership_id         uuid,
  initiated_at                   timestamptz not null default clock_timestamp(),
  confirmed_at                   timestamptz,
  confirmed_copy_count           integer,
  idempotency_key                text not null,
  request_fingerprint            text not null,
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

-- No direct browser CRUD or read. The RPCs below are the entire surface. A
-- bypass-RLS service role still has no table privilege and no RPC EXECUTE grant.
revoke all on public.prescription_print_operations
  from public, anon, authenticated, service_role;

/**
 * Guard the operational ledger itself against accidental future widening.
 * Initiation identity/reference fields never change. Confirmation may move once
 * from NULL/NULL to timestamp/count and never be rewritten afterwards.
 */
create or replace function public.guard_prescription_print_operation_update()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.id is distinct from old.id
     or new.prescription_id is distinct from old.prescription_id
     or new.finalized_prescription_version is distinct from old.finalized_prescription_version
     or new.snapshot_schema_version is distinct from old.snapshot_schema_version
     or new.review_digest is distinct from old.review_digest
     or new.practice_location_id is distinct from old.practice_location_id
     or new.actor_profile_id is distinct from old.actor_profile_id
     or new.actor_display_name is distinct from old.actor_display_name
     or new.actor_display_ref is distinct from old.actor_display_ref
     or new.authorization_basis is distinct from old.authorization_basis
     or new.doctor_profile_id is distinct from old.doctor_profile_id
     or new.practice_membership_id is distinct from old.practice_membership_id
     or new.initiated_at is distinct from old.initiated_at
     or new.idempotency_key is distinct from old.idempotency_key
     or new.request_fingerprint is distinct from old.request_fingerprint then
    raise exception 'PRINT_OPERATION_IMMUTABLE' using errcode = 'P0001';
  end if;

  if old.confirmed_at is not null
     and (new.confirmed_at is distinct from old.confirmed_at
          or new.confirmed_copy_count is distinct from old.confirmed_copy_count) then
    raise exception 'PRINT_CONFIRMATION_IMMUTABLE' using errcode = 'P0001';
  end if;

  if old.confirmed_at is null then
    if (new.confirmed_at is null) <> (new.confirmed_copy_count is null) then
      raise exception 'PRINT_CONFIRMATION_INVALID' using errcode = 'P0001';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.guard_prescription_print_operation_update()
  from public, anon, authenticated, service_role;

drop trigger if exists prescription_print_operations_update_guard
  on public.prescription_print_operations;
create trigger prescription_print_operations_update_guard
before update on public.prescription_print_operations
for each row execute function public.guard_prescription_print_operation_update();

create or replace function public.initiate_prescription_print(
  p_prescription_id      uuid,
  p_practice_location_id uuid,
  p_idempotency_key      text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor        uuid := auth.uid();
  v_doctor       uuid := public.current_doctor_id();
  v_key          text := btrim(coalesce(p_idempotency_key, ''));
  v_rx           public.prescriptions%rowtype;
  v_profile_name text;
  v_basis        text;
  v_membership   uuid;
  v_display_ref  text;
  v_request      jsonb;
  v_fingerprint  text;
  v_existing     public.prescription_print_operations%rowtype;
  v_operation    uuid;
  v_result       jsonb;
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
  v_fingerprint := encode(sha256(convert_to(v_request::text, 'UTF8')), 'hex');

  perform pg_advisory_xact_lock(
    hashtextextended('rx:print:key:' || v_actor::text || ':' || v_key, 0)
  );

  select * into v_existing
  from public.prescription_print_operations
  where actor_profile_id = v_actor and idempotency_key = v_key;

  -- A response-loss retry returns the already-recorded initiation. It does not
  -- create a fresh print operation and therefore need not re-authorize a write
  -- that already happened.
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

  -- No Identity Context is invented here. Record only the authority the frozen
  -- M2 server can prove now: owning Doctor, or exact-location handover staff.
  if v_doctor is not null and v_rx.owner_doctor_id = v_doctor then
    v_basis := 'DOCTOR_OWNER';
    v_display_ref := 'DOC-' || upper(substr(
      encode(sha256(convert_to(v_doctor::text, 'UTF8')), 'hex'), 1, 8));
  else
    if not public.may_hand_over_prescription(v_rx.id) then
      raise exception 'prescription not found' using errcode = '42501';
    end if;

    -- Frozen M2 marks superseded sheets as unsafe for handover. A Doctor may
    -- still print their own historical record, but location staff may not open
    -- a new handover-print operation for a superseded prescription.
    if exists (
      select 1 from public.prescriptions r
      where r.replaces_prescription_id = v_rx.id
    ) then
      raise exception 'SUPERSEDED_PRESCRIPTION_HANDOVER_FORBIDDEN'
        using errcode = '42501';
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
    v_display_ref := 'MEM-' || upper(substr(
      encode(sha256(convert_to(v_membership::text, 'UTF8')), 'hex'), 1, 8));
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
    jsonb_build_object(
      'printOperationId', v_operation,
      'authorizationBasis', v_basis
    )
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
  p_copy_count   integer
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor     uuid := auth.uid();
  v_operation public.prescription_print_operations%rowtype;
  v_rx        public.prescriptions%rowtype;
begin
  if v_actor is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  -- 100 is deliberately finite: it comfortably covers legitimate batch/reprint
  -- scenarios while rejecting accidental huge values and abusive counters.
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

  -- Response-loss retry of a successful confirmation is idempotent. A different
  -- later copy count is an attempted rewrite of operational history.
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

  -- Re-prove the SAME authorization basis at confirmation time. If authority
  -- disappeared after initiation, truth is "initiated / unconfirmed".
  if v_operation.authorization_basis = 'DOCTOR_OWNER' then
    if public.current_doctor_id() is distinct from v_operation.doctor_profile_id
       or v_rx.owner_doctor_id is distinct from v_operation.doctor_profile_id then
      raise exception 'PRINT_AUTHORITY_REVOKED' using errcode = '42501';
    end if;
  elsif v_operation.authorization_basis = 'LOCATION_STAFF' then
    if exists (
      select 1 from public.prescriptions r
      where r.replaces_prescription_id = v_rx.id
    ) then
      raise exception 'PRINT_AUTHORITY_REVOKED' using errcode = '42501';
    end if;

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

  return jsonb_build_object(
    'operationId', v_operation.id,
    'prescriptionId', v_operation.prescription_id,
    'initiatedAt', v_operation.initiated_at,
    'confirmedAt', v_operation.confirmed_at,
    'confirmedCopyCount', v_operation.confirmed_copy_count
  );
end;
$$;

revoke all on function public.confirm_prescription_print(uuid, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.confirm_prescription_print(uuid, integer)
  to authenticated;

create or replace function public.prescription_print_history(
  p_prescription_id      uuid,
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

  -- Doctor print history is longitudinal ownership history: no active-chamber
  -- restriction is added. Staff history remains exact-location handover scope.
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
  where o.prescription_id = v_rx.id
    and o.confirmed_at is not null
  order by o.confirmed_at desc, o.id desc
  limit 1;

  select coalesce(sum(o.confirmed_copy_count), 0)::integer into v_total
  from public.prescription_print_operations o
  where o.prescription_id = v_rx.id
    and o.confirmed_at is not null;

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
