-- Doctor's Diary Database V2, P1 identity-completion functions.
-- All caller-facing identity writes are SECURITY DEFINER and derive actor identity.

create or replace function public.has_platform_staff_role(
  subject_profile_id uuid,
  requested platform_staff_role
) returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.platform_staff ps
    join public.platform_staff_roles psr on psr.profile_id = ps.profile_id
    where ps.profile_id = subject_profile_id
      and ps.is_active
      and ps.revoked_at is null
      and psr.role = requested
      and psr.revoked_at is null
  )
$$;

create or replace function public.prevent_append_only_p1_change()
returns trigger language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'APPEND_ONLY_RECORD' using errcode='P0001';
end $$;

create trigger credential_review_events_append_only
before update or delete on public.credential_review_events
for each row execute function public.prevent_append_only_p1_change();
create or replace function public.enforce_platform_staff_role_separation()
returns trigger language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.revoked_at is null and new.role in ('HEALTH_ADVISORY_EDITOR','PUBLIC_HEALTH_SOURCE_STEWARD') then
    if exists (
      select 1 from public.platform_staff_roles x
      where x.profile_id = new.profile_id
        and x.revoked_at is null
        and x.id is distinct from new.id
        and x.role = case new.role
          when 'HEALTH_ADVISORY_EDITOR' then 'PUBLIC_HEALTH_SOURCE_STEWARD'::platform_staff_role
          else 'HEALTH_ADVISORY_EDITOR'::platform_staff_role end
    ) then
      raise exception 'MUTUALLY_EXCLUSIVE_PLATFORM_ROLES' using errcode='23514';
    end if;
  end if;
  return new;
end $$;

create trigger platform_staff_roles_separation
before insert or update on public.platform_staff_roles
for each row execute function public.enforce_platform_staff_role_separation();

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
  if not exists (select 1 from public.platform_staff where profile_id=target_profile_id and is_active and revoked_at is null) then
    raise exception 'ACTIVE_PLATFORM_STAFF_REQUIRED' using errcode='P0001';
  end if;
  insert into public.platform_staff_roles(profile_id, role, granted_by)
  values(target_profile_id, requested, actor)
  returning id into result;
  perform public.emit_audit_event('PLATFORM_ROLE_GRANTED','platform_staff_role',result,null);
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
declare actor uuid := public.current_profile_id(); target public.platform_staff_roles%rowtype;
begin
  if actor is null or not public.has_platform_staff_role(actor, 'PLATFORM_ADMIN') then
    raise exception 'PLATFORM_ADMIN_REQUIRED' using errcode='42501';
  end if;
  select * into target from public.platform_staff_roles where id=target_role_id for update;
  if not found then raise exception 'PLATFORM_ROLE_NOT_FOUND' using errcode='P0001'; end if;
  if target.revoked_at is null then
    update public.platform_staff_roles set revoked_at=clock_timestamp() where id=target_role_id;
    perform public.emit_audit_event('PLATFORM_ROLE_REVOKED','platform_staff_role',target_role_id,null);
  end if;
end $$;

