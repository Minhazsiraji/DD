-- Doctor profile claim, and the platform owner's decision on it.
--
-- ORDERING — RUN `db:migrate` BEFORE `db:policies`. Migration
-- 0020_freezing_mister_sinister owns the shape of `doctor_profile_claims`,
-- `doctor_profile_claim_events` and the status enum. Nothing is created here;
-- a policy file that stood the tables up would hide a skipped migration.
--
-- WHAT APPROVAL MEANS. `doctor_profiles.user_id` is NOT NULL, so a profile has
-- an owning account from birth. Approval therefore VERIFIES the professional
-- identity behind a profile; it does not move an ownership link. "Verified" is
-- the existence of an APPROVED claim, not a flag on doctor_profiles.
--
-- APPROVAL DOES NOT PUBLISH. No function here reads or writes
-- `profile_visibility`. A doctor approved this morning is still PRIVATE this
-- afternoon unless they publish themselves. Approval is someone else's decision
-- about who you are; publication is your decision about being findable, and an
-- administrator must never be able to make the second one for you.
--
-- ONE OWNER AUTHORITY. Decisions go through `is_platform_owner()` from 0033.
-- There is no second administrator concept here, and platform authority still
-- grants no clinical access — no function below reads a patient, an encounter,
-- a prescription or a queue row.
--
-- INTERNATIONAL. Evidence is (country_code, regulator_name,
-- registration_number). BMDC is a value, not a column.

alter table public.doctor_profile_claims enable row level security;
alter table public.doctor_profile_claim_events enable row level security;

/*
 * REVOKED, NOT MERELY UNGRANTED. Supabase grants `authenticated` every verb on
 * a new table by default, so omitting a verb changes nothing.
 *
 * Every write goes through a SECURITY DEFINER function below. A claimant who
 * could UPDATE this table directly would approve themselves; an owner who could
 * would decide without leaving an event row.
 */
revoke all on public.doctor_profile_claims from anon, authenticated;
revoke all on public.doctor_profile_claim_events from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Claimant side
-- ---------------------------------------------------------------------------

/**
 * File a claim over the caller's own doctor profile.
 *
 * The claimant is `auth.uid()` and the target is resolved from it. Neither
 * crosses the wire: a caller-supplied claimant id would let anyone file in
 * someone else's name, and a caller-supplied target would let them file over
 * someone else's profile.
 */
create or replace function public.submit_doctor_profile_claim(
  p_country_code text,
  p_regulator_name text,
  p_registration_number text,
  p_claimed_full_name text,
  p_evidence_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_doctor uuid := public.current_doctor_id();
  v_id uuid;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED';
  end if;
  if v_doctor is null then
    raise exception 'DOCTOR_PROFILE_REQUIRED';
  end if;

  if p_country_code is null or p_country_code !~ '^[A-Z]{2}$' then
    raise exception 'INVALID_COUNTRY';
  end if;
  if p_regulator_name is null or length(btrim(p_regulator_name)) < 2
     or length(btrim(p_regulator_name)) > 120 then
    raise exception 'INVALID_REGULATOR';
  end if;
  if p_registration_number is null or length(btrim(p_registration_number)) < 2
     or length(btrim(p_registration_number)) > 64 then
    raise exception 'INVALID_REGISTRATION';
  end if;
  if p_claimed_full_name is null or length(btrim(p_claimed_full_name)) < 2
     or length(btrim(p_claimed_full_name)) > 120 then
    raise exception 'INVALID_NAME';
  end if;
  if p_evidence_note is not null and length(p_evidence_note) > 1000 then
    raise exception 'EVIDENCE_TOO_LONG';
  end if;

  -- Already settled in the claimant's favour: nothing to file.
  if exists (
    select 1 from public.doctor_profile_claims c
    where c.doctor_profile_id = v_doctor and c.status = 'APPROVED'
  ) then
    raise exception 'ALREADY_APPROVED';
  end if;

  if exists (
    select 1 from public.doctor_profile_claims c
    where c.doctor_profile_id = v_doctor
      and c.claimant_user_id = v_user
      and c.status in ('PENDING', 'NEEDS_INFORMATION')
  ) then
    raise exception 'CLAIM_ALREADY_OPEN';
  end if;

  insert into public.doctor_profile_claims (
    doctor_profile_id, claimant_user_id, country_code, regulator_name,
    registration_number, claimed_full_name, evidence_note
  ) values (
    v_doctor, v_user, upper(btrim(p_country_code)), btrim(p_regulator_name),
    btrim(p_registration_number), btrim(p_claimed_full_name),
    nullif(btrim(p_evidence_note), '')
  )
  returning id into v_id;

  insert into public.doctor_profile_claim_events (claim_id, from_status, to_status, actor_id, note)
  values (v_id, null, 'PENDING', v_user, 'Claim submitted');

  return v_id;
end;
$$;

revoke all on function public.submit_doctor_profile_claim(text, text, text, text, text)
  from public, anon;
grant execute on function public.submit_doctor_profile_claim(text, text, text, text, text)
  to authenticated;

/**
 * The caller's OWN claims. Scoped by auth.uid(), takes no id — one doctor must
 * not be able to read another doctor's claim by guessing a uuid.
 */
create or replace function public.my_doctor_profile_claims()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', c.id,
      'status', c.status,
      'countryCode', c.country_code,
      'regulatorName', c.regulator_name,
      'registrationNumber', c.registration_number,
      'claimedFullName', c.claimed_full_name,
      'evidenceNote', c.evidence_note,
      'submittedAt', c.submitted_at,
      'decidedAt', c.decided_at,
      'decisionNote', c.decision_note
    ) order by c.submitted_at desc)
    from public.doctor_profile_claims c
    where c.claimant_user_id = v_user
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.my_doctor_profile_claims() from public, anon;
grant execute on function public.my_doctor_profile_claims() to authenticated;

