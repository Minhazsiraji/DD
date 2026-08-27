-- Platform owner authority — the primitive, and nothing more.
--
-- This unblocks doctor-claim approval and manual-payment approval, both of
-- which currently have no one who may say yes. It is NOT the Owner Control
-- Center: there are no metrics, no dashboards, no clinical reads here.
--
-- ORDERING — RUN `db:migrate` BEFORE `db:policies`. `platform_owners` is owned
-- by Drizzle migration 0019_open_whizzer, which is the authority for its shape.
--
-- TWO AXES, PERMANENTLY SEPARATE
--
--   location_role         what may this person do with CARE, at this place?
--   platform_owners       who may run the PLATFORM?
--
-- The enum is deliberately not extended. Adding OWNER to `location_role` would
-- put a business role inside every clinical policy that reads it.
--
-- OWNING THE PLATFORM IS NOT OWNING THE RECORDS
--
-- Nothing below grants a single read over patients, encounters, prescriptions
-- or any clinical table, and `is_platform_owner()` is referenced by no clinical
-- policy. A doctor's promise that their patient records are theirs alone
-- survives the existence of a platform administrator. That is enforced by
-- ABSENCE, which is easy to erode by accident, so
-- `scripts/verify-owner-authority.mjs` fails the moment an owner can reach one
-- clinical row.

-- ---------------------------------------------------------------------------
-- The allowlist
-- ---------------------------------------------------------------------------
--
-- `platform_owners` IS NOT CREATED HERE. Migration 0019_open_whizzer owns its
-- shape — table, constraints, foreign keys and index — and this file assumes it
-- has run.
--
-- A `create table if not exists` here would be worse than redundant: applied to
-- an unmigrated database it would quietly conjure a table with none of the
-- migration's constraints, and the deployment-order mistake that caused it
-- would never surface. This file fails loudly instead, which is the correct
-- outcome when `db:migrate` has been skipped.

alter table public.platform_owners enable row level security;

/*
 * REVOKED, NOT MERELY UNGRANTED. Supabase grants `authenticated` every verb on
 * a new table by default, so omitting a verb changes nothing — the privilege is
 * there until it is taken away.
 *
 * Nobody reads this table through PostgREST and nobody writes it from the app.
 * Membership is granted out of band by someone with database access; a table
 * that decides who may approve payments must not be editable by the people it
 * governs. There is deliberately NO policy allowing a self-insert.
 */
revoke all on public.platform_owners from anon, authenticated;

-- ---------------------------------------------------------------------------
-- The trusted helper
-- ---------------------------------------------------------------------------

/**
 * Is the CALLER a platform owner?
 *
 * Takes no argument, on purpose. A `is_platform_owner(user_id uuid)` overload
 * would let a caller ask about somebody else, and — worse — invites callers to
 * pass an id they control. Identity comes from `auth.uid()` and nowhere else,
 * so there is no client-supplied value anywhere in the decision.
 *
 * Anonymous returns false rather than null: `auth.uid()` is null for anon, the
 * lookup finds nothing, and `exists` is false. A null would be neither true nor
 * false in a policy and would fail open in the wrong hands.
 */
create or replace function public.is_platform_owner()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.platform_owners o
    where o.user_id = auth.uid()
      and o.is_active = true
  );
$$;

revoke all on function public.is_platform_owner() from public, anon;
grant execute on function public.is_platform_owner() to authenticated;

comment on function public.is_platform_owner() is
  'Platform administration authority only. Grants no clinical access, and must '
  'never be referenced by a policy on a clinical table.';

/*
 * An owner may see their OWN membership row — enough for the /owner route to
 * render, nothing more. There is no policy letting an owner enumerate other
 * owners, because that is a list of who can approve money.
 *
 * The SELECT privilege stays revoked above, so this policy is dormant unless a
 * future grant is added deliberately. Reads go through the helper.
 */
drop policy if exists "owner reads own membership" on public.platform_owners;
create policy "owner reads own membership"
on public.platform_owners for select
to authenticated
using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- What this file deliberately does NOT do
-- ---------------------------------------------------------------------------
--
-- No policy on patients, encounters, prescriptions, prescription_items,
-- appointments, queue_entries or any patient_* / encounter_* table mentions
-- is_platform_owner(). No SECURITY DEFINER function here reads clinical data.
-- No approval RPC exists yet — claim approval and payment confirmation are the
-- next stage, and they will be built on top of this helper rather than beside
-- it.
