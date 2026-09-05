-- Doctor's Diary Database V2, P1 identity operational closure.
-- Shared credential-review pull queue + explicit platform-staff lifecycle.
-- No reviewer assignment state is persisted in P1.

create or replace function public.list_pending_credential_reviews(
  after_action_seq bigint default null,
  page_size integer default 25
) returns table (
  credential_id uuid,
  actionable_since_seq bigint,
  applicant_profile_id uuid,
  applicant_full_name text,
  professional_profile_id uuid,
  professional_display_name text,
  applicant_profession profession,
  regulator_id uuid,
  regulator_country_code text,
  regulator_authority_code text,
  regulator_authority_name text,
  registration_display text,
  evidence_ref text,
  verification_status credential_status,
  awaiting_second_verifier boolean,
  caller_is_first_verifier boolean
)
language plpgsql security definer
set search_path = public, pg_temp
as $$declare caller uuid := public.current_profile_id();
begin
  if caller is null or not public.has_platform_staff_role(caller, 'CREDENTIAL_VERIFIER') then
    raise exception 'CREDENTIAL_VERIFIER_REQUIRED' using errcode='42501';
  end if;
  if page_size < 1 or page_size > 100 then
    raise exception 'CREDENTIAL_REVIEW_PAGE_SIZE_INVALID' using errcode='22023';
  end if;
  if after_action_seq is not null and after_action_seq < 0 then
    raise exception 'CREDENTIAL_REVIEW_CURSOR_INVALID' using errcode='22023';
  end if;

  return query
  with pending as (
    select pc.id as credential_id,
           action_event.action_seq,
           pp.profile_id as applicant_profile_id,
           p.full_name as applicant_full_name,
           pp.id as professional_profile_id,
           pp.display_name as professional_display_name,
           pp.profession as applicant_profession,
           r.id as regulator_id,
           r.country_code as regulator_country_code,
           r.authority_code as regulator_authority_code,
           r.authority_name as regulator_authority_name,           pc.registration_display,
           pc.evidence_ref,
           pc.verification_status,
           first_event.first_actor,
           exists (
             select 1
             from public.credential_review_events verified_event
             join public.professional_credentials verified_credential
               on verified_credential.id = verified_event.credential_id
             where verified_credential.regulator_id = pc.regulator_id
               and verified_event.event_kind = 'VERIFIED'
           ) as regulator_has_verified_history
    from public.professional_credentials pc
    join public.professional_profiles pp on pp.id = pc.professional_profile_id
    join public.profiles p on p.id = pp.profile_id
    join public.regulators r on r.id = pc.regulator_id
    join lateral (
      select max(review_event.seq)::bigint as action_seq
      from public.credential_review_events review_event
      where review_event.credential_id = pc.id
        and review_event.event_kind in ('SUBMITTED','RESUBMITTED')
    ) action_event on action_event.action_seq is not null
    left join lateral (
      select review_event.actor_profile_id as first_actor
      from public.credential_review_events review_event
      where review_event.credential_id = pc.id
        and review_event.event_kind = 'FIRST_VERIFIER_APPROVED'      order by review_event.seq asc
      limit 1
    ) first_event on true
    where pc.verification_status = 'PENDING'
  )
  select q.credential_id,
         q.action_seq,
         q.applicant_profile_id,
         q.applicant_full_name,
         q.professional_profile_id,
         q.professional_display_name,
         q.applicant_profession,
         q.regulator_id,
         q.regulator_country_code,
         q.regulator_authority_code,
         q.regulator_authority_name,
         q.registration_display,
         q.evidence_ref,
         q.verification_status,
         (not q.regulator_has_verified_history and q.first_actor is not null),
         coalesce(q.first_actor = caller, false)
  from pending q
  where after_action_seq is null or q.action_seq > after_action_seq
  order by q.action_seq asc
  limit page_size;
end $$;

