-- 0054_public_professional_verification_badge.sql
-- Expose only the approved/not-approved boolean for already-public doctor profiles.
-- No claim evidence, notes, reviewer identity, or private claim state is disclosed.

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
  v_verified boolean := false;
begin
  if p_slug is null or btrim(p_slug) = '' then
    return null;
  end if;

  /**
   * Two statements, not one, because plpgsql refuses a %rowtype variable in a
   * multi-target INTO list. The visibility boundary is unchanged: the doctor is
   * still resolved ONLY by (slug, profile_visibility = 'PUBLIC'), and a miss
   * still returns null rather than an error, so a private slug stays
   * indistinguishable from one that does not exist.
   */
  select d.* into v_doctor
  from public.doctor_profiles d
  where d.profile_slug = lower(btrim(p_slug))
    and d.profile_visibility = 'PUBLIC'
  limit 1;

  if not found then
    return null;
  end if;

  -- The display name only. Reached through the row already proven PUBLIC.
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

  select exists (
    select 1 from public.doctor_profile_claims c
    where c.doctor_profile_id = v_doctor.id
      and c.status = 'APPROVED'
  ) into v_verified;

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
    'verified', v_verified,
    'chambers', v_chambers
  );
end;
$$;

revoke all on function public.public_doctor_profile(text) from public;
grant execute on function public.public_doctor_profile(text) to anon, authenticated;
