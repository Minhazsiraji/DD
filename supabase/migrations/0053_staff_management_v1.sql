-- Doctor's Diary — 0053 Staff Management V1
-- NEXT RELEASE / POST-PILOT ONLY.
-- IMPORTANT: authored for CENTRAL review. Do not apply to protected Supabase
-- until CENTRAL explicitly authorizes the protected migration step.
--
-- Security model:
--   broad ACTIVE practice-location membership
--   × ACTIVE Doctor-specific staff grant
--   × Doctor-specific assigned location
--   × role ceiling
--   × explicit permission
--   × resource Doctor/location ownership
--   = delegated authority.
--
-- Existing location-scoped receptionist policies are intentionally preserved.
-- Existing receptionist memberships are NOT inferred into Doctor-staff grants.

-- ASSISTANT is a broad location-entry role only. It receives no authority from
-- legacy front-desk helpers; delegated authority is granted only by the new
-- Doctor-scoped Staff Management helpers below.
alter type public.location_role add value if not exists 'ASSISTANT';

create type public.doctor_staff_role as enum ('RECEPTIONIST', 'ASSISTANT');
create type public.doctor_staff_status as enum (
  'ACTIVE',
  'TEMPORARILY_DISABLED',
  'REMOVED'
);
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
  constraint doctor_staff_invitations_email_normalized
    check (email = lower(btrim(email)) and length(email) between 3 and 320),
  constraint doctor_staff_invitations_locations_nonempty
    check (cardinality(requested_location_ids) > 0),
  constraint doctor_staff_invitations_expiry_after_create
    check (expires_at > created_at),
  constraint doctor_staff_invitations_terminal_consistent
    check (not (linked_at is not null and revoked_at is not null))
);

create unique index doctor_staff_invitations_pending_doctor_email_key
  on public.doctor_staff_invitations (doctor_profile_id, email)
  where linked_at is null and revoked_at is null;
create index doctor_staff_invitations_doctor_idx
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
  constraint doctor_staff_grants_not_self
    check (staff_user_id <> created_by),
  constraint doctor_staff_grants_window
    check (ends_at is null or ends_at > starts_at),
  constraint doctor_staff_grants_status_consistent check (
    (status = 'ACTIVE' and temporarily_disabled_at is null and removed_at is null)
    or (status = 'TEMPORARILY_DISABLED' and temporarily_disabled_at is not null and removed_at is null)
    or (status = 'REMOVED' and removed_at is not null)
  ),
  unique (doctor_profile_id, staff_user_id)
);

create index doctor_staff_grants_staff_idx
  on public.doctor_staff_grants (staff_user_id, status);
create index doctor_staff_grants_doctor_status_idx
  on public.doctor_staff_grants (doctor_profile_id, status);

create table public.doctor_staff_locations (
  grant_id uuid not null references public.doctor_staff_grants(id) on delete cascade,
  doctor_profile_id uuid not null references public.doctor_profiles(id) on delete restrict,
  practice_location_id uuid not null references public.practice_locations(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (grant_id, practice_location_id),
  foreign key (doctor_profile_id, practice_location_id)
    references public.doctor_chambers(doctor_profile_id, practice_location_id)
    on delete restrict
);
create index doctor_staff_locations_doctor_location_idx
  on public.doctor_staff_locations (doctor_profile_id, practice_location_id);

create table public.doctor_staff_permissions (
  grant_id uuid not null references public.doctor_staff_grants(id) on delete cascade,
  permission public.doctor_staff_permission not null,
  created_at timestamptz not null default now(),
  primary key (grant_id, permission)
);

-- Assistant investigation preparation is deliberately stored separately from
-- the Doctor's actual encounter_investigations. A proposal cannot silently
-- become a final clinical order merely because staff prepared it.
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
  constraint staff_investigation_proposals_name check (length(btrim(name)) between 1 and 200),
  constraint staff_investigation_proposals_note check (note is null or length(note) <= 1000)
);
create index staff_investigation_proposals_encounter_idx
  on public.staff_investigation_proposals (encounter_id, created_at);
