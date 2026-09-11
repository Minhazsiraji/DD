-- O1-F — Owner Analytics Authority. Runtime migration 0047.
-- FORWARD ONLY. Do not edit 0041–0046.
--
-- Rebased per Central O1-F-R1 correction: this candidate is built directly on
-- the unified runtime's OWN accepted primitives —
--   public.is_platform_owner()   (0033_platform_owner_authority.sql)
--   public.session_is_aal2() / public.require_aal2()   (0045_prelaunch_sec01b_security_closure.sql)
-- — and introduces NO alternate Owner table, NO alternate AAL claim reader, and
-- NO parallel identity/authority state. It does not touch db/manifest.toml or
-- the separate Database V2 P0 Track-A program; that program is untouched and
-- stays separate until Central explicitly reconciles/cuts it over.
--
-- Domain L (metric_definitions / metric_contributions / metric_rollups /
-- service_usage_daily_agg / dd_metrics_reader / dd_metrics_rollup /
-- dd_owner_analytics) DOES NOT EXIST anywhere in this unified runtime —
-- confirmed by inspection, not assumed. Consequently:
--   - there is no metric_contributions grant/policy in this file at all: the
--     table does not exist, so the "conditionally approved" read has nothing
--     to attach to. If Domain L's raw contribution ledger is introduced later,
--     its read grant belongs with THAT introducing migration, not here.
--   - operational counts derived from real clinical activity (consultations
--     completed, prescriptions finalized, appointments booked) are OUT OF
--     SCOPE for this file. Populating them safely requires a privacy-safe
--     contribution-fact mechanism (an AFTER trigger on encounters/
--     prescriptions/appointments emitting a non-clinical fact, exactly the
--     shape the frozen O1-F architecture describes for Domain L) that does not
--     exist in this codebase yet. This file does not fabricate that data and
--     does not read encounters/prescriptions/appointments/patients from any
--     Domain-L object, directly or indirectly.
--
-- Everything below is additive only. No existing table, policy, grant, role,
-- or function is altered. No protected apply — this file is authored and
-- reviewable, not run against Track A or Track B in this task.

-- ===========================================================================
-- SECTION 0 — new enums
-- ===========================================================================

create type pilot_cohort_status as enum ('PLANNED','RUNNING','CLOSED');
create type pilot_participation_status as enum ('INVITED','ONBOARDING','ACTIVE','PAUSED','COMPLETED','WITHDRAWN');
create type pilot_consent_scope as enum ('PRODUCT_USAGE_ANALYTICS');
create type pilot_consent_event_kind as enum ('CONSENT_GRANTED','CONSENT_WITHDRAWN');

-- ===========================================================================
-- SECTION 1 — Owner + AAL2 authority: a thin composition, nothing more
--
-- assert_o1_owner_aal2() introduces ZERO new identity/authority state. It
-- reads no table of its own, accepts no caller-supplied identity, and derives
-- nothing from profile metadata or location membership. It composes exactly
-- the two accepted primitives, in order, and fails closed on either.
-- ===========================================================================

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
  perform public.require_aal2(); -- raises 'AAL2_REQUIRED' (42501) on its own if not AAL2
end;
$$;

comment on function public.assert_o1_owner_aal2() is
  'O1-F gate. Composes public.is_platform_owner() (0033) and public.require_aal2() '
  '(0045) only — no alternate Owner table, no alternate AAL reader, no parallel '
  'authority model. First statement of every O1-F owner-facing function.';

revoke all on function public.assert_o1_owner_aal2() from public, anon, authenticated, service_role;

-- ===========================================================================
-- SECTION 2 — pilot cohort / participation / consent authority
-- ===========================================================================

create table pilot_cohorts (
  cohort_code text primary key check (cohort_code ~ '^[A-Z0-9_]{3,40}$'),
  display_name text not null check (char_length(display_name) between 1 and 120 and display_name !~ '[\n\r]'),
  status pilot_cohort_status not null default 'PLANNED',
  started_on date not null,
  planned_end_on date,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default clock_timestamp()
);

-- Doctor resolution happens ONLY through a stable participation. No function
-- anywhere in this file accepts a bare doctor_id as a drill-down key.
create table pilot_participations (
  participation_id uuid primary key default gen_random_uuid(),
  cohort_code text not null references public.pilot_cohorts(cohort_code),
  doctor_id uuid not null references public.doctor_profiles(id),
  status pilot_participation_status not null default 'INVITED',
  enrolled_on date not null default current_date,
  unique (cohort_code, doctor_id)
);

-- Versioned + scoped consent, event-sourced (append-only). effective_at /
-- recorded_at are CONSENT PROVENANCE timestamps — a different domain from
-- activity telemetry, which stays day-grain with no timestamptz anywhere.
create table pilot_consent_events (
  id bigserial primary key,
  participation_id uuid not null references public.pilot_participations(participation_id),
  consent_scope pilot_consent_scope not null,
  consent_version text not null check (consent_version ~ '^[A-Za-z0-9._-]{1,40}$'),
  event pilot_consent_event_kind not null,
  effective_at timestamptz not null,
  recorded_at timestamptz not null default clock_timestamp(),
  recorded_by uuid not null references public.profiles(id)
);
create index pilot_consent_events_lookup on public.pilot_consent_events (participation_id, consent_scope, effective_at desc);

