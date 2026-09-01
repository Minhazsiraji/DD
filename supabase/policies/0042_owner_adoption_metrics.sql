-- Adoption metrics for the platform owner — counts, and nothing but counts.
--
-- ORDERING — RUN `db:migrate` BEFORE `db:policies`. Nothing is created here.
-- Every table read below is owned by an earlier migration; this file adds one
-- read-only function over them.
--
-- WHY THIS NEEDS A FUNCTION AT ALL. A platform owner has no clinical authority
-- and no cross-doctor read (0033, and proven by `db:verify:owner`): selecting
-- from `doctor_profiles` as an owner returns their own row or nothing. That is
-- the correct default and it stays. Answering "how many doctors have enabled
-- booking?" therefore cannot be a query from the app — it has to be a narrow,
-- gated, aggregate-only function, which is what this is.
--
-- THE SHAPE IS THE SECURITY CONTROL.
--
--   * It takes NO PARAMETERS. There is nothing to point at a doctor, a
--     location or a patient, so there is nothing to probe. A count is still a
--     disclosure when a caller can vary the selector; with no selector, the
--     answer is the same for everyone who may call it at all.
--   * It returns SCALARS ONLY — no row set, no ids, no names. An owner learns
--     that 14 doctors have a public profile and cannot learn which.
--   * It reads `encounters` for exactly one fact: how many DOCTORS have
--     completed at least one consultation. No patient, no count of
--     consultations, no date, no content, nothing that describes care. That
--     single number is the adoption question the pilot actually asks — "did
--     they get to their first real visit?" — and it is the most that can be
--     asked of a clinical table without describing a patient.
--
-- WHAT IT DELIBERATELY DOES NOT COUNT: patients, appointments, prescriptions,
-- documents, or anything per-doctor. A per-doctor breakdown is a list of who
-- is failing to adopt, which is a different product with a different consent
-- conversation. It is not built here and should not be added without one.

create or replace function public.owner_adoption_metrics()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
begin
  if not public.is_platform_owner() then
    raise exception 'NOT_PLATFORM_OWNER';
  end if;

  select jsonb_build_object(
    'doctors', (select count(*) from public.doctor_profiles),
    'publicProfiles', (
      select count(*) from public.doctor_profiles
      where profile_visibility = 'PUBLIC'
    ),
    'profilesWithSlug', (
      select count(*) from public.doctor_profiles
      where profile_visibility = 'PUBLIC'
        and coalesce(btrim(profile_slug), '') <> ''
    ),
    'withChambers', (
      select count(distinct doctor_profile_id) from public.doctor_chambers
    ),
    'withBookingEnabled', (
      select count(distinct doctor_profile_id) from public.doctor_booking_settings
      where booking_enabled = true
    ),
    /*
     * One fact, aggregated across the whole platform. See the header: this is
     * the only reach into a clinical table, and it describes doctors rather
     * than care.
     */
    'withFirstConsultation', (
      select count(distinct owner_doctor_id) from public.encounters
      where status = 'COMPLETED'
    ),
    /*
     * Subscription states as they are stored, not as the app projects them.
     * The seven-to-six projection lives in the application layer; sending the
     * projection down here would give the owner console a different vocabulary
     * from the billing table it is meant to explain.
     */
    'subscriptions', (
      select coalesce(jsonb_object_agg(status, n), '{}'::jsonb)
      from (
        select status, count(*) as n
        from public.doctor_subscriptions
        group by status
      ) s
    ),
    'pendingManualPayments', (
      select count(*) from public.subscription_payments
      where status = 'PENDING' and method = 'MANUAL_BANK'
    ),
    /*
     * Stamped so a screen can say when it was measured. `now()` is the
     * transaction start, which is exactly right here: every count above is
     * read in this one transaction and they are all as of this instant.
     */
    'generatedAt', now()
  )
  into v_result;

  return v_result;
end;
$$;

revoke all on function public.owner_adoption_metrics() from public, anon;
grant execute on function public.owner_adoption_metrics() to authenticated;

-- What this file does not do: it grants no owner a clinical row, returns no
-- id of any kind, accepts no parameter, breaks nothing down per doctor, and
-- writes nothing at all.
