/**
 * The doctor's professional profile: RLS, its own photo bucket, and the write
 * paths that own the rules.
 *
 * PRIVATE IS THE DEFAULT AND THE PILOT NEVER LEAVES IT. Nothing here serves a
 * profile to `anon`. The visibility column exists so a future public route has
 * a boundary to READ rather than one to invent, and every policy below is
 * written as though that route already existed — which is the only way to find
 * out now whether the boundary holds.
 *
 * WHAT IS DELIBERATELY NOT HERE
 *
 * No patient data, no counts, no clinical rows, no signature. The profile reads
 * `doctor_profiles`, `profiles.full_name`, `practice_locations` and the two new
 * chamber tables — nothing else is reachable from it.
 */

-- -----------------------------------------------------------------------------
-- 1. Chambers and their visiting hours: the doctor's own, and only theirs.
-- -----------------------------------------------------------------------------

alter table public.doctor_chambers      enable row level security;
alter table public.doctor_chamber_hours enable row level security;

/**
 * Does this chamber row belong to the calling doctor?
 *
 * SECURITY DEFINER so the hours policy can ask without its own read of
 * `doctor_chambers`; it answers one boolean and leaks nothing.
 */
create or replace function public.owns_chamber(target_chamber uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.doctor_chambers c
    where c.id = target_chamber
      and c.doctor_profile_id = public.current_doctor_id()
  );
$$;

revoke all on function public.owns_chamber(uuid) from public, anon;
grant execute on function public.owns_chamber(uuid) to authenticated;

/**
 * READ: the owning doctor only.
 *
 * Not "anyone at the same location". Two doctors at one hospital have separate
 * professional identities and separate stated hours; a colleague reading — let
 * alone inheriting — this doctor's schedule is precisely the confusion the
 * composite key exists to prevent.
 */
drop policy if exists doctor_chambers_select on public.doctor_chambers;
create policy doctor_chambers_select
  on public.doctor_chambers for select to authenticated
  using (doctor_profile_id = public.current_doctor_id());

drop policy if exists doctor_chamber_hours_select on public.doctor_chamber_hours;
create policy doctor_chamber_hours_select
  on public.doctor_chamber_hours for select to authenticated
  using (public.owns_chamber(chamber_id));

/**
 * WRITES ARE RPC-ONLY.
 *
 * Supabase grants `authenticated` every verb on a new table by default, so
 * omitting one from a GRANT does not remove it — each must be revoked. No write
 * policy exists: one would advertise a direct path that must not be taken, and
 * would let a later GRANT quietly reopen it.
 */
grant select on public.doctor_chambers      to authenticated;
grant select on public.doctor_chamber_hours to authenticated;
revoke insert, update, delete on public.doctor_chambers      from authenticated, anon;
revoke insert, update, delete on public.doctor_chamber_hours from authenticated, anon;
revoke all on public.doctor_chambers      from anon;
revoke all on public.doctor_chamber_hours from anon;

-- -----------------------------------------------------------------------------
-- 2. The photo bucket — SEPARATE from signatures, on purpose.
--
-- `doctor-assets` holds signature images and `prescription-assets` holds the
-- frozen copies attested by a review digest. Neither may hold a portrait: a
-- signature must not become replaceable, and a portrait must not become
-- undeletable. Different lifecycles, different buckets.
--
-- Private. `public = false` is re-asserted on conflict so it cannot drift.
-- Path convention `<auth.uid()>/photo.<ext>`; the first segment is the owner,
-- which every policy below checks — the browser never names a path we trust.
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'doctor-profile-photos', 'doctor-profile-photos', false, 3145728,
  array['image/png','image/jpeg','image/webp']
)
on conflict (id) do update set
  public             = false,           -- never let this flip to public
  file_size_limit    = 3145728,
  allowed_mime_types = array['image/png','image/jpeg','image/webp'];

