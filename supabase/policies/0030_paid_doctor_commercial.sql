-- Paid Doctor Commercial Foundation
-- Area K: public doctor profile + booking
-- Area O: subscription/payment lifecycle
--
-- SECURITY PRINCIPLES:
-- 1. Public callers never SELECT clinical tables directly.
-- 2. Knowing a profile slug is not authorization. PUBLIC visibility is checked
--    inside every public SECURITY DEFINER function.
-- 3. Public patient matching happens inside a trusted function and never reveals
--    whether a matching patient already existed.
-- 4. Booking writes into the existing appointments aggregate.
-- 5. Subscription state never deletes, rewrites or invalidates clinical history.
-- 6. All SECURITY DEFINER functions pin search_path.
--
-- ORDERING — RUN `db:migrate` BEFORE `db:policies`.
-- These tables and the two appointments columns are owned by the Drizzle
-- migration 0018_omniscient_post, which is the authority for their shape. The
-- `create table if not exists` / `add column if not exists` statements below are
-- idempotent no-ops once that migration has run, and exist so this file can be
-- read as a complete description of the boundary. Applying this file to a
-- database that has NOT been migrated would create the tables without the
-- migration's unique indexes, and the migration would then fail on CREATE TABLE.

-- ---------------------------------------------------------------------------
-- Booking configuration
-- ---------------------------------------------------------------------------

create table if not exists public.doctor_booking_settings (
  id uuid primary key default gen_random_uuid(),
  doctor_profile_id uuid not null references public.doctor_profiles(id) on delete cascade,
  doctor_chamber_id uuid not null references public.doctor_chambers(id) on delete cascade,
  booking_enabled boolean not null default false,
  booking_mode text not null default 'TOKEN'
    check (booking_mode in ('TOKEN', 'TIME_SLOT')),
  slot_minutes integer not null default 15
    check (slot_minutes between 5 and 180),
  max_patients integer not null default 30
    check (max_patients between 1 and 500),
  booking_window_days integer not null default 30
    check (booking_window_days between 1 and 180),
  min_lead_minutes integer not null default 60
    check (min_lead_minutes between 0 and 10080),
  consultation_fee numeric(12,2),
  currency text not null default 'BDT'
    check (currency ~ '^[A-Z]{3}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (doctor_chamber_id),
  check (consultation_fee is null or consultation_fee >= 0)
);

create index if not exists doctor_booking_settings_doctor_idx
  on public.doctor_booking_settings(doctor_profile_id);

create table if not exists public.doctor_booking_closed_dates (
  id uuid primary key default gen_random_uuid(),
  doctor_chamber_id uuid not null references public.doctor_chambers(id) on delete cascade,
  closed_on date not null,
  reason text,
  created_at timestamptz not null default now(),
  unique (doctor_chamber_id, closed_on),
  check (reason is null or length(reason) <= 120)
);

alter table public.doctor_booking_settings enable row level security;
alter table public.doctor_booking_closed_dates enable row level security;

revoke all on public.doctor_booking_settings from anon, authenticated;
revoke all on public.doctor_booking_closed_dates from anon, authenticated;

drop policy if exists "doctor owns booking settings read" on public.doctor_booking_settings;
create policy "doctor owns booking settings read"
on public.doctor_booking_settings for select
to authenticated
using (doctor_profile_id = public.current_doctor_id());

drop policy if exists "doctor owns closed dates read" on public.doctor_booking_closed_dates;
create policy "doctor owns closed dates read"
on public.doctor_booking_closed_dates for select
to authenticated
using (
  exists (
    select 1
    from public.doctor_chambers dc
    where dc.id = doctor_booking_closed_dates.doctor_chamber_id
      and dc.doctor_profile_id = public.current_doctor_id()
  )
);

-- Appointments gain a non-clinical provenance marker and a patient-safe booking ref.
alter table public.appointments
  add column if not exists booking_source text not null default 'INTERNAL';

alter table public.appointments
  drop constraint if exists appointments_booking_source_check;

alter table public.appointments
  add constraint appointments_booking_source_check
  check (booking_source in ('INTERNAL', 'DOCTOR', 'RECEPTIONIST', 'ASSISTANT', 'WALK_IN', 'PUBLIC'));

alter table public.appointments
  add column if not exists public_booking_ref uuid;

create unique index if not exists appointments_public_booking_ref_key
  on public.appointments(public_booking_ref)
  where public_booking_ref is not null;

-- ---------------------------------------------------------------------------
-- Closed public profile reader
-- ---------------------------------------------------------------------------

create or replace function public.public_doctor_profile(p_slug text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_doctor public.doctor_profiles%rowtype;
  v_full_name text;
  v_chambers jsonb;
begin
  if p_slug is null or btrim(p_slug) = '' then
    return null;
  end if;

  select d.*, p.full_name
    into v_doctor, v_full_name
  from public.doctor_profiles d
  join public.profiles p on p.id = d.user_id
  where d.profile_slug = lower(btrim(p_slug))
    and d.profile_visibility = 'PUBLIC'
  limit 1;

  if not found then
    return null;
  end if;

  select coalesce(jsonb_agg(ch order by (ch->>'position')::int), '[]'::jsonb)
  into v_chambers
  from (
    select jsonb_build_object(
      'chamberId', dc.id,
      'locationId', pl.id,
      'name', pl.name,
      'address', pl.address,
      'district', pl.district,
      'publicNote', dc.public_note,
      'position', dc.position,
      'bookingEnabled', coalesce(bs.booking_enabled, false),
      'bookingMode', bs.booking_mode,
      'consultationFee', bs.consultation_fee,
      'currency', coalesce(bs.currency, 'BDT'),
      'sessions', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'weekday', h.weekday,
            'startsAt', h.starts_at,
            'endsAt', h.ends_at
          )
          order by h.weekday, h.starts_at
        )
        from public.doctor_chamber_hours h
        where h.chamber_id = dc.id
      ), '[]'::jsonb)
    ) as ch
    from public.doctor_chambers dc
    join public.practice_locations pl on pl.id = dc.practice_location_id
    left join public.doctor_booking_settings bs on bs.doctor_chamber_id = dc.id
    where dc.doctor_profile_id = v_doctor.id
      and pl.is_active = true
  ) q;

  return jsonb_build_object(
    'fullName', coalesce(nullif(btrim(v_full_name), ''), 'Doctor'),
    'qualification', v_doctor.qualification,
    'designation', v_doctor.designation,
    'specialization', v_doctor.specialization,
    'bmdc',
      case when v_doctor.show_bmdc_on_profile
        then v_doctor.bmdc_registration_no
        else null
      end,
    'slug', v_doctor.profile_slug,
    'chambers', v_chambers
  );