create or replace function public.prevent_pilot_consent_event_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'PILOT_CONSENT_EVENT_APPEND_ONLY' using errcode = 'P0001';
end;
$$;
create trigger pilot_consent_events_append_only
before update or delete on public.pilot_consent_events
for each row execute function public.prevent_pilot_consent_event_mutation();

-- Authoritative, read-time liveness decision. NEVER materialised as a flag.
create or replace function public.pilot_consent_is_live(
  target_participation_id uuid,
  target_scope pilot_consent_scope,
  as_of timestamptz default clock_timestamp()
) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(
    (select e.event = 'CONSENT_GRANTED'
       from public.pilot_consent_events e
      where e.participation_id = target_participation_id
        and e.consent_scope = target_scope
        and e.effective_at <= as_of
      order by e.effective_at desc, e.id desc
      limit 1),
    false);
$$;
alter function public.pilot_consent_is_live(uuid, pilot_consent_scope, timestamptz) owner to dd_metrics_rollup;

-- Fold-time gate: true only if consent was live for the ENTIRE business day
-- (live at day start, no withdrawal recorded during the day). An uncovered
-- day produces no named aggregate row and is never backfilled on re-grant.
create or replace function public.pilot_consent_covers_day(
  target_participation_id uuid,
  target_scope pilot_consent_scope,
  target_day date
) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select public.pilot_consent_is_live(target_participation_id, target_scope, target_day::timestamptz)
     and not exists (
       select 1 from public.pilot_consent_events e
        where e.participation_id = target_participation_id
          and e.consent_scope = target_scope
          and e.event = 'CONSENT_WITHDRAWN'
          and e.effective_at >= target_day::timestamptz
          and e.effective_at <  (target_day + 1)::timestamptz
     );
$$;
alter function public.pilot_consent_covers_day(uuid, pilot_consent_scope, date) owner to dd_metrics_rollup;

-- ===========================================================================
-- SECTION 3 — pilot status log + registries (bounded codes, never free text)
-- ===========================================================================

create table pilot_event_registry (
  code text primary key check (code ~ '^[A-Z][A-Z0-9_]{1,39}$'),
  display_name text not null
);
insert into public.pilot_event_registry(code, display_name) values
  ('INVITED','Invited to pilot'), ('FIRST_ENGAGED','First engaged day'),
  ('PAUSED','Paused'), ('RESUMED','Resumed'), ('WITHDRAWN','Withdrawn'),
  ('COMPLETED','Completed'), ('COHORT_OPENED','Cohort opened'), ('COHORT_CLOSED','Cohort closed');

create table pilot_reason_registry (
  code text primary key check (code ~ '^[A-Z][A-Z0-9_]{1,39}$'),
  display_name text not null
);
insert into public.pilot_reason_registry(code, display_name) values
  ('SCHEDULE_CONFLICT','Doctor scheduling conflict'), ('TECHNICAL_ISSUE','Technical issue reported'),
  ('NO_LONGER_INTERESTED','No longer interested'), ('PILOT_CONCLUDED','Pilot concluded on schedule'),
  ('OTHER_REVIEWED','Other — Central-reviewed');

create table pilot_status_events (
  id bigserial primary key,
  cohort_code text not null references public.pilot_cohorts(cohort_code),
  doctor_id uuid references public.doctor_profiles(id),
  event_code text not null references public.pilot_event_registry(code),
  reason_code text references public.pilot_reason_registry(code),
  event_day date not null,
  recorded_by uuid not null references public.profiles(id),
  recorded_at timestamptz not null default clock_timestamp()
);

create or replace function public.prevent_pilot_status_event_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'PILOT_STATUS_EVENT_APPEND_ONLY' using errcode = 'P0001';
end;
$$;
create trigger pilot_status_events_append_only
before update or delete on public.pilot_status_events
for each row execute function public.prevent_pilot_status_event_mutation();

-- ===========================================================================
-- SECTION 4 — activity_contributions: non-clinical idempotency scheme
-- No FK to any clinical/generic contribution-fact mechanism (none exists here).
-- No per-session/per-event row. No timestamptz anywhere in this table.
-- ===========================================================================

create table feature_registry (
  code text primary key check (code ~ '^[a-z][a-z0-9_]{1,63}$' or code = '*'),
  display_name text not null,
  is_active boolean not null default true
);
insert into public.feature_registry(code, display_name) values ('*', 'Non-feature sentinel — reserved. Never a real feature.');

