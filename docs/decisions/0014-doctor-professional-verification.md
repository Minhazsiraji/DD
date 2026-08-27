# 0014 — Doctor professional verification is not a directory claim

Status: accepted
Date: 2026-08-27

## Context

The adoption funnel we want eventually is:

> Doctor's Diary prepares Dr X's professional profile → Dr X finds it → Dr X
> claims it → a platform owner verifies them → Dr X receives control.

What was built in this stage is narrower, and the difference is easy to miss
because both are colloquially "claiming a profile".

`doctor_profiles.user_id` is `NOT NULL`. A profile therefore has an owning
account from the moment it exists, and an ownerless "prepared profile" cannot be
represented at all. `submit_doctor_profile_claim()` resolves its target through
`current_doctor_id()`, and approval refuses unless
`doctor_profiles.user_id = claimant_user_id`.

So the capability is:

> I already own this Doctor's Diary doctor account. Please verify that the
> professional identity behind it is genuine.

## Decision

**Ship this as Doctor Professional Verification.** Name it that everywhere a
person can read — UI copy, architecture comments, this ADR — rather than letting
"claim" imply an ownership transfer that does not happen.

The database objects keep the `doctor_profile_claim*` names. Renaming them would
be churn across a migration, a policy file, four RPCs and two event tables for no
behavioural gain, and the `SECURITY DEFINER` helpers store their bodies as text,
so renames there are a known source of silent breakage.

**Do not make `doctor_profiles.user_id` nullable to reach the funnel.** That
column is what `current_doctor_id()` resolves through, and `current_doctor_id()`
is the gate on every clinical isolation policy in the product. Widening it to
allow ownerless rows would put a null into the middle of the tenancy model —
where "whose patient is this?" is answered — to serve an acquisition feature.
The blast radius is every patient record in the system.

## Consequences

What this stage does give us, and it is not nothing:

- a portable professional-identity trust layer — `(country, regulator,
  registration_number)`, not a BMDC column
- platform-owner review that is provably isolated from clinical records
- an auditable decision history that cannot be silently rewritten
- `PRIVATE` stays `PRIVATE`: verification never publishes a doctor
- the substrate for a "verified" badge once public discovery scales

## The future capability, sketched

**Prepared Directory Profile Claim** — a separate architecture, separately
reviewed:

- a *directory entry* entity that can exist with no clinical ownership at all,
  distinct from `doctor_profiles`
- a doctor proves identity against that entry, reusing the verification
  evidence and the platform-owner decision path built here
- on approval, an explicit **ownership transfer** step links the directory entry
  to a real `doctor_profiles` row — a modelled event, not a column flipped in
  place
- `current_doctor_id()`, `doctor_profiles.user_id` and clinical isolation are
  untouched by any of it

The transfer is the part that needs its own review. Moving a professional
identity between accounts is exactly the operation an attacker would want, and
it must never be reachable without an owner decision and an audit row.