/**
 * Answer a NEEDS_INFORMATION request, or withdraw. The claimant may move their
 * own claim back to PENDING or to CANCELLED, and nowhere else — a self-service
 * path to APPROVED would make the whole review theatre.
 */
create or replace function public.respond_to_doctor_profile_claim(
  p_claim_id uuid,
  p_action text,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_status public.doctor_profile_claim_status;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED';
  end if;
  if p_action not in ('RESUBMIT', 'CANCEL') then
    raise exception 'INVALID_ACTION';
  end if;
  if p_note is not null and length(p_note) > 1000 then
    raise exception 'NOTE_TOO_LONG';
  end if;

  -- Ownership is part of the lookup, so a foreign claim id simply is not found.
  select c.status into v_status
  from public.doctor_profile_claims c
  where c.id = p_claim_id and c.claimant_user_id = v_user
  for update;

  if not found then
    raise exception 'CLAIM_NOT_FOUND';
  end if;
  if v_status not in ('PENDING', 'NEEDS_INFORMATION') then
    raise exception 'CLAIM_ALREADY_DECIDED';
  end if;

  if p_action = 'CANCEL' then
    update public.doctor_profile_claims
    set status = 'CANCELLED', decided_at = now(), updated_at = now()
    where id = p_claim_id;

    insert into public.doctor_profile_claim_events (claim_id, from_status, to_status, actor_id, note)
    values (p_claim_id, v_status, 'CANCELLED', v_user, nullif(btrim(p_note), ''));
  else
    if v_status <> 'NEEDS_INFORMATION' then
      raise exception 'NOTHING_TO_RESUBMIT';
    end if;

    update public.doctor_profile_claims
    set status = 'PENDING',
        evidence_note = coalesce(nullif(btrim(p_note), ''), evidence_note),
        updated_at = now()
    where id = p_claim_id;

    insert into public.doctor_profile_claim_events (claim_id, from_status, to_status, actor_id, note)
    values (p_claim_id, v_status, 'PENDING', v_user, nullif(btrim(p_note), ''));
  end if;
end;
$$;

revoke all on function public.respond_to_doctor_profile_claim(uuid, text, text) from public, anon;
grant execute on function public.respond_to_doctor_profile_claim(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Platform owner side
-- ---------------------------------------------------------------------------

/**
 * Claims awaiting a decision, with the MINIMUM needed to decide.
 *
 * Professional identity only: the claimed name, the regulator, the registration
 * number, the account's own name and email, and the profile's professional
 * fields. No patient, no encounter, no prescription, no appointment, no queue.
 * A reviewer deciding "is this person this doctor?" needs none of that, and a
 * reviewer who could see it would be a clinical superuser by another name.
 */
create or replace function public.owner_pending_claims()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_platform_owner() then
    raise exception 'NOT_PLATFORM_OWNER';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', c.id,
      'status', c.status,
      'claimedFullName', c.claimed_full_name,
      'countryCode', c.country_code,
      'regulatorName', c.regulator_name,
      'registrationNumber', c.registration_number,
      'evidenceNote', c.evidence_note,
      'submittedAt', c.submitted_at,
      'accountName', p.full_name,
      'profileQualification', d.qualification,
      'profileSpecialization', d.specialization,
      'profileDesignation', d.designation,
      'profileRegistrationOnRecord', d.bmdc_registration_no
    ) order by c.submitted_at)
    from public.doctor_profile_claims c
    join public.doctor_profiles d on d.id = c.doctor_profile_id
    join public.profiles p on p.id = c.claimant_user_id
    where c.status in ('PENDING', 'NEEDS_INFORMATION')
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.owner_pending_claims() from public, anon;
grant execute on function public.owner_pending_claims() to authenticated;