create or replace function public.refresh_profile_capabilities(subject_profile_id uuid)
returns void language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  delete from public.profile_capabilities where profile_id = subject_profile_id;

  insert into public.profile_capabilities(
    profile_id, capability, granted_by_kind, source_row_id,
    professional_profile_id, effective_from, effective_until
  )
  select pp.profile_id, 'DOCTOR', 'CREDENTIAL', pc.id, pp.id, pc.verified_at, pc.expires_at
  from public.professional_credentials pc
  join public.professional_profiles pp on pp.id=pc.professional_profile_id and pp.profession='DOCTOR'
  where pp.profile_id=subject_profile_id
    and pc.profession='DOCTOR'
    and pc.verification_status='VERIFIED'
    and pc.verified_at is not null and pc.verified_at <= clock_timestamp()
    and (pc.expires_at is null or pc.expires_at > clock_timestamp())
  order by pc.verified_at desc, pc.id asc limit 1;
  insert into public.profile_capabilities(
    profile_id, capability, granted_by_kind, source_row_id,
    professional_profile_id, effective_from, effective_until
  )
  select msp.profile_id, 'MEDICAL_STUDENT', 'ENROLLMENT', se.id, null,
         coalesce(se.verified_at, se.created_at),
         case when se.ended_on is null then null else (se.ended_on + 1)::timestamp at time zone 'UTC' end
  from public.medical_student_profiles msp
  join public.student_enrollments se on se.medical_student_profile_id=msp.id
  where msp.profile_id=subject_profile_id
    and msp.status='ACTIVE'
    and se.verification_status='VERIFIED'
    and se.verified_at is not null and se.verified_at <= clock_timestamp()
    and se.ended_on is null
  order by se.verified_at desc, se.id asc limit 1;

  insert into public.profile_capabilities(profile_id, capability, granted_by_kind, effective_from)
  values(subject_profile_id, 'PUBLIC', 'BASELINE', clock_timestamp());
end $$;

create or replace function public.refresh_student_capability_trigger()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
declare profile_key uuid;
begin
  select msp.profile_id into profile_key
  from public.medical_student_profiles msp
  where msp.id=coalesce(new.medical_student_profile_id, old.medical_student_profile_id);
  perform public.refresh_profile_capabilities(profile_key);
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;

create trigger student_enrollments_capability_refresh
after insert or update or delete on public.student_enrollments
for each row execute function public.refresh_student_capability_trigger();
create or replace function public.refresh_student_profile_capability_trigger()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  perform public.refresh_profile_capabilities(coalesce(new.profile_id, old.profile_id));
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;

create trigger medical_student_profiles_capability_refresh
after update of status on public.medical_student_profiles
for each row execute function public.refresh_student_profile_capability_trigger();

create or replace function public.submit_credential(
  regulator_key uuid,
  registration text,
  evidence_path text default null
) returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare caller uuid:=public.current_profile_id(); professional public.professional_profiles%rowtype; regulator public.regulators%rowtype; result uuid;
begin
  if caller is null then raise exception 'AUTHENTICATION_REQUIRED' using errcode='42501'; end if;
  select * into professional from public.professional_profiles where profile_id=caller;
  if not found then raise exception 'PROFESSIONAL_PROFILE_REQUIRED' using errcode='P0001'; end if;
  select * into regulator from public.regulators where id=regulator_key and is_active;
  if not found then raise exception 'REGULATOR_NOT_AVAILABLE' using errcode='P0001'; end if;
  if btrim(coalesce(registration,''))='' then raise exception 'REGISTRATION_REQUIRED' using errcode='22023'; end if;
  if exists (
    select 1 from public.professional_credentials pc
    where pc.professional_profile_id=professional.id
      and pc.regulator_id=regulator_key
      and pc.verification_status='VERIFIED'
  ) then
    raise exception 'CREDENTIAL_ALREADY_VERIFIED' using errcode='P0001';
  end if;
  insert into public.professional_credentials(
    professional_profile_id, regulator_id, country_code, profession,
    registration_display, verification_status, source_kind, evidence_ref
  ) values (
    professional.id, regulator.id, regulator.country_code, professional.profession,
    btrim(registration), 'PENDING', 'SELF_ASSERTED', nullif(btrim(coalesce(evidence_path,'')),'')
  ) returning id into result;
  insert into public.credential_review_events(
    credential_id,event_kind,from_status,to_status,actor_profile_id,note
  ) values(result,'SUBMITTED',null,'PENDING',caller,null);
  perform public.emit_audit_event('CREDENTIAL_SUBMITTED','professional_credential',result,null);
  return result;
exception when unique_violation then
  raise exception 'CREDENTIAL_REVIEW_ALREADY_OPEN' using errcode='P0001';
end $$;

