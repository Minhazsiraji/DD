# M6F Doctor Voice personalization persistence proposal

Status: **NOT IMPLEMENTED — requires separate CENTRAL schema/RLS authorization.**

The existing `doctor_phrases` table stores reusable prescription text by `rx_phrase_kind`; it is not a command-authority store. `practice_locations.settings` is chamber-owned rather than Doctor-personal and has no suitable command-alias write contract. Reusing either would blur authority and scoping.

## Proposed tables

`doctor_voice_profiles`

- `doctor_profile_id uuid primary key references doctor_profiles(id) on delete cascade`
- `language_preference text not null check in ('ENGLISH','BANGLA','BANGLISH','MIXED')`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

`doctor_voice_aliases`

- `id uuid primary key default gen_random_uuid()`
- `doctor_profile_id uuid not null references doctor_profiles(id) on delete cascade`
- `kind text not null check in ('COMMAND','FIELD')`
- `phrase text not null`
- `phrase_normalized text generated always as (lower(btrim(regexp_replace(phrase, '\\s+', ' ', 'g')))) stored`
- `canonical_id text not null` — validated against the application-owned allowlist; never a free-form runtime action
- `is_active boolean not null default true`
- `confirmed_at timestamptz not null`
- `created_at timestamptz not null default now()`
- unique `(doctor_profile_id, kind, phrase_normalized)`
- phrase length and non-blank checks

Optional future suggestion evidence belongs in a separate bounded table and must never be executable:

`doctor_voice_alias_suggestions(doctor_profile_id, phrase_normalized, proposed_canonical_id, evidence_count, last_observed_at, status)` where status is `PENDING`, `ACCEPTED`, or `IGNORED`. Only an explicit acceptance transaction may create an active alias.

## Proposed RLS and write authority

- Enable RLS on both tables.
- `SELECT`: authenticated user may read rows only where `doctor_profiles.user_id = auth.uid()`.
- No direct authenticated `INSERT`, `UPDATE`, or `DELETE` grants.
- Security-definer RPCs with fixed `search_path`, explicit Doctor ownership check, canonical-ID allowlist validation, normalized collision checks, and audit event:
  - `save_my_voice_profile(language_preference)`
  - `add_my_voice_alias(kind, phrase, canonical_id)`
  - `remove_my_voice_alias(alias_id)`
  - `decide_my_voice_alias_suggestion(suggestion_id, decision)`
- Revoke every RPC from `public` and `anon`; grant only to `authenticated`.
- No service role in the application path.
- No alias may represent Finalize, Sign, Complete, Confirm investigations, Save medicine, or Apply Autopilot.

Until this is separately authorized, Preview uses an explicitly labelled browser-local profile with no server write and no passive learning.