create index staff_investigation_proposals_doctor_idx
  on public.staff_investigation_proposals (owner_doctor_id, created_at desc);

-- Absolute role ceilings. An explicit permission can only narrow this set.
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
  select exists (
    select 1
    from public.doctor_staff_grants g
    join public.doctor_staff_locations l
      on l.grant_id = g.id
     and l.doctor_profile_id = g.doctor_profile_id
    join public.doctor_staff_permissions p
      on p.grant_id = g.id
     and p.permission = target_permission
    join public.practice_location_members m
      on m.practice_location_id = l.practice_location_id
     and m.user_id = g.staff_user_id
     and m.status = 'ACTIVE'
     -- Avoid same-migration direct use of the newly-added location_role enum
     -- value. Text comparison preserves the broad-role boundary for both roles.
     and m.role::text = g.role::text
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
    select 1
    from public.patient_location_links pll
    where pll.patient_id = target_patient_id
      and public.has_doctor_staff_permission(
        target_doctor_id,
        pll.practice_location_id,
        target_permission
      )
  );
$$;

revoke all on function public.staff_role_allows_permission(public.doctor_staff_role, public.doctor_staff_permission) from public;
revoke all on function public.has_doctor_staff_permission(uuid, uuid, public.doctor_staff_permission) from public;
revoke all on function public.has_doctor_staff_permission_for_patient(uuid, uuid, public.doctor_staff_permission) from public;
grant execute on function public.staff_role_allows_permission(public.doctor_staff_role, public.doctor_staff_permission) to authenticated;
grant execute on function public.has_doctor_staff_permission(uuid, uuid, public.doctor_staff_permission) to authenticated;
grant execute on function public.has_doctor_staff_permission_for_patient(uuid, uuid, public.doctor_staff_permission) to authenticated;

-- Server-only finalization of an invitation/account-link. The caller must use
-- the service role. The invitation itself was authored by the authenticated
-- Doctor under RLS and therefore supplies the Doctor authority context. An
-- invitation alone creates no grant and confers no authorization.
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
  inv public.doctor_staff_invitations%rowtype;
  new_grant_id uuid;
  loc uuid;
  perm public.doctor_staff_permission;
  doctor_user_id uuid;
  existing_status text;
