-- O1-F-R2 — Owner Analytics Authority. Runtime migration 0047.
-- FORWARD ONLY. Do not edit 0041–0046.
--
-- Authority reuse:
--   public.is_platform_owner() (0033)
--   public.session_is_aal2() / public.require_aal2() (0045)
-- No alternate Owner/AAL authority is introduced.
--
-- R2 closes:
--   * explicit function ACLs
--   * frozen participation lifecycle
--   * participation-scoped consent and named aggregates
--   * exact 10-column E->F AI/Voice persistence contract
--   * explicit day-grain measurement coverage
--   * unknown-vs-zero semantics
--   * trusted ingestion / no direct client access
--   * k=5 / anti-reconstruction
--   * narrow audit_events insertion authority
--
-- This migration does not read clinical tables and must not be applied to a
-- protected runtime by this task.

create type pilot_cohort_status as enum ('PLANNED','RUNNING','CLOSED');
create type pilot_participation_status as enum ('INVITED','ENROLLED','COMPLETED','WITHDRAWN');
create type pilot_consent_scope as enum ('PRODUCT_USAGE_ANALYTICS');
create type pilot_consent_event_kind as enum ('CONSENT_GRANTED','CONSENT_WITHDRAWN');
create type telemetry_measurement_domain as enum ('ACTIVITY','AI_VOICE');

create role dd_metrics_reader noinherit;
create role dd_metrics_rollup noinherit;
create role dd_pilot_writer noinherit;
create role dd_retention noinherit;

create or replace function public.assert_o1_owner_aal2()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_platform_owner() then
    raise exception 'O1_OWNER_REQUIRED' using errcode = '42501';
  end if;
  perform public.require_aal2();
end;
$$;

create table public.pilot_cohorts (
  cohort_code text primary key check (cohort_code ~ '^[A-Z0-9_]{3,40}$'),
  display_name text not null check (char_length(display_name) between 1 and 120 and display_name !~ '[\n\r]'),
  status pilot_cohort_status not null default 'PLANNED',
  started_on date not null,
  planned_end_on date,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default clock_timestamp()
);

create table public.pilot_participations (
  participation_id uuid primary key default gen_random_uuid(),
  cohort_code text not null references public.pilot_cohorts(cohort_code),
  doctor_id uuid not null references public.doctor_profiles(id),
  status pilot_participation_status not null default 'INVITED',
  enrolled_on date not null default current_date,
  unique (cohort_code, doctor_id),
  unique (participation_id, cohort_code)
);

create or replace function public.enforce_pilot_participation_terminal()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if old.status = 'WITHDRAWN' and new.status <> 'WITHDRAWN' then
    raise exception 'PILOT_PARTICIPATION_WITHDRAWN_TERMINAL' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger pilot_participations_terminal
before update on public.pilot_participations
for each row execute function public.enforce_pilot_participation_terminal();

create table public.pilot_consent_events (
  id bigserial primary key,
  participation_id uuid not null,
  cohort_code text not null,
  consent_scope pilot_consent_scope not null,
  consent_version text not null check (consent_version ~ '^[A-Za-z0-9._-]{1,40}$'),
  event pilot_consent_event_kind not null,
  effective_at timestamptz not null,
  recorded_at timestamptz not null default clock_timestamp(),
  recorded_by uuid not null references public.profiles(id),
  foreign key (participation_id, cohort_code)
    references public.pilot_participations(participation_id, cohort_code)
);
create index pilot_consent_events_lookup
  on public.pilot_consent_events
  (participation_id, cohort_code, consent_scope, effective_at desc);

create or replace function public.prevent_pilot_consent_event_mutation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'PILOT_CONSENT_EVENT_APPEND_ONLY' using errcode = 'P0001';
end;
$$;

create trigger pilot_consent_events_append_only
before update or delete on public.pilot_consent_events
for each row execute function public.prevent_pilot_consent_event_mutation();

create or replace function public.pilot_consent_is_live(
  target_cohort_code text,
  target_participation_id uuid,
  target_scope pilot_consent_scope,
  as_of timestamptz default clock_timestamp()
) returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (
      select e.event = 'CONSENT_GRANTED'
      from public.pilot_consent_events e
      where e.participation_id = target_participation_id
        and e.cohort_code = target_cohort_code
        and e.consent_scope = target_scope
        and e.effective_at <= as_of
      order by e.effective_at desc, e.id desc
      limit 1
    ),
    false
  );
$$;
alter function public.pilot_consent_is_live(text, uuid, pilot_consent_scope, timestamptz)
  owner to dd_metrics_rollup;

create or replace function public.pilot_consent_covers_day(
  target_cohort_code text,
  target_participation_id uuid,
  target_scope pilot_consent_scope,
  target_day date
) returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    public.pilot_consent_is_live(
      target_cohort_code,
      target_participation_id,
      target_scope,
      target_day::timestamptz
    )
    and not exists (
      select 1
      from public.pilot_consent_events e
      where e.participation_id = target_participation_id
        and e.cohort_code = target_cohort_code
        and e.consent_scope = target_scope
        and e.event = 'CONSENT_WITHDRAWN'
        and e.effective_at >= target_day::timestamptz
        and e.effective_at < (target_day + 1)::timestamptz
    );
$$;
alter function public.pilot_consent_covers_day(text, uuid, pilot_consent_scope, date)
  owner to dd_metrics_rollup;

create table public.pilot_event_registry (
  code text primary key check (code ~ '^[A-Z][A-Z0-9_]{1,39}$'),
  display_name text not null
);
insert into public.pilot_event_registry(code, display_name) values
  ('INVITED','Invited to pilot'),
  ('ENROLLED','Enrolled in pilot'),
  ('COMPLETED','Completed pilot'),
  ('WITHDRAWN','Withdrawn from pilot'),
  ('FIRST_ENGAGED','First engaged day'),
  ('COHORT_OPENED','Cohort opened'),
  ('COHORT_CLOSED','Cohort closed');

create table public.pilot_reason_registry (
  code text primary key check (code ~ '^[A-Z][A-Z0-9_]{1,39}$'),
  display_name text not null
);
insert into public.pilot_reason_registry(code, display_name) values
  ('SCHEDULE_CONFLICT','Doctor scheduling conflict'),
  ('TECHNICAL_ISSUE','Technical issue reported'),
  ('NO_LONGER_INTERESTED','No longer interested'),
  ('PILOT_CONCLUDED','Pilot concluded on schedule'),
  ('OTHER_REVIEWED','Other - Central-reviewed');

