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
  if tg_op = 'INSERT' then
    if new.status <> 'INVITED' then
      raise exception 'PILOT_PARTICIPATION_INITIAL_STATE_INVALID'
        using errcode = 'P0001';
    end if;
    return new;
  end if;

  if new.status = old.status then
    return new;
  end if;

  if old.status = 'INVITED'
     and new.status in ('ENROLLED','WITHDRAWN')
  then
    return new;
  end if;

  if old.status = 'ENROLLED'
     and new.status in ('COMPLETED','WITHDRAWN')
  then
    return new;
  end if;

  raise exception 'PILOT_PARTICIPATION_TRANSITION_INVALID'
    using errcode = 'P0001';
end;
$$;

create trigger pilot_participations_terminal
before insert or update on public.pilot_participations
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
values
  ('*', 'Non-feature sentinel'),
  ('dashboard', 'Dashboard'),
  ('patients', 'Patients'),
  ('consultation', 'Consultation'),
  ('prescription', 'Prescription'),
  ('appointments', 'Appointments'),
  ('queue', 'Queue'),
  ('settings', 'Settings');

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
  quantity_total numeric(38,18) check (quantity_total is null or quantity_total >= 0),
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
  with lifecycle_as_of as (
    select
      p.participation_id,
      p.cohort_code,
      p.doctor_id,
      (
        select e.event_code
        from public.pilot_status_events e
        where e.participation_id = p.participation_id
          and e.cohort_code = p.cohort_code
          and e.event_code in (
            'INVITED',
            'ENROLLED',
            'COMPLETED',
            'WITHDRAWN'
          )
          and e.event_day <= target_period_day
        order by e.event_day desc, e.id desc
        limit 1
      ) as lifecycle_status
    from public.pilot_participations p
    where p.cohort_code = target_cohort_code
  )
  select
    target_period_day,
    target_cohort_code,

    count(*) filter (
      where l.lifecycle_status = 'INVITED'
    ),

    count(*) filter (
      where l.lifecycle_status = 'ENROLLED'
    ),

    count(*) filter (
      where l.lifecycle_status = 'COMPLETED'
    ),

    count(*) filter (
      where l.lifecycle_status = 'WITHDRAWN'
    ),

    count(*) filter (
      where l.lifecycle_status in ('ENROLLED','COMPLETED')
        and public.pilot_consent_covers_day(
          l.cohort_code,
          l.participation_id,
          'PRODUCT_USAGE_ANALYTICS',
          target_period_day
        )
    ),

    count(distinct l.doctor_id) filter (
      where l.lifecycle_status in ('ENROLLED','COMPLETED')
        and exists (
          select 1
          from public.doctor_daily_activity_agg a
          where a.participation_id = l.participation_id
            and a.cohort_code = l.cohort_code
            and a.period_day = target_period_day
            and a.active_day
        )
    ),

    clock_timestamp()

  from lifecycle_as_of l

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
  provider_id text,
  model_id text,
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
    select
      'UNAVAILABLE',
      null::text,
      null::text,
      null::text,
      null::text,
      null::numeric,
      null::numeric,
      null::numeric,
      null::text;
    return;
  end if;

  if v_doctors < 5 then
    return query
    select
      'INSUFFICIENT_COHORT',
      null::text,
      null::text,
      null::text,
      null::text,
      null::numeric,
      null::numeric,
      null::numeric,
      null::text;
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
    select
      'UNAVAILABLE',
      null::text,
      null::text,
      null::text,
      null::text,
      null::numeric,
      null::numeric,
      null::numeric,
      null::text;
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
    select
      'NOT_MEASURED',
      null::text,
      null::text,
      null::text,
      null::text,
      null::numeric,
      null::numeric,
      null::numeric,
      null::text;
    return;
  end if;

  select exists (
    select 1
    from public.service_usage_daily_agg s
    join public.pilot_participations p
      on p.doctor_id = s.principal_doctor_id
     and p.cohort_code = target_cohort_code
    where s.period_day
          between greatest(window_start, p.enrolled_on)
          and window_end
      and p.status in ('ENROLLED','COMPLETED')
      and public.pilot_consent_covers_day(
        p.cohort_code,
        p.participation_id,
        'PRODUCT_USAGE_ANALYTICS',
        s.period_day
      )
  )
  into v_has_rows;

  if not v_has_rows then
    return query
    select
      'OK',
      null::text,
      null::text,
      null::text,
      null::text,
      0::numeric,
      0::numeric,
      0::numeric,
      null::text;
    return;
  end if;

  return query
  with grouped as (
    select
      s.provider_id,
      s.model_id,
      s.service_kind,
      s.unit,
      s.currency_code,

      count(
        distinct s.principal_doctor_id
      ) as doctor_count,

      case
        when count(*) filter (
          where s.quantity_total is null
        ) > 0
          then null::numeric
        else sum(s.quantity_total)
      end as quantity_total,

      sum(s.event_count)::numeric as event_count,

      case
        when count(*) filter (
          where s.estimated_cost_minor is null
        ) > 0
          then null::numeric
        else sum(s.estimated_cost_minor)
      end as estimated_cost_minor

    from public.service_usage_daily_agg s

    join public.pilot_participations p
      on p.doctor_id = s.principal_doctor_id
     and p.cohort_code = target_cohort_code

    where s.period_day
          between greatest(window_start, p.enrolled_on)
          and window_end
      and p.status in ('ENROLLED','COMPLETED')
      and public.pilot_consent_covers_day(
        p.cohort_code,
        p.participation_id,
        'PRODUCT_USAGE_ANALYTICS',
        s.period_day
      )

    group by
      s.provider_id,
      s.model_id,
      s.service_kind,
      s.unit,
      s.currency_code
  )

  select
    'OK',
    g.provider_id,
    g.model_id,
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
        s.provider_id,
        s.model_id,
        s.service_kind,
        s.unit,
        s.currency_code,
        count(
          distinct s.principal_doctor_id
        ) as doctor_count

      from public.service_usage_daily_agg s

      join public.pilot_participations p
        on p.doctor_id = s.principal_doctor_id
       and p.cohort_code = target_cohort_code

      where s.period_day
            between greatest(window_start, p.enrolled_on)
            and window_end
        and p.status in ('ENROLLED','COMPLETED')
        and public.pilot_consent_covers_day(
          p.cohort_code,
          p.participation_id,
          'PRODUCT_USAGE_ANALYTICS',
          s.period_day
        )

      group by
        s.provider_id,
        s.model_id,
        s.service_kind,
        s.unit,
        s.currency_code
    ) x
    where x.doctor_count < 5
  )
  into v_has_suppressed;

  if v_has_suppressed then
    return query
    select
      'INSUFFICIENT_COHORT',
      null::text,
      null::text,
      null::text,
      null::text,
      null::numeric,
      null::numeric,
      null::numeric,
      null::text;
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
  created_new boolean := false;
