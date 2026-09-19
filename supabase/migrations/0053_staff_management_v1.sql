-- Doctor's Diary — 0053 Staff Management V1
-- NEXT RELEASE / POST-PILOT ONLY.
-- REVIEW DRAFT: DO NOT APPLY TO PROTECTED SUPABASE WITHOUT CENTRAL APPROVAL.
--
-- Effective delegated authority:
-- verified authenticated user
--   -> ACTIVE managed location-entry membership
--   -> ACTIVE Doctor-specific staff grant
--   -> Doctor-specific assigned location
--   -> role ceiling
--   -> explicit permission
--   -> resource belongs to that Doctor/location
--   -> allow; otherwise deny.
--
-- Existing unadopted RECEPTIONIST memberships keep frozen pilot behavior.
-- Explicit Team adoption at a location suspends that user's legacy
-- RECEPTIONIST membership there and creates/uses the inert ASSISTANT location
-- role only as the broad managed-entry marker. The semantic Team role remains
-- on doctor_staff_grants. This prevents Doctor A's Team grant at a shared clinic
-- from inheriting Doctor B's legacy location-wide receptionist surface.

alter type public.location_role add value if not exists 'ASSISTANT';

create type public.doctor_staff_role as enum ('RECEPTIONIST', 'ASSISTANT');
create type public.doctor_staff_status as enum ('ACTIVE', 'TEMPORARILY_DISABLED', 'REMOVED');
create type public.doctor_staff_permission as enum (
  'appointments.view',
  'appointments.manage',
  'patient.lookup',
  'arrival.manage',
  'queue.manage',
  'chamber.view',
  'intake.write',
  'document.attach',
  'investigation.prepare'
);

create table public.doctor_staff_invitations (
  id uuid primary key default gen_random_uuid(),
  doctor_profile_id uuid not null references public.doctor_profiles(id) on delete cascade,
  email text not null,
  role public.doctor_staff_role not null,
  requested_location_ids uuid[] not null,
  requested_permissions public.doctor_staff_permission[] not null default '{}'::public.doctor_staff_permission[],
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days'),
  linked_at timestamptz,
  linked_user_id uuid references public.profiles(id) on delete set null,
  revoked_at timestamptz,
  constraint doctor_staff_inv_email_normalized
    check (email = lower(btrim(email)) and length(email) between 3 and 320),
  constraint doctor_staff_inv_locations_nonempty check (cardinality(requested_location_ids) > 0),
  constraint doctor_staff_inv_expiry_valid check (expires_at > created_at),
  constraint doctor_staff_inv_terminal check (not (linked_at is not null and revoked_at is not null))
);
create unique index doctor_staff_inv_pending_email_key
  on public.doctor_staff_invitations (doctor_profile_id, email)
  where linked_at is null and revoked_at is null;
create index doctor_staff_inv_doctor_idx
  on public.doctor_staff_invitations (doctor_profile_id, created_at desc);

create table public.doctor_staff_grants (
  id uuid primary key default gen_random_uuid(),
  doctor_profile_id uuid not null references public.doctor_profiles(id) on delete restrict,
  staff_user_id uuid not null references public.profiles(id) on delete restrict,
  role public.doctor_staff_role not null,
  status public.doctor_staff_status not null default 'ACTIVE',
  source_invitation_id uuid references public.doctor_staff_invitations(id) on delete set null,
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  temporarily_disabled_at timestamptz,
  removed_at timestamptz,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (doctor_profile_id, staff_user_id),
  unique (id, doctor_profile_id),
  constraint doctor_staff_grant_window check (ends_at is null or ends_at > starts_at),
  constraint doctor_staff_grant_status_consistent check (
    (status = 'ACTIVE' and temporarily_disabled_at is null and removed_at is null)
    or (status = 'TEMPORARILY_DISABLED' and temporarily_disabled_at is not null and removed_at is null)
    or (status = 'REMOVED' and removed_at is not null)
  )
);
create index doctor_staff_grant_staff_idx on public.doctor_staff_grants (staff_user_id, status);
create index doctor_staff_grant_doctor_idx on public.doctor_staff_grants (doctor_profile_id, status);

create table public.doctor_staff_locations (
  grant_id uuid not null,
  doctor_profile_id uuid not null,
  practice_location_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (grant_id, practice_location_id),
  foreign key (grant_id, doctor_profile_id)
    references public.doctor_staff_grants(id, doctor_profile_id) on delete cascade,
  foreign key (doctor_profile_id, practice_location_id)
    references public.doctor_chambers(doctor_profile_id, practice_location_id) on delete restrict
);
create index doctor_staff_location_doctor_idx
  on public.doctor_staff_locations (doctor_profile_id, practice_location_id);

create table public.doctor_staff_permissions (
  grant_id uuid not null references public.doctor_staff_grants(id) on delete cascade,
  permission public.doctor_staff_permission not null,
  created_at timestamptz not null default now(),
  primary key (grant_id, permission)
);

-- Preparation only; never written into encounter_investigations automatically.
create table public.staff_investigation_proposals (
  id uuid primary key default gen_random_uuid(),
  grant_id uuid not null references public.doctor_staff_grants(id) on delete restrict,
  owner_doctor_id uuid not null references public.doctor_profiles(id) on delete restrict,
  practice_location_id uuid not null references public.practice_locations(id) on delete restrict,
  encounter_id uuid not null references public.encounters(id) on delete restrict,
  proposed_by uuid not null references public.profiles(id) on delete restrict,
  name text not null,
  note text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles(id) on delete set null,
  constraint staff_investigation_name_valid check (length(btrim(name)) between 1 and 200),
  constraint staff_investigation_note_valid check (note is null or length(note) <= 1000)
);
create index staff_investigation_encounter_idx
  on public.staff_investigation_proposals (encounter_id, created_at);