/**
 * Decide a claim.
 *
 * IDEMPOTENT. Re-approving an already-APPROVED claim returns the standing
 * decision unchanged and writes no second event — a retried request, a
 * double-clicked button and a replayed action all land on the same row.
 *
 * The decider is `is_platform_owner()` plus `auth.uid()`. No decider id crosses
 * the wire.
 *
 * CONFLICT IS REFUSED, NOT RESOLVED. If the claimant no longer owns the account
 * behind the profile, approval raises rather than guessing. Two people wanting
 * one identity is a question for a human.
 *
 * `profile_visibility` is untouched on every path.
 */
create or replace function public.owner_decide_doctor_profile_claim(
  p_claim_id uuid,
  p_decision text,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_owner uuid := auth.uid();
  v_status public.doctor_profile_claim_status;
  v_target public.doctor_profile_claim_status;
  v_profile uuid;
  v_claimant uuid;
  v_profile_owner uuid;
begin
  if not public.is_platform_owner() then
    raise exception 'NOT_PLATFORM_OWNER';
  end if;
  if p_decision not in ('APPROVE', 'REJECT', 'NEEDS_INFORMATION') then
    raise exception 'INVALID_DECISION';
  end if;
  if p_note is not null and length(p_note) > 1000 then
    raise exception 'NOTE_TOO_LONG';
  end if;

  select c.status, c.doctor_profile_id, c.claimant_user_id
    into v_status, v_profile, v_claimant
  from public.doctor_profile_claims c
  where c.id = p_claim_id
  for update;

  if not found then
    raise exception 'CLAIM_NOT_FOUND';
  end if;

  v_target := case p_decision
    when 'APPROVE' then 'APPROVED'
    when 'REJECT' then 'REJECTED'
    else 'NEEDS_INFORMATION'
  end;

  /*
   * Idempotence, and the protection of history in one rule. Repeating the
   * decision already recorded is a no-op; CHANGING a settled decision is
   * refused outright. A reversal is a new fact about the world and must be
   * modelled as one, not smuggled in by overwriting the old row.
   */
  if v_status = v_target then
    return jsonb_build_object('id', p_claim_id, 'status', v_status, 'changed', false);
  end if;
  if v_status in ('APPROVED', 'REJECTED', 'CANCELLED') then
    raise exception 'CLAIM_ALREADY_DECIDED';
  end if;

  if v_target = 'APPROVED' then
    select d.user_id into v_profile_owner
    from public.doctor_profiles d where d.id = v_profile;

    if v_profile_owner is distinct from v_claimant then
      raise exception 'OWNERSHIP_CONFLICT';
    end if;
  end if;

  update public.doctor_profile_claims
  set status = v_target,
      decided_at = case when v_target = 'NEEDS_INFORMATION' then null else now() end,
      decided_by = case when v_target = 'NEEDS_INFORMATION' then null else v_owner end,
      decision_note = nullif(btrim(p_note), ''),
      updated_at = now()
  where id = p_claim_id;

  insert into public.doctor_profile_claim_events (claim_id, from_status, to_status, actor_id, note)
  values (p_claim_id, v_status, v_target, v_owner, nullif(btrim(p_note), ''));

  return jsonb_build_object('id', p_claim_id, 'status', v_target, 'changed', true);
end;
$$;

revoke all on function public.owner_decide_doctor_profile_claim(uuid, text, text) from public, anon;
grant execute on function public.owner_decide_doctor_profile_claim(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- What this file deliberately does NOT do
-- ---------------------------------------------------------------------------
--
-- It writes no `profile_visibility`. It reads no clinical table. It defines no
-- second owner authority. It offers no path from a claimant to APPROVED, and no
-- path for anyone to rewrite a settled decision.