create or replace function public.respond_to_credential(
  credential_key uuid,
  response_action text,
  evidence_path text default null
) returns credential_status
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare caller uuid:=public.current_profile_id(); target public.professional_credentials%rowtype; next_status credential_status;
begin
  if caller is null then raise exception 'AUTHENTICATION_REQUIRED' using errcode='42501'; end if;
  select pc.* into target
  from public.professional_credentials pc
  join public.professional_profiles pp on pp.id=pc.professional_profile_id
  where pc.id=credential_key and pp.profile_id=caller
  for update of pc;
  if not found then raise exception 'CREDENTIAL_NOT_FOUND' using errcode='P0001'; end if;
  if upper(btrim(coalesce(response_action,''))) <> 'RESUBMIT' then
    raise exception 'CREDENTIAL_RESPONSE_INVALID' using errcode='22023';
  end if;
  if target.verification_status <> 'NEEDS_INFORMATION' then
    raise exception 'CREDENTIAL_NOT_AWAITING_INFORMATION' using errcode='P0001';
  end if;
  update public.professional_credentials
  set verification_status='PENDING',
      evidence_ref=coalesce(nullif(btrim(coalesce(evidence_path,'')),''), evidence_ref),
      verified_at=null,
      verified_by_staff_id=null,
      verification_method=null
  where id=credential_key;
  insert into public.credential_review_events(
    credential_id,event_kind,from_status,to_status,actor_profile_id,note
  ) values(credential_key,'RESUBMITTED','NEEDS_INFORMATION','PENDING',caller,null);
  perform public.emit_audit_event('CREDENTIAL_RESUBMITTED','professional_credential',credential_key,null);
  return 'PENDING';