create or replace function public.read_credential_review_case(
  credential_key uuid
) returns table (  credential_id uuid,
  actionable_since_seq bigint,
  applicant_profile_id uuid,
  applicant_full_name text,
  professional_profile_id uuid,
  professional_display_name text,
  applicant_profession profession,
  regulator_id uuid,
  regulator_country_code text,
  regulator_authority_code text,
  regulator_authority_name text,
  registration_display text,
  evidence_ref text,
  verification_status credential_status,
  verification_method credential_verification_method,
  verified_at timestamptz,
  expires_at timestamptz,
  awaiting_second_verifier boolean,
  caller_is_first_verifier boolean
)
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare caller uuid := public.current_profile_id();
begin
  if caller is null or not public.has_platform_staff_role(caller, 'CREDENTIAL_VERIFIER') then
    raise exception 'CREDENTIAL_VERIFIER_REQUIRED' using errcode='42501';
  end if;
  if not exists (select 1 from public.professional_credentials where id=credential_key) then
    raise exception 'CREDENTIAL_REVIEW_NOT_FOUND' using errcode='P0001';
  end if;
  return query
  select pc.id,
         action_event.action_seq,
         pp.profile_id,
         p.full_name,
         pp.id,
         pp.display_name,
         pp.profession,
         r.id,
         r.country_code,
         r.authority_code,
         r.authority_name,
         pc.registration_display,
         pc.evidence_ref,
         pc.verification_status,
         pc.verification_method,
         pc.verified_at,
         pc.expires_at,
         (not regulator_state.has_verified_history and first_event.first_actor is not null),
         coalesce(first_event.first_actor = caller, false)
  from public.professional_credentials pc
  join public.professional_profiles pp on pp.id=pc.professional_profile_id
  join public.profiles p on p.id=pp.profile_id
  join public.regulators r on r.id=pc.regulator_id
  left join lateral (
    select max(review_event.seq)::bigint as action_seq
    from public.credential_review_events review_event
    where review_event.credential_id=pc.id
      and review_event.event_kind in ('SUBMITTED','RESUBMITTED')
  ) action_event on true  left join lateral (
    select review_event.actor_profile_id as first_actor
    from public.credential_review_events review_event
    where review_event.credential_id=pc.id
      and review_event.event_kind='FIRST_VERIFIER_APPROVED'
    order by review_event.seq asc
    limit 1
  ) first_event on true
  cross join lateral (
    select exists (
      select 1
      from public.credential_review_events verified_event
      join public.professional_credentials verified_credential
        on verified_credential.id=verified_event.credential_id
      where verified_credential.regulator_id=pc.regulator_id
        and verified_event.event_kind='VERIFIED'
    ) as has_verified_history
  ) regulator_state
  where pc.id=credential_key;
end $$;

create or replace function public.read_credential_review_history(
  credential_key uuid,
  after_event_seq bigint default null,
  page_size integer default 100
) returns table (
  event_seq bigint,
  event_kind text,
  from_status credential_status,
  to_status credential_status,
  actor_profile_id uuid,  actor_role platform_staff_role,
  note text,
  occurred_at timestamptz
)
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare caller uuid := public.current_profile_id();
begin
  if caller is null or not public.has_platform_staff_role(caller, 'CREDENTIAL_VERIFIER') then
    raise exception 'CREDENTIAL_VERIFIER_REQUIRED' using errcode='42501';
  end if;
  if page_size < 1 or page_size > 200 then
    raise exception 'CREDENTIAL_REVIEW_HISTORY_PAGE_SIZE_INVALID' using errcode='22023';
  end if;
  if after_event_seq is not null and after_event_seq < 0 then
    raise exception 'CREDENTIAL_REVIEW_CURSOR_INVALID' using errcode='22023';
  end if;
  if not exists (select 1 from public.professional_credentials where id=credential_key) then
    raise exception 'CREDENTIAL_REVIEW_NOT_FOUND' using errcode='P0001';
  end if;

  return query
  select cre.seq,
         cre.event_kind,
         cre.from_status,
         cre.to_status,
         cre.actor_profile_id,
         cre.actor_role,
         cre.note,
         cre.occurred_at
  from public.credential_review_events cre  where cre.credential_id=credential_key
    and (after_event_seq is null or cre.seq > after_event_seq)
  order by cre.seq asc
  limit page_size;
end $$;