drop policy if exists doctor_photo_select on storage.objects;
create policy doctor_photo_select
  on storage.objects for select to authenticated
  using (
    bucket_id = 'doctor-profile-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists doctor_photo_insert on storage.objects;
create policy doctor_photo_insert
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'doctor-profile-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists doctor_photo_update on storage.objects;
create policy doctor_photo_update
  on storage.objects for update to authenticated
  using (
    bucket_id = 'doctor-profile-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

/**
 * DELETE is allowed here, unlike the prescription bucket.
 *
 * A doctor may remove their own portrait; nothing clinical depends on it and no
 * digest attests it. That difference is the whole reason these are two buckets.
 */
drop policy if exists doctor_photo_delete on storage.objects;
create policy doctor_photo_delete
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'doctor-profile-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- -----------------------------------------------------------------------------
-- 3. Writes.
-- -----------------------------------------------------------------------------

/**
 * Reserved handles a doctor may not take.
 *
 * Routing words, and words that would let a profile impersonate the product.
 * Held in SQL rather than a form because the form is not the boundary.
 */
create or replace function public.slug_is_reserved(candidate text)
returns boolean
language sql
immutable
as $$
  select candidate = any (array[
    'admin','api','app','auth','dashboard','doctor','doctors','dr','help',
    'login','logout','new','patient','patients','prescription','prescriptions',
    'profile','root','settings','signup','support','system','www'
  ]);
$$;

revoke all on function public.slug_is_reserved(text) from public, anon, authenticated;

/**
 * Set the doctor's own professional profile fields.
 *
 * `auth.uid()` decides whose profile this is. There is NO doctor id parameter,
 * because a caller-supplied identity on a write is how one doctor edits
 * another — and `current_doctor_id()` already answers the question honestly.
 *
 * BMDC is written through the same column the unique index guards, so this path
 * cannot become a way around it: a duplicate raises `23505` here exactly as it
 * does in onboarding.
 */
create or replace function public.save_professional_profile(
  p_qualification   text,
  p_specialization  text,
  p_designation     text,
  p_bmdc            text,
  p_show_bmdc       boolean,
  p_slug            text
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_doctor uuid;
  v_slug   text;
begin
  v_doctor := public.current_doctor_id();
  if v_doctor is null then
    raise exception 'only a doctor has a professional profile' using errcode = '42501';
  end if;

  v_slug := nullif(btrim(lower(coalesce(p_slug, ''))), '');
  if v_slug is not null then
    if public.slug_is_reserved(v_slug) then
      raise exception 'SLUG_RESERVED' using errcode = '22023';
    end if;
    if v_slug !~ '^[a-z0-9]([a-z0-9-]{1,38}[a-z0-9])$' then
      raise exception 'SLUG_INVALID' using errcode = '22023';
    end if;
  end if;

  update public.doctor_profiles set
    qualification         = nullif(btrim(coalesce(p_qualification, '')), ''),
    specialization        = nullif(btrim(coalesce(p_specialization, '')), ''),
    designation           = nullif(btrim(coalesce(p_designation, '')), ''),
    bmdc_registration_no  = nullif(btrim(coalesce(p_bmdc, '')), ''),
    show_bmdc_on_profile  = coalesce(p_show_bmdc, false),
    profile_slug          = v_slug,
    updated_at            = now()
  where id = v_doctor;

  return v_doctor;
end;
$$;

revoke all on function public.save_professional_profile(text, text, text, text, boolean, text)
  from public, anon;
grant execute on function public.save_professional_profile(text, text, text, text, boolean, text)
  to authenticated;

/**
 * Record where the doctor's own photo now lives.
 *
 * The PATH IS DERIVED HERE, never accepted: `<user>/photo`. A caller that could
 * name the path could point their profile at somebody else's object, and the
 * storage policies alone would not stop it — those govern who may write an
 * object, not what a row may claim about one.
 */
create or replace function public.set_professional_photo(p_present boolean)
returns text
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_doctor uuid;
  v_user   uuid := auth.uid();
  v_path   text;
begin
  v_doctor := public.current_doctor_id();
  if v_doctor is null or v_user is null then
    raise exception 'only a doctor has a professional profile' using errcode = '42501';
  end if;

  v_path := case when p_present then v_user::text || '/photo' else null end;

  update public.doctor_profiles
     set professional_photo_path = v_path, updated_at = now()
   where id = v_doctor;

  return v_path;
end;
$$;

revoke all on function public.set_professional_photo(boolean) from public, anon;
grant execute on function public.set_professional_photo(boolean) to authenticated;

/**
 * Replace one chamber's visiting hours, wholesale.
 *
 * REPLACE rather than patch: a schedule is read as a complete statement of when
 * the doctor sits, and merging rows would leave a removed session behind for a
 * patient to turn up to.
 *
 * The location must be one the doctor ACTIVELY PRACTISES AT — checked in the
 * database, against membership, not against anything the browser said. A doctor
 * cannot publish hours for a hospital they do not work at.
 */
create or replace function public.save_chamber_schedule(
  p_practice_location_id uuid,
  p_public_note          text,
  p_sessions             jsonb
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_doctor  uuid;
  v_chamber uuid;
  v_note    text;
  v_row     jsonb;
begin
  v_doctor := public.current_doctor_id();
  if v_doctor is null then
    raise exception 'only a doctor has a professional profile' using errcode = '42501';
  end if;

  if not public.doctor_practises_at(v_doctor, p_practice_location_id) then
    raise exception 'not a chamber you practise at' using errcode = '42501';
  end if;

  v_note := nullif(btrim(coalesce(p_public_note, '')), '');
  if v_note is not null and length(v_note) > 120 then
    raise exception 'NOTE_TOO_LONG' using errcode = '22023';
  end if;

  insert into public.doctor_chambers (doctor_profile_id, practice_location_id, public_note)
  values (v_doctor, p_practice_location_id, v_note)
  on conflict (doctor_profile_id, practice_location_id) do update
    set public_note = excluded.public_note, updated_at = now()
  returning id into v_chamber;

  delete from public.doctor_chamber_hours where chamber_id = v_chamber;

  for v_row in select * from jsonb_array_elements(coalesce(p_sessions, '[]'::jsonb))
  loop
    insert into public.doctor_chamber_hours (chamber_id, weekday, starts_at, ends_at)
    values (
      v_chamber,
      (v_row ->> 'weekday')::integer,
      v_row ->> 'startsAt',
      v_row ->> 'endsAt'
    );
  end loop;

  return v_chamber;
end;
$$;

revoke all on function public.save_chamber_schedule(uuid, text, jsonb) from public, anon;
grant execute on function public.save_chamber_schedule(uuid, text, jsonb) to authenticated;