end $$;
create or replace function public.decide_credential(
  credential_key uuid,
  decision credential_status,
  decision_note text default null,
  method credential_verification_method default 'MANUAL_REVIEW'
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  caller uuid:=public.current_profile_id();
  target public.professional_credentials%rowtype;
  applicant_profile uuid;
  first_actor uuid;
  regulator_has_verified_history boolean;
begin
  if caller is null or not public.has_platform_staff_role(caller,'CREDENTIAL_VERIFIER') then
    raise exception 'CREDENTIAL_VERIFIER_REQUIRED' using errcode='42501';
  end if;
  if decision not in ('NEEDS_INFORMATION','VERIFIED','REJECTED') then
    raise exception 'CREDENTIAL_DECISION_INVALID' using errcode='22023';
  end if;
  select * into target from public.professional_credentials where id=credential_key for update;
  if not found then raise exception 'CREDENTIAL_NOT_FOUND' using errcode='P0001'; end if;
  select profile_id into applicant_profile from public.professional_profiles where id=target.professional_profile_id;
  if applicant_profile = caller then raise exception 'CREDENTIAL_SELF_DECISION_FORBIDDEN' using errcode='42501'; end if;
  if target.verification_status not in ('PENDING','NEEDS_INFORMATION') then
    raise exception 'CREDENTIAL_REVIEW_CLOSED' using errcode='P0001';
  end if;
  if decision='NEEDS_INFORMATION' then
    update public.professional_credentials
    set verification_status='NEEDS_INFORMATION', verification_method=method
    where id=credential_key;
    insert into public.credential_review_events(
      credential_id,event_kind,from_status,to_status,actor_profile_id,actor_role,note
    ) values(credential_key,'NEEDS_INFORMATION',target.verification_status,'NEEDS_INFORMATION',caller,'CREDENTIAL_VERIFIER',nullif(btrim(coalesce(decision_note,'')),''));
    perform public.emit_audit_event('CREDENTIAL_NEEDS_INFORMATION','professional_credential',credential_key,null);
    return jsonb_build_object('status','NEEDS_INFORMATION','changed',true);
  end if;

  if decision='REJECTED' then
    update public.professional_credentials
    set verification_status='REJECTED', verification_method=method,
        verified_at=null, verified_by_staff_id=null
    where id=credential_key;
    insert into public.credential_review_events(
      credential_id,event_kind,from_status,to_status,actor_profile_id,actor_role,note
    ) values(credential_key,'REJECTED',target.verification_status,'REJECTED',caller,'CREDENTIAL_VERIFIER',nullif(btrim(coalesce(decision_note,'')),''));
    perform public.emit_audit_event('CREDENTIAL_REJECTED','professional_credential',credential_key,null);
    return jsonb_build_object('status','REJECTED','changed',true);
  end if;
  select exists (
    select 1
    from public.credential_review_events cre
    join public.professional_credentials pc on pc.id=cre.credential_id
    where pc.regulator_id=target.regulator_id and cre.event_kind='VERIFIED'
  ) into regulator_has_verified_history;

  if not regulator_has_verified_history then
    select cre.actor_profile_id into first_actor
    from public.credential_review_events cre
    where cre.credential_id=credential_key
      and cre.event_kind='FIRST_VERIFIER_APPROVED'
    order by cre.seq asc limit 1;

    if first_actor is null then
      insert into public.credential_review_events(
        credential_id,event_kind,from_status,to_status,actor_profile_id,actor_role,note
      ) values(credential_key,'FIRST_VERIFIER_APPROVED',target.verification_status,target.verification_status,caller,'CREDENTIAL_VERIFIER',nullif(btrim(coalesce(decision_note,'')),''));
      perform public.emit_audit_event('CREDENTIAL_FIRST_VERIFIER_APPROVED','professional_credential',credential_key,null);
      return jsonb_build_object('status',target.verification_status::text,'changed',false,'awaiting_second_verifier',true);
    end if;

    if first_actor=caller then
      raise exception 'SECOND_DISTINCT_VERIFIER_REQUIRED' using errcode='42501';
    end if;
  end if;

  update public.professional_credentials
  set verification_status='VERIFIED',
      verification_method=method,
      verified_at=clock_timestamp(),
      verified_by_staff_id=caller,
      source_kind='STAFF_VERIFIED'
  where id=credential_key;

  insert into public.credential_review_events(
    credential_id,event_kind,from_status,to_status,actor_profile_id,actor_role,note
  ) values(credential_key,'VERIFIED',target.verification_status,'VERIFIED',caller,'CREDENTIAL_VERIFIER',nullif(btrim(coalesce(decision_note,'')),''));
  perform public.emit_audit_event('CREDENTIAL_VERIFIED','professional_credential',credential_key,null);
  return jsonb_build_object('status','VERIFIED','changed',true,'awaiting_second_verifier',false);
end $$;
create or replace function public.submit_student_enrollment(
  institution_key uuid,
  student_id_value text,
  programme_value text,
  started_on_value date default null,
  expected_graduation_value date default null
) returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  caller uuid:=public.current_profile_id();
  institution public.medical_institutions%rowtype;
  student_profile public.medical_student_profiles%rowtype;
  result uuid;
begin
  if caller is null then raise exception 'AUTHENTICATION_REQUIRED' using errcode='42501'; end if;
  select * into institution from public.medical_institutions where id=institution_key and is_active;
  if not found then raise exception 'MEDICAL_INSTITUTION_NOT_AVAILABLE' using errcode='P0001'; end if;
  if btrim(coalesce(programme_value,''))='' then raise exception 'PROGRAMME_REQUIRED' using errcode='22023'; end if;

  select * into student_profile from public.medical_student_profiles where profile_id=caller;
  if not found then
    insert into public.medical_student_profiles(profile_id) values(caller) returning * into student_profile;
  elsif student_profile.status <> 'ACTIVE' then
    raise exception 'MEDICAL_STUDENT_PROFILE_NOT_ACTIVE' using errcode='P0001';
  end if;

  if exists (
    select 1 from public.student_enrollments se
    where se.medical_student_profile_id=student_profile.id
      and se.medical_institution_id=institution_key
      and se.verification_status='VERIFIED'
      and se.ended_on is null
  ) then
    raise exception 'STUDENT_ENROLLMENT_ALREADY_VERIFIED' using errcode='P0001';
  end if;
  insert into public.student_enrollments(
    medical_student_profile_id, medical_institution_id, institution_country_code,
    student_id_display, programme, started_on, expected_graduation,
    verification_status
  ) values(
    student_profile.id, institution.id, institution.country_code,
    nullif(btrim(coalesce(student_id_value,'')),''), btrim(programme_value),
    started_on_value, expected_graduation_value, 'PENDING'
  ) returning id into result;
  perform public.emit_audit_event('STUDENT_ENROLLMENT_SUBMITTED','student_enrollment',result,null);
  return result;
exception when unique_violation then
  raise exception 'STUDENT_ENROLLMENT_REVIEW_ALREADY_OPEN' using errcode='P0001';
end $$;

create or replace function public.decide_enrollment(
  enrollment_key uuid,
  decision credential_status,
  decision_note text default null,
  method credential_verification_method default 'MANUAL_REVIEW'
) returns credential_status
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  caller uuid:=public.current_profile_id();
  target public.student_enrollments%rowtype;
  applicant_profile uuid;
begin
  if caller is null or not public.has_platform_staff_role(caller,'CREDENTIAL_VERIFIER') then
    raise exception 'CREDENTIAL_VERIFIER_REQUIRED' using errcode='42501';
  end if;
  if decision not in ('NEEDS_INFORMATION','VERIFIED','REJECTED') then
    raise exception 'ENROLLMENT_DECISION_INVALID' using errcode='22023';
  end if;
  select * into target from public.student_enrollments where id=enrollment_key for update;
  if not found then raise exception 'STUDENT_ENROLLMENT_NOT_FOUND' using errcode='P0001'; end if;
  select msp.profile_id into applicant_profile from public.medical_student_profiles msp where msp.id=target.medical_student_profile_id;
  if applicant_profile=caller then raise exception 'ENROLLMENT_SELF_DECISION_FORBIDDEN' using errcode='42501'; end if;
  if target.verification_status not in ('PENDING','NEEDS_INFORMATION') then
    raise exception 'ENROLLMENT_REVIEW_CLOSED' using errcode='P0001';
  end if;
  if decision='VERIFIED' then
    update public.student_enrollments
    set verification_status='VERIFIED', verification_method=method,
        verified_at=clock_timestamp(), verified_by_staff_id=caller, updated_at=clock_timestamp()
    where id=enrollment_key;
    perform public.emit_audit_event('STUDENT_ENROLLMENT_VERIFIED','student_enrollment',enrollment_key,null);
  elsif decision='NEEDS_INFORMATION' then
    update public.student_enrollments
    set verification_status='NEEDS_INFORMATION', verification_method=method,
        verified_at=null, verified_by_staff_id=null, updated_at=clock_timestamp()
    where id=enrollment_key;
    perform public.emit_audit_event('STUDENT_ENROLLMENT_NEEDS_INFORMATION','student_enrollment',enrollment_key,null);
  else
    update public.student_enrollments
    set verification_status='REJECTED', verification_method=method,
        verified_at=null, verified_by_staff_id=null, updated_at=clock_timestamp()
    where id=enrollment_key;
    perform public.emit_audit_event('STUDENT_ENROLLMENT_REJECTED','student_enrollment',enrollment_key,null);
  end if;
  return decision;
end $$;
create or replace function public.validate_system_health_detail()
returns trigger language plpgsql
set search_path = public, pg_temp
as $$
declare item record; rule public.health_signal_registry_keys%rowtype; numeric_value numeric; string_value text;
begin
  if jsonb_typeof(new.detail) <> 'object' or public.p1_jsonb_object_key_count(new.detail) > 12 then
    raise exception 'HEALTH_SIGNAL_DETAIL_INVALID' using errcode='23514';
  end if;
  for item in select * from jsonb_each(new.detail) loop
    select * into rule from public.health_signal_registry_keys
    where signal_code=new.signal_code and detail_key=item.key;
    if not found then raise exception 'HEALTH_SIGNAL_DETAIL_KEY_NOT_ALLOWED' using errcode='23514'; end if;
    if jsonb_typeof(item.value) in ('object','array','null') then
      raise exception 'HEALTH_SIGNAL_DETAIL_VALUE_INVALID' using errcode='23514';
    end if;
    if rule.value_type in ('INTEGER','NUMERIC') then
      if jsonb_typeof(item.value) <> 'number' then raise exception 'HEALTH_SIGNAL_DETAIL_TYPE_MISMATCH' using errcode='23514'; end if;
      numeric_value := (item.value #>> '{}')::numeric;
      if rule.value_type='INTEGER' and numeric_value <> trunc(numeric_value) then
        raise exception 'HEALTH_SIGNAL_DETAIL_INTEGER_REQUIRED' using errcode='23514';
      end if;
      if rule.min_value is not null and numeric_value < rule.min_value then raise exception 'HEALTH_SIGNAL_DETAIL_BELOW_MIN' using errcode='23514'; end if;
      if rule.max_value is not null and numeric_value > rule.max_value then raise exception 'HEALTH_SIGNAL_DETAIL_ABOVE_MAX' using errcode='23514'; end if;
    elsif rule.value_type='BOOLEAN' then
      if jsonb_typeof(item.value) <> 'boolean' then raise exception 'HEALTH_SIGNAL_DETAIL_TYPE_MISMATCH' using errcode='23514'; end if;
    else
      if jsonb_typeof(item.value) <> 'string' then raise exception 'HEALTH_SIGNAL_DETAIL_TYPE_MISMATCH' using errcode='23514'; end if;
      string_value := item.value #>> '{}';
      if not (string_value = any(rule.enum_values)) then raise exception 'HEALTH_SIGNAL_DETAIL_ENUM_INVALID' using errcode='23514'; end if;
    end if;
  end loop;
  return new;
end $$;

create trigger system_health_signals_detail_guard
before insert or update on public.system_health_signals
for each row execute function public.validate_system_health_detail();
create or replace function public.require_platform_analyst()
returns uuid language plpgsql security definer
set search_path = public, pg_temp
as $$
declare caller uuid:=public.current_profile_id();
begin
  if caller is null or not public.has_platform_staff_role(caller,'PLATFORM_ANALYST') then
    raise exception 'PLATFORM_ANALYST_REQUIRED' using errcode='42501';
  end if;
  return caller;
end $$;

create or replace function public.owner_metrics_overview(from_day date, to_day date)
returns jsonb language plpgsql security definer
set search_path = public, pg_temp
as $$
declare caller uuid; result jsonb;
begin
  caller := public.require_platform_analyst();
  if from_day is null or to_day is null or from_day > to_day or to_day-from_day > 3660 then
    raise exception 'METRIC_PERIOD_INVALID' using errcode='22023';
  end if;
  select jsonb_build_object(
    'from',from_day,'to',to_day,
    'doctors_registered',coalesce(sum(count_value) filter(where metric_code='DOCTORS_REGISTERED'),0),
    'doctors_verified',coalesce(sum(count_value) filter(where metric_code='DOCTORS_VERIFIED'),0),
    'appointments_booked',coalesce(sum(count_value) filter(where metric_code='APPOINTMENTS_BOOKED'),0),
    'appointments_completed',coalesce(sum(count_value) filter(where metric_code='APPOINTMENTS_COMPLETED'),0),
    'consultations_completed',coalesce(sum(count_value) filter(where metric_code='CONSULTATIONS_COMPLETED'),0),
    'prescriptions_finalized',coalesce(sum(count_value) filter(where metric_code='PRESCRIPTIONS_FINALIZED'),0),
    'doctors_active',null,
    'doctors_subscribed',null
  ) into result
  from public.metric_rollups
  where period_kind='DAY' and period_start between from_day and to_day;
  perform public.emit_audit_event('OWNER_METRICS_OVERVIEW_READ','owner_metrics',null,null);
  return result;
end $$;
create or replace function public.owner_metrics_timeseries(
  requested_metric text,
  from_day date,
  to_day date
) returns table(period_day date, count_value bigint)
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  perform public.require_platform_analyst();
  if from_day is null or to_day is null or from_day > to_day or to_day-from_day > 3660 then
    raise exception 'METRIC_PERIOD_INVALID' using errcode='22023';
  end if;
  if not exists(select 1 from public.metric_definitions where metric_code=requested_metric and is_active) then
    raise exception 'METRIC_NOT_AVAILABLE' using errcode='P0001';
  end if;
  perform public.emit_audit_event('OWNER_METRICS_TIMESERIES_READ','owner_metrics',null,null);
  return query
    select mr.period_start, sum(mr.count_value)::bigint
    from public.metric_rollups mr
    where mr.period_kind='DAY' and mr.metric_code=requested_metric
      and mr.period_start between from_day and to_day
    group by mr.period_start order by mr.period_start;
end $$;

create or replace function public.owner_metrics_new_doctors(
  from_day date,
  to_day date
) returns table(period_day date, count_value bigint)
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  perform public.require_platform_analyst();
  if from_day is null or to_day is null or from_day > to_day or to_day-from_day > 3660 then
    raise exception 'METRIC_PERIOD_INVALID' using errcode='22023';
  end if;
  perform public.emit_audit_event('OWNER_METRICS_NEW_DOCTORS_READ','owner_metrics',null,null);
  return query
    select mr.period_start, sum(mr.count_value)::bigint
    from public.metric_rollups mr
    where mr.period_kind='DAY' and mr.metric_code='DOCTORS_REGISTERED'
      and mr.period_start between from_day and to_day
    group by mr.period_start order by mr.period_start;
end $$;
create or replace function public.owner_system_health(as_of timestamptz default clock_timestamp())
returns table(
  signal_code text,
  status text,
  value numeric,
  unit text,
  detail jsonb,
  observed_at timestamptz
)
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  perform public.require_platform_analyst();
  perform public.emit_audit_event('OWNER_SYSTEM_HEALTH_READ','owner_metrics',null,null);
  return query
    select r.signal_code,
           case
             when s.observed_at is null or s.observed_at < as_of-r.expected_interval then 'STALE'
             else s.status::text
           end,
           s.value,
           s.unit::text,
           coalesce(s.detail,'{}'::jsonb),
           s.observed_at
    from public.health_signal_registry r
    left join lateral (
      select x.observed_at,x.status,x.value,x.unit,x.detail
      from public.system_health_signals x
      where x.signal_code=r.signal_code and x.observed_at <= as_of
      order by x.observed_at desc limit 1
    ) s on true
    where r.is_active
    order by r.signal_code;
end $$;

create or replace function public.owner_system_health_history(
  requested_signal text,
  from_day date,
  to_day date
) returns table(period_day date, status text, value numeric, unit text)
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  perform public.require_platform_analyst();
  if from_day is null or to_day is null or from_day>to_day or to_day-from_day>3660 then
    raise exception 'HEALTH_PERIOD_INVALID' using errcode='22023';
  end if;
  if not exists(select 1 from public.health_signal_registry where signal_code=requested_signal and is_active) then
    raise exception 'HEALTH_SIGNAL_NOT_AVAILABLE' using errcode='P0001';
  end if;
  perform public.emit_audit_event('OWNER_SYSTEM_HEALTH_HISTORY_READ','owner_metrics',null,null);
  return query
    select distinct on ((s.observed_at at time zone 'UTC')::date)
      (s.observed_at at time zone 'UTC')::date,
      s.status::text,s.value,s.unit::text
    from public.system_health_signals s
    where s.signal_code=requested_signal
      and (s.observed_at at time zone 'UTC')::date between from_day and to_day
    order by (s.observed_at at time zone 'UTC')::date, s.observed_at desc;
end $$;
