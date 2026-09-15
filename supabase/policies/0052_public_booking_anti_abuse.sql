-- P-S2 Public Booking Anti-Abuse Closure
--
-- Scope: anonymous public booking creation only.
-- This delta deliberately does not alter booking validation, duplicate detection,
-- chamber ownership, slot/capacity semantics, or any clinical module.
--
-- SECURITY MODEL
-- 1. The browser never supplies the throttle key directly to PostgreSQL.
-- 2. The Next.js server derives an HMAC source key from Vercel's trusted
--    x-forwarded-for value and the existing server-only service-role secret.
-- 3. Only service_role may consume a rate bucket or execute the raw booking RPC.
-- 4. The limiter commits before the booking write, so malformed/unavailable
--    attempts still consume the source budget and cannot be used for free abuse.
-- 5. No raw IP, patient name, phone, booking details, or clinical data is stored
--    in the limiter table.

create table if not exists public.public_booking_rate_limits (
  source_key text not null,
  window_start timestamptz not null,
  request_count integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (source_key, window_start),
  check (source_key ~ '^[0-9a-f]{64}$'),
  check (request_count between 1 and 5)
);

create index if not exists public_booking_rate_limits_window_idx
  on public.public_booking_rate_limits(window_start);

alter table public.public_booking_rate_limits enable row level security;
revoke all on table public.public_booking_rate_limits from public, anon, authenticated;
grant select, insert, update, delete on table public.public_booking_rate_limits to service_role;

create or replace function public.consume_public_booking_rate_limit(p_source_key text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_window_start timestamptz;
  v_count integer;
begin
  if p_source_key is null or p_source_key !~ '^[0-9a-f]{64}$' then
    return false;
  end if;

  -- Fixed 10-minute UTC buckets. Five attempts per source key per bucket.
  v_window_start := to_timestamp(
    floor(extract(epoch from clock_timestamp()) / 600) * 600
  );

  insert into public.public_booking_rate_limits as rl (
    source_key,
    window_start,
    request_count,
    created_at,
    updated_at
  ) values (
    p_source_key,
    v_window_start,
    1,
    now(),
    now()
  )
  on conflict (source_key, window_start) do update
    set request_count = rl.request_count + 1,
        updated_at = now()
    where rl.request_count < 5
  returning request_count into v_count;

  -- Keep the pilot table bounded without exposing or depending on caller data.
  delete from public.public_booking_rate_limits
  where window_start < now() - interval '24 hours';

  return v_count is not null and v_count <= 5;
end;
$$;

revoke all on function public.consume_public_booking_rate_limit(text) from public, anon, authenticated;
grant execute on function public.consume_public_booking_rate_limit(text) to service_role;

-- The raw SECURITY DEFINER booking write must no longer be directly callable by
-- anonymous/authenticated clients, otherwise callers could bypass the source
-- limiter by invoking PostgREST RPC themselves.
revoke execute on function public.create_public_booking(
  text, uuid, date, text, text, text, text, text
) from anon, authenticated;
grant execute on function public.create_public_booking(
  text, uuid, date, text, text, text, text, text
) to service_role;