create or replace function public.staff_role_allows_permission(
  target_role public.doctor_staff_role,
  target_permission public.doctor_staff_permission
)
returns boolean
language sql
immutable
set search_path = pg_catalog, public
as $$
  select case target_role
    when 'RECEPTIONIST' then target_permission in (
      'appointments.view'::public.doctor_staff_permission,
      'appointments.manage'::public.doctor_staff_permission,
      'patient.lookup'::public.doctor_staff_permission,
      'arrival.manage'::public.doctor_staff_permission,
      'queue.manage'::public.doctor_staff_permission,
      'chamber.view'::public.doctor_staff_permission
    )
    when 'ASSISTANT' then target_permission in (
      'patient.lookup'::public.doctor_staff_permission,
      'appointments.view'::public.doctor_staff_permission,
      'chamber.view'::public.doctor_staff_permission,
      'intake.write'::public.doctor_staff_permission,
      'document.attach'::public.doctor_staff_permission,
      'investigation.prepare'::public.doctor_staff_permission
    )
    else false
  end;
$$;

-- Do not cast the newly-added location_role enum label in a normal SQL body in
-- the same migration transaction. role::text is safe; creation of the actual
-- ASSISTANT membership is deferred to dynamic SQL executed after migration.
create or replace function public.managed_staff_entry_at(target_location uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.practice_location_members m
    where m.practice_location_id = target_location
      and m.user_id = auth.uid()
      and m.status = 'ACTIVE'
      and m.role::text = 'ASSISTANT'
  );
$$;