create table public.pilot_status_events (
  id bigserial primary key,
  participation_id uuid,
  cohort_code text not null references public.pilot_cohorts(cohort_code),
  event_code text not null references public.pilot_event_registry(code),
  reason_code text references public.pilot_reason_registry(code),
  event_day date not null,
  recorded_by uuid not null references public.profiles(id),
  recorded_at timestamptz not null default clock_timestamp(),
  foreign key (participation_id, cohort_code)
    references public.pilot_participations(participation_id, cohort_code)
);

create or replace function public.prevent_pilot_status_event_mutation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'PILOT_STATUS_EVENT_APPEND_ONLY' using errcode = 'P0001';
end;
$$;

create trigger pilot_status_events_append_only
before update or delete on public.pilot_status_events
for each row execute function public.prevent_pilot_status_event_mutation();

create table public.feature_registry (
  code text primary key check (code ~ '^[a-z][a-z0-9_]{1,63}$' or code = '*'),
  display_name text not null,
  is_active boolean not null default true
);
insert into public.feature_registry(code, display_name)
values ('*', 'Non-feature sentinel');

create table public.activity_contributions (
  metric_code text not null check (metric_code in (
    'DOCTOR_ACTIVE_DAY',
    'DOCTOR_ENGAGED_MINUTES_DAILY',
    'DOCTOR_SESSION_COUNT_DAILY',
    'DOCTOR_FEATURE_TOUCH_DAILY'
  )),
  doctor_id uuid not null references public.doctor_profiles(id),
  period_day date not null,
  feature_code text not null references public.feature_registry(code),
  value bigint not null check (value >= 0),
  source_stream text not null check (source_stream in (
    'O1A_INTERACTION_METER','AUTH_DAILY','APP_FEATURE'
  )),
  source_version bigint not null check (source_version >= 0),
  ingested_on date not null default current_date,
  primary key (metric_code, doctor_id, period_day, feature_code),
  check (
    (metric_code = 'DOCTOR_FEATURE_TOUCH_DAILY' and feature_code <> '*')
    or
    (metric_code in (
      'DOCTOR_ACTIVE_DAY',
      'DOCTOR_ENGAGED_MINUTES_DAILY',
      'DOCTOR_SESSION_COUNT_DAILY'
    ) and feature_code = '*')
  )
);

create table public.telemetry_day_coverage (
  period_day date not null,
  principal_doctor_id uuid not null references public.doctor_profiles(id),
  measurement_domain telemetry_measurement_domain not null,
  is_complete boolean not null,
  source_version bigint not null check (source_version >= 0),
  primary key (period_day, principal_doctor_id, measurement_domain)
);

-- Frozen E->F contract: EXACTLY these ten columns.
create table public.service_usage_daily_agg (
  period_day date not null,
  principal_doctor_id uuid not null references public.doctor_profiles(id),
  provider_id text not null check (
    char_length(provider_id) between 1 and 80
    and provider_id ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]*$'
  ),
  service_kind text not null check (service_kind ~ '^[A-Z][A-Z0-9_]{1,31}$'),
  model_id text not null check (
    char_length(model_id) between 1 and 120
    and model_id ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]*$'
  ),
  unit text not null check (unit ~ '^[A-Za-z][A-Za-z0-9_/-]{0,31}$'),
  quantity_total numeric(38,18) not null check (quantity_total >= 0),
  event_count bigint not null check (event_count >= 0),
  estimated_cost_minor numeric(38,18) check (estimated_cost_minor is null or estimated_cost_minor >= 0),
  currency_code text not null check (currency_code ~ '^[A-Z]{3}$'),
  primary key (
    period_day,
    principal_doctor_id,
    provider_id,
    service_kind,
    model_id,
    unit,
    currency_code
  )
);