begin
  if current_user not in ('postgres', 'service_role', 'supabase_admin') then
    raise exception 'STAFF_LINK_SERVICE_ONLY';
  end if;

  select * into inv
  from public.doctor_staff_invitations
  where id = target_invitation_id
  for update;

  if not found or inv.revoked_at is not null or inv.linked_at is not null or inv.expires_at <= now() then
    raise exception 'STAFF_INVITATION_NOT_LINKABLE';
  end if;

  if not exists (select 1 from public.profiles p where p.id = target_staff_user_id) then
    raise exception 'STAFF_PROFILE_NOT_READY';
  end if;

  select dp.user_id into doctor_user_id
  from public.doctor_profiles dp
  where dp.id = inv.doctor_profile_id;

  if doctor_user_id is null or doctor_user_id = target_staff_user_id then
    raise exception 'STAFF_SELF_LINK_FORBIDDEN';
  end if;

  if cardinality(inv.requested_location_ids) <> (
    select count(distinct x)::int from unnest(inv.requested_location_ids) as x
  ) then
    raise exception 'STAFF_DUPLICATE_LOCATION';
  end if;

  if cardinality(inv.requested_location_ids) <> (
    select count(*)::int
    from public.doctor_chambers dc
    where dc.doctor_profile_id = inv.doctor_profile_id
      and dc.practice_location_id = any(inv.requested_location_ids)
  ) then
    raise exception 'STAFF_LOCATION_NOT_DOCTOR_CHAMBER';
  end if;

  if exists (
    select 1 from unnest(inv.requested_permissions) p
    where not public.staff_role_allows_permission(inv.role, p)
  ) then
    raise exception 'STAFF_PERMISSION_EXCEEDS_ROLE';
  end if;

  if exists (
    select 1
    from public.doctor_staff_grants g
    where g.doctor_profile_id = inv.doctor_profile_id
      and g.staff_user_id = target_staff_user_id
      and g.status <> 'REMOVED'
  ) then
    raise exception 'STAFF_RELATIONSHIP_ALREADY_EXISTS';
  end if;

  -- Re-adoption of a previously removed relationship reuses the historical row
  -- rather than deleting audit attribution.
  select id into new_grant_id
  from public.doctor_staff_grants
  where doctor_profile_id = inv.doctor_profile_id
    and staff_user_id = target_staff_user_id
  for update;

  if found then
    update public.doctor_staff_grants
    set role = inv.role,
        status = 'ACTIVE',
        source_invitation_id = inv.id,
        starts_at = now(),
        ends_at = null,
        temporarily_disabled_at = null,
        removed_at = null,
        updated_by = inv.created_by,
        updated_at = now()
    where id = new_grant_id;
    delete from public.doctor_staff_locations where grant_id = new_grant_id;
    delete from public.doctor_staff_permissions where grant_id = new_grant_id;
  else
    insert into public.doctor_staff_grants (
      doctor_profile_id, staff_user_id, role, status,
      source_invitation_id, created_by, updated_by
    ) values (
      inv.doctor_profile_id, target_staff_user_id, inv.role, 'ACTIVE',
      inv.id, inv.created_by, inv.created_by
    ) returning id into new_grant_id;
  end if;

  foreach loc in array inv.requested_location_ids loop
    -- Respect a location-level suspension. Doctor-specific Staff Management must
    -- never bypass the broader location-entry boundary.
    select m.status::text into existing_status
    from public.practice_location_members m
    where m.practice_location_id = loc
      and m.user_id = target_staff_user_id
      and m.role::text = inv.role::text
    limit 1;

    if existing_status = 'SUSPENDED' then
      raise exception 'STAFF_LOCATION_MEMBERSHIP_SUSPENDED';
    end if;

    if existing_status is null then
      -- Dynamic cast defers use of the newly-added ASSISTANT enum value until
      -- runtime, after this migration has committed.
      execute
        'insert into public.practice_location_members '
        || '(practice_location_id, user_id, role, status, invited_by, joined_at) '
        || 'values ($1, $2, $3::public.location_role, ''ACTIVE'', $4, now())'
      using loc, target_staff_user_id, inv.role::text, inv.created_by;
    elsif existing_status = 'INVITED' then
      update public.practice_location_members m
      set status = 'ACTIVE', joined_at = coalesce(joined_at, now()), updated_at = now()
      where m.practice_location_id = loc
        and m.user_id = target_staff_user_id
        and m.role::text = inv.role::text;
    end if;

    insert into public.doctor_staff_locations (grant_id, doctor_profile_id, practice_location_id)
    values (new_grant_id, inv.doctor_profile_id, loc);
  end loop;

  foreach perm in array inv.requested_permissions loop
    insert into public.doctor_staff_permissions (grant_id, permission)
    values (new_grant_id, perm);
  end loop;

  update public.doctor_staff_invitations
  set linked_at = now(), linked_user_id = target_staff_user_id
  where id = inv.id;

  insert into public.audit_events (
    practice_location_id, actor_id, action, resource_type, resource_id, meta
  ) values (
    inv.requested_location_ids[1], inv.created_by,
    'STAFF_LINKED', 'doctor_staff_grant', new_grant_id,
    jsonb_build_object(
      'doctor_profile_id', inv.doctor_profile_id,
      'staff_user_id', target_staff_user_id,
      'staff_role', inv.role,
      'invitation_id', inv.id
    )
  );

  return new_grant_id;
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
declare
  g public.doctor_staff_grants%rowtype;