create or replace function public.activate_platform_staff(
  target_profile_id uuid,
  staff_note text default null
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := public.current_profile_id();
  existing public.platform_staff%rowtype;
  changed boolean := false;
  action_code text;
begin
  if actor is null or not public.has_platform_staff_role(actor, 'PLATFORM_ADMIN') then
    raise exception 'PLATFORM_ADMIN_REQUIRED' using errcode='42501';
  end if;
  if not exists (
    select 1 from public.profiles
    where id=target_profile_id and deactivated_at is null
  ) then
    raise exception 'ACTIVE_PROFILE_REQUIRED' using errcode='P0001';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('dd.platform_admin_lifecycle', 0)
  );  select * into existing
  from public.platform_staff
  where profile_id=target_profile_id
  for update;

  if not found then
    insert into public.platform_staff(profile_id, granted_by, note)
    values(target_profile_id, actor, nullif(btrim(coalesce(staff_note,'')),''));
    changed := true;
    action_code := 'PLATFORM_STAFF_ONBOARDED';
  elsif not existing.is_active or existing.revoked_at is not null then
    update public.platform_staff
    set is_active=true,
        revoked_at=null,
        granted_by=actor,
        note=nullif(btrim(coalesce(staff_note,'')),'')
    where profile_id=target_profile_id;
    changed := true;
    action_code := 'PLATFORM_STAFF_REACTIVATED';
  end if;

  if changed then
    perform public.emit_audit_event(
      action_code, 'platform_staff', target_profile_id, null
    );
  end if;
  return jsonb_build_object('profile_id',target_profile_id,'changed',changed);
end $$;

create or replace function public.deactivate_platform_staff(
  target_profile_id uuid,
  staff_note text default null
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := public.current_profile_id();
  target public.platform_staff%rowtype;
  live_admins integer;
  role_row record;
  revoked_count integer := 0;
  revoked_at_value timestamptz := clock_timestamp();
begin
  if actor is null or not public.has_platform_staff_role(actor, 'PLATFORM_ADMIN') then
    raise exception 'PLATFORM_ADMIN_REQUIRED' using errcode='42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('dd.platform_admin_lifecycle', 0)
  );

  select * into target
  from public.platform_staff
  where profile_id=target_profile_id
  for update;
  if not found then
    raise exception 'PLATFORM_STAFF_NOT_FOUND' using errcode='P0001';
  end if;
  if not target.is_active or target.revoked_at is not null then
    return jsonb_build_object(
      'profile_id',target_profile_id,'changed',false,'revoked_roles',0
    );
  end if;
  if exists (
    select 1 from public.platform_staff_roles psr
    where psr.profile_id=target_profile_id
      and psr.role='PLATFORM_ADMIN'
      and psr.revoked_at is null
  ) then
    select count(*)::integer into live_admins
    from public.platform_staff ps
    join public.platform_staff_roles psr on psr.profile_id=ps.profile_id
    where ps.is_active and ps.revoked_at is null
      and psr.role='PLATFORM_ADMIN' and psr.revoked_at is null;
    if live_admins <= 1 then
      raise exception 'FINAL_PLATFORM_ADMIN_REQUIRED' using errcode='P0001';
    end if;
  end if;

  for role_row in
    update public.platform_staff_roles
    set revoked_at=revoked_at_value
    where profile_id=target_profile_id and revoked_at is null
    returning id
  loop
    revoked_count := revoked_count + 1;
    perform public.emit_audit_event(
      'PLATFORM_ROLE_REVOKED','platform_staff_role',role_row.id,null
    );
  end loop;

  update public.platform_staff
  set is_active=false, revoked_at=revoked_at_value,
      note=nullif(btrim(coalesce(staff_note,'')),'')
  where profile_id=target_profile_id;
  perform public.emit_audit_event(
    'PLATFORM_STAFF_DEACTIVATED','platform_staff',target_profile_id,null
  );
  return jsonb_build_object(
    'profile_id',target_profile_id,'changed',true,'revoked_roles',revoked_count
  );
end $$;

create or replace function public.grant_platform_staff_role(
  target_profile_id uuid,
  requested platform_staff_role
) returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare actor uuid := public.current_profile_id(); result uuid;
begin
  if actor is null or not public.has_platform_staff_role(actor, 'PLATFORM_ADMIN') then
    raise exception 'PLATFORM_ADMIN_REQUIRED' using errcode='42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('dd.platform_admin_lifecycle', 0)
  );
  if not exists (
    select 1 from public.platform_staff
    where profile_id=target_profile_id and is_active and revoked_at is null
  ) then
    raise exception 'ACTIVE_PLATFORM_STAFF_REQUIRED' using errcode='P0001';
  end if;
  insert into public.platform_staff_roles(profile_id, role, granted_by)
  values(target_profile_id, requested, actor)
  returning id into result;
  perform public.emit_audit_event(
    'PLATFORM_ROLE_GRANTED','platform_staff_role',result,null
  );
  return result;