create or replace function public.ingest_activity_contribution(
  target_metric_code text,
  target_doctor_id uuid,
  target_period_day date,
  target_feature_code text,
  target_value bigint,
  target_source_stream text,
  target_source_version bigint
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.activity_contributions(
    metric_code, doctor_id, period_day, feature_code,
    value, source_stream, source_version
  )
  values (
    target_metric_code, target_doctor_id, target_period_day, target_feature_code,
    target_value, target_source_stream, target_source_version
  )
  on conflict (metric_code, doctor_id, period_day, feature_code) do update
    set value = excluded.value,
        source_stream = excluded.source_stream,
        source_version = excluded.source_version,
        ingested_on = current_date
    where excluded.source_version > public.activity_contributions.source_version;
end;
$$;
alter function public.ingest_activity_contribution(
  text, uuid, date, text, bigint, text, bigint
) owner to dd_metrics_rollup;

create or replace function public.mark_telemetry_day_coverage(
  target_period_day date,
  target_principal_doctor_id uuid,
  target_measurement_domain telemetry_measurement_domain,
  target_is_complete boolean,
  target_source_version bigint
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.telemetry_day_coverage(
    period_day, principal_doctor_id, measurement_domain,
    is_complete, source_version
  )
  values (
    target_period_day, target_principal_doctor_id, target_measurement_domain,
    target_is_complete, target_source_version
  )
  on conflict (period_day, principal_doctor_id, measurement_domain) do update
    set is_complete = excluded.is_complete,
        source_version = excluded.source_version
    where excluded.source_version > public.telemetry_day_coverage.source_version;
end;
$$;
alter function public.mark_telemetry_day_coverage(
  date, uuid, telemetry_measurement_domain, boolean, bigint
) owner to dd_metrics_rollup;

create or replace function public.ingest_service_usage_daily(
  target_period_day date,
  target_principal_doctor_id uuid,
  target_provider_id text,
  target_service_kind text,
  target_model_id text,
  target_unit text,
  target_quantity_total numeric,
  target_event_count bigint,
  target_estimated_cost_minor numeric,
  target_currency_code text
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.service_usage_daily_agg(
    period_day,
    principal_doctor_id,
    provider_id,
    service_kind,
    model_id,
    unit,
    quantity_total,
    event_count,
    estimated_cost_minor,
    currency_code
  )
  values (
    target_period_day,
    target_principal_doctor_id,
    target_provider_id,
    target_service_kind,
    target_model_id,
    target_unit,
    target_quantity_total,
    target_event_count,
    target_estimated_cost_minor,
    target_currency_code
  )
  on conflict (
    period_day,
    principal_doctor_id,
    provider_id,
    service_kind,
    model_id,
    unit,
    currency_code
  ) do update
    set quantity_total = excluded.quantity_total,
        event_count = excluded.event_count,
        estimated_cost_minor = excluded.estimated_cost_minor;
end;
$$;
alter function public.ingest_service_usage_daily(
  date, uuid, text, text, text, text, numeric, bigint, numeric, text
) owner to dd_metrics_rollup;

create table public.doctor_daily_activity_agg (
  period_day date not null,
  participation_id uuid not null,
  cohort_code text not null,
  doctor_id uuid not null references public.doctor_profiles(id),
  engaged_minutes bigint not null,
  active_day boolean not null,
  session_count bigint not null,
  feature_touch_count bigint not null,
  source_high_water bigint not null,
  computed_at timestamptz not null default clock_timestamp(),
  primary key (period_day, participation_id),
  foreign key (participation_id, cohort_code)
    references public.pilot_participations(participation_id, cohort_code)
);

create table public.pilot_status_daily_agg (
  period_day date not null,
  cohort_code text not null references public.pilot_cohorts(cohort_code),
  invited_count bigint not null,
  enrolled_count bigint not null,
  completed_count bigint not null,
  withdrawn_count bigint not null,
  consented_count bigint not null,
  active_doctor_count bigint not null,
  computed_at timestamptz not null default clock_timestamp(),
  primary key (period_day, cohort_code)
);

create or replace function public.rebuild_doctor_daily_activity_agg(
  target_period_day date
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from public.doctor_daily_activity_agg
  where period_day = target_period_day;

  insert into public.doctor_daily_activity_agg(
    period_day,
    participation_id,
    cohort_code,
    doctor_id,
    engaged_minutes,
    active_day,
    session_count,
    feature_touch_count,
    source_high_water,
    computed_at
  )
  select
    target_period_day,
    p.participation_id,
    p.cohort_code,
    p.doctor_id,
    coalesce((
      select ac.value
      from public.activity_contributions ac
      where ac.metric_code = 'DOCTOR_ENGAGED_MINUTES_DAILY'
        and ac.doctor_id = p.doctor_id
        and ac.period_day = target_period_day
        and ac.feature_code = '*'
    ), 0),
    coalesce((
      select ac.value
      from public.activity_contributions ac
      where ac.metric_code = 'DOCTOR_ACTIVE_DAY'
        and ac.doctor_id = p.doctor_id
        and ac.period_day = target_period_day
        and ac.feature_code = '*'
    ), 0) > 0,
    coalesce((
      select ac.value
      from public.activity_contributions ac
      where ac.metric_code = 'DOCTOR_SESSION_COUNT_DAILY'
        and ac.doctor_id = p.doctor_id
        and ac.period_day = target_period_day
        and ac.feature_code = '*'
    ), 0),
    (
      select count(*)::bigint
      from public.activity_contributions ac
      where ac.metric_code = 'DOCTOR_FEATURE_TOUCH_DAILY'
        and ac.doctor_id = p.doctor_id
        and ac.period_day = target_period_day
        and ac.feature_code <> '*'
        and ac.value > 0
    ),
    c.source_version,
    clock_timestamp()
  from public.pilot_participations p
  join public.telemetry_day_coverage c
    on c.principal_doctor_id = p.doctor_id
   and c.period_day = target_period_day
   and c.measurement_domain = 'ACTIVITY'
   and c.is_complete
  where p.status in ('ENROLLED','COMPLETED')
    and p.enrolled_on <= target_period_day
    and public.pilot_consent_covers_day(
      p.cohort_code,
      p.participation_id,
      'PRODUCT_USAGE_ANALYTICS',
      target_period_day
    );
end;
$$;
alter function public.rebuild_doctor_daily_activity_agg(date)
  owner to dd_metrics_rollup;

create or replace function public.rebuild_pilot_status_daily_agg(
  target_period_day date,
  target_cohort_code text
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.pilot_status_daily_agg(
    period_day,
    cohort_code,
    invited_count,
    enrolled_count,
    completed_count,
    withdrawn_count,
    consented_count,
    active_doctor_count,
    computed_at
  )
  select
    target_period_day,
    target_cohort_code,
    count(*) filter (where p.status = 'INVITED'),
    count(*) filter (where p.status = 'ENROLLED'),
    count(*) filter (where p.status = 'COMPLETED'),
    count(*) filter (where p.status = 'WITHDRAWN'),
    count(*) filter (
      where p.status in ('ENROLLED','COMPLETED')
        and public.pilot_consent_covers_day(
          p.cohort_code,
          p.participation_id,
          'PRODUCT_USAGE_ANALYTICS',
          target_period_day
        )
    ),
    count(distinct p.doctor_id) filter (
      where exists (
        select 1
        from public.doctor_daily_activity_agg a
        where a.participation_id = p.participation_id
          and a.period_day = target_period_day
          and a.active_day
      )
    ),
    clock_timestamp()
  from public.pilot_participations p
  where p.cohort_code = target_cohort_code
  on conflict (period_day, cohort_code) do update set
    invited_count = excluded.invited_count,
    enrolled_count = excluded.enrolled_count,
    completed_count = excluded.completed_count,
    withdrawn_count = excluded.withdrawn_count,
    consented_count = excluded.consented_count,
    active_doctor_count = excluded.active_doctor_count,
    computed_at = excluded.computed_at;
end;
$$;
alter function public.rebuild_pilot_status_daily_agg(date, text)
  owner to dd_metrics_rollup;

create or replace function public.k_anon_suppress(
  raw_value bigint,
  distinct_doctors bigint,
  k integer default 5
) returns text
language sql
immutable
as $$
  select case
    when distinct_doctors < k then 'INSUFFICIENT_COHORT'
    else raw_value::text
  end;
$$;

create or replace function public.participation_measurement_state(
  target_cohort_code text,
  target_participation_id uuid,
  window_start date,
  window_end date,
  target_domain telemetry_measurement_domain
) returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_doctor_id uuid;
  v_status pilot_participation_status;
  v_enrolled_on date;
  v_start date;
begin
  if window_start is null or window_end is null or window_end < window_start then
    return 'UNAVAILABLE';
  end if;

  select p.doctor_id, p.status, p.enrolled_on
  into v_doctor_id, v_status, v_enrolled_on
  from public.pilot_participations p
  where p.cohort_code = target_cohort_code
    and p.participation_id = target_participation_id;

  if v_doctor_id is null
     or v_status not in ('ENROLLED','COMPLETED')
     or not public.pilot_consent_is_live(
       target_cohort_code,
       target_participation_id,
       'PRODUCT_USAGE_ANALYTICS',
       clock_timestamp()
     )
  then
    return 'UNAVAILABLE';
  end if;

  v_start := greatest(window_start, v_enrolled_on);
  if v_start > window_end then
    return 'UNAVAILABLE';
  end if;

  if exists (
    select 1
    from generate_series(v_start, window_end, interval '1 day') g(day)
    where not public.pilot_consent_covers_day(
      target_cohort_code,
      target_participation_id,
      'PRODUCT_USAGE_ANALYTICS',
      g.day::date
    )
  ) then
    return 'UNAVAILABLE';
  end if;

  if exists (
    select 1
    from generate_series(v_start, window_end, interval '1 day') g(day)
    where not exists (
      select 1
      from public.telemetry_day_coverage c
      where c.period_day = g.day::date
        and c.principal_doctor_id = v_doctor_id
        and c.measurement_domain = target_domain
        and c.is_complete
    )
  ) then
    return 'NOT_MEASURED';
  end if;

  if target_domain = 'ACTIVITY'
     and exists (
       select 1
       from generate_series(v_start, window_end, interval '1 day') g(day)
       where not exists (
         select 1
         from public.doctor_daily_activity_agg a
         where a.period_day = g.day::date
           and a.participation_id = target_participation_id
           and a.cohort_code = target_cohort_code
       )
     )
  then
    return 'UNAVAILABLE';
  end if;

  return 'OK';
end;
$$;
alter function public.participation_measurement_state(
  text, uuid, date, date, telemetry_measurement_domain
) owner to dd_metrics_reader;

create or replace function public.owner_pilot_status(
  window_start date,
  window_end date
) returns table (
  cohort_code text,
  invited_count text,
  enrolled_count text,
  completed_count text,
  withdrawn_count text,
  consented_count text,
  active_doctor_count text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  c record;
  s record;
  v_doctors bigint;
  v_active bigint;
  v_state text;
begin
  perform public.assert_o1_owner_aal2();

  for c in select pc.cohort_code from public.pilot_cohorts pc order by pc.cohort_code
  loop
    select a.*
    into s
    from public.pilot_status_daily_agg a
    where a.cohort_code = c.cohort_code
      and a.period_day between window_start and window_end
    order by a.period_day desc
    limit 1;

    cohort_code := c.cohort_code;

    if s.cohort_code is null then
      invited_count := 'UNAVAILABLE';
      enrolled_count := 'UNAVAILABLE';
      completed_count := 'UNAVAILABLE';
      withdrawn_count := 'UNAVAILABLE';
      consented_count := 'UNAVAILABLE';
    else
      invited_count := s.invited_count::text;
      enrolled_count := s.enrolled_count::text;
      completed_count := s.completed_count::text;
      withdrawn_count := s.withdrawn_count::text;
      consented_count := s.consented_count::text;
    end if;

    select count(distinct p.doctor_id)
    into v_doctors
    from public.pilot_participations p
    where p.cohort_code = c.cohort_code
      and p.status in ('ENROLLED','COMPLETED')
      and public.pilot_consent_is_live(
        p.cohort_code,
        p.participation_id,
        'PRODUCT_USAGE_ANALYTICS',
        clock_timestamp()
      );

    if v_doctors = 0 then
      active_doctor_count := 'UNAVAILABLE';
    elsif v_doctors < 5 then
      active_doctor_count := 'INSUFFICIENT_COHORT';
    elsif exists (
      select 1
      from public.pilot_participations p
      where p.cohort_code = c.cohort_code
        and p.status in ('ENROLLED','COMPLETED')
        and public.pilot_consent_is_live(
          p.cohort_code,
          p.participation_id,
          'PRODUCT_USAGE_ANALYTICS',
          clock_timestamp()
        )
        and public.participation_measurement_state(
          p.cohort_code,
          p.participation_id,
          window_start,
          window_end,
          'ACTIVITY'
        ) = 'NOT_MEASURED'
    ) then
      active_doctor_count := 'NOT_MEASURED';
    elsif exists (
      select 1
      from public.pilot_participations p
      where p.cohort_code = c.cohort_code
        and p.status in ('ENROLLED','COMPLETED')
        and public.pilot_consent_is_live(
          p.cohort_code,
          p.participation_id,
          'PRODUCT_USAGE_ANALYTICS',
          clock_timestamp()
        )
        and public.participation_measurement_state(
          p.cohort_code,
          p.participation_id,
          window_start,
          window_end,
          'ACTIVITY'
        ) = 'UNAVAILABLE'
    ) then
      active_doctor_count := 'UNAVAILABLE';
    else
      select count(distinct a.doctor_id)
      into v_active
      from public.doctor_daily_activity_agg a
      where a.cohort_code = c.cohort_code
        and a.period_day between window_start and window_end
        and a.active_day;
      if v_active > 0 and v_active < 5 then
        active_doctor_count := 'INSUFFICIENT_COHORT';
      else
        active_doctor_count := v_active::text;
      end if;
    end if;

    return next;
  end loop;
end;
$$;
alter function public.owner_pilot_status(date, date)
  owner to dd_metrics_reader;

create or replace function public.owner_pilot_cohort_detail(
  target_cohort_code text,
  window_start date,
  window_end date
) returns table (
  participation_id uuid,
  status pilot_participation_status,
  enrolled_on date,
  measurement_status text,
  engaged_minutes bigint,
  active_days bigint,
  session_count bigint,
  feature_touch_count bigint
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.assert_o1_owner_aal2();

  return query
  select
    p.participation_id,
    p.status,
    p.enrolled_on,
    st.state,
    case when st.state = 'OK' then (
      select sum(a.engaged_minutes)::bigint
      from public.doctor_daily_activity_agg a
      where a.participation_id = p.participation_id
        and a.cohort_code = p.cohort_code
        and a.period_day between greatest(window_start, p.enrolled_on) and window_end
    ) end,
    case when st.state = 'OK' then (
      select sum(a.active_day::int)::bigint
      from public.doctor_daily_activity_agg a
      where a.participation_id = p.participation_id
        and a.cohort_code = p.cohort_code
        and a.period_day between greatest(window_start, p.enrolled_on) and window_end
    ) end,
    case when st.state = 'OK' then (
      select sum(a.session_count)::bigint
      from public.doctor_daily_activity_agg a
      where a.participation_id = p.participation_id
        and a.cohort_code = p.cohort_code
        and a.period_day between greatest(window_start, p.enrolled_on) and window_end
    ) end,
    case when st.state = 'OK' then (
      select sum(a.feature_touch_count)::bigint
      from public.doctor_daily_activity_agg a
      where a.participation_id = p.participation_id
        and a.cohort_code = p.cohort_code
        and a.period_day between greatest(window_start, p.enrolled_on) and window_end
    ) end
  from public.pilot_participations p
  cross join lateral (
    select public.participation_measurement_state(
      p.cohort_code,
      p.participation_id,
      window_start,
      window_end,
      'ACTIVITY'
    ) as state
  ) st
  where p.cohort_code = target_cohort_code;
end;
$$;
alter function public.owner_pilot_cohort_detail(text, date, date)
  owner to dd_metrics_reader;

create or replace function public.owner_doctor_activity(
  target_cohort_code text,
  target_participation_id uuid,
  window_start date,
  window_end date
) returns table (
  status text,
  engaged_minutes bigint,
  active_days bigint,
  session_count bigint,
  feature_touch_count bigint
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_doctor_id uuid;
  v_status pilot_participation_status;
  v_state text;
  v_reason text;
begin
  perform public.assert_o1_owner_aal2();

  select p.doctor_id, p.status
  into v_doctor_id, v_status
  from public.pilot_participations p
  where p.participation_id = target_participation_id
    and p.cohort_code = target_cohort_code;

  if v_doctor_id is null then
    v_reason := 'OWNER_DOCTOR_ACTIVITY_LOOKUP_NOT_MEMBER';
    v_state := 'UNAVAILABLE';
  elsif v_status = 'WITHDRAWN' then
    v_reason := 'OWNER_DOCTOR_ACTIVITY_LOOKUP_PARTICIPATION_WITHDRAWN';
    v_state := 'UNAVAILABLE';
  elsif v_status not in ('ENROLLED','COMPLETED') then
    v_reason := 'OWNER_DOCTOR_ACTIVITY_LOOKUP_NOT_ENROLLED';
    v_state := 'UNAVAILABLE';
  elsif not public.pilot_consent_is_live(
    target_cohort_code,
    target_participation_id,
    'PRODUCT_USAGE_ANALYTICS',
    clock_timestamp()
  ) then
    v_reason := 'OWNER_DOCTOR_ACTIVITY_LOOKUP_CONSENT_WITHDRAWN';
    v_state := 'UNAVAILABLE';
  else
    v_state := public.participation_measurement_state(
      target_cohort_code,
      target_participation_id,
      window_start,
      window_end,
      'ACTIVITY'
    );
    if v_state = 'NOT_MEASURED' then
      v_reason := 'OWNER_DOCTOR_ACTIVITY_LOOKUP_NOT_MEASURED';
    elsif v_state = 'UNAVAILABLE' then
      v_reason := 'OWNER_DOCTOR_ACTIVITY_LOOKUP_AGG_UNAVAILABLE';
    else
      v_reason := 'OWNER_DOCTOR_ACTIVITY_LOOKUP_OK';
    end if;
  end if;

  insert into public.audit_events(actor_id, action, resource_type, resource_id)
  values (auth.uid(), v_reason, 'pilot_participation', target_participation_id);

  if v_state <> 'OK' then
    return query
    select v_state, null::bigint, null::bigint, null::bigint, null::bigint;
    return;
  end if;

  return query
  select
    'OK'::text,
    sum(a.engaged_minutes)::bigint,
    sum(a.active_day::int)::bigint,
    sum(a.session_count)::bigint,
    sum(a.feature_touch_count)::bigint
  from public.doctor_daily_activity_agg a
  where a.participation_id = target_participation_id
    and a.cohort_code = target_cohort_code
    and a.period_day between window_start and window_end;
end;
$$;
alter function public.owner_doctor_activity(text, uuid, date, date)
  owner to dd_metrics_reader;

create or replace function public.owner_activity_summary(
  window_start date,
  window_end date
) returns table (
  active_doctor_count text,
  total_sessions text,
  total_engaged_minutes text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_doctors bigint;
begin
  perform public.assert_o1_owner_aal2();

  select count(distinct p.doctor_id)
  into v_doctors
  from public.pilot_participations p
  where p.status in ('ENROLLED','COMPLETED')
    and public.pilot_consent_is_live(
      p.cohort_code,
      p.participation_id,
      'PRODUCT_USAGE_ANALYTICS',
      clock_timestamp()
    );

  if v_doctors = 0 then
    return query select 'UNAVAILABLE', 'UNAVAILABLE', 'UNAVAILABLE';
    return;
  end if;

  if v_doctors < 5 then
    return query select
      'INSUFFICIENT_COHORT',
      'INSUFFICIENT_COHORT',
      'INSUFFICIENT_COHORT';
    return;
  end if;

  if exists (
    select 1
    from public.pilot_participations p
    where p.status in ('ENROLLED','COMPLETED')
      and public.pilot_consent_is_live(
        p.cohort_code,
        p.participation_id,
        'PRODUCT_USAGE_ANALYTICS',
        clock_timestamp()
      )
      and public.participation_measurement_state(
        p.cohort_code,
        p.participation_id,
        window_start,
        window_end,
        'ACTIVITY'
      ) = 'NOT_MEASURED'
  ) then
    return query select 'NOT_MEASURED', 'NOT_MEASURED', 'NOT_MEASURED';
    return;
  end if;

  if exists (
    select 1
    from public.pilot_participations p
    where p.status in ('ENROLLED','COMPLETED')
      and public.pilot_consent_is_live(
        p.cohort_code,
        p.participation_id,
        'PRODUCT_USAGE_ANALYTICS',
        clock_timestamp()
      )
      and public.participation_measurement_state(
        p.cohort_code,
        p.participation_id,
        window_start,
        window_end,
        'ACTIVITY'
      ) = 'UNAVAILABLE'
  ) then
    return query select 'UNAVAILABLE', 'UNAVAILABLE', 'UNAVAILABLE';
    return;
  end if;

  return query
  with dedup as (
    select
      a.doctor_id,
      a.period_day,
      bool_or(a.active_day) as active_day,
      max(a.session_count) as session_count,
      max(a.engaged_minutes) as engaged_minutes
    from public.doctor_daily_activity_agg a
    join public.pilot_participations p
      on p.participation_id = a.participation_id
     and p.cohort_code = a.cohort_code
    where a.period_day between window_start and window_end
      and p.status in ('ENROLLED','COMPLETED')
      and public.pilot_consent_is_live(
        p.cohort_code,
        p.participation_id,
        'PRODUCT_USAGE_ANALYTICS',
        clock_timestamp()
      )
    group by a.doctor_id, a.period_day
  )
  select
    count(distinct doctor_id) filter (where active_day)::text,
    sum(session_count)::text,
    sum(engaged_minutes)::text
  from dedup;
end;
$$;
alter function public.owner_activity_summary(date, date)
  owner to dd_metrics_reader;

create or replace function public.owner_service_usage_summary(
  target_cohort_code text,
  window_start date,
  window_end date
) returns table (
  status text,
  service_kind text,
  unit text,
  quantity_total numeric,
  event_count numeric,
  estimated_cost_minor numeric,
  currency_code text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_doctors bigint;
  v_has_rows boolean;
  v_has_suppressed boolean;
begin
  perform public.assert_o1_owner_aal2();

  select count(distinct p.doctor_id)
  into v_doctors
  from public.pilot_participations p
  where p.cohort_code = target_cohort_code
    and p.status in ('ENROLLED','COMPLETED')
    and public.pilot_consent_is_live(
      p.cohort_code,
      p.participation_id,
      'PRODUCT_USAGE_ANALYTICS',
      clock_timestamp()
    );

  if v_doctors = 0 then
    return query
    select 'UNAVAILABLE', null::text, null::text,
           null::numeric, null::numeric, null::numeric, null::text;
    return;
  end if;

  if v_doctors < 5 then
    return query
    select 'INSUFFICIENT_COHORT', null::text, null::text,
           null::numeric, null::numeric, null::numeric, null::text;
    return;
  end if;

  if exists (
    select 1
    from public.pilot_participations p
    where p.cohort_code = target_cohort_code
      and p.status in ('ENROLLED','COMPLETED')
      and public.pilot_consent_is_live(
        p.cohort_code,
        p.participation_id,
        'PRODUCT_USAGE_ANALYTICS',
        clock_timestamp()
      )
      and public.participation_measurement_state(
        p.cohort_code,
        p.participation_id,
        window_start,
        window_end,
        'AI_VOICE'
      ) = 'UNAVAILABLE'
  ) then
    return query
    select 'UNAVAILABLE', null::text, null::text,
           null::numeric, null::numeric, null::numeric, null::text;
    return;
  end if;

  if exists (
    select 1
    from public.pilot_participations p
    where p.cohort_code = target_cohort_code
      and p.status in ('ENROLLED','COMPLETED')
      and public.pilot_consent_is_live(
        p.cohort_code,
        p.participation_id,
        'PRODUCT_USAGE_ANALYTICS',
        clock_timestamp()
      )
      and public.participation_measurement_state(
        p.cohort_code,
        p.participation_id,
        window_start,
        window_end,
        'AI_VOICE'
      ) = 'NOT_MEASURED'
  ) then
    return query
    select 'NOT_MEASURED', null::text, null::text,
           null::numeric, null::numeric, null::numeric, null::text;
    return;
  end if;

  select exists (
    select 1
    from public.service_usage_daily_agg s
    join public.pilot_participations p
      on p.doctor_id = s.principal_doctor_id
     and p.cohort_code = target_cohort_code
    where s.period_day between greatest(window_start, p.enrolled_on) and window_end
      and p.status in ('ENROLLED','COMPLETED')
      and public.pilot_consent_covers_day(
        p.cohort_code,
        p.participation_id,
        'PRODUCT_USAGE_ANALYTICS',
        s.period_day
      )
  ) into v_has_rows;

  if not v_has_rows then
    return query
    select 'OK', null::text, null::text,
           0::numeric, 0::numeric, 0::numeric, null::text;
    return;
  end if;

  return query
  with grouped as (
    select
      s.service_kind,
      s.unit,
      s.currency_code,
      count(distinct s.principal_doctor_id) as doctor_count,
      sum(s.quantity_total) as quantity_total,
      sum(s.event_count)::numeric as event_count,
      case
        when count(*) filter (where s.estimated_cost_minor is null) > 0
          then null::numeric
        else sum(s.estimated_cost_minor)
      end as estimated_cost_minor
    from public.service_usage_daily_agg s
    join public.pilot_participations p
      on p.doctor_id = s.principal_doctor_id
     and p.cohort_code = target_cohort_code
    where s.period_day between greatest(window_start, p.enrolled_on) and window_end
      and p.status in ('ENROLLED','COMPLETED')
      and public.pilot_consent_covers_day(
        p.cohort_code,
        p.participation_id,
        'PRODUCT_USAGE_ANALYTICS',
        s.period_day
      )
    group by s.service_kind, s.unit, s.currency_code
  )
  select
    'OK',
    g.service_kind,
    g.unit,
    g.quantity_total,
    g.event_count,
    g.estimated_cost_minor,
    g.currency_code
  from grouped g
  where g.doctor_count >= 5;

  select exists (
    select 1
    from (
      select
        s.service_kind,
        s.unit,
        s.currency_code,
        count(distinct s.principal_doctor_id) as doctor_count
      from public.service_usage_daily_agg s
      join public.pilot_participations p
        on p.doctor_id = s.principal_doctor_id
       and p.cohort_code = target_cohort_code
      where s.period_day between greatest(window_start, p.enrolled_on) and window_end
        and p.status in ('ENROLLED','COMPLETED')
        and public.pilot_consent_covers_day(
          p.cohort_code,
          p.participation_id,
          'PRODUCT_USAGE_ANALYTICS',
          s.period_day
        )
      group by s.service_kind, s.unit, s.currency_code
    ) x
    where x.doctor_count < 5
  ) into v_has_suppressed;

  if v_has_suppressed then
    return query
    select 'INSUFFICIENT_COHORT', null::text, null::text,
           null::numeric, null::numeric, null::numeric, null::text;
  end if;
end;
$$;
alter function public.owner_service_usage_summary(text, date, date)
  owner to dd_metrics_reader;

create or replace function public.pilot_participation_state(
  target_cohort_code text
) returns table (
  participation_id uuid,
  doctor_id uuid,
  status pilot_participation_status,
  enrolled_on date,
  consent_live boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.assert_o1_owner_aal2();
  return query
  select
    p.participation_id,
    p.doctor_id,
    p.status,
    p.enrolled_on,
    public.pilot_consent_is_live(
      p.cohort_code,
      p.participation_id,
      'PRODUCT_USAGE_ANALYTICS',
      clock_timestamp()
    )
  from public.pilot_participations p
  where p.cohort_code = target_cohort_code;
end;
$$;
alter function public.pilot_participation_state(text)
  owner to dd_pilot_writer;

create or replace function public.admin_pilot_cohort_upsert(
  target_cohort_code text,
  target_display_name text,
  target_started_on date,
  target_planned_end_on date default null
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.assert_o1_owner_aal2();
  insert into public.pilot_cohorts(
    cohort_code, display_name, started_on, planned_end_on, created_by
  )
  values (
    target_cohort_code, target_display_name,
    target_started_on, target_planned_end_on, auth.uid()
  )
  on conflict (cohort_code) do update
    set display_name = excluded.display_name,
        planned_end_on = excluded.planned_end_on;
end;
$$;
alter function public.admin_pilot_cohort_upsert(text, text, date, date)
  owner to dd_pilot_writer;

create or replace function public.admin_pilot_participation_set(
  target_cohort_code text,
  target_doctor_id uuid,
  target_status pilot_participation_status
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  result uuid;
  prior_status pilot_participation_status;
begin
  perform public.assert_o1_owner_aal2();

  select p.participation_id, p.status
  into result, prior_status
  from public.pilot_participations p
  where p.cohort_code = target_cohort_code
    and p.doctor_id = target_doctor_id
  for update;

  if result is null then
    insert into public.pilot_participations(
      cohort_code, doctor_id, status
    )
    values (
      target_cohort_code, target_doctor_id, target_status
    )
    returning participation_id into result;
  else
    if prior_status = 'WITHDRAWN' and target_status <> 'WITHDRAWN' then
      raise exception 'PILOT_PARTICIPATION_WITHDRAWN_TERMINAL'
        using errcode = 'P0001';
    end if;

    update public.pilot_participations
    set status = target_status
    where participation_id = result;
  end if;

  insert into public.pilot_status_events(
    participation_id, cohort_code, event_code, event_day, recorded_by
  )
  values (
    result, target_cohort_code, target_status::text, current_date, auth.uid()
  );

  return result;
end;
$$;
alter function public.admin_pilot_participation_set(
  text, uuid, pilot_participation_status
) owner to dd_pilot_writer;

create or replace function public.admin_pilot_event_add(
  target_cohort_code text,
  target_participation_id uuid,
  target_event_code text,
  target_reason_code text,
  target_event_day date
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.assert_o1_owner_aal2();

  insert into public.pilot_status_events(
    participation_id,
    cohort_code,
    event_code,
    reason_code,
    event_day,
    recorded_by
  )
  values (
    target_participation_id,
    target_cohort_code,
    target_event_code,
    target_reason_code,
    target_event_day,
    auth.uid()
  );
end;
$$;
alter function public.admin_pilot_event_add(text, uuid, text, text, date)
  owner to dd_pilot_writer;

create or replace function public.admin_pilot_consent_set(
  target_cohort_code text,
  target_participation_id uuid,
  target_scope pilot_consent_scope,
  target_version text,
  target_event pilot_consent_event_kind,
  target_effective_at timestamptz default clock_timestamp()
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.assert_o1_owner_aal2();

  if not exists (
    select 1
    from public.pilot_participations p
    where p.participation_id = target_participation_id
      and p.cohort_code = target_cohort_code
  ) then
    raise exception 'PILOT_PARTICIPATION_REQUIRED' using errcode = 'P0001';
  end if;

  insert into public.pilot_consent_events(
    participation_id,
    cohort_code,
    consent_scope,
    consent_version,
    event,
    effective_at,
    recorded_by
  )
  values (
    target_participation_id,
    target_cohort_code,
    target_scope,
    target_version,
    target_event,
    target_effective_at,
    auth.uid()
  );
end;
$$;
alter function public.admin_pilot_consent_set(
  text, uuid, pilot_consent_scope, text, pilot_consent_event_kind, timestamptz
) owner to dd_pilot_writer;

-- RLS: every new table is forced. API roles get no direct table policy.
do $$
declare item text;
begin
  foreach item in array array[
    'pilot_cohorts',
    'pilot_participations',
    'pilot_consent_events',
    'pilot_event_registry',
    'pilot_reason_registry',
    'pilot_status_events',
    'feature_registry',
    'activity_contributions',
    'telemetry_day_coverage',
    'service_usage_daily_agg',
    'doctor_daily_activity_agg',
    'pilot_status_daily_agg'
  ]
  loop
    execute format('alter table public.%I enable row level security', item);
    execute format('alter table public.%I force row level security', item);
    execute format(
      'create policy %I_deny_default on public.%I for all using (false) with check (false)',
      item,
      item
    );
  end loop;
end
$$;

create policy pilot_cohorts_reader_read
  on public.pilot_cohorts for select to dd_metrics_reader using (true);
create policy pilot_cohorts_writer_all
  on public.pilot_cohorts for all to dd_pilot_writer using (true) with check (true);

create policy pilot_participations_reader_read
  on public.pilot_participations for select to dd_metrics_reader using (true);
create policy pilot_participations_writer_all
  on public.pilot_participations for all to dd_pilot_writer using (true) with check (true);
create policy pilot_participations_rollup_read
  on public.pilot_participations for select to dd_metrics_rollup using (true);

create policy pilot_consent_events_rollup_read
  on public.pilot_consent_events for select to dd_metrics_rollup using (true);
create policy pilot_consent_events_writer_insert
  on public.pilot_consent_events for insert to dd_pilot_writer with check (true);
create policy pilot_consent_events_writer_read
  on public.pilot_consent_events for select to dd_pilot_writer using (true);

create policy pilot_status_events_writer_insert
  on public.pilot_status_events for insert to dd_pilot_writer with check (true);

create policy activity_contributions_rollup_all
  on public.activity_contributions for all to dd_metrics_rollup using (true) with check (true);

create policy telemetry_day_coverage_reader_read
  on public.telemetry_day_coverage for select to dd_metrics_reader using (true);
create policy telemetry_day_coverage_rollup_all
  on public.telemetry_day_coverage for all to dd_metrics_rollup using (true) with check (true);

create policy service_usage_daily_agg_reader_read
  on public.service_usage_daily_agg for select to dd_metrics_reader using (true);
create policy service_usage_daily_agg_rollup_all
  on public.service_usage_daily_agg for all to dd_metrics_rollup using (true) with check (true);

create policy doctor_daily_activity_agg_reader_read
  on public.doctor_daily_activity_agg for select to dd_metrics_reader using (true);
create policy doctor_daily_activity_agg_rollup_all
  on public.doctor_daily_activity_agg for all to dd_metrics_rollup using (true) with check (true);

create policy pilot_status_daily_agg_reader_read
  on public.pilot_status_daily_agg for select to dd_metrics_reader using (true);
create policy pilot_status_daily_agg_rollup_all
  on public.pilot_status_daily_agg for all to dd_metrics_rollup using (true) with check (true);

alter table public.audit_events enable row level security;
alter table public.audit_events force row level security;

-- Narrow accepted exception: bounded INSERT-only audit path.
create policy audit_events_o1f_reader_insert
on public.audit_events
for insert
to dd_metrics_reader
with check (
  actor_id = auth.uid()
  and resource_type = 'pilot_participation'
  and action in (
    'OWNER_DOCTOR_ACTIVITY_LOOKUP_NOT_MEMBER',
    'OWNER_DOCTOR_ACTIVITY_LOOKUP_PARTICIPATION_WITHDRAWN',
    'OWNER_DOCTOR_ACTIVITY_LOOKUP_NOT_ENROLLED',
    'OWNER_DOCTOR_ACTIVITY_LOOKUP_CONSENT_WITHDRAWN',
    'OWNER_DOCTOR_ACTIVITY_LOOKUP_NOT_MEASURED',
    'OWNER_DOCTOR_ACTIVITY_LOOKUP_AGG_UNAVAILABLE',
    'OWNER_DOCTOR_ACTIVITY_LOOKUP_OK'
  )
);

-- Internal-role baseline.
revoke all on all tables in schema public
  from dd_metrics_reader, dd_metrics_rollup, dd_pilot_writer, dd_retention;
revoke all on all functions in schema public
  from dd_metrics_reader, dd_metrics_rollup, dd_pilot_writer, dd_retention;

grant select on public.pilot_cohorts,
  public.pilot_participations,
  public.telemetry_day_coverage,
  public.service_usage_daily_agg,
  public.doctor_daily_activity_agg,
  public.pilot_status_daily_agg
to dd_metrics_reader;
grant insert on public.audit_events to dd_metrics_reader;

grant select on public.activity_contributions,
  public.pilot_consent_events,
  public.pilot_participations,
  public.telemetry_day_coverage,
  public.service_usage_daily_agg
to dd_metrics_rollup;
grant insert, update on public.activity_contributions,
  public.telemetry_day_coverage,
  public.service_usage_daily_agg
to dd_metrics_rollup;
grant select, insert, update, delete on
  public.doctor_daily_activity_agg,
  public.pilot_status_daily_agg
to dd_metrics_rollup;

grant select, insert, update on
  public.pilot_cohorts,
  public.pilot_participations
to dd_pilot_writer;
grant insert on
  public.pilot_status_events,
  public.pilot_consent_events
to dd_pilot_writer;
grant select on
  public.pilot_participations,
  public.pilot_consent_events
to dd_pilot_writer;
grant usage on sequence
  public.pilot_consent_events_id_seq,
  public.pilot_status_events_id_seq
to dd_pilot_writer;

grant usage on schema auth to dd_metrics_reader, dd_pilot_writer;

-- Explicit function ACL hardening. Every function created by 0047 loses
-- default API execution before exact allow-list grants below.
revoke execute on function public.assert_o1_owner_aal2()
  from public, anon, authenticated, service_role;
revoke execute on function public.enforce_pilot_participation_terminal()
  from public, anon, authenticated, service_role;
revoke execute on function public.prevent_pilot_consent_event_mutation()
  from public, anon, authenticated, service_role;
revoke execute on function public.pilot_consent_is_live(
  text, uuid, pilot_consent_scope, timestamptz
) from public, anon, authenticated, service_role;
revoke execute on function public.pilot_consent_covers_day(
  text, uuid, pilot_consent_scope, date
) from public, anon, authenticated, service_role;
revoke execute on function public.prevent_pilot_status_event_mutation()
  from public, anon, authenticated, service_role;
revoke execute on function public.ingest_activity_contribution(
  text, uuid, date, text, bigint, text, bigint
) from public, anon, authenticated, service_role;
revoke execute on function public.mark_telemetry_day_coverage(
  date, uuid, telemetry_measurement_domain, boolean, bigint
) from public, anon, authenticated, service_role;
revoke execute on function public.ingest_service_usage_daily(
  date, uuid, text, text, text, text, numeric, bigint, numeric, text
) from public, anon, authenticated, service_role;
revoke execute on function public.rebuild_doctor_daily_activity_agg(date)
  from public, anon, authenticated, service_role;
revoke execute on function public.rebuild_pilot_status_daily_agg(date, text)
  from public, anon, authenticated, service_role;
revoke execute on function public.k_anon_suppress(bigint, bigint, integer)
  from public, anon, authenticated, service_role;
revoke execute on function public.participation_measurement_state(
  text, uuid, date, date, telemetry_measurement_domain
) from public, anon, authenticated, service_role;
revoke execute on function public.owner_pilot_status(date, date)
  from public, anon, authenticated, service_role;
revoke execute on function public.owner_pilot_cohort_detail(text, date, date)
  from public, anon, authenticated, service_role;
revoke execute on function public.owner_doctor_activity(text, uuid, date, date)
  from public, anon, authenticated, service_role;
revoke execute on function public.owner_activity_summary(date, date)
  from public, anon, authenticated, service_role;
revoke execute on function public.owner_service_usage_summary(text, date, date)
  from public, anon, authenticated, service_role;
revoke execute on function public.pilot_participation_state(text)
  from public, anon, authenticated, service_role;
revoke execute on function public.admin_pilot_cohort_upsert(text, text, date, date)
  from public, anon, authenticated, service_role;
revoke execute on function public.admin_pilot_participation_set(
  text, uuid, pilot_participation_status
) from public, anon, authenticated, service_role;
revoke execute on function public.admin_pilot_event_add(
  text, uuid, text, text, date
) from public, anon, authenticated, service_role;
revoke execute on function public.admin_pilot_consent_set(
  text, uuid, pilot_consent_scope, text, pilot_consent_event_kind, timestamptz
) from public, anon, authenticated, service_role;

grant execute on function public.is_platform_owner()
  to dd_metrics_reader, dd_pilot_writer;
grant execute on function public.require_aal2()
  to dd_metrics_reader, dd_pilot_writer;
grant execute on function public.assert_o1_owner_aal2()
  to dd_metrics_reader, dd_pilot_writer;

grant execute on function public.pilot_consent_is_live(
  text, uuid, pilot_consent_scope, timestamptz
) to dd_metrics_reader, dd_metrics_rollup, dd_pilot_writer;
grant execute on function public.pilot_consent_covers_day(
  text, uuid, pilot_consent_scope, date
) to dd_metrics_reader, dd_metrics_rollup;
grant execute on function public.k_anon_suppress(bigint, bigint, integer)
  to dd_metrics_reader;
grant execute on function public.participation_measurement_state(
  text, uuid, date, date, telemetry_measurement_domain
) to dd_metrics_reader;

grant execute on function public.ingest_activity_contribution(
  text, uuid, date, text, bigint, text, bigint
) to service_role;
grant execute on function public.mark_telemetry_day_coverage(
  date, uuid, telemetry_measurement_domain, boolean, bigint
) to service_role;
grant execute on function public.ingest_service_usage_daily(
  date, uuid, text, text, text, text, numeric, bigint, numeric, text
) to service_role;

grant execute on function
  public.owner_pilot_status(date, date),
  public.owner_pilot_cohort_detail(text, date, date),
  public.owner_doctor_activity(text, uuid, date, date),
  public.owner_activity_summary(date, date),
  public.owner_service_usage_summary(text, date, date),
  public.pilot_participation_state(text),
  public.admin_pilot_cohort_upsert(text, text, date, date),
  public.admin_pilot_participation_set(text, uuid, pilot_participation_status),
  public.admin_pilot_event_add(text, uuid, text, text, date),
  public.admin_pilot_consent_set(
    text, uuid, pilot_consent_scope, text, pilot_consent_event_kind, timestamptz
  )
to authenticated;

-- Supabase API roles have no direct O1-F table/sequence path.
revoke all on
  public.pilot_cohorts,
  public.pilot_participations,
  public.pilot_consent_events,
  public.pilot_event_registry,
  public.pilot_reason_registry,
  public.pilot_status_events,
  public.feature_registry,
  public.activity_contributions,
  public.telemetry_day_coverage,
  public.service_usage_daily_agg,
  public.doctor_daily_activity_agg,
  public.pilot_status_daily_agg
from public, anon, authenticated, service_role;

revoke all on sequence
  public.pilot_consent_events_id_seq,
  public.pilot_status_events_id_seq
from public, anon, authenticated, service_role;