begin
  perform public.require_aal2();
  select * into g from public.doctor_staff_grants where id = target_grant_id for update;
  if not found or g.doctor_profile_id <> public.current_doctor_id() then
    raise exception 'STAFF_GRANT_NOT_FOUND';
  end if;

  update public.doctor_staff_grants
  set status = target_status,
      temporarily_disabled_at = case when target_status = 'TEMPORARILY_DISABLED' then now() else null end,
      removed_at = case when target_status = 'REMOVED' then now() else null end,
      updated_by = auth.uid(),
      updated_at = now()
  where id = target_grant_id;

  insert into public.audit_events (practice_location_id, actor_id, action, resource_type, resource_id, meta)
  select l.practice_location_id, auth.uid(), 'STAFF_STATUS_CHANGED', 'doctor_staff_grant', g.id,
         jsonb_build_object('doctor_profile_id', g.doctor_profile_id, 'staff_user_id', g.staff_user_id,
                            'staff_role', g.role, 'new_status', target_status)
  from public.doctor_staff_locations l where l.grant_id = g.id order by l.created_at limit 1;
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
  g public.doctor_staff_grants%rowtype;
  loc uuid;
  existing_status text;
begin
  perform public.require_aal2();
  select * into g from public.doctor_staff_grants where id = target_grant_id for update;
  if not found or g.doctor_profile_id <> public.current_doctor_id() or g.status = 'REMOVED' then
    raise exception 'STAFF_GRANT_NOT_EDITABLE';
  end if;
  if target_location_ids is null or cardinality(target_location_ids) = 0 then
    raise exception 'STAFF_LOCATION_REQUIRED';
  end if;
  if cardinality(target_location_ids) <> (select count(distinct x)::int from unnest(target_location_ids) x) then
    raise exception 'STAFF_DUPLICATE_LOCATION';
  end if;
  if cardinality(target_location_ids) <> (
    select count(*)::int from public.doctor_chambers dc
    where dc.doctor_profile_id = g.doctor_profile_id and dc.practice_location_id = any(target_location_ids)
  ) then
    raise exception 'STAFF_LOCATION_NOT_DOCTOR_CHAMBER';
  end if;

  delete from public.doctor_staff_locations where grant_id = g.id;
  foreach loc in array target_location_ids loop
    select m.status::text into existing_status
    from public.practice_location_members m
    where m.practice_location_id = loc and m.user_id = g.staff_user_id and m.role::text = g.role::text
    limit 1;
    if existing_status = 'SUSPENDED' then raise exception 'STAFF_LOCATION_MEMBERSHIP_SUSPENDED'; end if;
    if existing_status is null then
      execute
        'insert into public.practice_location_members '
        || '(practice_location_id, user_id, role, status, invited_by, joined_at) '
        || 'values ($1, $2, $3::public.location_role, ''ACTIVE'', $4, now())'
      using loc, g.staff_user_id, g.role::text, auth.uid();
    elsif existing_status = 'INVITED' then
      update public.practice_location_members m
      set status = 'ACTIVE', joined_at = coalesce(joined_at, now()), updated_at = now()
      where m.practice_location_id = loc and m.user_id = g.staff_user_id and m.role::text = g.role::text;
    end if;
    insert into public.doctor_staff_locations (grant_id, doctor_profile_id, practice_location_id)
    values (g.id, g.doctor_profile_id, loc);
  end loop;

  update public.doctor_staff_grants set updated_by = auth.uid(), updated_at = now() where id = g.id;
  insert into public.audit_events (practice_location_id, actor_id, action, resource_type, resource_id, meta)
  values (target_location_ids[1], auth.uid(), 'STAFF_LOCATIONS_REPLACED', 'doctor_staff_grant', g.id,
          jsonb_build_object('doctor_profile_id', g.doctor_profile_id, 'staff_user_id', g.staff_user_id,
                             'location_ids', target_location_ids));
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
  g public.doctor_staff_grants%rowtype;
  perm public.doctor_staff_permission;