end;
$$;

revoke all on function public.public_doctor_profile(text) from public;
grant execute on function public.public_doctor_profile(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Public availability
-- ---------------------------------------------------------------------------

create or replace function public.public_booking_slots(
  p_slug text,
  p_location_id uuid,
  p_date date
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_doctor_id uuid;
  v_chamber_id uuid;
  v_timezone text;
  v_mode text;
  v_slot_minutes integer;
  v_max integer;
  v_window integer;
  v_lead integer;
  v_now_local timestamp;
  v_day_count integer;
  v_result jsonb := '[]'::jsonb;
begin
  select d.id, dc.id, pl.timezone,
         bs.booking_mode, bs.slot_minutes, bs.max_patients,
         bs.booking_window_days, bs.min_lead_minutes
    into v_doctor_id, v_chamber_id, v_timezone,
         v_mode, v_slot_minutes, v_max, v_window, v_lead
  from public.doctor_profiles d
  join public.doctor_chambers dc on dc.doctor_profile_id = d.id
  join public.practice_locations pl on pl.id = dc.practice_location_id
  join public.doctor_booking_settings bs on bs.doctor_chamber_id = dc.id
  where d.profile_slug = lower(btrim(p_slug))
    and d.profile_visibility = 'PUBLIC'
    and dc.practice_location_id = p_location_id
    and bs.booking_enabled = true
    and pl.is_active = true
  limit 1;

  if v_doctor_id is null then
    return '[]'::jsonb;
  end if;

  v_now_local := now() at time zone v_timezone;
  v_day_count := p_date - v_now_local::date;

  if v_day_count < 0 or v_day_count > v_window then
    return '[]'::jsonb;
  end if;

  if exists (
    select 1 from public.doctor_booking_closed_dates c
    where c.doctor_chamber_id = v_chamber_id
      and c.closed_on = p_date
  ) then
    return '[]'::jsonb;
  end if;

  if v_mode = 'TIME_SLOT' then
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'localTime', to_char(s.local_slot, 'HH24:MI'),
        'label', to_char(s.local_slot, 'HH12:MI AM')
      )
      order by s.local_slot
    ), '[]'::jsonb)
    into v_result
    from (
      select gs as local_slot
      from public.doctor_chamber_hours h
      cross join lateral generate_series(
        p_date + h.starts_at::time,
        p_date + h.ends_at::time - make_interval(mins => v_slot_minutes),
        make_interval(mins => v_slot_minutes)
      ) gs
      where h.chamber_id = v_chamber_id
        and h.weekday = extract(dow from p_date)::int
    ) s
    where s.local_slot >= v_now_local + make_interval(mins => v_lead)
      and not exists (
        select 1
        from public.appointments a
        where a.owner_doctor_id = v_doctor_id
          and a.practice_location_id = p_location_id
          and a.status not in ('CANCELLED', 'NO_SHOW')
          and a.scheduled_for = (s.local_slot at time zone v_timezone)
      );
  else
    -- Token mode: expose each advertised session once while total daily capacity remains.
    if (
      select count(*)
      from public.appointments a
      where a.owner_doctor_id = v_doctor_id
        and a.practice_location_id = p_location_id
        and a.session_date = p_date
        and a.status not in ('CANCELLED', 'NO_SHOW')
    ) >= v_max then
      return '[]'::jsonb;
    end if;

    select coalesce(jsonb_agg(
      jsonb_build_object(
        'localTime', h.starts_at,
        'label', to_char((p_date + h.starts_at::time), 'HH12:MI AM') || ' session'
      )
      order by h.starts_at
    ), '[]'::jsonb)
    into v_result
    from public.doctor_chamber_hours h
    where h.chamber_id = v_chamber_id
      and h.weekday = extract(dow from p_date)::int
      and (p_date + h.starts_at::time) >= v_now_local + make_interval(mins => v_lead);
  end if;

  return v_result;