create table activity_contributions (
  metric_code text not null check (metric_code in
    ('DOCTOR_ACTIVE_DAY','DOCTOR_ENGAGED_MINUTES_DAILY','DOCTOR_SESSION_COUNT_DAILY','DOCTOR_FEATURE_TOUCH_DAILY')),
  doctor_id uuid not null references public.doctor_profiles(id),
  period_day date not null,
  feature_code text not null references public.feature_registry(code),
  value bigint not null check (value >= 0),
  source_stream text not null check (source_stream in ('O1A_INTERACTION_METER','AUTH_DAILY','APP_FEATURE')),
  source_version bigint not null,
  ingested_on date not null default current_date,
  primary key (metric_code, doctor_id, period_day, feature_code),
  -- feature_code applicability is EXACT: the sentinel '*' is mandatory for the
  -- three non-feature metrics (collapsing their key to one row per Doctor/day/
  -- metric, so a minute/session/day is never split or double-counted across
  -- features) and forbidden for the one metric where feature_code is the
  -- controlled dimension.
  check (
    (metric_code = 'DOCTOR_FEATURE_TOUCH_DAILY' and feature_code <> '*')
    or
    (metric_code in ('DOCTOR_ACTIVE_DAY','DOCTOR_ENGAGED_MINUTES_DAILY','DOCTOR_SESSION_COUNT_DAILY') and feature_code = '*')
  )
);
comment on table public.activity_contributions is
  'RAW TIER. No timestamptz. No per-session/per-event row. SET-not-increment on '
  'ingest. Idempotency is the primary key itself, guarded by a monotonic '
  'non-clinical source_version. No clinical FK of any kind.';

-- Engaged-activity ingestion authority required by A / day-grain telemetry
-- ingestion required by E's usage counters (the four metrics this file
-- defines only — E's own AI/Voice usage/cost surface is a separate, larger
-- piece of work this file does not attempt; its source tables do not exist).
--
-- O1-F does not create the interaction/minute producer. O1-A remains the
-- metric-definition authority for what counts as an engaged minute; this
-- function only accepts and idempotently stores whatever day-grain totals a
-- conformant, trusted server-side producer supplies.
create or replace function public.ingest_activity_contribution(
  target_metric_code text,
  target_doctor_id uuid,
  target_period_day date,
  target_feature_code text,
  target_value bigint,
  target_source_stream text,
  target_source_version bigint
) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.activity_contributions(metric_code, doctor_id, period_day, feature_code, value, source_stream, source_version)
  values (target_metric_code, target_doctor_id, target_period_day, target_feature_code, target_value, target_source_stream, target_source_version)
  on conflict (metric_code, doctor_id, period_day, feature_code) do update
    set value = excluded.value, source_version = excluded.source_version, ingested_on = current_date
    where excluded.source_version > public.activity_contributions.source_version;
end;
$$;
alter function public.ingest_activity_contribution(text, uuid, date, text, bigint, text, bigint) owner to dd_metrics_rollup;