begin
  perform public.require_aal2();
  select * into g from public.doctor_staff_grants where id = target_grant_id for update;
  if not found or g.doctor_profile_id <> public.current_doctor_id() or g.status = 'REMOVED' then
    raise exception 'STAFF_GRANT_NOT_EDITABLE';
  end if;
  if exists (select 1 from unnest(coalesce(target_permissions, '{}'::public.doctor_staff_permission[])) p
             where not public.staff_role_allows_permission(g.role, p)) then
    raise exception 'STAFF_PERMISSION_EXCEEDS_ROLE';
  end if;
  delete from public.doctor_staff_permissions where grant_id = g.id;
  foreach perm in array coalesce(target_permissions, '{}'::public.doctor_staff_permission[]) loop
    insert into public.doctor_staff_permissions (grant_id, permission) values (g.id, perm)
    on conflict do nothing;
  end loop;
  update public.doctor_staff_grants set updated_by = auth.uid(), updated_at = now() where id = g.id;
  insert into public.audit_events (practice_location_id, actor_id, action, resource_type, resource_id, meta)
  select l.practice_location_id, auth.uid(), 'STAFF_PERMISSIONS_REPLACED', 'doctor_staff_grant', g.id,
         jsonb_build_object('doctor_profile_id', g.doctor_profile_id, 'staff_user_id', g.staff_user_id,
                            'permissions', coalesce(target_permissions, '{}'::public.doctor_staff_permission[]))
  from public.doctor_staff_locations l where l.grant_id = g.id order by l.created_at limit 1;
end;
$$;

revoke all on function public.doctor_set_staff_status(uuid, public.doctor_staff_status) from public;
revoke all on function public.doctor_replace_staff_locations(uuid, uuid[]) from public;
revoke all on function public.doctor_replace_staff_permissions(uuid, public.doctor_staff_permission[]) from public;
grant execute on function public.doctor_set_staff_status(uuid, public.doctor_staff_status) to authenticated;
grant execute on function public.doctor_replace_staff_locations(uuid, uuid[]) to authenticated;
grant execute on function public.doctor_replace_staff_permissions(uuid, public.doctor_staff_permission[]) to authenticated;

-- Narrow Assistant intake writer: only vitals on a DRAFT encounter. No complaint,
-- illness, assessment, advice, diagnosis or prescription fields are exposed.
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
  e public.encounters%rowtype;
  g_id uuid;
  g_role public.doctor_staff_role;
begin
  perform public.require_aal2();
  select * into e from public.encounters where id = target_encounter_id for update;
  if not found or e.status <> 'DRAFT' then raise exception 'STAFF_INTAKE_ENCOUNTER_NOT_DRAFT'; end if;
  if not public.has_doctor_staff_permission(e.owner_doctor_id, e.practice_location_id, 'intake.write') then
    raise exception 'STAFF_INTAKE_FORBIDDEN';
  end if;
  select g.id, g.role into g_id, g_role
  from public.doctor_staff_grants g
  join public.doctor_staff_locations l on l.grant_id = g.id and l.practice_location_id = e.practice_location_id
  where g.doctor_profile_id = e.owner_doctor_id and g.staff_user_id = auth.uid() and g.status = 'ACTIVE'
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
  where id = e.id;

  insert into public.audit_events (practice_location_id, actor_id, action, resource_type, resource_id, meta)
  values (e.practice_location_id, auth.uid(), 'STAFF_INTAKE_VITALS_UPDATED', 'encounter', e.id,
          jsonb_build_object('doctor_profile_id', e.owner_doctor_id, 'staff_role', g_role,
                             'grant_id', g_id));
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
  e public.encounters%rowtype;
  g_id uuid;
  g_role public.doctor_staff_role;
  proposal_id uuid;