end;
$$;

revoke all on function public.public_booking_slots(text, uuid, date) from public;
grant execute on function public.public_booking_slots(text, uuid, date) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Public booking write
-- ---------------------------------------------------------------------------

create or replace function public.create_public_booking(
  p_slug text,
  p_location_id uuid,
  p_date date,
  p_local_time text,
  p_patient_name text,
  p_phone text,
  p_sex text default 'UNKNOWN',
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_doctor_id uuid;
  v_chamber_id uuid;
  v_timezone text;
  v_mode text;
  v_slot_minutes integer;
  v_max integer;
  v_window integer;
  v_lead integer;
  v_phone_norm text;
  v_name text;
  v_name_norm text;
  v_local timestamp;
  v_instant timestamptz;
  v_patient_id uuid;
  v_patient_number text;
  v_prefix text;
  v_seq integer;
  v_booking_ref uuid := gen_random_uuid();
  v_appointment_id uuid := gen_random_uuid();
  v_count integer;
begin
  v_name := btrim(coalesce(p_patient_name, ''));
  v_phone_norm := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  v_name_norm := lower(btrim(regexp_replace(v_name, '\s+', ' ', 'g')));

  if length(v_name) < 2 or length(v_name) > 120 then
    raise exception 'INVALID_PATIENT_NAME';
  end if;
  if length(v_phone_norm) < 8 or length(v_phone_norm) > 15 then
    raise exception 'INVALID_PHONE';
  end if;
  if p_sex not in ('MALE', 'FEMALE', 'OTHER', 'UNKNOWN') then
    raise exception 'INVALID_SEX';
  end if;
  if p_reason is not null and length(p_reason) > 300 then
    raise exception 'REASON_TOO_LONG';
  end if;

  select d.id, dc.id, pl.timezone,
         bs.booking_mode, bs.slot_minutes, bs.max_patients,
         bs.booking_window_days, bs.min_lead_minutes
    into v_doctor_id, v_chamber_id, v_timezone,
         v_mode, v_slot_minutes, v_max, v_window, v_lead
  from public.doctor_profiles d
  join public.doctor_chambers dc on dc.doctor_profile_id = d.id
  join public.practice_locations pl on pl.id = dc.practice_location_id
  join public.doctor_booking_settings bs on bs.doctor_chamber_id = dc.id
  where d.profile_slug = lower(btrim(p_slug))
    and d.profile_visibility = 'PUBLIC'
    and dc.practice_location_id = p_location_id
    and bs.booking_enabled = true
    and pl.is_active = true
  for update of bs
  limit 1;

  if v_doctor_id is null then
    raise exception 'BOOKING_NOT_AVAILABLE';
  end if;

  if p_date < (now() at time zone v_timezone)::date
     or p_date > (now() at time zone v_timezone)::date + v_window then
    raise exception 'DATE_NOT_AVAILABLE';
  end if;

  if exists (
    select 1 from public.doctor_booking_closed_dates c
    where c.doctor_chamber_id = v_chamber_id and c.closed_on = p_date
  ) then
    raise exception 'DATE_NOT_AVAILABLE';
  end if;

  begin
    v_local := p_date + p_local_time::time;
  exception when others then
    raise exception 'INVALID_TIME';
  end;

  if v_local < (now() at time zone v_timezone) + make_interval(mins => v_lead) then
    raise exception 'TOO_SOON';
  end if;

  if not exists (
    select 1
    from public.doctor_chamber_hours h
    where h.chamber_id = v_chamber_id
      and h.weekday = extract(dow from p_date)::int
      and (
        (v_mode = 'TIME_SLOT'
          and p_local_time::time >= h.starts_at::time
          and p_local_time::time + make_interval(mins => v_slot_minutes) <= h.ends_at::time)
        or
        (v_mode = 'TOKEN' and p_local_time::time = h.starts_at::time)
      )
  ) then
    raise exception 'TIME_NOT_AVAILABLE';
  end if;

  v_instant := v_local at time zone v_timezone;

  -- One advisory lock per doctor/location/day/time closes public booking races.
  perform pg_advisory_xact_lock(
    hashtextextended(
      v_doctor_id::text || ':' || p_location_id::text || ':' ||
      p_date::text || ':' || p_local_time,
      0
    )
  );

  if v_mode = 'TIME_SLOT' then
    select count(*) into v_count
    from public.appointments a
    where a.owner_doctor_id = v_doctor_id
      and a.practice_location_id = p_location_id
      and a.scheduled_for = v_instant
      and a.status not in ('CANCELLED', 'NO_SHOW');

    if v_count > 0 then
      raise exception 'SLOT_TAKEN';
    end if;
  else
    select count(*) into v_count
    from public.appointments a
    where a.owner_doctor_id = v_doctor_id
      and a.practice_location_id = p_location_id
      and a.session_date = p_date
      and a.status not in ('CANCELLED', 'NO_SHOW');

    if v_count >= v_max then
      raise exception 'SESSION_FULL';
    end if;
  end if;

  -- Duplicate guard: do not create two active bookings for the same phone/doctor/date.
  if exists (
    select 1
    from public.appointments a
    join public.patients p on p.id = a.patient_id
    where a.owner_doctor_id = v_doctor_id
      and a.practice_location_id = p_location_id
      and a.session_date = p_date
      and a.status not in ('CANCELLED', 'NO_SHOW')
      and p.phone_normalized = v_phone_norm
      and p.deleted_at is null
  ) then
    raise exception 'DUPLICATE_BOOKING';
  end if;

  select p.id into v_patient_id
  from public.patients p
  where p.owner_doctor_id = v_doctor_id
    and p.phone_normalized = v_phone_norm
    and p.deleted_at is null
  order by p.created_at
  limit 1;

  if v_patient_id is null then
    update public.doctor_profiles
      set patient_number_seq = patient_number_seq + 1,
          updated_at = now()
    where id = v_doctor_id
    returning patient_number_prefix, patient_number_seq
      into v_prefix, v_seq;

    v_patient_number := coalesce(nullif(v_prefix, ''), 'PT') || '-' || lpad(v_seq::text, 6, '0');
    v_patient_id := gen_random_uuid();

    insert into public.patients (
      id, owner_doctor_id, patient_number, full_name, name_normalized,
      sex, phone, phone_normalized, created_by
    ) values (
      v_patient_id, v_doctor_id, v_patient_number, v_name, v_name_norm,
      p_sex::public.sex, btrim(p_phone), v_phone_norm, null
    );
  end if;

  insert into public.patient_location_links (
    patient_id, practice_location_id, first_seen_at, last_seen_at
  ) values (
    v_patient_id, p_location_id, now(), now()
  )
  on conflict (patient_id, practice_location_id)
  do update set last_seen_at = excluded.last_seen_at;

  insert into public.appointments (
    id, owner_doctor_id, practice_location_id, patient_id,
    scheduled_for, session_date, duration_minutes, visit_type, status,
    reason, created_by, booking_source, public_booking_ref
  ) values (
    v_appointment_id, v_doctor_id, p_location_id, v_patient_id,
    v_instant, p_date, v_slot_minutes, 'NEW', 'SCHEDULED',
    nullif(btrim(p_reason), ''), null, 'PUBLIC', v_booking_ref
  );

  insert into public.appointment_events (
    appointment_id, practice_location_id, event_type,
    from_status, to_status, actor_id, note
  ) values (
    v_appointment_id, p_location_id, 'CREATED',
    null, 'SCHEDULED', null, 'Public self-booking'
  );

  return jsonb_build_object(
    'bookingRef', v_booking_ref,
    'date', p_date,
    'localTime', p_local_time,
    'status', 'SCHEDULED'
  );
end;
$$;

revoke all on function public.create_public_booking(text, uuid, date, text, text, text, text, text) from public;
grant execute on function public.create_public_booking(text, uuid, date, text, text, text, text, text)
  to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Subscription + payment lifecycle
-- ---------------------------------------------------------------------------

create table if not exists public.subscription_plans (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  monthly_price_bdt numeric(12,2) not null default 0 check (monthly_price_bdt >= 0),
  annual_price_bdt numeric(12,2) check (annual_price_bdt is null or annual_price_bdt >= 0),
  is_active boolean not null default true,
  is_founder_plan boolean not null default false,
  features jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (code ~ '^[A-Z0-9_]{2,40}$')
);

insert into public.subscription_plans(code, name, monthly_price_bdt, is_active, is_founder_plan, features)
values
  ('PILOT', 'Pilot', 0, true, false, '{"commercial":"pilot"}'::jsonb),
  ('FOUNDING_DOCTOR', 'Founding Doctor', 0, true, true, '{"priceConfigurable":true}'::jsonb)
on conflict (code) do nothing;

create table if not exists public.doctor_subscriptions (
  id uuid primary key default gen_random_uuid(),
  doctor_profile_id uuid not null unique references public.doctor_profiles(id) on delete restrict,
  plan_id uuid not null references public.subscription_plans(id) on delete restrict,
  status text not null default 'PILOT'
    check (status in ('PILOT','TRIAL','ACTIVE','GRACE_PERIOD','PAST_DUE','CANCELLED','EXPIRED')),
  starts_at timestamptz not null default now(),
  current_period_start timestamptz,
  current_period_end timestamptz,
  grace_until timestamptz,
  cancel_at_period_end boolean not null default false,
  cancelled_at timestamptz,
  founder_discount_percent numeric(5,2)
    check (founder_discount_percent is null or founder_discount_percent between 0 and 100),
  founder_price_locked_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.subscription_payments (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.doctor_subscriptions(id) on delete restrict,
  amount numeric(12,2) not null check (amount > 0),
  currency text not null default 'BDT' check (currency ~ '^[A-Z]{3}$'),
  method text not null default 'MANUAL_BANK'
    check (method in ('MANUAL_BANK','SSLCOMMERZ','CARD','OTHER')),
  status text not null default 'PENDING'
    check (status in ('PENDING','CONFIRMED','REJECTED','REFUNDED')),
  payer_reference text,
  note text,
  submitted_at timestamptz not null default now(),
  confirmed_at timestamptz,
  recorded_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  check (payer_reference is null or length(payer_reference) <= 120),
  check (note is null or length(note) <= 500)
);

create index if not exists subscription_payments_subscription_idx
  on public.subscription_payments(subscription_id, created_at desc);

alter table public.subscription_plans enable row level security;
alter table public.doctor_subscriptions enable row level security;
alter table public.subscription_payments enable row level security;

revoke all on public.subscription_plans from anon, authenticated;
revoke all on public.doctor_subscriptions from anon, authenticated;
revoke all on public.subscription_payments from anon, authenticated;

-- Plans are commercial metadata; authenticated doctors may read active plans.
drop policy if exists "doctors read active plans" on public.subscription_plans;
create policy "doctors read active plans"
on public.subscription_plans for select
to authenticated
using (is_active = true);

drop policy if exists "doctor reads own subscription" on public.doctor_subscriptions;
create policy "doctor reads own subscription"
on public.doctor_subscriptions for select
to authenticated
using (doctor_profile_id = public.current_doctor_id());

drop policy if exists "doctor reads own payments" on public.subscription_payments;
create policy "doctor reads own payments"
on public.subscription_payments for select
to authenticated
using (
  exists (
    select 1 from public.doctor_subscriptions s
    where s.id = subscription_payments.subscription_id
      and s.doctor_profile_id = public.current_doctor_id()
  )
);

create or replace function public.ensure_doctor_subscription()
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_doctor uuid := public.current_doctor_id();
  v_plan uuid;
  v_id uuid;
begin
  if v_doctor is null then
    raise exception 'DOCTOR_REQUIRED';
  end if;

  select id into v_id
  from public.doctor_subscriptions
  where doctor_profile_id = v_doctor;

  if v_id is not null then
    return v_id;
  end if;

  select id into v_plan from public.subscription_plans where code = 'PILOT' limit 1;
  if v_plan is null then
    raise exception 'PILOT_PLAN_MISSING';
  end if;

  insert into public.doctor_subscriptions(doctor_profile_id, plan_id, status)
  values (v_doctor, v_plan, 'PILOT')
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.ensure_doctor_subscription() from public;
grant execute on function public.ensure_doctor_subscription() to authenticated;

create or replace function public.current_subscription()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_result jsonb;
begin
  v_id := public.ensure_doctor_subscription();

  select jsonb_build_object(
    'subscriptionId', s.id,
    'status', s.status,
    'planCode', p.code,
    'planName', p.name,
    'monthlyPriceBdt', p.monthly_price_bdt,
    'annualPriceBdt', p.annual_price_bdt,
    'currentPeriodStart', s.current_period_start,
    'currentPeriodEnd', s.current_period_end,
    'graceUntil', s.grace_until,
    'cancelAtPeriodEnd', s.cancel_at_period_end,
    'founderDiscountPercent', s.founder_discount_percent,
    'founderPriceLockedUntil', s.founder_price_locked_until,
    'payments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', pay.id,
        'amount', pay.amount,
        'currency', pay.currency,
        'method', pay.method,
        'status', pay.status,
        'payerReference', pay.payer_reference,
        'submittedAt', pay.submitted_at,
        'confirmedAt', pay.confirmed_at
      ) order by pay.created_at desc)
      from public.subscription_payments pay
      where pay.subscription_id = s.id
    ), '[]'::jsonb)
  )
  into v_result
  from public.doctor_subscriptions s
  join public.subscription_plans p on p.id = s.plan_id
  where s.id = v_id;

  return v_result;