-- Trusted server-only caller, matching this codebase's existing convention for
-- trusted writes (SUPABASE_SERVICE_ROLE_KEY, never exposed to a client bundle
-- — see prescription-assets / src/lib/supabase/service.ts). Not a bare table
-- grant: service_role gets EXECUTE on this function only; the INSERT itself
-- always runs as dd_metrics_rollup (the function's owner), which is the only
-- identity with any grant on activity_contributions.
revoke all on function public.ingest_activity_contribution(text, uuid, date, text, bigint, text, bigint) from public, anon, authenticated;
grant execute on function public.ingest_activity_contribution(text, uuid, date, text, bigint, text, bigint) to service_role;

-- ===========================================================================
-- SECTION 5 — named aggregate (RC-2) + de-identified aggregate (RC-3)
--
-- consultations_completed / prescriptions_finalized / appointments_booked are
-- DELIBERATELY ABSENT from this table in this candidate (see file header):
-- no privacy-safe contribution-fact source exists yet in this runtime for
-- them, and this file will not read encounters/prescriptions/appointments
-- directly to fabricate a substitute.
-- ===========================================================================

create table doctor_daily_activity_agg (
  period_day date not null,
  doctor_id uuid not null references public.doctor_profiles(id),
  engaged_minutes integer not null default 0,
  active_day boolean not null default false,
  session_count integer not null default 0,
  feature_touch_count integer not null default 0,
  source_high_water bigint not null default 0,
  computed_at timestamptz not null default clock_timestamp(),
  primary key (period_day, doctor_id)
);
comment on table public.doctor_daily_activity_agg is
  'AGGREGATE TIER, named. A row exists for (doctor_id, period_day) ONLY IF '
  'consent covered the whole business day (fold-time gate). No patient/'
  'encounter/prescription/document id. No free text. No timestamptz other '
  'than computed_at (staleness only).';

create table pilot_status_daily_agg (
  period_day date not null,
  cohort_code text not null references public.pilot_cohorts(cohort_code),
  invited_count bigint not null default 0,
  onboarding_count bigint not null default 0,
  active_count bigint not null default 0,
  paused_count bigint not null default 0,
  completed_count bigint not null default 0,
  withdrawn_count bigint not null default 0,
  consented_count bigint not null default 0,
  active_doctor_count bigint not null default 0,
  computed_at timestamptz not null default clock_timestamp(),
  primary key (period_day, cohort_code)
);
comment on table public.pilot_status_daily_agg is
  'AGGREGATE TIER, de-identified — no doctor_id column. active_doctor_count is '
  'RAW here; k=5 suppression is applied only at the owner_* read boundary, '
  'never stored pre-suppressed, never exposed directly (RLS forces zero direct read).';

-- ===========================================================================
-- SECTION 6 — fold jobs (dd_metrics_rollup only; no owner-facing function
-- calls these; invocation cadence is an operational decision, not authored
-- here — no pg_cron, no Edge Function trigger, nothing scheduled)
-- ===========================================================================

create or replace function public.rebuild_doctor_daily_activity_agg(target_period_day date)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare rec record;
begin
  for rec in
    select
      ac.doctor_id,
      max(pp.participation_id) filter (where pp.doctor_id = ac.doctor_id) as participation_id
    from public.activity_contributions ac
    left join public.pilot_participations pp on pp.doctor_id = ac.doctor_id
    where ac.period_day = target_period_day
    group by ac.doctor_id
  loop
    if rec.participation_id is null
       or not public.pilot_consent_covers_day(rec.participation_id, 'PRODUCT_USAGE_ANALYTICS', target_period_day)
    then
      delete from public.doctor_daily_activity_agg where period_day = target_period_day and doctor_id = rec.doctor_id;
      continue;
    end if;

    insert into public.doctor_daily_activity_agg (
      period_day, doctor_id, engaged_minutes, active_day, session_count, feature_touch_count, source_high_water, computed_at
    )
    select
      target_period_day,
      rec.doctor_id,
      coalesce((select value from public.activity_contributions where metric_code='DOCTOR_ENGAGED_MINUTES_DAILY' and doctor_id=rec.doctor_id and period_day=target_period_day and feature_code='*'), 0),
      coalesce((select value from public.activity_contributions where metric_code='DOCTOR_ACTIVE_DAY' and doctor_id=rec.doctor_id and period_day=target_period_day and feature_code='*'), 0) > 0,
      coalesce((select value from public.activity_contributions where metric_code='DOCTOR_SESSION_COUNT_DAILY' and doctor_id=rec.doctor_id and period_day=target_period_day and feature_code='*'), 0),
      coalesce((select count(*) from public.activity_contributions where metric_code='DOCTOR_FEATURE_TOUCH_DAILY' and doctor_id=rec.doctor_id and period_day=target_period_day and feature_code <> '*' and value > 0), 0),
      (select max(source_version) from public.activity_contributions where doctor_id=rec.doctor_id and period_day=target_period_day),
      clock_timestamp()
    on conflict (period_day, doctor_id) do update set
      engaged_minutes = excluded.engaged_minutes, active_day = excluded.active_day,
      session_count = excluded.session_count, feature_touch_count = excluded.feature_touch_count,
      source_high_water = excluded.source_high_water, computed_at = excluded.computed_at;
  end loop;
end;
$$;
alter function public.rebuild_doctor_daily_activity_agg(date) owner to dd_metrics_rollup;
comment on function public.rebuild_doctor_daily_activity_agg(date) is
  'Maintenance role only. Recomputes from activity_contributions alone — never '
  'reads a clinical table. Deterministic, re-runnable, never invoked by an '
  'owner-facing function.';

create or replace function public.rebuild_pilot_status_daily_agg(target_period_day date, target_cohort_code text)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.pilot_status_daily_agg (
    period_day, cohort_code, invited_count, onboarding_count, active_count, paused_count,
    completed_count, withdrawn_count, consented_count, active_doctor_count, computed_at
  )
  select
    target_period_day,
    target_cohort_code,
    count(*) filter (where p.status = 'INVITED'),
    count(*) filter (where p.status = 'ONBOARDING'),
    count(*) filter (where p.status = 'ACTIVE'),
    count(*) filter (where p.status = 'PAUSED'),
    count(*) filter (where p.status = 'COMPLETED'),
    count(*) filter (where p.status = 'WITHDRAWN'),
    count(*) filter (where public.pilot_consent_is_live(p.participation_id, 'PRODUCT_USAGE_ANALYTICS', target_period_day::timestamptz)),
    count(distinct p.doctor_id) filter (
      where public.pilot_consent_is_live(p.participation_id, 'PRODUCT_USAGE_ANALYTICS', target_period_day::timestamptz)
        and exists (select 1 from public.doctor_daily_activity_agg a where a.doctor_id = p.doctor_id and a.period_day = target_period_day and a.active_day)
    ),
    clock_timestamp()
  from public.pilot_participations p
  where p.cohort_code = target_cohort_code
  on conflict (period_day, cohort_code) do update set
    invited_count = excluded.invited_count, onboarding_count = excluded.onboarding_count,
    active_count = excluded.active_count, paused_count = excluded.paused_count,
    completed_count = excluded.completed_count, withdrawn_count = excluded.withdrawn_count,
    consented_count = excluded.consented_count, active_doctor_count = excluded.active_doctor_count,
    computed_at = excluded.computed_at;
end;
$$;
alter function public.rebuild_pilot_status_daily_agg(date, text) owner to dd_metrics_rollup;

-- ===========================================================================
-- SECTION 7 — k=5 small-cohort suppression primitive
-- ===========================================================================

create or replace function public.k_anon_suppress(raw_value bigint, distinct_doctors bigint, k integer default 5)
returns text
language sql immutable as $$
  select case when distinct_doctors < k then 'INSUFFICIENT_COHORT' else raw_value::text end;
$$;
comment on function public.k_anon_suppress(bigint, bigint, integer) is
  'Server-side only. Returns a distinct sentinel string, never 0, never '
  'NULL-as-unknown, when fewer than k distinct Doctors contribute. No owner_* '
  'return type in this file carries an "other"/"remainder" column, so a '
  'suppressed cell cannot be solved by subtraction from a visible total.';

-- ===========================================================================
-- SECTION 8 — the Owner RPC boundary
-- EXECUTE is granted to `authenticated`, matching this codebase's existing
-- owner-gated pattern (is_platform_owner() itself is EXECUTE-to-authenticated,
-- §0033) — the actual authority check runs FIRST, inside the function, via
-- assert_o1_owner_aal2(). Every function's OWNER is reassigned to a narrow,
-- NOLOGIN, table-scoped role so that even a defect in the function body
-- cannot reach a table that role has no grant on (defense in depth beyond the
-- in-body check).
-- ===========================================================================

create or replace function public.owner_pilot_status(window_start date, window_end date)
returns table (
  cohort_code text, invited_count text, onboarding_count text, active_count text, paused_count text,
  completed_count text, withdrawn_count text, consented_count text, active_doctor_count text
) language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.assert_o1_owner_aal2();
  return query
  select
    a.cohort_code,
    (array_agg(a.invited_count order by a.period_day desc))[1]::text,
    (array_agg(a.onboarding_count order by a.period_day desc))[1]::text,
    (array_agg(a.active_count order by a.period_day desc))[1]::text,
    (array_agg(a.paused_count order by a.period_day desc))[1]::text,
    (array_agg(a.completed_count order by a.period_day desc))[1]::text,
    (array_agg(a.withdrawn_count order by a.period_day desc))[1]::text,
    (array_agg(a.consented_count order by a.period_day desc))[1]::text,
    public.k_anon_suppress(
      count(distinct d.doctor_id) filter (where d.active_day),
      count(distinct d.doctor_id) filter (where d.active_day)
    )
  from public.pilot_status_daily_agg a
  left join public.pilot_participations p on p.cohort_code = a.cohort_code
  left join public.doctor_daily_activity_agg d on d.doctor_id = p.doctor_id and d.period_day between window_start and window_end
  where a.period_day between window_start and window_end
  group by a.cohort_code;
end;
$$;
alter function public.owner_pilot_status(date, date) owner to dd_metrics_reader;

create or replace function public.owner_pilot_cohort_detail(target_cohort_code text, window_start date, window_end date)
returns table (
  participation_id uuid, status pilot_participation_status, enrolled_on date,
  engaged_minutes bigint, active_days bigint, session_count bigint, feature_touch_count bigint
) language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.assert_o1_owner_aal2();
  return query
  select
    p.participation_id, p.status, p.enrolled_on,
    coalesce(sum(a.engaged_minutes), 0), coalesce(sum(a.active_day::int), 0),
    coalesce(sum(a.session_count), 0), coalesce(sum(a.feature_touch_count), 0)
  from public.pilot_participations p
  left join public.doctor_daily_activity_agg a
    on a.doctor_id = p.doctor_id and a.period_day between window_start and window_end
  where p.cohort_code = target_cohort_code
    and public.pilot_consent_is_live(p.participation_id, 'PRODUCT_USAGE_ANALYTICS', clock_timestamp())
  group by p.participation_id, p.status, p.enrolled_on;
end;
$$;
alter function public.owner_pilot_cohort_detail(text, date, date) owner to dd_metrics_reader;

-- The only per-Doctor function. Requires (cohort_code, participation_id) —
-- never a bare doctor_id. On ANY precondition failure it returns the single
-- generic 'ANALYTICS_UNAVAILABLE' row and performs the same lookups
-- regardless of which precondition failed; the caller cannot distinguish
-- "no such participation" from "wrong cohort" from "consent withdrawn". The
-- true cause is written to audit_events only, as the action code.
create or replace function public.owner_doctor_activity(target_cohort_code text, target_participation_id uuid, window_start date, window_end date)
returns table (
  status text, engaged_minutes bigint, active_days bigint, session_count bigint, feature_touch_count bigint
) language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_doctor_id uuid;
  v_status pilot_participation_status;
  v_authorized boolean := false;
  v_reason text;
begin
  perform public.assert_o1_owner_aal2();

  select p.doctor_id, p.status into v_doctor_id, v_status
    from public.pilot_participations p
    where p.participation_id = target_participation_id and p.cohort_code = target_cohort_code;

  if v_doctor_id is null then
    v_reason := 'OWNER_DOCTOR_ACTIVITY_LOOKUP_NOT_MEMBER';
  elsif v_status = 'WITHDRAWN' then
    v_reason := 'OWNER_DOCTOR_ACTIVITY_LOOKUP_PARTICIPATION_WITHDRAWN';
  elsif not public.pilot_consent_is_live(target_participation_id, 'PRODUCT_USAGE_ANALYTICS', clock_timestamp()) then
    v_reason := 'OWNER_DOCTOR_ACTIVITY_LOOKUP_CONSENT_WITHDRAWN';
  else
    v_authorized := true;
    v_reason := 'OWNER_DOCTOR_ACTIVITY_LOOKUP_OK';
  end if;

  -- this codebase's audit_events has no actor_kind column (checked against
  -- drizzle/migrations/0000_parallel_mentor.sql) — actor_id + action + resource_type/id only.
  insert into public.audit_events(actor_id, action, resource_type, resource_id)
  values (auth.uid(), v_reason, 'pilot_participation', target_participation_id);

  if not v_authorized then
    return query select 'ANALYTICS_UNAVAILABLE'::text, null::bigint, null::bigint, null::bigint, null::bigint;
    return;
  end if;

  return query
  select
    'OK'::text,
    coalesce(sum(a.engaged_minutes), 0), coalesce(sum(a.active_day::int), 0),
    coalesce(sum(a.session_count), 0), coalesce(sum(a.feature_touch_count), 0)
  from public.doctor_daily_activity_agg a
  where a.doctor_id = v_doctor_id and a.period_day between window_start and window_end;