begin
  perform public.assert_o1_owner_aal2();

  select
    p.participation_id,
    p.status
  into
    result,
    prior_status
  from public.pilot_participations p
  where p.cohort_code = target_cohort_code
    and p.doctor_id = target_doctor_id
  for update;

  if result is null then
    if target_status <> 'INVITED' then
      raise exception 'PILOT_PARTICIPATION_INITIAL_STATE_INVALID'
        using errcode = 'P0001';
    end if;

    insert into public.pilot_participations(
      cohort_code,
      doctor_id,
      status
    )
    values (
      target_cohort_code,
      target_doctor_id,
      'INVITED'
    )
    returning participation_id into result;

    created_new := true;

  elsif prior_status <> target_status then
    update public.pilot_participations
    set status = target_status
    where participation_id = result;
  end if;

  if created_new
     or prior_status is distinct from target_status
  then
    insert into public.pilot_status_events(
      participation_id,
      cohort_code,
      event_code,
      event_day,
      recorded_by
    )
    values (
      result,
      target_cohort_code,
      target_status::text,
      current_date,
      auth.uid()
    );
  end if;

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

  if target_event_code in (
    'INVITED',
    'ENROLLED',
    'COMPLETED',
    'WITHDRAWN'
  ) then
    raise exception 'PILOT_LIFECYCLE_EVENT_WRITER_REQUIRED'
      using errcode = 'P0001';
  end if;

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
create policy pilot_status_events_rollup_read
  on public.pilot_status_events for select to dd_metrics_rollup using (true);

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
  public.pilot_status_events,
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

-- ============================================================================
-- O1-F-I1 — Integration storage + trusted day-close authority
-- CENTRAL-authorized amendment to the still-unapplied 0047 only.
-- This block introduces no clinical analytics and does not change the frozen
-- Owner aggregate contract above.
-- ============================================================================

-- A: short-lived authoritative engaged-minute set. Exactly the four logical
-- fields frozen by O1-A; no path, patient, encounter, device, IP or payload.
create table public.engagement_minute_store (
  doctor_id uuid not null references public.doctor_profiles(id),
  period_day date not null,
  minute_bucket timestamptz not null,
  surface text not null check (surface in (
    'DASHBOARD',
    'PATIENTS',
    'CONSULTATION',
    'PRESCRIPTION',
    'APPOINTMENTS',
    'QUEUE',
    'SETTINGS',
    'OWNER'
  )),
  primary key (doctor_id, period_day, minute_bucket, surface),
  check (minute_bucket = date_trunc('minute', minute_bucket))
);
create index engagement_minute_store_retention_idx
  on public.engagement_minute_store(minute_bucket);

create or replace function public.purge_expired_engagement_minutes()
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_deleted bigint;
begin
  delete from public.engagement_minute_store
  where minute_bucket < clock_timestamp() - interval '48 hours';
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;
alter function public.purge_expired_engagement_minutes()
  owner to dd_metrics_rollup;