exception when unique_violation then
  raise exception 'PLATFORM_ROLE_ALREADY_ACTIVE' using errcode='P0001';
end $$;

create or replace function public.revoke_platform_staff_role(
  target_role_id uuid
) returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := public.current_profile_id();
  target public.platform_staff_roles%rowtype;
  live_admins integer;
begin
  if actor is null or not public.has_platform_staff_role(actor, 'PLATFORM_ADMIN') then
    raise exception 'PLATFORM_ADMIN_REQUIRED' using errcode='42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('dd.platform_admin_lifecycle', 0)
  );
  select * into target
  from public.platform_staff_roles
  where id=target_role_id
  for update;
  if not found then
    raise exception 'PLATFORM_ROLE_NOT_FOUND' using errcode='P0001';
  end if;
  if target.revoked_at is not null then
    return;
  end if;
  if target.role='PLATFORM_ADMIN' then
    select count(*)::integer into live_admins
    from public.platform_staff ps
    join public.platform_staff_roles psr on psr.profile_id=ps.profile_id
    where ps.is_active and ps.revoked_at is null
      and psr.role='PLATFORM_ADMIN' and psr.revoked_at is null;
    if live_admins <= 1 then
      raise exception 'FINAL_PLATFORM_ADMIN_REQUIRED' using errcode='P0001';
    end if;
  end if;

  update public.platform_staff_roles
  set revoked_at=clock_timestamp()
  where id=target_role_id;
  perform public.emit_audit_event(
    'PLATFORM_ROLE_REVOKED','platform_staff_role',target_role_id,null
  );
end $$;

create or replace function public.bootstrap_platform_admin(
  target_profile_id uuid,
  staff_note text default null
) returns jsonb
language plpgsql security invoker
set search_path = public, pg_temp
as $$
declare
  database_owner name;
  role_id uuid;
  staff_changed boolean := false;
begin
  select pg_catalog.pg_get_userbyid(d.datdba)
  into database_owner
  from pg_catalog.pg_database d
  where d.datname=pg_catalog.current_database();

  if database_owner is null then
    raise exception 'DATABASE_OWNER_REQUIRED' using errcode='42501';
  end if;
  if session_user = database_owner::text
     and current_user = database_owner::text then
    null;
  else
    raise exception 'DATABASE_OWNER_REQUIRED' using errcode='42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('dd.platform_admin_lifecycle', 0)
  );
  if exists (
    select 1
    from public.platform_staff ps
    join public.platform_staff_roles psr on psr.profile_id=ps.profile_id
    where ps.is_active and ps.revoked_at is null
      and psr.role='PLATFORM_ADMIN' and psr.revoked_at is null
  ) then
    raise exception 'LIVE_PLATFORM_ADMIN_ALREADY_EXISTS' using errcode='P0001';
  end if;
  if not exists (
    select 1 from public.profiles
    where id=target_profile_id and deactivated_at is null
  ) then
    raise exception 'ACTIVE_PROFILE_REQUIRED' using errcode='P0001';
  end if;
  select not exists (
    select 1 from public.platform_staff
    where profile_id=target_profile_id and is_active and revoked_at is null
  ) into staff_changed;

  insert into public.platform_staff(
    profile_id, is_active, granted_by, revoked_at, note, is_owner_account
  ) values (
    target_profile_id, true, null, null,
    nullif(btrim(coalesce(staff_note,'')),''), false
  )
  on conflict (profile_id) do update
    set is_active=true,
        revoked_at=null,
        note=excluded.note;

  insert into public.platform_staff_roles(profile_id, role, granted_by)
  values(target_profile_id, 'PLATFORM_ADMIN', target_profile_id)
  returning id into role_id;

  insert into public.audit_events(
    actor_kind, actor_id, acted_as, action, resource_type, resource_id
  ) values (
    'SYSTEM', null, 'DB_OWNER_BOOTSTRAP',
    'PLATFORM_STAFF_BOOTSTRAPPED','platform_staff',target_profile_id
  );
  insert into public.audit_events(
    actor_kind, actor_id, acted_as, action, resource_type, resource_id
  ) values (
    'SYSTEM', null, 'DB_OWNER_BOOTSTRAP',
    'PLATFORM_ROLE_GRANTED','platform_staff_role',role_id
  );

  return jsonb_build_object(
    'profile_id',target_profile_id,
    'role_id',role_id,
    'staff_changed',staff_changed
  );
end $$;