end;
$$;
alter function public.owner_doctor_activity(text, uuid, date, date) owner to dd_metrics_reader;

create or replace function public.owner_activity_summary(window_start date, window_end date)
returns table (active_doctor_count text, total_sessions text, total_engaged_minutes text)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_distinct bigint;
begin
  perform public.assert_o1_owner_aal2();
  select count(distinct a.doctor_id) into v_distinct
    from public.doctor_daily_activity_agg a where a.period_day between window_start and window_end and a.active_day;

  return query
  select
    public.k_anon_suppress((select count(distinct doctor_id) from public.doctor_daily_activity_agg where period_day between window_start and window_end and active_day), v_distinct),
    public.k_anon_suppress((select coalesce(sum(session_count),0) from public.doctor_daily_activity_agg where period_day between window_start and window_end), v_distinct),
    public.k_anon_suppress((select coalesce(sum(engaged_minutes),0) from public.doctor_daily_activity_agg where period_day between window_start and window_end), v_distinct);
end;
$$;
alter function public.owner_activity_summary(date, date) owner to dd_metrics_reader;

-- Consent-management state is control-plane, never analytics. Not an owner_*
-- analytics function; separate authority surface, same gate.
create or replace function public.pilot_participation_state(target_cohort_code text)
returns table (participation_id uuid, doctor_id uuid, status pilot_participation_status, enrolled_on date, consent_live boolean)
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.assert_o1_owner_aal2();
  return query
  select p.participation_id, p.doctor_id, p.status, p.enrolled_on,
         public.pilot_consent_is_live(p.participation_id, 'PRODUCT_USAGE_ANALYTICS', clock_timestamp())
  from public.pilot_participations p where p.cohort_code = target_cohort_code;
