-- =============================================================================
-- INV1-BF-01 — Investigation V1 backend foundation.
--
-- Repository-only candidate. This migration must not be applied to the protected
-- DD Supabase project until Central explicitly authorises the remote migration.
--
-- V1 stores ordered/requested investigations only. Quick picks, custom text and
-- AI/voice proposals remain local application state until the Doctor performs
-- one explicit confirmation. The confirmation below is the single atomic write
-- boundary for that staged list.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Durable operation identity for unknown-outcome-safe batch confirmation.
--
-- The table stores no investigation wording or notes. request_hash is a SHA-256
-- digest of the canonical request; the clinical rows remain in
-- encounter_investigations and the operational record contains only identities,
-- counts and versions.
-- -----------------------------------------------------------------------------
create table if not exists public.investigation_confirmation_operations (
  owner_doctor_id      uuid        not null references public.doctor_profiles(id) on delete restrict,
  operation_key        uuid        not null,
  encounter_id         uuid        not null references public.encounters(id) on delete restrict,
  practice_location_id uuid        not null references public.practice_locations(id) on delete restrict,
  expected_version     integer     not null check (expected_version > 0),
  request_hash         text        not null check (char_length(request_hash) = 64),
  result_version       integer     not null,
  confirmed_count      integer     not null check (confirmed_count between 1 and 100),
  created_at           timestamptz not null default clock_timestamp(),

  primary key (owner_doctor_id, operation_key),
  check (result_version = expected_version + 1)
);

create index if not exists investigation_confirmation_operations_encounter_idx
  on public.investigation_confirmation_operations (encounter_id, created_at desc);

alter table public.investigation_confirmation_operations enable row level security;
alter table public.investigation_confirmation_operations force row level security;

-- No direct API surface. The SECURITY DEFINER confirmation function is the only
-- application path to this operational object.
revoke all on public.investigation_confirmation_operations
  from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Atomic Doctor confirmation.
