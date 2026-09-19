-- 0054_seo_search_eligibility.sql
-- Source-only migration for CENTRAL review. Do not apply to protected Supabase here.
-- Staff Management owns 0053_staff_management_v1.sql.

create type public.search_identity_class as enum (
  'UNCLASSIFIED',
  'REAL',
  'SYNTHETIC',
  'TEST'
);

-- Keep search classification outside doctor_profiles because authenticated currently
-- has table-level SELECT on doctor_profiles. This private one-to-one relation keeps
-- the classification marker out of browser-queryable profile rows.
create table public.doctor_search_identities (
  doctor_profile_id uuid primary key
    references public.doctor_profiles(id) on delete cascade,
  search_identity_class public.search_identity_class not null default 'UNCLASSIFIED',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.doctor_search_identities enable row level security;

revoke all on table public.doctor_search_identities from public;
revoke all on table public.doctor_search_identities from anon;
revoke all on table public.doctor_search_identities from authenticated;
grant select, insert, update, delete on table public.doctor_search_identities to service_role;

-- Existing doctors begin fail-closed as UNCLASSIFIED.
insert into public.doctor_search_identities (doctor_profile_id)
select id from public.doctor_profiles
on conflict (doctor_profile_id) do nothing;

create or replace function public.ensure_doctor_search_identity()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.doctor_search_identities (doctor_profile_id)
  values (new.id)
  on conflict (doctor_profile_id) do nothing;
  return new;
end;
$$;

revoke all on function public.ensure_doctor_search_identity() from public;
revoke all on function public.ensure_doctor_search_identity() from anon;
revoke all on function public.ensure_doctor_search_identity() from authenticated;
revoke all on function public.ensure_doctor_search_identity() from service_role;

create trigger doctor_profiles_search_identity_default
  after insert on public.doctor_profiles
  for each row
  execute function public.ensure_doctor_search_identity();

create or replace function public.is_doctor_search_indexable(p_doctor_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.doctor_profiles d
    join public.profiles p
      on p.id = d.user_id
    join auth.users u
      on u.id = p.id
    join public.doctor_search_identities si
      on si.doctor_profile_id = d.id
    where d.id = p_doctor_profile_id
      and d.profile_visibility = 'PUBLIC'
      and si.search_identity_class = 'REAL'
      and u.deleted_at is null
      and (u.banned_until is null or u.banned_until < now())
      and (u.email is null or lower(u.email) not like '%@qa.invalid')
      and nullif(btrim(d.profile_slug), '') is not null
      and nullif(btrim(p.full_name), '') is not null
      and (
        nullif(btrim(d.qualification), '') is not null
        or nullif(btrim(d.designation), '') is not null
        or nullif(btrim(d.specialization), '') is not null
      )
  );
$$;

revoke all on function public.is_doctor_search_indexable(uuid) from public;
revoke all on function public.is_doctor_search_indexable(uuid) from anon;
revoke all on function public.is_doctor_search_indexable(uuid) from authenticated;
revoke all on function public.is_doctor_search_indexable(uuid) from service_role;

create or replace function public.public_search_indexable_doctor_slugs()
returns table (profile_slug text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select d.profile_slug
  from public.doctor_profiles d
  where public.is_doctor_search_indexable(d.id)
  order by d.profile_slug;
$$;

revoke all on function public.public_search_indexable_doctor_slugs() from public;
grant execute on function public.public_search_indexable_doctor_slugs() to anon, authenticated, service_role;

-- Preserve the existing public profile payload and add only the safe boolean.
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

  select d.* into v_doctor
  from public.doctor_profiles d
  where d.profile_slug = lower(btrim(p_slug))
    and d.profile_visibility = 'PUBLIC'
  limit 1;

  if not found then
    return null;
  end if;

  select p.full_name into v_full_name
  from public.profiles p
  where p.id = v_doctor.user_id;

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
    'chambers', v_chambers,
    'is_search_indexable', public.is_doctor_search_indexable(v_doctor.id)
  );
end;
$$;

-- Replace default EXECUTE behavior with an explicit public surface matching the
-- existing RPC: callers may receive public profile data plus the boolean only.
revoke all on function public.public_doctor_profile(text) from public;
grant execute on function public.public_doctor_profile(text) to anon, authenticated, service_role;