end;
$$;
alter function public.pilot_participation_state(text) owner to dd_pilot_writer;

-- ===========================================================================
-- SECTION 9 — pilot control-plane writers (dd_pilot_writer)
-- ===========================================================================

create or replace function public.admin_pilot_cohort_upsert(target_cohort_code text, target_display_name text, target_started_on date, target_planned_end_on date default null)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.assert_o1_owner_aal2();
  insert into public.pilot_cohorts(cohort_code, display_name, started_on, planned_end_on, created_by)
  values (target_cohort_code, target_display_name, target_started_on, target_planned_end_on, auth.uid())
  on conflict (cohort_code) do update set display_name = excluded.display_name, planned_end_on = excluded.planned_end_on;
end;
$$;
alter function public.admin_pilot_cohort_upsert(text, text, date, date) owner to dd_pilot_writer;

create or replace function public.admin_pilot_participation_set(target_cohort_code text, target_doctor_id uuid, target_status pilot_participation_status)
returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare result uuid;
begin
  perform public.assert_o1_owner_aal2();
  insert into public.pilot_participations(cohort_code, doctor_id, status)
  values (target_cohort_code, target_doctor_id, target_status)
  on conflict (cohort_code, doctor_id) do update set status = excluded.status
  returning participation_id into result;

  insert into public.pilot_status_events(cohort_code, doctor_id, event_code, event_day, recorded_by)
  values (target_cohort_code, target_doctor_id,
    case target_status
      when 'INVITED' then 'INVITED' when 'PAUSED' then 'PAUSED' when 'ACTIVE' then 'RESUMED'
      when 'COMPLETED' then 'COMPLETED' when 'WITHDRAWN' then 'WITHDRAWN' else 'INVITED' end,
    current_date, auth.uid());

  return result;
end;
$$;
alter function public.admin_pilot_participation_set(text, uuid, pilot_participation_status) owner to dd_pilot_writer;