--
-- One call:
--   * authenticates at AAL2;
--   * derives Doctor identity from auth/database state;
--   * proves active Doctor membership at the supplied active location;
--   * serialises duplicate operation keys;
--   * makes compatible replay a no-op;
--   * locks and CAS-checks the encounter once;
--   * inserts every ordered row or none;
--   * advances encounter.version exactly once;
--   * writes the existing per-row clinical event plus one non-clinical audit;
--   * persists the durable replay result in the same transaction.
--
-- Existing add/update/remove investigation RPCs are deliberately untouched so
-- frozen M2 behavior is not broken before CSU replaces the surface.
-- -----------------------------------------------------------------------------
create or replace function public.confirm_encounter_investigations(
  p_encounter_id           uuid,
  p_practice_location_id   uuid,
  p_expected_version       integer,
  p_operation_key          uuid,
  p_rows                   jsonb
)
returns table (
  result_version  integer,
  confirmed_count integer,
  replayed        boolean
)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_doctor       uuid;
  v_item         jsonb;
  v_name         text;
  v_note         text;
  v_normalized   jsonb := '[]'::jsonb;
  v_request_hash text;
  v_operation    public.investigation_confirmation_operations%rowtype;
  v_start_pos    integer;
  v_position     integer;
  v_id           uuid;
  v_next         integer;
  v_count        integer := 0;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  if not public.session_is_aal2() then
    raise exception 'AAL2_REQUIRED' using errcode = '42501';
  end if;

  v_doctor := public.current_doctor_id();
  if v_doctor is null then
    raise exception 'only a doctor can confirm investigations' using errcode = '42501';
  end if;

  if p_encounter_id is null
     or p_practice_location_id is null
     or p_operation_key is null
     or p_expected_version is null
     or p_expected_version <= 0 then
    raise exception 'INVESTIGATION_CONFIRMATION_INVALID' using errcode = '22023';
  end if;

  -- The current write is location-bound. Membership is read from database
  -- authority; no caller-supplied Doctor id is accepted.
  if not public.doctor_practises_at(v_doctor, p_practice_location_id) then
    raise exception 'encounter not found' using errcode = '42501';
  end if;

  if p_rows is null
     or jsonb_typeof(p_rows) <> 'array'
     or jsonb_array_length(p_rows) < 1
     or jsonb_array_length(p_rows) > 100 then
    raise exception 'INVESTIGATION_ROWS_INVALID' using errcode = '22023';
  end if;

  -- Validate and canonicalise the complete staged list BEFORE touching clinical
  -- rows. Extra keys are rejected rather than silently ignored.
  for v_item in select value from jsonb_array_elements(p_rows) as r(value)
  loop
    if jsonb_typeof(v_item) <> 'object'
       or not (v_item ? 'name')
       or jsonb_typeof(v_item -> 'name') <> 'string'
       or exists (
         select 1
         from jsonb_object_keys(v_item) as k(key)
         where k.key not in ('name', 'note')
       ) then
      raise exception 'INVESTIGATION_ROW_INVALID' using errcode = '22023';
    end if;

    v_name := btrim(v_item ->> 'name');
    if v_name = '' or char_length(v_name) > 300 then
      raise exception 'INVESTIGATION_NAME_INVALID' using errcode = '22023';
    end if;

    v_note := null;
    if v_item ? 'note' then
      if jsonb_typeof(v_item -> 'note') = 'null' then
        v_note := null;
      elsif jsonb_typeof(v_item -> 'note') = 'string' then
        v_note := nullif(btrim(v_item ->> 'note'), '');
        if v_note is not null and char_length(v_note) > 2000 then
          raise exception 'INVESTIGATION_NOTE_INVALID' using errcode = '22023';
        end if;
      else
        raise exception 'INVESTIGATION_NOTE_INVALID' using errcode = '22023';
      end if;
    end if;

    v_normalized := v_normalized || jsonb_build_array(
      jsonb_build_object('name', v_name, 'note', v_note)
    );
    v_count := v_count + 1;
  end loop;

  v_request_hash := pg_catalog.encode(
    extensions.digest(
      jsonb_build_object(
        'encounterId', p_encounter_id,
        'practiceLocationId', p_practice_location_id,
        'expectedVersion', p_expected_version,
        'rows', v_normalized
      )::text,
      'sha256'
    ),
    'hex'
  );

  -- Two simultaneous retries with the same operation identity must not both see
  -- "not found" in the operation table. A transaction-scoped advisory lock is
  -- used only to serialize that one Doctor/key pair; the encounter row lock
  -- below remains the clinical mutation lock.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(v_doctor::text),
    pg_catalog.hashtext(p_operation_key::text)
  );

  select * into v_operation
  from public.investigation_confirmation_operations o
  where o.owner_doctor_id = v_doctor
    and o.operation_key = p_operation_key;

  if found then
    if v_operation.encounter_id is distinct from p_encounter_id
       or v_operation.practice_location_id is distinct from p_practice_location_id
       or v_operation.expected_version is distinct from p_expected_version
       or v_operation.request_hash is distinct from v_request_hash then
      raise exception 'INVESTIGATION_OPERATION_KEY_REUSE' using errcode = '22023';
    end if;

    return query
      select v_operation.result_version, v_operation.confirmed_count, true;
    return;
  end if;

  -- Existing helper locks the encounter and fails closed for wrong Doctor,
  -- wrong location, terminal status or stale expected version.
  perform public.encounter_for_update(
    p_encounter_id,
    p_practice_location_id,
    p_expected_version
  );

  select coalesce(max(i.position), 0)
    into v_start_pos
  from public.encounter_investigations i
  where i.encounter_id = p_encounter_id;

  v_position := v_start_pos;

  -- PL/pgSQL function execution is one database transaction. Any failure in
  -- this loop, version advance, event/audit write or operation record rolls the
  -- complete confirmation back.
  for v_item in select value from jsonb_array_elements(v_normalized) as r(value)
  loop
    v_position := v_position + 1;
    v_name := v_item ->> 'name';
    v_note := case
      when jsonb_typeof(v_item -> 'note') = 'null' then null
      else v_item ->> 'note'
    end;

    insert into public.encounter_investigations (
      encounter_id, name, note, position
    ) values (
      p_encounter_id, v_name, v_note, v_position
    )
    returning id into v_id;

    -- Keep the accepted encounter_event enum. Each confirmed row is still an
    -- INVESTIGATION_ADDED clinical event; the shared operationKey ties the
    -- atomic confirmation together without introducing a new event lifecycle.
    insert into public.encounter_events (
      encounter_id, event_type, detail, actor_id
    ) values (
      p_encounter_id,
      'INVESTIGATION_ADDED',
      jsonb_build_object(
        'investigationId', v_id,
        'name', v_name,
        'position', v_position,
        'operationKey', p_operation_key
      ),
      auth.uid()
    );
  end loop;

  update public.encounters
     set version = version + 1,
         updated_at = now()
   where id = p_encounter_id
  returning version into v_next;

  -- Operational audit intentionally contains no investigation wording or note.
  perform public.log_encounter_audit(
    p_encounter_id,
    p_practice_location_id,
    'encounter.investigations_confirmed',
    jsonb_build_object(
      'operationKey', p_operation_key,
      'confirmedCount', v_count,
      'version', v_next
    )
  );

  insert into public.investigation_confirmation_operations (
    owner_doctor_id,
    operation_key,
    encounter_id,
    practice_location_id,
    expected_version,
    request_hash,
    result_version,
    confirmed_count
  ) values (
    v_doctor,
    p_operation_key,
    p_encounter_id,
    p_practice_location_id,
    p_expected_version,
    v_request_hash,
    v_next,
    v_count
  );

  return query select v_next, v_count, false;