create or replace function public.record_engagement_minute(
  target_doctor_id uuid,
  target_period_day date,
  target_surface text
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_bucket timestamptz;
  v_inserted bigint;
begin
  if target_doctor_id is null or target_period_day is null then
    raise exception 'O1A_MINUTE_CONTEXT_REQUIRED' using errcode = '22023';
  end if;

  if target_surface not in (
    'DASHBOARD',
    'PATIENTS',
    'CONSULTATION',
    'PRESCRIPTION',
    'APPOINTMENTS',
    'QUEUE',
    'SETTINGS',
    'OWNER'
  ) then
    raise exception 'O1A_MINUTE_SURFACE_INVALID' using errcode = '22023';
  end if;

  -- The trusted server supplies the clinic day, but never a timestamp. The DB
  -- is the sole minute clock. A ±1 UTC-day guard admits legitimate timezone
  -- boundaries while refusing arbitrary historical/future bucket placement.
  v_bucket := date_trunc('minute', v_now);
  if target_period_day < ((v_bucket at time zone 'UTC')::date - 1)
     or target_period_day > ((v_bucket at time zone 'UTC')::date + 1)
  then
    raise exception 'O1A_MINUTE_PERIOD_DAY_OUT_OF_RANGE' using errcode = '22023';
  end if;

  delete from public.engagement_minute_store
  where minute_bucket < v_now - interval '48 hours';

  insert into public.engagement_minute_store(
    doctor_id,
    period_day,
    minute_bucket,
    surface
  )
  values (
    target_doctor_id,
    target_period_day,
    v_bucket,
    target_surface
  )
  on conflict (doctor_id, period_day, minute_bucket, surface) do nothing;

  get diagnostics v_inserted = row_count;
  return v_inserted = 1;
end;
$$;
alter function public.record_engagement_minute(uuid, date, text)
  owner to dd_metrics_rollup;

create or replace function public.snapshot_engagement_minutes(
  target_doctor_id uuid,
  target_period_day date
) returns table (
  minute_bucket timestamptz,
  surface text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := clock_timestamp();
begin
  if target_doctor_id is null or target_period_day is null then
    raise exception 'O1A_MINUTE_CONTEXT_REQUIRED' using errcode = '22023';
  end if;

  delete from public.engagement_minute_store m
  where m.minute_bucket < v_now - interval '48 hours';

  return query
  select m.minute_bucket, m.surface
  from public.engagement_minute_store m
  where m.doctor_id = target_doctor_id
    and m.period_day = target_period_day
    and m.minute_bucket >= v_now - interval '48 hours'
  order by m.minute_bucket, m.surface;
end;
$$;
alter function public.snapshot_engagement_minutes(uuid, date)
  owner to dd_metrics_rollup;

-- E: durable privacy-safe L0 telemetry. No JSONB or opaque payload is persisted.
-- event_key is the idempotency primary key frozen by O1-E.
create table public.ai_voice_telemetry_l0 (
  event_key text primary key check (char_length(event_key) between 1 and 160),
  event_type text not null check (event_type in (
    'AI_OPERATION_STARTED',
    'AI_PROVIDER_ATTEMPTED',
    'AI_PROVIDER_SUCCEEDED',
    'AI_PROVIDER_FAILED',
    'AI_PROVIDER_TIMEOUT',
    'AI_PROPOSAL_PRODUCED',
    'AI_PROPOSAL_ACCEPTED',
    'AI_PROPOSAL_EDITED',
    'AI_PROPOSAL_REJECTED',
    'AI_PROPOSAL_EXPIRED',
    'VOICE_GRANT_ISSUED',
    'VOICE_GRANT_DENIED',
    'VOICE_SESSION_REPORTED'
  )),
  schema_version integer not null check (schema_version = 1),
  occurred_at timestamptz not null,
  actor_user_id uuid,
  doctor_profile_id uuid,
  operation_id text check (
    operation_id is null or operation_id ~ '^ddop_[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  proposal_id text check (
    proposal_id is null or proposal_id ~ '^ddprop_[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  voice_session_id text check (
    voice_session_id is null or voice_session_id ~ '^ddvs_[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  grant_id text check (
    grant_id is null or grant_id ~ '^ddgr_[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  provider_id text check (
    provider_id is null or provider_id ~ '^[a-z0-9][a-z0-9._-]{0,63}$'
  ),
  model_id text check (
    model_id is null or model_id ~ '^[a-z0-9][a-z0-9._-]{0,63}$'
  ),
  task_type text check (task_type is null or task_type in (
    'PRESCRIPTION_MEDICINE',
    'INVESTIGATION_LIST',
    'CLINICAL_NOTE',
    'NAVIGATION_COMMAND'
  )),
  source text check (source is null or source in ('TEXT','VOICE_TRANSCRIPT')),
  attempt_no smallint check (attempt_no is null or attempt_no between 1 and 100),
  latency_ms bigint check (latency_ms is null or latency_ms between 0 and 9007199254740991),
  failure_code text check (failure_code is null or failure_code in (
    'VALIDATION_REJECTED',
    'PROVIDER_TIMEOUT',
    'PROVIDER_ABORTED',
    'PROVIDER_ERROR_UNCLASSIFIED',
    'POST_PROVIDER_INTERNAL',
    'OPENAI_SYNTHETIC_EVAL_DISABLED',
    'OPENAI_API_KEY_MISSING',
    'OPENAI_PROVIDER_HTTP',
    'OPENAI_PROVIDER_REFUSAL',
    'OPENAI_PROVIDER_INCOMPLETE',
    'OPENAI_PROVIDER_MALFORMED'
  )),
  provider_http_status integer check (
    provider_http_status is null or provider_http_status between 100 and 599
  ),
  usage_state text check (usage_state is null or usage_state in (
    'REPORTED',
    'UNKNOWN_PENDING_RECONCILIATION',
    'NOT_APPLICABLE'
  )),
  input_tokens bigint check (input_tokens is null or input_tokens between 0 and 9007199254740991),
  cached_input_tokens bigint check (cached_input_tokens is null or cached_input_tokens between 0 and 9007199254740991),
  output_tokens bigint check (output_tokens is null or output_tokens between 0 and 9007199254740991),
  reasoning_tokens bigint check (reasoning_tokens is null or reasoning_tokens between 0 and 9007199254740991),
  total_tokens bigint check (total_tokens is null or total_tokens between 0 and 9007199254740991),
  cost_state text check (cost_state is null or cost_state in (
    'ESTIMATED',
    'PROVIDER_REPORTED',
    'RECONCILED',
    'UNKNOWN_PENDING_RECONCILIATION',
    'UNPRICED',
    'NOT_INCURRED'
  )),
  cost_source text check (cost_source is null or cost_source in (
    'PRICING_SNAPSHOT',
    'PROVIDER_REPORTED',
    'RECONCILIATION'
  )),
  cost_attribution_mode text check (
    cost_attribution_mode is null or cost_attribution_mode in ('ALLOCATED','CANONICAL')
  ),
  pricing_snapshot_id text check (
    pricing_snapshot_id is null or pricing_snapshot_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
  ),
  estimated_cost_usd_micros numeric(24,6) check (
    estimated_cost_usd_micros is null or estimated_cost_usd_micros >= 0
  ),
  input_cost_usd_micros numeric(24,6) check (
    input_cost_usd_micros is null or input_cost_usd_micros >= 0
  ),
  cached_input_cost_usd_micros numeric(24,6) check (
    cached_input_cost_usd_micros is null or cached_input_cost_usd_micros >= 0
  ),
  output_cost_usd_micros numeric(24,6) check (
    output_cost_usd_micros is null or output_cost_usd_micros >= 0
  ),
  uncertainty_count bigint check (
    uncertainty_count is null or uncertainty_count between 0 and 9007199254740991
  ),
  denial_reason text check (denial_reason is null or denial_reason in (
    'RATE_LIMITED',
    'CONFIG_MISSING',
    'GRANT_REJECTED',
    'GRANT_NETWORK'
  )),
  streamed_audio_ms bigint check (
    streamed_audio_ms is null or streamed_audio_ms between 0 and 900000
  ),
  measurement_quality text check (measurement_quality is null or measurement_quality in (
    'CLIENT_ESTIMATE',
    'PROVIDER_REPORTED',
    'RECONCILED',
    'UNKNOWN'
  )),
  connect_latency_ms bigint check (
    connect_latency_ms is null or connect_latency_ms between 0 and 9007199254740991
  ),
  first_result_latency_ms bigint check (
    first_result_latency_ms is null or first_result_latency_ms between 0 and 9007199254740991
  ),

  -- Identifier/shape confinement: typed columns cannot be populated by an
  -- event type that did not carry them in frozen E.
  check (
    (operation_id is null or event_type in (
      'AI_OPERATION_STARTED','AI_PROVIDER_ATTEMPTED','AI_PROVIDER_SUCCEEDED',
      'AI_PROVIDER_FAILED','AI_PROVIDER_TIMEOUT','AI_PROPOSAL_PRODUCED'
    ))
    and (proposal_id is null or event_type in (
      'AI_PROPOSAL_PRODUCED','AI_PROPOSAL_ACCEPTED','AI_PROPOSAL_EDITED',
      'AI_PROPOSAL_REJECTED','AI_PROPOSAL_EXPIRED'
    ))
    and (voice_session_id is null or event_type = 'VOICE_SESSION_REPORTED')
    and (grant_id is null or event_type in (
      'VOICE_GRANT_ISSUED','VOICE_GRANT_DENIED','VOICE_SESSION_REPORTED'
    ))
  ),

  -- Required fields per event family.
  check (
    (event_type <> 'AI_OPERATION_STARTED' or
      (operation_id is not null and provider_id is not null and model_id is not null
       and task_type is not null and source is not null))
    and
    (event_type <> 'AI_PROVIDER_ATTEMPTED' or
      (operation_id is not null and attempt_no is not null and provider_id is not null
       and model_id is not null and task_type is not null))
    and
    (event_type not in ('AI_PROVIDER_SUCCEEDED','AI_PROVIDER_FAILED','AI_PROVIDER_TIMEOUT') or
      (operation_id is not null and attempt_no is not null and provider_id is not null
       and model_id is not null and task_type is not null and latency_ms is not null
       and usage_state is not null and cost_state is not null))
    and
    (event_type <> 'AI_PROPOSAL_PRODUCED' or
      (operation_id is not null and proposal_id is not null and provider_id is not null
       and model_id is not null and task_type is not null and uncertainty_count is not null))
    and
    (event_type not in (
      'AI_PROPOSAL_ACCEPTED','AI_PROPOSAL_EDITED','AI_PROPOSAL_REJECTED','AI_PROPOSAL_EXPIRED'
    ) or (proposal_id is not null and task_type is not null))
    and
    (event_type not in ('VOICE_GRANT_ISSUED','VOICE_GRANT_DENIED') or
      (grant_id is not null and provider_id is not null and model_id is not null))
    and
    (event_type <> 'VOICE_SESSION_REPORTED' or
      (voice_session_id is not null and grant_id is not null and provider_id is not null
       and model_id is not null and measurement_quality is not null and cost_state is not null))
  ),

  -- Frozen outcome truth rules.
  check (
    event_type not in ('AI_PROVIDER_SUCCEEDED','AI_PROVIDER_FAILED','AI_PROVIDER_TIMEOUT')
    or (
      (event_type <> 'AI_PROVIDER_SUCCEEDED' or failure_code is null)
      and (event_type = 'AI_PROVIDER_SUCCEEDED' or failure_code is not null)
      and (event_type <> 'AI_PROVIDER_TIMEOUT' or
        (failure_code = 'PROVIDER_TIMEOUT' and usage_state = 'UNKNOWN_PENDING_RECONCILIATION'))
      and (usage_state = 'REPORTED' or
        (input_tokens is null and cached_input_tokens is null and output_tokens is null
         and reasoning_tokens is null and total_tokens is null))
      and (usage_state <> 'UNKNOWN_PENDING_RECONCILIATION'
        or cost_state = 'UNKNOWN_PENDING_RECONCILIATION')
      and (usage_state <> 'NOT_APPLICABLE' or cost_state = 'NOT_INCURRED')
      and (input_tokens is null or cached_input_tokens is null or cached_input_tokens <= input_tokens)
      and (output_tokens is null or reasoning_tokens is null or reasoning_tokens <= output_tokens)
    )
  ),

  -- Frozen grant/report truth rules.
  check (
    (event_type <> 'VOICE_GRANT_ISSUED' or denial_reason is null)
    and (event_type <> 'VOICE_GRANT_DENIED' or denial_reason is not null)
    and (event_type <> 'VOICE_SESSION_REPORTED' or
      (streamed_audio_ms is not null or cost_state = 'UNKNOWN_PENDING_RECONCILIATION'))
  ),

  -- Frozen cost completeness. Unknown is NULL, authoritative zero is numeric 0.
  check (
    cost_state is null
    or (
      (cost_state not in ('UNKNOWN_PENDING_RECONCILIATION','UNPRICED')
       or (estimated_cost_usd_micros is null
           and input_cost_usd_micros is null
           and cached_input_cost_usd_micros is null
           and output_cost_usd_micros is null
           and cost_source is null
           and cost_attribution_mode is null))
      and
      (cost_state <> 'NOT_INCURRED' or (estimated_cost_usd_micros is not null and estimated_cost_usd_micros = 0))
      and
      (cost_state not in ('ESTIMATED','PROVIDER_REPORTED','RECONCILED')
       or (estimated_cost_usd_micros is not null
           and cost_source is not null
           and cost_attribution_mode is not null))
    )
  ),

  check (
    event_type not in ('AI_PROVIDER_SUCCEEDED','AI_PROVIDER_FAILED','AI_PROVIDER_TIMEOUT')
    or cost_state not in ('ESTIMATED','PROVIDER_REPORTED','RECONCILED')
    or (
      input_cost_usd_micros is not null
      and cached_input_cost_usd_micros is not null
      and output_cost_usd_micros is not null
      and input_cost_usd_micros + cached_input_cost_usd_micros + output_cost_usd_micros
          = estimated_cost_usd_micros
      and (
        cost_attribution_mode <> 'CANONICAL'
        or (input_cost_usd_micros = 0 and cached_input_cost_usd_micros = 0)
      )
    )
  )
);
create index ai_voice_telemetry_l0_occurred_key_idx
  on public.ai_voice_telemetry_l0(occurred_at, event_key);
create index ai_voice_telemetry_l0_proposal_idx
  on public.ai_voice_telemetry_l0(proposal_id)
  where proposal_id is not null;
create index ai_voice_telemetry_l0_grant_idx
  on public.ai_voice_telemetry_l0(grant_id, occurred_at, event_key)
  where grant_id is not null;

create or replace function public.o1e_telemetry_allowed_keys(
  target_event_type text
) returns text[]
language sql
immutable
set search_path = public, pg_temp
as $$
  select case target_event_type
    when 'AI_OPERATION_STARTED' then array[
      'event_type','schema_version','event_key','occurred_at','actor_user_id','doctor_profile_id',
      'operation_id','provider_id','model_id','task_type','source'
    ]::text[]
    when 'AI_PROVIDER_ATTEMPTED' then array[
      'event_type','schema_version','event_key','occurred_at','actor_user_id','doctor_profile_id',
      'operation_id','attempt_no','provider_id','model_id','task_type'
    ]::text[]
    when 'AI_PROVIDER_SUCCEEDED' then array[
      'event_type','schema_version','event_key','occurred_at','actor_user_id','doctor_profile_id',
      'operation_id','attempt_no','provider_id','model_id','task_type','latency_ms','failure_code',
      'provider_http_status','usage_state','input_tokens','cached_input_tokens','output_tokens',
      'reasoning_tokens','total_tokens','cost_state','cost_source','cost_attribution_mode',
      'pricing_snapshot_id','estimated_cost_usd_micros','input_cost_usd_micros',
      'cached_input_cost_usd_micros','output_cost_usd_micros'
    ]::text[]
    when 'AI_PROVIDER_FAILED' then array[
      'event_type','schema_version','event_key','occurred_at','actor_user_id','doctor_profile_id',
      'operation_id','attempt_no','provider_id','model_id','task_type','latency_ms','failure_code',
      'provider_http_status','usage_state','input_tokens','cached_input_tokens','output_tokens',
      'reasoning_tokens','total_tokens','cost_state','cost_source','cost_attribution_mode',
      'pricing_snapshot_id','estimated_cost_usd_micros','input_cost_usd_micros',
      'cached_input_cost_usd_micros','output_cost_usd_micros'
    ]::text[]
    when 'AI_PROVIDER_TIMEOUT' then array[
      'event_type','schema_version','event_key','occurred_at','actor_user_id','doctor_profile_id',
      'operation_id','attempt_no','provider_id','model_id','task_type','latency_ms','failure_code',
      'provider_http_status','usage_state','input_tokens','cached_input_tokens','output_tokens',
      'reasoning_tokens','total_tokens','cost_state','cost_source','cost_attribution_mode',
      'pricing_snapshot_id','estimated_cost_usd_micros','input_cost_usd_micros',
      'cached_input_cost_usd_micros','output_cost_usd_micros'
    ]::text[]
    when 'AI_PROPOSAL_PRODUCED' then array[
      'event_type','schema_version','event_key','occurred_at','actor_user_id','doctor_profile_id',
      'operation_id','proposal_id','provider_id','model_id','task_type','uncertainty_count'
    ]::text[]
    when 'AI_PROPOSAL_ACCEPTED' then array[
      'event_type','schema_version','event_key','occurred_at','actor_user_id','doctor_profile_id',
      'proposal_id','task_type'
    ]::text[]
    when 'AI_PROPOSAL_EDITED' then array[
      'event_type','schema_version','event_key','occurred_at','actor_user_id','doctor_profile_id',
      'proposal_id','task_type'
    ]::text[]
    when 'AI_PROPOSAL_REJECTED' then array[
      'event_type','schema_version','event_key','occurred_at','actor_user_id','doctor_profile_id',
      'proposal_id','task_type'
    ]::text[]
    when 'AI_PROPOSAL_EXPIRED' then array[
      'event_type','schema_version','event_key','occurred_at','actor_user_id','doctor_profile_id',
      'proposal_id','task_type'
    ]::text[]
    when 'VOICE_GRANT_ISSUED' then array[
      'event_type','schema_version','event_key','occurred_at','actor_user_id','doctor_profile_id',
      'grant_id','provider_id','model_id','denial_reason'
    ]::text[]
    when 'VOICE_GRANT_DENIED' then array[
      'event_type','schema_version','event_key','occurred_at','actor_user_id','doctor_profile_id',
      'grant_id','provider_id','model_id','denial_reason'
    ]::text[]
    when 'VOICE_SESSION_REPORTED' then array[
      'event_type','schema_version','event_key','occurred_at','actor_user_id','doctor_profile_id',
      'voice_session_id','grant_id','provider_id','model_id','streamed_audio_ms',
      'measurement_quality','connect_latency_ms','first_result_latency_ms','cost_state','cost_source',
      'cost_attribution_mode','pricing_snapshot_id','estimated_cost_usd_micros'
    ]::text[]
    else null::text[]
  end;
$$;
alter function public.o1e_telemetry_allowed_keys(text)
  owner to dd_metrics_rollup;

create or replace function public.ingest_ai_voice_telemetry_event(
  target_event jsonb
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_type text;
  v_allowed text[];
  v_key text;
  v_kind text;
  v_expected_key text;
  v_inserted bigint;
  v_numeric_keys constant text[] := array[
    'schema_version','attempt_no','latency_ms','provider_http_status','input_tokens',
    'cached_input_tokens','output_tokens','reasoning_tokens','total_tokens','uncertainty_count',
    'streamed_audio_ms','connect_latency_ms','first_result_latency_ms'
  ];
  v_nullable_keys constant text[] := array[
    'actor_user_id','doctor_profile_id','failure_code','provider_http_status','input_tokens',
    'cached_input_tokens','output_tokens','reasoning_tokens','total_tokens','cost_source',
    'cost_attribution_mode','pricing_snapshot_id','estimated_cost_usd_micros',
    'input_cost_usd_micros','cached_input_cost_usd_micros','output_cost_usd_micros',
    'denial_reason','streamed_audio_ms','connect_latency_ms','first_result_latency_ms'
  ];
  v_micros_keys constant text[] := array[
    'estimated_cost_usd_micros','input_cost_usd_micros',
    'cached_input_cost_usd_micros','output_cost_usd_micros'
  ];
begin
  if target_event is null or jsonb_typeof(target_event) <> 'object' then
    raise exception 'O1E_EVENT_OBJECT_REQUIRED' using errcode = '22023';
  end if;

  v_type := target_event ->> 'event_type';
  v_allowed := public.o1e_telemetry_allowed_keys(v_type);
  if v_allowed is null then
    raise exception 'O1E_EVENT_TYPE_INVALID' using errcode = '22023';
  end if;

  if exists (
    select 1 from jsonb_object_keys(target_event) k
    where not (k = any(v_allowed))
  ) or exists (
    select 1 from unnest(v_allowed) k
    where not (target_event ? k)
  ) then
    raise exception 'O1E_EVENT_FIELDS_INVALID' using errcode = '22023';
  end if;

  foreach v_key in array v_allowed
  loop
    v_kind := jsonb_typeof(target_event -> v_key);
    if v_kind = 'null' then
      if not (v_key = any(v_nullable_keys)) then
        raise exception 'O1E_EVENT_NULL_INVALID:%', v_key using errcode = '22023';
      end if;
    elsif v_key = any(v_numeric_keys) then
      if v_kind <> 'number' or (target_event ->> v_key) !~ '^\d+$' then
        raise exception 'O1E_EVENT_NUMBER_INVALID:%', v_key using errcode = '22023';
      end if;
    elsif v_kind <> 'string' then
      raise exception 'O1E_EVENT_STRING_INVALID:%', v_key using errcode = '22023';
    end if;
  end loop;

  if target_event ->> 'schema_version' <> '1' then
    raise exception 'O1E_SCHEMA_VERSION_INVALID' using errcode = '22023';
  end if;

  if (target_event ->> 'occurred_at') !~
     '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$'
  then
    raise exception 'O1E_OCCURRED_AT_INVALID' using errcode = '22023';
  end if;

  foreach v_key in array v_micros_keys
  loop
    if target_event ? v_key
       and jsonb_typeof(target_event -> v_key) <> 'null'
       and (target_event ->> v_key) !~ '^\d{1,18}\.\d{6}$'
    then
      raise exception 'O1E_MICROS_INVALID:%', v_key using errcode = '22023';
    end if;
  end loop;

  v_expected_key := case v_type
    when 'AI_OPERATION_STARTED' then 'op:' || (target_event ->> 'operation_id')
    when 'AI_PROVIDER_ATTEMPTED' then
      'att:' || (target_event ->> 'operation_id') || ':' || (target_event ->> 'attempt_no')
    when 'AI_PROVIDER_SUCCEEDED' then
      'out:' || (target_event ->> 'operation_id') || ':' || (target_event ->> 'attempt_no')
    when 'AI_PROVIDER_FAILED' then
      'out:' || (target_event ->> 'operation_id') || ':' || (target_event ->> 'attempt_no')
    when 'AI_PROVIDER_TIMEOUT' then
      'out:' || (target_event ->> 'operation_id') || ':' || (target_event ->> 'attempt_no')
    when 'AI_PROPOSAL_PRODUCED' then 'prop:' || (target_event ->> 'proposal_id')
    when 'AI_PROPOSAL_ACCEPTED' then 'dec:' || (target_event ->> 'proposal_id')
    when 'AI_PROPOSAL_EDITED' then 'dec:' || (target_event ->> 'proposal_id')
    when 'AI_PROPOSAL_REJECTED' then 'dec:' || (target_event ->> 'proposal_id')
    when 'AI_PROPOSAL_EXPIRED' then 'exp:' || (target_event ->> 'proposal_id')
    when 'VOICE_GRANT_ISSUED' then 'grant:' || (target_event ->> 'grant_id')
    when 'VOICE_GRANT_DENIED' then 'grant:' || (target_event ->> 'grant_id')
    when 'VOICE_SESSION_REPORTED' then 'voice:' || (target_event ->> 'voice_session_id')
  end;

  if v_expected_key is null or target_event ->> 'event_key' <> v_expected_key then
    raise exception 'O1E_EVENT_KEY_MISMATCH' using errcode = '22023';
  end if;

  insert into public.ai_voice_telemetry_l0(
    event_key,
    event_type,
    schema_version,
    occurred_at,
    actor_user_id,
    doctor_profile_id,
    operation_id,
    proposal_id,
    voice_session_id,
    grant_id,
    provider_id,
    model_id,
    task_type,
    source,
    attempt_no,
    latency_ms,
    failure_code,
    provider_http_status,
    usage_state,
    input_tokens,
    cached_input_tokens,
    output_tokens,
    reasoning_tokens,
    total_tokens,
    cost_state,
    cost_source,
    cost_attribution_mode,
    pricing_snapshot_id,
    estimated_cost_usd_micros,
    input_cost_usd_micros,
    cached_input_cost_usd_micros,
    output_cost_usd_micros,
    uncertainty_count,
    denial_reason,
    streamed_audio_ms,
    measurement_quality,
    connect_latency_ms,
    first_result_latency_ms
  ) values (
    target_event ->> 'event_key',
    v_type,
    (target_event ->> 'schema_version')::integer,
    (target_event ->> 'occurred_at')::timestamptz,
    nullif(target_event ->> 'actor_user_id', '')::uuid,
    nullif(target_event ->> 'doctor_profile_id', '')::uuid,
    target_event ->> 'operation_id',
    target_event ->> 'proposal_id',
    target_event ->> 'voice_session_id',
    target_event ->> 'grant_id',
    target_event ->> 'provider_id',
    target_event ->> 'model_id',
    target_event ->> 'task_type',
    target_event ->> 'source',
    (target_event ->> 'attempt_no')::smallint,
    (target_event ->> 'latency_ms')::bigint,
    target_event ->> 'failure_code',
    (target_event ->> 'provider_http_status')::integer,
    target_event ->> 'usage_state',
    (target_event ->> 'input_tokens')::bigint,
    (target_event ->> 'cached_input_tokens')::bigint,
    (target_event ->> 'output_tokens')::bigint,
    (target_event ->> 'reasoning_tokens')::bigint,
    (target_event ->> 'total_tokens')::bigint,
    target_event ->> 'cost_state',
    target_event ->> 'cost_source',
    target_event ->> 'cost_attribution_mode',
    target_event ->> 'pricing_snapshot_id',
    (target_event ->> 'estimated_cost_usd_micros')::numeric(24,6),
    (target_event ->> 'input_cost_usd_micros')::numeric(24,6),
    (target_event ->> 'cached_input_cost_usd_micros')::numeric(24,6),
    (target_event ->> 'output_cost_usd_micros')::numeric(24,6),
    (target_event ->> 'uncertainty_count')::bigint,
    target_event ->> 'denial_reason',
    (target_event ->> 'streamed_audio_ms')::bigint,
    target_event ->> 'measurement_quality',
    (target_event ->> 'connect_latency_ms')::bigint,
    (target_event ->> 'first_result_latency_ms')::bigint
  )
  on conflict (event_key) do nothing;

  get diagnostics v_inserted = row_count;
  return v_inserted = 1;
end;
$$;
alter function public.ingest_ai_voice_telemetry_event(jsonb)
  owner to dd_metrics_rollup;

create or replace function public.read_ai_voice_telemetry_events(
  target_from timestamptz,
  target_until timestamptz,
  target_after_occurred timestamptz default null,
  target_after_event_key text default null,
  target_limit integer default 1000
) returns setof public.ai_voice_telemetry_l0
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if target_from is null or target_until is null
     or target_until <= target_from
     or target_until - target_from > interval '48 hours'
  then
    raise exception 'O1E_READ_WINDOW_INVALID' using errcode = '22023';
  end if;

  if target_limit is null or target_limit < 1 or target_limit > 5000 then
    raise exception 'O1E_READ_LIMIT_INVALID' using errcode = '22023';
  end if;

  if (target_after_occurred is null) <> (target_after_event_key is null) then
    raise exception 'O1E_READ_CURSOR_INVALID' using errcode = '22023';
  end if;

  return query
  select e.*
  from public.ai_voice_telemetry_l0 e
  where e.occurred_at >= target_from
    and e.occurred_at < target_until
    and (
      target_after_occurred is null
      or (e.occurred_at, e.event_key) > (target_after_occurred, target_after_event_key)
    )
  order by e.occurred_at, e.event_key
  limit target_limit;
end;
$$;
alter function public.read_ai_voice_telemetry_events(
  timestamptz, timestamptz, timestamptz, text, integer
) owner to dd_metrics_rollup;

-- Trusted day-close authorities. The boolean is an explicit worker attestation;
-- false never mutates coverage. Existing ingestion/rebuild authorities remain
-- internal and are invoked under the rollup owner, not granted to callers.
create or replace function public.finalize_activity_measurement_day(
  target_period_day date,
  target_source_version bigint,
  target_ingestion_complete boolean
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  d record;
  c record;
begin
  if target_period_day is null or target_source_version is null or target_source_version < 0 then
    raise exception 'O1F_ACTIVITY_CLOSE_ARGUMENT_INVALID' using errcode = '22023';
  end if;
  if target_ingestion_complete is distinct from true then
    raise exception 'O1F_ACTIVITY_CLOSE_ATTESTATION_REQUIRED' using errcode = '22023';
  end if;

  for d in
    select distinct p.doctor_id
    from public.pilot_participations p
    where p.status in ('ENROLLED','COMPLETED')
      and p.enrolled_on <= target_period_day
      and public.pilot_consent_covers_day(
        p.cohort_code,
        p.participation_id,
        'PRODUCT_USAGE_ANALYTICS',
        target_period_day
      )
  loop
    perform public.mark_telemetry_day_coverage(
      target_period_day,
      d.doctor_id,
      'ACTIVITY',
      true,
      target_source_version
    );
  end loop;

  if exists (
    select 1
    from public.pilot_participations p
    where p.status in ('ENROLLED','COMPLETED')
      and p.enrolled_on <= target_period_day
      and public.pilot_consent_covers_day(
        p.cohort_code,
        p.participation_id,
        'PRODUCT_USAGE_ANALYTICS',
        target_period_day
      )
      and not exists (
        select 1
        from public.telemetry_day_coverage t
        where t.period_day = target_period_day
          and t.principal_doctor_id = p.doctor_id
          and t.measurement_domain = 'ACTIVITY'
          and t.is_complete
      )
  ) then
    raise exception 'O1F_ACTIVITY_CLOSE_SOURCE_VERSION_STALE' using errcode = '40001';
  end if;

  perform public.rebuild_doctor_daily_activity_agg(target_period_day);

  for c in select distinct p.cohort_code from public.pilot_participations p
  loop
    perform public.rebuild_pilot_status_daily_agg(target_period_day, c.cohort_code);
  end loop;

  perform public.purge_expired_engagement_minutes();
end;
$$;
alter function public.finalize_activity_measurement_day(date, bigint, boolean)
  owner to dd_metrics_rollup;

create or replace function public.finalize_ai_voice_measurement_day(
  target_period_day date,
  target_source_version bigint,
  target_projection_complete boolean
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  d record;
begin
  if target_period_day is null or target_source_version is null or target_source_version < 0 then
    raise exception 'O1F_AI_VOICE_CLOSE_ARGUMENT_INVALID' using errcode = '22023';
  end if;
  if target_projection_complete is distinct from true then
    raise exception 'O1F_AI_VOICE_CLOSE_ATTESTATION_REQUIRED' using errcode = '22023';
  end if;

  for d in
    select distinct p.doctor_id
    from public.pilot_participations p
    where p.status in ('ENROLLED','COMPLETED')
      and p.enrolled_on <= target_period_day
      and public.pilot_consent_covers_day(
        p.cohort_code,
        p.participation_id,
        'PRODUCT_USAGE_ANALYTICS',
        target_period_day
      )
  loop
    perform public.mark_telemetry_day_coverage(
      target_period_day,
      d.doctor_id,
      'AI_VOICE',
      true,
      target_source_version
    );
  end loop;

  if exists (
    select 1
    from public.pilot_participations p
    where p.status in ('ENROLLED','COMPLETED')
      and p.enrolled_on <= target_period_day
      and public.pilot_consent_covers_day(
        p.cohort_code,
        p.participation_id,
        'PRODUCT_USAGE_ANALYTICS',
        target_period_day
      )
      and not exists (
        select 1
        from public.telemetry_day_coverage t
        where t.period_day = target_period_day
          and t.principal_doctor_id = p.doctor_id
          and t.measurement_domain = 'AI_VOICE'
          and t.is_complete
      )
  ) then
    raise exception 'O1F_AI_VOICE_CLOSE_SOURCE_VERSION_STALE' using errcode = '40001';
  end if;
end;
$$;
alter function public.finalize_ai_voice_measurement_day(date, bigint, boolean)
  owner to dd_metrics_rollup;

-- Every new table is RLS-forced. No API role gets a direct policy.
alter table public.engagement_minute_store enable row level security;
alter table public.engagement_minute_store force row level security;
create policy engagement_minute_store_deny_default
  on public.engagement_minute_store for all
  using (false) with check (false);
create policy engagement_minute_store_rollup_all
  on public.engagement_minute_store for all to dd_metrics_rollup
  using (true) with check (true);

alter table public.ai_voice_telemetry_l0 enable row level security;
alter table public.ai_voice_telemetry_l0 force row level security;
create policy ai_voice_telemetry_l0_deny_default
  on public.ai_voice_telemetry_l0 for all
  using (false) with check (false);
create policy ai_voice_telemetry_l0_rollup_read
  on public.ai_voice_telemetry_l0 for select to dd_metrics_rollup
  using (true);
create policy ai_voice_telemetry_l0_rollup_insert
  on public.ai_voice_telemetry_l0 for insert to dd_metrics_rollup
  with check (true);

-- No direct table path for any Supabase API role, including service_role.
revoke all on public.engagement_minute_store, public.ai_voice_telemetry_l0
  from public, anon, authenticated, service_role,
       dd_metrics_reader, dd_metrics_rollup, dd_pilot_writer, dd_retention;

grant select, insert, delete on public.engagement_minute_store
  to dd_metrics_rollup;
grant select, insert on public.ai_voice_telemetry_l0
  to dd_metrics_rollup;

-- Default function EXECUTE is removed before the narrow grants.
revoke execute on function public.purge_expired_engagement_minutes()
  from public, anon, authenticated, service_role,
       dd_metrics_reader, dd_pilot_writer, dd_retention;
revoke execute on function public.record_engagement_minute(uuid, date, text)
  from public, anon, authenticated, service_role,
       dd_metrics_reader, dd_pilot_writer, dd_retention;
revoke execute on function public.snapshot_engagement_minutes(uuid, date)
  from public, anon, authenticated, service_role,
       dd_metrics_reader, dd_pilot_writer, dd_retention;
revoke execute on function public.o1e_telemetry_allowed_keys(text)
  from public, anon, authenticated, service_role,
       dd_metrics_reader, dd_pilot_writer, dd_retention;
revoke execute on function public.ingest_ai_voice_telemetry_event(jsonb)
  from public, anon, authenticated, service_role,
       dd_metrics_reader, dd_pilot_writer, dd_retention;
revoke execute on function public.read_ai_voice_telemetry_events(
  timestamptz, timestamptz, timestamptz, text, integer
) from public, anon, authenticated, service_role,
       dd_metrics_reader, dd_pilot_writer, dd_retention;
revoke execute on function public.finalize_activity_measurement_day(date, bigint, boolean)
  from public, anon, authenticated, service_role,
       dd_metrics_reader, dd_pilot_writer, dd_retention;
revoke execute on function public.finalize_ai_voice_measurement_day(date, bigint, boolean)
  from public, anon, authenticated, service_role,
       dd_metrics_reader, dd_pilot_writer, dd_retention;

grant execute on function public.purge_expired_engagement_minutes()
  to service_role;
grant execute on function public.record_engagement_minute(uuid, date, text)
  to service_role;
grant execute on function public.snapshot_engagement_minutes(uuid, date)
  to service_role;
grant execute on function public.ingest_ai_voice_telemetry_event(jsonb)
  to service_role;
grant execute on function public.read_ai_voice_telemetry_events(
  timestamptz, timestamptz, timestamptz, text, integer
) to service_role;
grant execute on function public.finalize_activity_measurement_day(date, bigint, boolean)
  to service_role;
grant execute on function public.finalize_ai_voice_measurement_day(date, bigint, boolean)
  to service_role;


-- The trusted wrappers execute accepted F authorities as the private internal
-- rollup role. These grants do NOT reach any API role and are intentionally
-- narrower than exposing the rollup functions to service_role.
grant execute on function public.mark_telemetry_day_coverage(
  date, uuid, telemetry_measurement_domain, boolean, bigint
) to dd_metrics_rollup;
grant execute on function public.rebuild_doctor_daily_activity_agg(date)
  to dd_metrics_rollup;
grant execute on function public.rebuild_pilot_status_daily_agg(date, text)
  to dd_metrics_rollup;