create or replace function public.has_doctor_staff_permission(
  target_doctor_id uuid,
  target_location_id uuid,
  target_permission public.doctor_staff_permission
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.managed_staff_entry_at(target_location_id)
    and exists (
      select 1
      from public.doctor_staff_grants g
      join public.doctor_staff_locations l
        on l.grant_id = g.id and l.doctor_profile_id = g.doctor_profile_id
      join public.doctor_staff_permissions p
        on p.grant_id = g.id and p.permission = target_permission
      where g.doctor_profile_id = target_doctor_id
        and g.staff_user_id = auth.uid()
        and g.status = 'ACTIVE'
        and g.starts_at <= now()
        and (g.ends_at is null or g.ends_at > now())
        and l.practice_location_id = target_location_id
        and public.staff_role_allows_permission(g.role, target_permission)
    );
$$;

create or replace function public.has_doctor_staff_permission_for_patient(
  target_doctor_id uuid,
  target_patient_id uuid,
  target_permission public.doctor_staff_permission
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.patient_location_links l
    where l.patient_id = target_patient_id
      and public.has_doctor_staff_permission(
        target_doctor_id, l.practice_location_id, target_permission
      )
  );
$$;

revoke all on function public.staff_role_allows_permission(public.doctor_staff_role, public.doctor_staff_permission) from public;
revoke all on function public.managed_staff_entry_at(uuid) from public;
revoke all on function public.has_doctor_staff_permission(uuid, uuid, public.doctor_staff_permission) from public;
revoke all on function public.has_doctor_staff_permission_for_patient(uuid, uuid, public.doctor_staff_permission) from public;
grant execute on function public.staff_role_allows_permission(public.doctor_staff_role, public.doctor_staff_permission) to authenticated;
grant execute on function public.managed_staff_entry_at(uuid) to authenticated;
grant execute on function public.has_doctor_staff_permission(uuid, uuid, public.doctor_staff_permission) to authenticated;
grant execute on function public.has_doctor_staff_permission_for_patient(uuid, uuid, public.doctor_staff_permission) to authenticated;

-- Service-role-only identity link. An invitation row alone grants no access.
create or replace function public.service_link_doctor_staff_invitation(
  target_invitation_id uuid,
  target_staff_user_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_inv public.doctor_staff_invitations%rowtype;
  v_grant_id uuid;
  v_doctor_user_id uuid;
  v_location uuid;
  v_permission public.doctor_staff_permission;
  v_entry_status text;
begin
  if current_user not in ('postgres', 'service_role', 'supabase_admin') then
    raise exception 'STAFF_LINK_SERVICE_ONLY' using errcode = '42501';
  end if;

  select * into v_inv
  from public.doctor_staff_invitations
  where id = target_invitation_id
  for update;

  if not found or v_inv.linked_at is not null or v_inv.revoked_at is not null
     or v_inv.expires_at <= now() then
    raise exception 'STAFF_INVITATION_NOT_LINKABLE' using errcode = '42501';
  end if;

  if not exists (select 1 from public.profiles p where p.id = target_staff_user_id) then
    raise exception 'STAFF_PROFILE_NOT_READY' using errcode = '42501';
  end if;

  select d.user_id into v_doctor_user_id
  from public.doctor_profiles d where d.id = v_inv.doctor_profile_id;
  if v_doctor_user_id is null or v_doctor_user_id = target_staff_user_id then
    raise exception 'STAFF_SELF_LINK_FORBIDDEN' using errcode = '42501';
  end if;

  if cardinality(v_inv.requested_location_ids) = 0
     or cardinality(v_inv.requested_location_ids) <>
        (select count(distinct x)::int from unnest(v_inv.requested_location_ids) x) then
    raise exception 'STAFF_LOCATION_SET_INVALID' using errcode = '22023';
  end if;

  if cardinality(v_inv.requested_location_ids) <>
     (select count(*)::int from public.doctor_chambers c
      where c.doctor_profile_id = v_inv.doctor_profile_id
        and c.practice_location_id = any(v_inv.requested_location_ids)) then
    raise exception 'STAFF_LOCATION_NOT_DOCTOR_CHAMBER' using errcode = '42501';
  end if;

  if exists (
    select 1 from unnest(v_inv.requested_permissions) p
    where not public.staff_role_allows_permission(v_inv.role, p)
  ) then
    raise exception 'STAFF_PERMISSION_EXCEEDS_ROLE' using errcode = '42501';
  end if;

  select g.id into v_grant_id
  from public.doctor_staff_grants g
  where g.doctor_profile_id = v_inv.doctor_profile_id
    and g.staff_user_id = target_staff_user_id
  for update;

  if found then
    if exists (
      select 1 from public.doctor_staff_grants g
      where g.id = v_grant_id and g.status <> 'REMOVED'
    ) then
      raise exception 'STAFF_RELATIONSHIP_ALREADY_EXISTS' using errcode = '23505';
    end if;
    update public.doctor_staff_grants
    set role = v_inv.role,
        status = 'ACTIVE',
        source_invitation_id = v_inv.id,
        starts_at = now(),
        ends_at = null,
        temporarily_disabled_at = null,
        removed_at = null,
        updated_by = v_inv.created_by,
        updated_at = now()
    where id = v_grant_id;
    delete from public.doctor_staff_locations l where l.grant_id = v_grant_id;
    delete from public.doctor_staff_permissions p where p.grant_id = v_grant_id;
  else
    insert into public.doctor_staff_grants (
      doctor_profile_id, staff_user_id, role, source_invitation_id, created_by, updated_by
    ) values (
      v_inv.doctor_profile_id, target_staff_user_id, v_inv.role,
      v_inv.id, v_inv.created_by, v_inv.created_by
    ) returning id into v_grant_id;
  end if;

  foreach v_location in array v_inv.requested_location_ids loop
    -- Explicit adoption removes the legacy location-wide receptionist authority
    -- for this user/location. No unadopted membership is touched.
    update public.practice_location_members m
    set status = 'SUSPENDED', updated_at = now()
    where m.practice_location_id = v_location
      and m.user_id = target_staff_user_id
      and m.role::text = 'RECEPTIONIST'
      and m.status = 'ACTIVE';

    select m.status::text into v_entry_status
    from public.practice_location_members m
    where m.practice_location_id = v_location
      and m.user_id = target_staff_user_id
      and m.role::text = 'ASSISTANT'
    limit 1;

    if v_entry_status = 'SUSPENDED' then
      raise exception 'STAFF_MANAGED_ENTRY_SUSPENDED' using errcode = '42501';
    elsif v_entry_status = 'INVITED' then
      update public.practice_location_members m
      set status = 'ACTIVE', joined_at = coalesce(joined_at, now()), updated_at = now()
      where m.practice_location_id = v_location
        and m.user_id = target_staff_user_id
        and m.role::text = 'ASSISTANT';
    elsif v_entry_status is null then
      execute
        'insert into public.practice_location_members '
        || '(practice_location_id,user_id,role,status,invited_by,joined_at) '
        || 'values ($1,$2,''ASSISTANT''::public.location_role,''ACTIVE'',$3,now())'
      using v_location, target_staff_user_id, v_inv.created_by;
    end if;

    insert into public.doctor_staff_locations (
      grant_id, doctor_profile_id, practice_location_id
    ) values (v_grant_id, v_inv.doctor_profile_id, v_location);
  end loop;

  foreach v_permission in array v_inv.requested_permissions loop
    insert into public.doctor_staff_permissions (grant_id, permission)
    values (v_grant_id, v_permission);
  end loop;

  update public.doctor_staff_invitations
  set linked_at = now(), linked_user_id = target_staff_user_id
  where id = v_inv.id;

  insert into public.audit_events (
    practice_location_id, actor_id, action, resource_type, resource_id, meta
  ) values (
    v_inv.requested_location_ids[1], v_inv.created_by,
    'STAFF_LINKED', 'doctor_staff_grant', v_grant_id,
    jsonb_build_object(
      'doctor_profile_id', v_inv.doctor_profile_id,
      'staff_user_id', target_staff_user_id,
      'staff_role', v_inv.role,
      'invitation_id', v_inv.id
    )
  );

  return v_grant_id;
end;
$$;
revoke all on function public.service_link_doctor_staff_invitation(uuid, uuid) from public, anon, authenticated;
grant execute on function public.service_link_doctor_staff_invitation(uuid, uuid) to service_role;

create or replace function public.doctor_set_staff_status(
  target_grant_id uuid,
  target_status public.doctor_staff_status
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_grant public.doctor_staff_grants%rowtype;
begin
  perform public.require_aal2();
  select * into v_grant from public.doctor_staff_grants where id = target_grant_id for update;
  if not found or v_grant.doctor_profile_id <> public.current_doctor_id() then
    raise exception 'STAFF_GRANT_NOT_FOUND' using errcode = '42501';
  end if;
  if v_grant.status = 'REMOVED' and target_status <> 'REMOVED' then
    raise exception 'REMOVED_STAFF_REQUIRES_NEW_ADOPTION' using errcode = '42501';
  end if;

  update public.doctor_staff_grants
  set status = target_status,
      temporarily_disabled_at = case when target_status = 'TEMPORARILY_DISABLED' then now() else null end,
      removed_at = case when target_status = 'REMOVED' then now() else removed_at end,
      updated_by = auth.uid(),
      updated_at = now()
  where id = v_grant.id;

  insert into public.audit_events (
    practice_location_id, actor_id, action, resource_type, resource_id, meta
  )
  select l.practice_location_id, auth.uid(), 'STAFF_STATUS_CHANGED',
         'doctor_staff_grant', v_grant.id,
         jsonb_build_object(
           'doctor_profile_id', v_grant.doctor_profile_id,
           'staff_user_id', v_grant.staff_user_id,
           'staff_role', v_grant.role,
           'new_status', target_status
         )
  from public.doctor_staff_locations l
  where l.grant_id = v_grant.id
  order by l.created_at limit 1;
end;
$$;

create or replace function public.doctor_replace_staff_permissions(
  target_grant_id uuid,
  target_permissions public.doctor_staff_permission[]
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_grant public.doctor_staff_grants%rowtype;
  v_permission public.doctor_staff_permission;
begin
  perform public.require_aal2();
  select * into v_grant from public.doctor_staff_grants where id = target_grant_id for update;
  if not found or v_grant.doctor_profile_id <> public.current_doctor_id()
     or v_grant.status = 'REMOVED' then
    raise exception 'STAFF_GRANT_NOT_EDITABLE' using errcode = '42501';
  end if;
  if exists (
    select 1
    from unnest(coalesce(target_permissions, '{}'::public.doctor_staff_permission[])) p
    where not public.staff_role_allows_permission(v_grant.role, p)
  ) then
    raise exception 'STAFF_PERMISSION_EXCEEDS_ROLE' using errcode = '42501';
  end if;

  delete from public.doctor_staff_permissions p where p.grant_id = v_grant.id;
  foreach v_permission in array coalesce(target_permissions, '{}'::public.doctor_staff_permission[]) loop
    insert into public.doctor_staff_permissions (grant_id, permission)
    values (v_grant.id, v_permission) on conflict do nothing;
  end loop;
  update public.doctor_staff_grants
  set updated_by = auth.uid(), updated_at = now() where id = v_grant.id;

  insert into public.audit_events (
    practice_location_id, actor_id, action, resource_type, resource_id, meta
  )
  select l.practice_location_id, auth.uid(), 'STAFF_PERMISSIONS_REPLACED',
         'doctor_staff_grant', v_grant.id,
         jsonb_build_object(
           'doctor_profile_id', v_grant.doctor_profile_id,
           'staff_user_id', v_grant.staff_user_id,
           'permissions', coalesce(target_permissions, '{}'::public.doctor_staff_permission[])
         )
  from public.doctor_staff_locations l
  where l.grant_id = v_grant.id
  order by l.created_at limit 1;
end;
$$;

create or replace function public.doctor_replace_staff_locations(
  target_grant_id uuid,
  target_location_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_grant public.doctor_staff_grants%rowtype;
  v_location uuid;
  v_entry_status text;
begin
  perform public.require_aal2();
  select * into v_grant from public.doctor_staff_grants where id = target_grant_id for update;
  if not found or v_grant.doctor_profile_id <> public.current_doctor_id()
     or v_grant.status = 'REMOVED' then
    raise exception 'STAFF_GRANT_NOT_EDITABLE' using errcode = '42501';
  end if;
  if target_location_ids is null or cardinality(target_location_ids) = 0
     or cardinality(target_location_ids) <>
        (select count(distinct x)::int from unnest(target_location_ids) x) then
    raise exception 'STAFF_LOCATION_SET_INVALID' using errcode = '22023';
  end if;
  if cardinality(target_location_ids) <>
     (select count(*)::int from public.doctor_chambers c
      where c.doctor_profile_id = v_grant.doctor_profile_id
        and c.practice_location_id = any(target_location_ids)) then
    raise exception 'STAFF_LOCATION_NOT_DOCTOR_CHAMBER' using errcode = '42501';
  end if;

  delete from public.doctor_staff_locations l where l.grant_id = v_grant.id;
  foreach v_location in array target_location_ids loop
    update public.practice_location_members m
    set status = 'SUSPENDED', updated_at = now()
    where m.practice_location_id = v_location
      and m.user_id = v_grant.staff_user_id
      and m.role::text = 'RECEPTIONIST'
      and m.status = 'ACTIVE';

    select m.status::text into v_entry_status
    from public.practice_location_members m
    where m.practice_location_id = v_location
      and m.user_id = v_grant.staff_user_id
      and m.role::text = 'ASSISTANT'
    limit 1;

    if v_entry_status = 'SUSPENDED' then
      raise exception 'STAFF_MANAGED_ENTRY_SUSPENDED' using errcode = '42501';
    elsif v_entry_status = 'INVITED' then
      update public.practice_location_members m
      set status = 'ACTIVE', joined_at = coalesce(joined_at, now()), updated_at = now()
      where m.practice_location_id = v_location
        and m.user_id = v_grant.staff_user_id
        and m.role::text = 'ASSISTANT';
    elsif v_entry_status is null then
      execute
        'insert into public.practice_location_members '
        || '(practice_location_id,user_id,role,status,invited_by,joined_at) '
        || 'values ($1,$2,''ASSISTANT''::public.location_role,''ACTIVE'',$3,now())'
      using v_location, v_grant.staff_user_id, auth.uid();
    end if;

    insert into public.doctor_staff_locations (
      grant_id, doctor_profile_id, practice_location_id
    ) values (v_grant.id, v_grant.doctor_profile_id, v_location);
  end loop;

  update public.doctor_staff_grants
  set updated_by = auth.uid(), updated_at = now() where id = v_grant.id;
  insert into public.audit_events (
    practice_location_id, actor_id, action, resource_type, resource_id, meta
  ) values (
    target_location_ids[1], auth.uid(), 'STAFF_LOCATIONS_REPLACED',
    'doctor_staff_grant', v_grant.id,
    jsonb_build_object(
      'doctor_profile_id', v_grant.doctor_profile_id,
      'staff_user_id', v_grant.staff_user_id,
      'location_ids', target_location_ids
    )
  );
end;
$$;

revoke all on function public.doctor_set_staff_status(uuid, public.doctor_staff_status) from public;
revoke all on function public.doctor_replace_staff_permissions(uuid, public.doctor_staff_permission[]) from public;
revoke all on function public.doctor_replace_staff_locations(uuid, uuid[]) from public;
grant execute on function public.doctor_set_staff_status(uuid, public.doctor_staff_status) to authenticated;
grant execute on function public.doctor_replace_staff_permissions(uuid, public.doctor_staff_permission[]) to authenticated;
grant execute on function public.doctor_replace_staff_locations(uuid, uuid[]) to authenticated;

-- Assistant bounded support: structured vitals only on a DRAFT encounter.
create or replace function public.staff_write_intake_vitals(
  target_encounter_id uuid,
  target_height_cm numeric default null,
  target_weight_kg numeric default null,
  target_temperature_c numeric default null,
  target_pulse_bpm integer default null,
  target_systolic integer default null,
  target_diastolic integer default null,
  target_resp_rate integer default null,
  target_spo2 integer default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_encounter public.encounters%rowtype;
  v_grant_id uuid;
  v_staff_role public.doctor_staff_role;
begin
  perform public.require_aal2();
  select * into v_encounter from public.encounters where id = target_encounter_id for update;
  if not found or v_encounter.status <> 'DRAFT' then
    raise exception 'STAFF_INTAKE_ENCOUNTER_NOT_DRAFT' using errcode = '42501';
  end if;
  if not public.has_doctor_staff_permission(
    v_encounter.owner_doctor_id, v_encounter.practice_location_id, 'intake.write'
  ) then
    raise exception 'STAFF_INTAKE_FORBIDDEN' using errcode = '42501';
  end if;

  select g.id, g.role into v_grant_id, v_staff_role
  from public.doctor_staff_grants g
  join public.doctor_staff_locations l
    on l.grant_id = g.id and l.practice_location_id = v_encounter.practice_location_id
  where g.doctor_profile_id = v_encounter.owner_doctor_id
    and g.staff_user_id = auth.uid() and g.status = 'ACTIVE'
  limit 1;

  update public.encounters
  set vital_height_cm = target_height_cm,
      vital_weight_kg = target_weight_kg,
      vital_temperature_c = target_temperature_c,
      vital_pulse_bpm = target_pulse_bpm,
      vital_systolic = target_systolic,
      vital_diastolic = target_diastolic,
      vital_resp_rate = target_resp_rate,
      vital_spo2 = target_spo2,
      updated_at = now()
  where id = v_encounter.id;

  insert into public.audit_events (
    practice_location_id, actor_id, action, resource_type, resource_id, meta
  ) values (
    v_encounter.practice_location_id, auth.uid(),
    'STAFF_INTAKE_VITALS_UPDATED', 'encounter', v_encounter.id,
    jsonb_build_object(
      'doctor_profile_id', v_encounter.owner_doctor_id,
      'staff_role', v_staff_role,
      'grant_id', v_grant_id
    )
  );
end;
$$;

create or replace function public.staff_prepare_investigation(
  target_encounter_id uuid,
  target_name text,
  target_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_encounter public.encounters%rowtype;
  v_grant_id uuid;
  v_staff_role public.doctor_staff_role;
  v_proposal_id uuid;
begin
  perform public.require_aal2();
  select * into v_encounter from public.encounters where id = target_encounter_id;
  if not found or v_encounter.status <> 'DRAFT' then
    raise exception 'STAFF_INVESTIGATION_ENCOUNTER_NOT_DRAFT' using errcode = '42501';
  end if;
  if not public.has_doctor_staff_permission(
    v_encounter.owner_doctor_id, v_encounter.practice_location_id, 'investigation.prepare'
  ) then
    raise exception 'STAFF_INVESTIGATION_FORBIDDEN' using errcode = '42501';
  end if;

  select g.id, g.role into v_grant_id, v_staff_role
  from public.doctor_staff_grants g
  join public.doctor_staff_locations l
    on l.grant_id = g.id and l.practice_location_id = v_encounter.practice_location_id
  where g.doctor_profile_id = v_encounter.owner_doctor_id
    and g.staff_user_id = auth.uid() and g.status = 'ACTIVE'
  limit 1;

  insert into public.staff_investigation_proposals (
    grant_id, owner_doctor_id, practice_location_id, encounter_id,
    proposed_by, name, note
  ) values (
    v_grant_id, v_encounter.owner_doctor_id, v_encounter.practice_location_id,
    v_encounter.id, auth.uid(), btrim(target_name), target_note
  ) returning id into v_proposal_id;

  insert into public.audit_events (
    practice_location_id, actor_id, action, resource_type, resource_id, meta
  ) values (
    v_encounter.practice_location_id, auth.uid(),
    'STAFF_INVESTIGATION_PROPOSED', 'staff_investigation_proposal', v_proposal_id,
    jsonb_build_object(
      'doctor_profile_id', v_encounter.owner_doctor_id,
      'staff_role', v_staff_role,
      'grant_id', v_grant_id,
      'encounter_id', v_encounter.id
    )
  );
  return v_proposal_id;
end;
$$;

create or replace function public.staff_attach_document_record(
  target_doctor_id uuid,
  target_location_id uuid,
  target_patient_id uuid,
  target_encounter_id uuid,
  target_document_type public.document_type,
  target_title text,
  target_document_date date,
  target_notes text,
  target_storage_path text,
  target_mime_type text,
  target_size_bytes integer,
  target_original_filename text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_document_id uuid;
  v_grant_id uuid;
  v_staff_role public.doctor_staff_role;
begin
  perform public.require_aal2();
  if not public.has_doctor_staff_permission(
    target_doctor_id, target_location_id, 'document.attach'
  ) then
    raise exception 'STAFF_DOCUMENT_ATTACH_FORBIDDEN' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.patients p
    where p.id = target_patient_id and p.owner_doctor_id = target_doctor_id
  ) or not exists (
    select 1 from public.patient_location_links l
    where l.patient_id = target_patient_id and l.practice_location_id = target_location_id
  ) then
    raise exception 'STAFF_DOCUMENT_PATIENT_NOT_VISIBLE' using errcode = '42501';
  end if;
  if target_encounter_id is not null and not exists (
    select 1 from public.encounters e
    where e.id = target_encounter_id
      and e.owner_doctor_id = target_doctor_id
      and e.patient_id = target_patient_id
      and e.practice_location_id = target_location_id
  ) then
    raise exception 'STAFF_DOCUMENT_ENCOUNTER_INVALID' using errcode = '42501';
  end if;

  select g.id, g.role into v_grant_id, v_staff_role
  from public.doctor_staff_grants g
  join public.doctor_staff_locations l
    on l.grant_id = g.id and l.practice_location_id = target_location_id
  where g.doctor_profile_id = target_doctor_id
    and g.staff_user_id = auth.uid() and g.status = 'ACTIVE'
  limit 1;

  insert into public.patient_documents (
    patient_id, owner_doctor_id, practice_location_id, encounter_id,
    document_type, title, document_date, notes, storage_path, mime_type,
    size_bytes, original_filename, uploaded_by
  ) values (
    target_patient_id, target_doctor_id, target_location_id, target_encounter_id,
    target_document_type, btrim(target_title), target_document_date, target_notes,
    target_storage_path, target_mime_type, target_size_bytes,
    target_original_filename, auth.uid()
  ) returning id into v_document_id;

  insert into public.audit_events (
    practice_location_id, actor_id, action, resource_type, resource_id, meta
  ) values (
    target_location_id, auth.uid(), 'STAFF_DOCUMENT_ATTACHED',
    'patient_document', v_document_id,
    jsonb_build_object(
      'doctor_profile_id', target_doctor_id,
      'staff_role', v_staff_role,
      'grant_id', v_grant_id,
      'patient_id', target_patient_id
    )
  );
  return v_document_id;
end;
$$;

revoke all on function public.staff_write_intake_vitals(uuid,numeric,numeric,numeric,integer,integer,integer,integer,integer) from public;
revoke all on function public.staff_prepare_investigation(uuid,text,text) from public;
revoke all on function public.staff_attach_document_record(uuid,uuid,uuid,uuid,public.document_type,text,date,text,text,text,integer,text) from public;
grant execute on function public.staff_write_intake_vitals(uuid,numeric,numeric,numeric,integer,integer,integer,integer,integer) to authenticated;
grant execute on function public.staff_prepare_investigation(uuid,text,text) to authenticated;
grant execute on function public.staff_attach_document_record(uuid,uuid,uuid,uuid,public.document_type,text,date,text,text,text,integer,text) to authenticated;

-- Team-managed receptionist operational paths. Frozen pilot RPCs remain
-- unchanged for unadopted legacy receptionists.
create or replace function public.staff_create_appointment(
  target_doctor_id uuid,
  target_location_id uuid,
  target_patient_id uuid,
  target_scheduled_for timestamptz,
  target_duration_minutes integer default 15,
  target_visit_type public.visit_type default 'NEW',
  target_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_appointment_id uuid;
  v_session_day date;
begin
  perform public.require_aal2();
  if not public.has_doctor_staff_permission(
    target_doctor_id, target_location_id, 'appointments.manage'
  ) then
    raise exception 'STAFF_APPOINTMENT_MANAGE_FORBIDDEN' using errcode = '42501';
  end if;
  if not public.doctor_practises_at(target_doctor_id, target_location_id) then
    raise exception 'STAFF_APPOINTMENT_DOCTOR_LOCATION_INVALID' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.patients p
    where p.id = target_patient_id and p.owner_doctor_id = target_doctor_id
  ) or not exists (
    select 1 from public.patient_location_links l
    where l.patient_id = target_patient_id and l.practice_location_id = target_location_id
  ) then
    raise exception 'STAFF_APPOINTMENT_PATIENT_INVALID' using errcode = '42501';
  end if;
  if target_scheduled_for is null then
    raise exception 'STAFF_APPOINTMENT_TIME_REQUIRED' using errcode = '22023';
  end if;

  v_session_day := public.session_date_for(target_location_id, target_scheduled_for);
  insert into public.appointments (
    owner_doctor_id, practice_location_id, patient_id, scheduled_for,
    session_date, duration_minutes, visit_type, reason, created_by
  ) values (
    target_doctor_id, target_location_id, target_patient_id,
    target_scheduled_for, v_session_day, coalesce(target_duration_minutes,15),
    coalesce(target_visit_type,'NEW'), nullif(btrim(coalesce(target_reason,'')),''),
    auth.uid()
  ) returning id into v_appointment_id;

  insert into public.appointment_events (
    appointment_id, practice_location_id, event_type, to_status, actor_id
  ) values (
    v_appointment_id, target_location_id, 'CREATED', 'SCHEDULED', auth.uid()
  );
  insert into public.audit_events (
    practice_location_id, actor_id, action, resource_type, resource_id, meta
  ) values (
    target_location_id, auth.uid(), 'STAFF_APPOINTMENT_CREATED',
    'appointment', v_appointment_id,
    jsonb_build_object('doctor_profile_id', target_doctor_id)
  );
  return v_appointment_id;
end;
$$;

create or replace function public.staff_set_appointment_status(
  target_appointment_id uuid,
  target_status public.appointment_status,
  target_reason public.cancellation_reason default null,
  target_note text default null
)
returns public.appointment_status
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_appointment public.appointments%rowtype;
  v_event public.appointment_event_type;
  v_token integer;
  v_permission public.doctor_staff_permission;
begin
  perform public.require_aal2();
  select * into v_appointment
  from public.appointments where id = target_appointment_id for update;
  if not found then
    raise exception 'STAFF_APPOINTMENT_NOT_FOUND' using errcode = '42501';
  end if;
  if target_status in ('IN_CONSULTATION','COMPLETED') then
    raise exception 'STAFF_CLINICAL_APPOINTMENT_TRANSITION_FORBIDDEN' using errcode = '42501';
  end if;

  v_permission := case
    when target_status = 'ARRIVED' then 'arrival.manage'::public.doctor_staff_permission
    else 'appointments.manage'::public.doctor_staff_permission
  end;
  if not public.has_doctor_staff_permission(
    v_appointment.owner_doctor_id, v_appointment.practice_location_id, v_permission
  ) then
    raise exception 'STAFF_APPOINTMENT_STATUS_FORBIDDEN' using errcode = '42501';
  end if;
  if v_appointment.status = target_status then return v_appointment.status; end if;
  if not public.appointment_transition_allowed(v_appointment.status, target_status) then
    raise exception 'STAFF_APPOINTMENT_TRANSITION_INVALID' using errcode = '22023';
  end if;
  if target_status = 'CANCELLED' and target_reason is null then
    raise exception 'STAFF_APPOINTMENT_CANCELLATION_REASON_REQUIRED' using errcode = '22023';
  end if;

  v_event := case target_status
    when 'CONFIRMED' then 'CONFIRMED'
    when 'ARRIVED' then 'ARRIVED'
    when 'CANCELLED' then 'CANCELLED'
    when 'NO_SHOW' then 'NO_SHOW'
    else null
  end;
  if v_event is null then
    raise exception 'STAFF_APPOINTMENT_TRANSITION_FORBIDDEN' using errcode = '42501';
  end if;

  if target_status = 'ARRIVED' and v_appointment.token_number is null then
    v_token := public.allocate_token(
      v_appointment.practice_location_id, v_appointment.session_date
    );
  end if;

  update public.appointments
  set status = target_status,
      token_number = coalesce(v_token, token_number),
      arrived_at = case when target_status='ARRIVED' then now() else arrived_at end,
      cancelled_at = case when target_status in ('CANCELLED','NO_SHOW') then now() else cancelled_at end,
      cancellation_reason = coalesce(target_reason, cancellation_reason),
      cancellation_note = coalesce(
        nullif(btrim(coalesce(target_note,'')),''), cancellation_note
      ),
      updated_at = now()
  where id = v_appointment.id;

  insert into public.appointment_events (
    appointment_id, practice_location_id, event_type,
    from_status, to_status, actor_id, note
  ) values (
    v_appointment.id, v_appointment.practice_location_id, v_event,
    v_appointment.status, target_status, auth.uid(),
    nullif(btrim(coalesce(target_note,'')),'')
  );
  insert into public.audit_events (
    practice_location_id, actor_id, action, resource_type, resource_id, meta
  ) values (
    v_appointment.practice_location_id, auth.uid(),
    'STAFF_APPOINTMENT_STATUS_CHANGED', 'appointment', v_appointment.id,
    jsonb_build_object(
      'doctor_profile_id', v_appointment.owner_doctor_id,
      'from_status', v_appointment.status,
      'to_status', target_status
    )
  );
  return target_status;
end;
$$;

create or replace function public.staff_set_queue_priority(
  target_appointment_id uuid,
  target_location_id uuid,
  target_reason public.priority_reason,
  target_note text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_appointment public.appointments%rowtype;
begin
  perform public.require_aal2();
  select * into v_appointment
  from public.appointments where id = target_appointment_id for update;
  if not found
     or v_appointment.practice_location_id <> target_location_id
     or v_appointment.status <> 'ARRIVED'
     or not public.has_doctor_staff_permission(
       v_appointment.owner_doctor_id, target_location_id, 'queue.manage'
     ) then
    raise exception 'STAFF_QUEUE_FORBIDDEN' using errcode = '42501';
  end if;
  if target_reason is null then
    raise exception 'STAFF_QUEUE_REASON_REQUIRED' using errcode = '22023';
  end if;

  insert into public.queue_entries (
    appointment_id, practice_location_id, session_date
  ) values (
    v_appointment.id, v_appointment.practice_location_id, v_appointment.session_date
  ) on conflict (appointment_id) do update set updated_at = now();

  update public.queue_entries
  set priority = 1,
      priority_reason = target_reason,
      priority_note = nullif(btrim(coalesce(target_note,'')),''),
      priority_set_by = auth.uid(),
      updated_at = now()
  where appointment_id = v_appointment.id;

  insert into public.queue_events (
    appointment_id, practice_location_id, event_type, reason, note, actor_id
  ) values (
    v_appointment.id, v_appointment.practice_location_id,
    'PRIORITY_SET', target_reason,
    nullif(btrim(coalesce(target_note,'')),''), auth.uid()
  );
  insert into public.audit_events (
    practice_location_id, actor_id, action, resource_type, resource_id, meta
  ) values (
    v_appointment.practice_location_id, auth.uid(),
    'STAFF_QUEUE_PRIORITY_SET', 'appointment', v_appointment.id,
    jsonb_build_object('doctor_profile_id', v_appointment.owner_doctor_id)
  );
end;
$$;

revoke all on function public.staff_create_appointment(uuid,uuid,uuid,timestamptz,integer,public.visit_type,text) from public;
revoke all on function public.staff_set_appointment_status(uuid,public.appointment_status,public.cancellation_reason,text) from public;
revoke all on function public.staff_set_queue_priority(uuid,uuid,public.priority_reason,text) from public;
grant execute on function public.staff_create_appointment(uuid,uuid,uuid,timestamptz,integer,public.visit_type,text) to authenticated;
grant execute on function public.staff_set_appointment_status(uuid,public.appointment_status,public.cancellation_reason,text) to authenticated;
grant execute on function public.staff_set_queue_priority(uuid,uuid,public.priority_reason,text) to authenticated;

-- New tables are Doctor-owned or actor-visible only.
alter table public.doctor_staff_invitations enable row level security;
alter table public.doctor_staff_invitations force row level security;
alter table public.doctor_staff_grants enable row level security;
alter table public.doctor_staff_grants force row level security;
alter table public.doctor_staff_locations enable row level security;
alter table public.doctor_staff_locations force row level security;
alter table public.doctor_staff_permissions enable row level security;
alter table public.doctor_staff_permissions force row level security;
alter table public.staff_investigation_proposals enable row level security;
alter table public.staff_investigation_proposals force row level security;

create policy doctor_staff_invitations_select_doctor
on public.doctor_staff_invitations for select to authenticated
using (doctor_profile_id = public.current_doctor_id());

create policy doctor_staff_invitations_insert_doctor
on public.doctor_staff_invitations for insert to authenticated
with check (
  doctor_profile_id = public.current_doctor_id()
  and created_by = auth.uid()
  and public.session_is_aal2()
);

create policy doctor_staff_grants_select_doctor
on public.doctor_staff_grants for select to authenticated
using (doctor_profile_id = public.current_doctor_id());

create policy doctor_staff_locations_select_doctor
on public.doctor_staff_locations for select to authenticated
using (doctor_profile_id = public.current_doctor_id());

create policy doctor_staff_permissions_select_doctor
on public.doctor_staff_permissions for select to authenticated
using (exists (
  select 1 from public.doctor_staff_grants g
  where g.id = doctor_staff_permissions.grant_id
    and g.doctor_profile_id = public.current_doctor_id()
));

create policy staff_investigation_proposals_select_doctor_or_actor
on public.staff_investigation_proposals for select to authenticated
using (owner_doctor_id = public.current_doctor_id() or proposed_by = auth.uid());

-- Additive delegated reads. Existing Doctor-owned clinical RLS and legacy
-- receptionist RLS are not relaxed or replaced.
create policy doctor_chambers_select_team_staff
on public.doctor_chambers for select to authenticated
using (public.has_doctor_staff_permission(
  doctor_profile_id, practice_location_id, 'chamber.view'
));

create policy patients_select_team_staff
on public.patients for select to authenticated
using (public.has_doctor_staff_permission_for_patient(
  owner_doctor_id, id, 'patient.lookup'
));

create policy appointments_select_team_staff
on public.appointments for select to authenticated
using (
  public.has_doctor_staff_permission(
    owner_doctor_id, practice_location_id, 'appointments.view'
  )
  or public.has_doctor_staff_permission(
    owner_doctor_id, practice_location_id, 'appointments.manage'
  )
);

create policy queue_entries_select_team_staff
on public.queue_entries for select to authenticated
using (exists (
  select 1 from public.appointments a
  where a.id = queue_entries.appointment_id
    and public.has_doctor_staff_permission(
      a.owner_doctor_id, a.practice_location_id, 'queue.manage'
    )
));

-- Doctor gets their own Doctor-context Team audit events. Existing Location Admin
-- audit visibility is not expanded.
create policy audit_events_select_doctor_team
on public.audit_events for select to authenticated
using (
  public.current_doctor_id() is not null
  and meta ->> 'doctor_profile_id' = public.current_doctor_id()::text
);

revoke all on public.doctor_staff_invitations from anon;
revoke all on public.doctor_staff_grants from anon;
revoke all on public.doctor_staff_locations from anon;
revoke all on public.doctor_staff_permissions from anon;
revoke all on public.staff_investigation_proposals from anon;

grant select, insert on public.doctor_staff_invitations to authenticated;
grant select on public.doctor_staff_grants to authenticated;
grant select on public.doctor_staff_locations to authenticated;
grant select on public.doctor_staff_permissions to authenticated;
grant select on public.staff_investigation_proposals to authenticated;