create or replace function public.admin_pilot_event_add(target_cohort_code text, target_doctor_id uuid, target_event_code text, target_reason_code text, target_event_day date)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.assert_o1_owner_aal2();
  insert into public.pilot_status_events(cohort_code, doctor_id, event_code, reason_code, event_day, recorded_by)
  values (target_cohort_code, target_doctor_id, target_event_code, target_reason_code, target_event_day, auth.uid());
end;
$$;
alter function public.admin_pilot_event_add(text, uuid, text, text, date) owner to dd_pilot_writer;

-- The only write path for consent. Withdrawal is effective immediately at
-- read time everywhere because every named read calls pilot_consent_is_live() fresh.
create or replace function public.admin_pilot_consent_set(
  target_participation_id uuid, target_scope pilot_consent_scope, target_version text,
  target_event pilot_consent_event_kind, target_effective_at timestamptz default clock_timestamp()
) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.assert_o1_owner_aal2();
  insert into public.pilot_consent_events(participation_id, consent_scope, consent_version, event, effective_at, recorded_by)
  values (target_participation_id, target_scope, target_version, target_event, target_effective_at, auth.uid());
end;
$$;
alter function public.admin_pilot_consent_set(uuid, pilot_consent_scope, text, pilot_consent_event_kind, timestamptz) owner to dd_pilot_writer;

-- ===========================================================================
-- SECTION 10 — roles
-- Four new roles. NOLOGIN, internal, not assumable by anon/authenticated/
-- service_role, zero grant on any clinical table. No "dd_owner_analytics" /
-- "dd_owner_authority" / "dd_activity_producer" role is introduced — the
-- Owner-facing surface is reached the same way every other owner-gated
-- action in this codebase is reached (EXECUTE to authenticated + an in-body
-- check), and the trusted-server ingestion path uses this codebase's own
-- existing service_role convention instead of a bespoke role.
-- ===========================================================================

create role dd_metrics_reader noinherit;
create role dd_metrics_rollup noinherit;
create role dd_pilot_writer noinherit;
create role dd_retention noinherit; -- created, granted nothing beyond the blanket revoke below. No job attached.

-- ===========================================================================
-- SECTION 11 — RLS. Forced on every new table. Baseline denies everyone;
-- each service role gets its own narrow, explicitly scoped policy —
-- PostgreSQL PERMISSIVE policies are OR'd, so the blanket deny does not block
-- a role that also matches its own scoped policy, and a role with no scoped
-- policy sees nothing. No interactive role (anon, authenticated, service_role)
-- ever receives a scoped policy on any O1-F table.
-- ===========================================================================

do $$ declare item text; begin
  foreach item in array array[
    'pilot_cohorts','pilot_participations','pilot_consent_events','pilot_event_registry',
    'pilot_reason_registry','pilot_status_events','feature_registry','activity_contributions',
    'doctor_daily_activity_agg','pilot_status_daily_agg'
  ] loop
    execute format('alter table public.%I enable row level security', item);
    execute format('alter table public.%I force row level security', item);
    execute format('create policy %I_deny_default on public.%I for all using (false) with check (false)', item, item);
  end loop;
end $$;

create policy pilot_cohorts_reader_read on public.pilot_cohorts for select to dd_metrics_reader using (true);
create policy pilot_cohorts_writer_all on public.pilot_cohorts for all to dd_pilot_writer using (true) with check (true);

create policy pilot_participations_reader_read on public.pilot_participations for select to dd_metrics_reader using (true);
create policy pilot_participations_writer_all on public.pilot_participations for all to dd_pilot_writer using (true) with check (true);
create policy pilot_participations_rollup_read on public.pilot_participations for select to dd_metrics_rollup using (true);

create policy pilot_consent_events_rollup_read on public.pilot_consent_events for select to dd_metrics_rollup using (true);
create policy pilot_consent_events_writer_insert on public.pilot_consent_events for insert to dd_pilot_writer with check (true);
create policy pilot_consent_events_writer_read on public.pilot_consent_events for select to dd_pilot_writer using (true);

create policy pilot_status_events_rollup_read on public.pilot_status_events for select to dd_metrics_rollup using (true);
create policy pilot_status_events_writer_insert on public.pilot_status_events for insert to dd_pilot_writer with check (true);

create policy activity_contributions_rollup_all on public.activity_contributions for all to dd_metrics_rollup using (true) with check (true);

create policy doctor_daily_activity_agg_reader_read on public.doctor_daily_activity_agg for select to dd_metrics_reader using (true);
create policy doctor_daily_activity_agg_rollup_all on public.doctor_daily_activity_agg for all to dd_metrics_rollup using (true) with check (true);

create policy pilot_status_daily_agg_reader_read on public.pilot_status_daily_agg for select to dd_metrics_reader using (true);
create policy pilot_status_daily_agg_rollup_all on public.pilot_status_daily_agg for all to dd_metrics_rollup using (true) with check (true);