begin
  perform public.require_aal2();
  select * into e from public.encounters where id = target_encounter_id;
  if not found or e.status <> 'DRAFT' then raise exception 'STAFF_INVESTIGATION_ENCOUNTER_NOT_DRAFT'; end if;
  if not public.has_doctor_staff_permission(e.owner_doctor_id, e.practice_location_id, 'investigation.prepare') then
    raise exception 'STAFF_INVESTIGATION_FORBIDDEN';
  end if;
  select g.id, g.role into g_id, g_role
  from public.doctor_staff_grants g
  join public.doctor_staff_locations l on l.grant_id = g.id and l.practice_location_id = e.practice_location_id
  where g.doctor_profile_id = e.owner_doctor_id and g.staff_user_id = auth.uid() and g.status = 'ACTIVE'
  limit 1;

  insert into public.staff_investigation_proposals (
    grant_id, owner_doctor_id, practice_location_id, encounter_id, proposed_by, name, note
  ) values (
    g_id, e.owner_doctor_id, e.practice_location_id, e.id, auth.uid(), btrim(target_name), target_note
  ) returning id into proposal_id;

  insert into public.audit_events (practice_location_id, actor_id, action, resource_type, resource_id, meta)
  values (e.practice_location_id, auth.uid(), 'STAFF_INVESTIGATION_PROPOSED', 'staff_investigation_proposal', proposal_id,
          jsonb_build_object('doctor_profile_id', e.owner_doctor_id, 'staff_role', g_role,
                             'grant_id', g_id, 'encounter_id', e.id));
  return proposal_id;
end;
$$;
revoke all on function public.staff_write_intake_vitals(uuid,numeric,numeric,numeric,integer,integer,integer,integer,integer) from public;
revoke all on function public.staff_prepare_investigation(uuid,text,text) from public;
grant execute on function public.staff_write_intake_vitals(uuid,numeric,numeric,numeric,integer,integer,integer,integer,integer) to authenticated;
grant execute on function public.staff_prepare_investigation(uuid,text,text) to authenticated;

-- RLS for new Staff Management tables.
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
create policy doctor_staff_invitations_update_doctor
  on public.doctor_staff_invitations for update to authenticated
  using (doctor_profile_id = public.current_doctor_id() and public.session_is_aal2())
  with check (doctor_profile_id = public.current_doctor_id() and public.session_is_aal2());

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

-- Additive delegated read policies. Existing Doctor and legacy receptionist
-- policies are not replaced or broadened.
create policy doctor_chambers_select_delegated_staff
  on public.doctor_chambers for select to authenticated
  using (public.has_doctor_staff_permission(doctor_profile_id, practice_location_id, 'chamber.view'));

create policy patients_select_delegated_staff
  on public.patients for select to authenticated
  using (public.has_doctor_staff_permission_for_patient(owner_doctor_id, id, 'patient.lookup'));

create policy appointments_select_delegated_staff
  on public.appointments for select to authenticated
  using (
    public.has_doctor_staff_permission(owner_doctor_id, practice_location_id, 'appointments.view')
    or public.has_doctor_staff_permission(owner_doctor_id, practice_location_id, 'appointments.manage')
  );

create policy queue_entries_select_delegated_staff
  on public.queue_entries for select to authenticated
  using (exists (
    select 1 from public.appointments a
    where a.id = queue_entries.appointment_id
      and public.has_doctor_staff_permission(a.owner_doctor_id, a.practice_location_id, 'queue.manage')
  ));

-- Doctor may read audit events emitted by their delegated staff. No new
-- LOCATION_ADMIN audit visibility is introduced.
create policy audit_events_select_doctor_team
  on public.audit_events for select to authenticated
  using (
    public.current_doctor_id() is not null
    and meta ->> 'doctor_profile_id' = public.current_doctor_id()::text
  );

-- Direct table access remains default-deny. New data changes go through the
-- reviewed RPCs above; service-role finalization is server-only.
revoke all on public.doctor_staff_invitations from anon;
revoke all on public.doctor_staff_grants from anon;
revoke all on public.doctor_staff_locations from anon;
revoke all on public.doctor_staff_permissions from anon;
revoke all on public.staff_investigation_proposals from anon;

grant select, insert, update on public.doctor_staff_invitations to authenticated;
grant select on public.doctor_staff_grants to authenticated;
grant select on public.doctor_staff_locations to authenticated;
grant select on public.doctor_staff_permissions to authenticated;
grant select on public.staff_investigation_proposals to authenticated;