end;
$$;

revoke all on function public.current_subscription() from public;
grant execute on function public.current_subscription() to authenticated;

create or replace function public.submit_manual_subscription_payment(
  p_amount numeric,
  p_reference text,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_subscription uuid;
  v_id uuid;
begin
  if p_amount is null or p_amount <= 0 or p_amount > 10000000 then
    raise exception 'INVALID_AMOUNT';
  end if;
  if p_reference is null or length(btrim(p_reference)) < 3 or length(p_reference) > 120 then
    raise exception 'INVALID_REFERENCE';
  end if;
  if p_note is not null and length(p_note) > 500 then
    raise exception 'NOTE_TOO_LONG';
  end if;

  v_subscription := public.ensure_doctor_subscription();

  -- Exact duplicate reference on the same subscription is rejected.
  if exists (
    select 1 from public.subscription_payments
    where subscription_id = v_subscription
      and lower(btrim(coalesce(payer_reference, ''))) = lower(btrim(p_reference))
      and status <> 'REJECTED'
  ) then
    raise exception 'DUPLICATE_REFERENCE';
  end if;

  insert into public.subscription_payments(
    subscription_id, amount, currency, method, status,
    payer_reference, note
  ) values (
    v_subscription, p_amount, 'BDT', 'MANUAL_BANK', 'PENDING',
    btrim(p_reference), nullif(btrim(p_note), '')
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.submit_manual_subscription_payment(numeric, text, text) from public;
grant execute on function public.submit_manual_subscription_payment(numeric, text, text)
  to authenticated;

create or replace function public.cancel_own_subscription()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.ensure_doctor_subscription();

  update public.doctor_subscriptions
  set cancel_at_period_end = true,
      updated_at = now()
  where doctor_profile_id = public.current_doctor_id()
    and status not in ('CANCELLED','EXPIRED');
end;
$$;

revoke all on function public.cancel_own_subscription() from public;
grant execute on function public.cancel_own_subscription() to authenticated;

create or replace function public.reactivate_own_subscription()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.ensure_doctor_subscription();

  update public.doctor_subscriptions
  set cancel_at_period_end = false,
      cancelled_at = null,
      updated_at = now()
  where doctor_profile_id = public.current_doctor_id()
    and status not in ('CANCELLED','EXPIRED');
end;
$$;

revoke all on function public.reactivate_own_subscription() from public;
grant execute on function public.reactivate_own_subscription() to authenticated;

-- No function here changes clinical rows on cancellation, expiry or non-payment.
-- That is an invariant, not an omission.

-- ---------------------------------------------------------------------------
-- Doctor-owned booking configuration
-- ---------------------------------------------------------------------------
--
-- Without these, Area K is implemented and unreachable: `booking_enabled`
-- defaults to false, every table grant is revoked, and nothing could turn it on
-- except direct database access.
--
-- The doctor is the only authority here, and they are resolved from the session
-- by current_doctor_id() — never taken as a parameter. Every function re-proves
-- that the chamber belongs to the caller before it writes, because a chamber id
-- is a caller-supplied uuid and knowing one must never be enough.

create or replace function public.doctor_booking_config()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_doctor uuid := public.current_doctor_id();
  v_result jsonb;
begin
  if v_doctor is null then
    raise exception 'DOCTOR_REQUIRED';
  end if;

  select coalesce(jsonb_agg(ch order by (ch->>'position')::int), '[]'::jsonb)
  into v_result
  from (
    select jsonb_build_object(
      'chamberId', dc.id,
      'locationId', pl.id,
      'locationName', pl.name,
      'district', pl.district,
      'timezone', pl.timezone,
      'isActive', pl.is_active,
      'position', dc.position,
      'bookingEnabled', coalesce(bs.booking_enabled, false),
      'bookingMode', coalesce(bs.booking_mode, 'TOKEN'),
      'slotMinutes', coalesce(bs.slot_minutes, 15),
      'maxPatients', coalesce(bs.max_patients, 30),
      'bookingWindowDays', coalesce(bs.booking_window_days, 30),
      'minLeadMinutes', coalesce(bs.min_lead_minutes, 60),
      'consultationFee', bs.consultation_fee,
      'currency', coalesce(bs.currency, 'BDT'),
      'configured', (bs.id is not null),
      'sessions', coalesce((
        select jsonb_agg(
          jsonb_build_object('weekday', h.weekday, 'startsAt', h.starts_at, 'endsAt', h.ends_at)
          order by h.weekday, h.starts_at)
        from public.doctor_chamber_hours h
        where h.chamber_id = dc.id
      ), '[]'::jsonb),
      'closedDates', coalesce((
        select jsonb_agg(
          jsonb_build_object('closedOn', c.closed_on, 'reason', c.reason)
          order by c.closed_on)
        from public.doctor_booking_closed_dates c
        where c.doctor_chamber_id = dc.id
          and c.closed_on >= (now() at time zone pl.timezone)::date
      ), '[]'::jsonb)
    ) as ch
    from public.doctor_chambers dc
    join public.practice_locations pl on pl.id = dc.practice_location_id
    left join public.doctor_booking_settings bs on bs.doctor_chamber_id = dc.id
    where dc.doctor_profile_id = v_doctor
  ) q;

  return v_result;
end;
$$;

revoke all on function public.doctor_booking_config() from public, anon;
grant execute on function public.doctor_booking_config() to authenticated;

/**
 * One write for one chamber.
 *
 * Enabling booking is refused unless the chamber actually has visiting hours:
 * a public "Book now" button over a chamber with no sessions is a promise the
 * availability function cannot keep, and the patient would meet an empty list
 * with no explanation.
 */
create or replace function public.save_doctor_booking_settings(
  p_chamber_id uuid,
  p_enabled boolean,
  p_mode text,
  p_slot_minutes integer,
  p_max_patients integer,
  p_window_days integer,
  p_lead_minutes integer,
  p_fee numeric default null,
  p_currency text default 'BDT'
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_doctor uuid := public.current_doctor_id();
  v_id uuid;
begin
  if v_doctor is null then
    raise exception 'DOCTOR_REQUIRED';
  end if;

  -- The chamber must be the caller's. Knowing its id proves nothing.
  if not exists (
    select 1 from public.doctor_chambers dc
    where dc.id = p_chamber_id and dc.doctor_profile_id = v_doctor
  ) then
    raise exception 'CHAMBER_NOT_FOUND';
  end if;

  if p_mode not in ('TOKEN', 'TIME_SLOT') then
    raise exception 'INVALID_MODE';
  end if;
  if p_slot_minutes is null or p_slot_minutes < 5 or p_slot_minutes > 180 then
    raise exception 'INVALID_SLOT_MINUTES';
  end if;
  if p_max_patients is null or p_max_patients < 1 or p_max_patients > 500 then
    raise exception 'INVALID_MAX_PATIENTS';
  end if;
  if p_window_days is null or p_window_days < 1 or p_window_days > 180 then
    raise exception 'INVALID_WINDOW';
  end if;
  if p_lead_minutes is null or p_lead_minutes < 0 or p_lead_minutes > 10080 then
    raise exception 'INVALID_LEAD';
  end if;
  if p_fee is not null and (p_fee < 0 or p_fee > 1000000) then
    raise exception 'INVALID_FEE';
  end if;
  if p_currency is null or p_currency !~ '^[A-Z]{3}$' then
    raise exception 'INVALID_CURRENCY';
  end if;

  if p_enabled and not exists (
    select 1 from public.doctor_chamber_hours h where h.chamber_id = p_chamber_id
  ) then
    raise exception 'NO_VISITING_HOURS';
  end if;

  if p_enabled and not exists (
    select 1
    from public.doctor_chambers dc
    join public.practice_locations pl on pl.id = dc.practice_location_id
    where dc.id = p_chamber_id and pl.is_active = true
  ) then
    raise exception 'LOCATION_INACTIVE';
  end if;

  insert into public.doctor_booking_settings (
    doctor_profile_id, doctor_chamber_id, booking_enabled, booking_mode,
    slot_minutes, max_patients, booking_window_days, min_lead_minutes,
    consultation_fee, currency
  ) values (
    v_doctor, p_chamber_id, p_enabled, p_mode,
    p_slot_minutes, p_max_patients, p_window_days, p_lead_minutes,
    p_fee, p_currency
  )
  on conflict (doctor_chamber_id) do update set
    booking_enabled = excluded.booking_enabled,
    booking_mode = excluded.booking_mode,
    slot_minutes = excluded.slot_minutes,
    max_patients = excluded.max_patients,
    booking_window_days = excluded.booking_window_days,
    min_lead_minutes = excluded.min_lead_minutes,
    consultation_fee = excluded.consultation_fee,
    currency = excluded.currency,
    updated_at = now()
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.save_doctor_booking_settings(uuid, boolean, text, integer, integer, integer, integer, numeric, text) from public, anon;
grant execute on function public.save_doctor_booking_settings(uuid, boolean, text, integer, integer, integer, integer, numeric, text) to authenticated;

/**
 * Closing a date does NOT cancel appointments already booked on it. Those are
 * clinical commitments a patient is holding, and silently voiding them from a
 * settings screen would be the worst possible surprise. The doctor closes the
 * date to stop NEW bookings; existing ones stay and are theirs to handle.
 */
create or replace function public.add_doctor_booking_closed_date(
  p_chamber_id uuid,
  p_date date,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_doctor uuid := public.current_doctor_id();
begin
  if v_doctor is null then
    raise exception 'DOCTOR_REQUIRED';
  end if;

  if not exists (
    select 1 from public.doctor_chambers dc
    where dc.id = p_chamber_id and dc.doctor_profile_id = v_doctor
  ) then
    raise exception 'CHAMBER_NOT_FOUND';
  end if;

  if p_date is null then
    raise exception 'INVALID_DATE';
  end if;
  if p_reason is not null and length(p_reason) > 120 then
    raise exception 'REASON_TOO_LONG';
  end if;

  insert into public.doctor_booking_closed_dates (doctor_chamber_id, closed_on, reason)
  values (p_chamber_id, p_date, nullif(btrim(p_reason), ''))
  on conflict (doctor_chamber_id, closed_on) do update
    set reason = excluded.reason;
end;
$$;

revoke all on function public.add_doctor_booking_closed_date(uuid, date, text) from public, anon;
grant execute on function public.add_doctor_booking_closed_date(uuid, date, text) to authenticated;

create or replace function public.remove_doctor_booking_closed_date(
  p_chamber_id uuid,
  p_date date
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_doctor uuid := public.current_doctor_id();
begin
  if v_doctor is null then
    raise exception 'DOCTOR_REQUIRED';
  end if;

  if not exists (
    select 1 from public.doctor_chambers dc
    where dc.id = p_chamber_id and dc.doctor_profile_id = v_doctor
  ) then
    raise exception 'CHAMBER_NOT_FOUND';
  end if;

  delete from public.doctor_booking_closed_dates
  where doctor_chamber_id = p_chamber_id and closed_on = p_date;
end;
$$;

revoke all on function public.remove_doctor_booking_closed_date(uuid, date) from public, anon;
grant execute on function public.remove_doctor_booking_closed_date(uuid, date) to authenticated;

-- Every function above resolves the doctor from the session and re-proves
-- chamber ownership. None of them is reachable by anon, and none of them
-- touches a patient, an encounter or a prescription.