end;
$$;

revoke all on function public.confirm_encounter_investigations(uuid, uuid, integer, uuid, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.confirm_encounter_investigations(uuid, uuid, integer, uuid, jsonb)
  to authenticated;

-- -----------------------------------------------------------------------------
-- Recently used by you — Doctor-owned longitudinal persisted history.
--
-- Deliberately NO practice-location predicate: a Doctor who legitimately works
-- at more than one location gets their own history across those locations. The
-- ordering is recency of actual persisted use, not medical recommendation rank.
-- -----------------------------------------------------------------------------
create or replace function public.recent_encounter_investigations(
  p_limit integer default 20
)
returns table (
  name         text,
  last_used_at timestamptz,
  usage_count  bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_doctor uuid;
  v_limit  integer := coalesce(p_limit, 20);
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if not public.session_is_aal2() then
    raise exception 'AAL2_REQUIRED' using errcode = '42501';
  end if;

  v_doctor := public.current_doctor_id();
  if v_doctor is null then
    raise exception 'not a doctor' using errcode = '42501';
  end if;
  if v_limit < 1 or v_limit > 50 then
    raise exception 'INVESTIGATION_RECENT_LIMIT_INVALID' using errcode = '22023';
  end if;

  return query
    select i.name,
           max(i.created_at) as last_used_at,
           count(*)::bigint as usage_count
    from public.encounter_investigations i
    join public.encounters e on e.id = i.encounter_id
    where e.owner_doctor_id = v_doctor
    group by i.name
    order by max(i.created_at) desc, i.name
    limit v_limit;
end;
$$;

revoke all on function public.recent_encounter_investigations(integer)
  from public, anon, authenticated, service_role;
grant execute on function public.recent_encounter_investigations(integer)
  to authenticated;

-- -----------------------------------------------------------------------------
-- Doctor-owned longitudinal patient Investigation history.
--
-- This is order/request history only: no result, interpretation, specimen/LIS
-- status or lab billing fields exist in the contract. Original location is
-- returned, while tenancy remains the owning Doctor rather than chamber scope.
-- -----------------------------------------------------------------------------
create or replace function public.patient_investigation_history(
  p_patient_id uuid,
  p_limit      integer default 100
)
returns table (
  investigation_id      uuid,
  encounter_id          uuid,
  investigation_name    text,
  note                  text,
  position              integer,
  ordered_at            timestamptz,
  encounter_started_at  timestamptz,
  ordering_doctor_id    uuid,
  ordering_doctor_name  text,
  practice_location_id  uuid,
  practice_location_name text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_doctor uuid;
  v_limit  integer := coalesce(p_limit, 100);
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if not public.session_is_aal2() then
    raise exception 'AAL2_REQUIRED' using errcode = '42501';
  end if;

  v_doctor := public.current_doctor_id();
  if v_doctor is null then
    raise exception 'not a doctor' using errcode = '42501';
  end if;
  if p_patient_id is null or v_limit < 1 or v_limit > 200 then
    raise exception 'INVESTIGATION_HISTORY_INVALID' using errcode = '22023';
  end if;

  -- Exact Doctor ownership, not location membership and not role union.
  if not exists (
    select 1
    from public.patients p
    where p.id = p_patient_id
      and p.owner_doctor_id = v_doctor
      and p.deleted_at is null
  ) then
    raise exception 'patient not found' using errcode = '42501';
  end if;

  return query
    select i.id,
           e.id,
           i.name,
           i.note,
           i.position,
           i.created_at,
           e.started_at,
           e.owner_doctor_id,
           pr.full_name,
           e.practice_location_id,
           l.name
    from public.encounter_investigations i
    join public.encounters e on e.id = i.encounter_id
    join public.practice_locations l on l.id = e.practice_location_id
    join public.doctor_profiles d on d.id = e.owner_doctor_id
    left join public.profiles pr on pr.id = d.user_id
    where e.owner_doctor_id = v_doctor
      and e.patient_id = p_patient_id
    order by i.created_at desc, e.id, i.position
    limit v_limit;
end;
$$;

revoke all on function public.patient_investigation_history(uuid, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.patient_investigation_history(uuid, integer)
  to authenticated;