-- FLAG FOR CENTRAL: the existing public.audit_events (0001_rls.sql) is RLS-forced with an
-- INSERT policy scoped to authenticated practice-location members (audit_events_insert_member) —
-- dd_metrics_reader satisfies neither that role nor that membership check. owner_doctor_activity
-- needs to record its true unauthorized-lookup cause somewhere internal-only (never returned to
-- the caller — see Section 8), so this adds ONE narrow, INSERT-ONLY policy for dd_metrics_reader.
-- It cannot SELECT any audit_events row (no read policy is added), cannot UPDATE/DELETE (no such
-- policy is added, and 0020_revoke_truncate.sql's TRUNCATE revoke is untouched), and the existing
-- audit_events_insert_member / audit_events_select policies for `authenticated` are unmodified.
create policy audit_events_o1f_reader_insert on public.audit_events for insert to dd_metrics_reader with check (true);

-- ===========================================================================
-- SECTION 12 — grants
-- ===========================================================================

revoke all on all tables in schema public from dd_metrics_reader, dd_metrics_rollup, dd_pilot_writer, dd_retention;
revoke all on all functions in schema public from dd_metrics_reader, dd_metrics_rollup, dd_pilot_writer, dd_retention;

grant select on public.pilot_cohorts, public.pilot_participations, public.doctor_daily_activity_agg, public.pilot_status_daily_agg to dd_metrics_reader;
-- INSERT-ONLY, paired with the scoped RLS policy above (Section 11) — no SELECT/UPDATE/DELETE.
grant insert on public.audit_events to dd_metrics_reader;
grant select, insert, update on public.doctor_daily_activity_agg, public.pilot_status_daily_agg to dd_metrics_rollup;
grant select on public.activity_contributions, public.pilot_status_events, public.pilot_consent_events, public.pilot_participations to dd_metrics_rollup;
grant insert, update on public.activity_contributions to dd_metrics_rollup;

grant select, insert, update on public.pilot_cohorts, public.pilot_participations to dd_pilot_writer;
grant insert on public.pilot_status_events, public.pilot_consent_events to dd_pilot_writer;
grant select on public.pilot_participations, public.pilot_consent_events to dd_pilot_writer;
grant usage on sequence public.pilot_consent_events_id_seq, public.pilot_status_events_id_seq to dd_pilot_writer;

-- The two accepted primitives, granted ONLY to the two roles that call them
-- (assert_o1_owner_aal2 is owned by the deploy role, but calls these as
-- itself — dd_metrics_reader / dd_pilot_writer are the roles that own the
-- owner_*/admin_pilot_* functions that call assert_o1_owner_aal2 in turn, and
-- Postgres re-checks EXECUTE at each call regardless of nesting).
grant execute on function public.is_platform_owner() to dd_metrics_reader, dd_pilot_writer;
grant execute on function public.require_aal2() to dd_metrics_reader, dd_pilot_writer;
grant execute on function public.assert_o1_owner_aal2() to dd_metrics_reader, dd_pilot_writer;

grant execute on function public.pilot_consent_is_live(uuid, pilot_consent_scope, timestamptz) to dd_metrics_reader, dd_pilot_writer, dd_metrics_rollup;
grant execute on function public.pilot_consent_covers_day(uuid, pilot_consent_scope, date) to dd_metrics_rollup;
grant execute on function public.k_anon_suppress(bigint, bigint, integer) to dd_metrics_reader;

grant execute on function
  public.owner_pilot_status(date, date),
  public.owner_pilot_cohort_detail(text, date, date),
  public.owner_doctor_activity(text, uuid, date, date),
  public.owner_activity_summary(date, date),
  public.pilot_participation_state(text),
  public.admin_pilot_cohort_upsert(text, text, date, date),
  public.admin_pilot_participation_set(text, uuid, pilot_participation_status),
  public.admin_pilot_event_add(text, uuid, text, text, date),
  public.admin_pilot_consent_set(uuid, pilot_consent_scope, text, pilot_consent_event_kind, timestamptz)
to authenticated;

-- Supabase grants `authenticated` every verb on a new table by default;
-- omitting a REVOKE leaves it there. Explicit, table by table.
revoke all on public.pilot_cohorts, public.pilot_participations, public.pilot_consent_events,
  public.pilot_event_registry, public.pilot_reason_registry, public.pilot_status_events,
  public.feature_registry, public.activity_contributions, public.doctor_daily_activity_agg,
  public.pilot_status_daily_agg
from anon, authenticated;

revoke all on sequence public.pilot_consent_events_id_seq, public.pilot_status_events_id_seq from anon, authenticated;

-- End of 0047. Confirmations:
--   * no accepted runtime object (0000–0046, or their Drizzle-owned shapes)
--     was altered — every grant above targets a NEW role or a NEW object;
--   * no clinical table (patients, encounters, prescriptions, appointments,
--     queue_entries, or any patient_*/encounter_*/prescription_* table) is
--     read, written, or referenced by any object in this file;
--   * no free text, no clinical identifier, no prompt/completion/transcript/
--     audio/provider-payload field exists on any table this file creates;
--   * db/manifest.toml and the separate Database V2 P0 Track-A program are
--     untouched;
--   * this file is authored for review only — it has not been applied to any
--     database in this task.
