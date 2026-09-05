# Doctor's Diary — P1 Identity Operational Closure Evidence

Date: 2026-09-06
Classification: controlled P1 isolated implementation / local proof only
Branch: `md/p1-identity-operational-closure`
Worktree: `/workspaces/DD-md-p1-operational`
Base: `b82096323c0d79fb134ac9639cdd509588c54a6e`

## Scope and frozen boundaries

This slice closes the two P1 operational gaps accepted by Central after Slice 2:
credential-verifier human discovery/read and platform-staff lifecycle/bootstrap.
P0 remains byte-for-byte frozen; no P0 product file was modified.
No CSU/M1 application file was modified.
No protected/shared Supabase, `--linked`, production, remote P1 deploy, app V2 cutover,
Voice, DGDA, real doctor/patient data, or service-role shortcut was used.

## Credential verifier shared pull queue

The verifier workflow uses a shared pull queue; no persistent reviewer assignment/claim schema was added.
Caller identity is derived with `current_profile_id()` and requires an active
`CREDENTIAL_VERIFIER` platform role. `PLATFORM_ADMIN` alone does not inherit access.
Discovery and known-case/history reads are SECURITY DEFINER RPCs; underlying credential,
profile, and review-event tables receive no blanket verifier SELECT grant or verifier RLS policy.
Pagination is stable keyset pagination, not OFFSET pagination.
Queue/case responses expose only minimal professional/regulator/registration/evidence metadata
required for human verification plus whether a case awaits a distinct second verifier.
No clinical patient, health-subject, encounter, prescription, or other clinical payload is exposed.
Existing self-review denial, first-regulator four-eyes behavior, and decision `FOR UPDATE`
row locking/concurrency semantics are preserved.
Closed cases are not actionable and drop out of the pull queue.

Accepted P1 defines only the opaque `professional_credentials.evidence_ref` metadata field.
No accepted private verification-evidence bucket/retrieval contract exists, so this slice exposes
that metadata reference only and adds zero storage permission or retrieval authority.
Private evidence-document retrieval, if later required, remains a separate Central storage gate.

## Platform staff lifecycle

`activate_platform_staff()` is PLATFORM_ADMIN-authorized and creates/reactivates staff membership only.
Onboarding grants zero platform role, doctor capability, clinical capability, or owner authority.
Existing explicit `grant_platform_staff_role()` / `revoke_platform_staff_role()` remains the role model.
`deactivate_platform_staff()` atomically revokes every live platform role and deactivates membership.
Reactivation does not restore previously revoked roles.
A shared transaction advisory lock protects PLATFORM_ADMIN lifecycle transitions.
The final live PLATFORM_ADMIN role cannot be revoked and the final live PLATFORM_ADMIN staff member
cannot be deactivated. Audit events are preserved for membership and role transitions.
`is_owner_account` remains designation-only and grants zero authority.
## Operations-only initial PLATFORM_ADMIN bootstrap

`bootstrap_platform_admin()` is SECURITY INVOKER and positively gated to the actual PostgreSQL
database owner/session. It is not an application request-path RPC.
PUBLIC, anon, authenticated, and service_role have no EXECUTE privilege.
It does not depend on PLATFORM_OWNER and does not use a real-user seed.
The target must already be an active valid profile.
When zero live PLATFORM_ADMINs exist, the DB owner can activate platform staff and explicitly
grant PLATFORM_ADMIN. A second bootstrap while a live admin exists fails closed.
Bootstrap emits SYSTEM audit rows, sets no owner designation, and creates no clinical authority.
It may serve controlled operations recovery only while zero live PLATFORM_ADMINs exist.

## New Slice 3 runtime proofs

- `verify-credential-review-queue.mjs`: PASS — ordinary authenticated denied; PLATFORM_ADMIN-only denied;
  CREDENTIAL_VERIFIER allowed; minimal queue/case/history metadata; stable keyset pagination;
  self-review denied; first verifier cannot be second verifier; second distinct verifier succeeds;
  closed cases leave the actionable queue; append-only history; no blanket clinical/storage read;
  existing decision row lock preserved.
- `verify-platform-staff-lifecycle.mjs`: PASS — admin-only onboarding; zero implicit authority;
  explicit requested role only; deactivation revokes effective authority; reactivation stays role-free;
  final-admin role and deactivation protections; audit preserved.
- `verify-platform-admin-bootstrap.mjs`: PASS — PUBLIC/anon/authenticated/service_role denied;
  local DB-owner succeeds at zero admins; second bootstrap denied; explicit PLATFORM_ADMIN only;
  no PLATFORM_OWNER or clinical authority; SYSTEM audit present.
- `verify-p1-security-surface.mjs`: PASS — 9 P1 FORCE-RLS tables; service_role no P1 shortcut;
  P1 sequence closed; SECURITY DEFINER search paths pinned; bootstrap remains SECURITY INVOKER;
  no verifier direct-table policy access.
## Existing P1 and cumulative-safe P0 regressions

Existing P1 proofs remain green: health-detail 12-key bound; student-no-clinical;
role-enum separation; canonical staff-role inventory; owner designation not authority;
credential submit/self-denial/four-eyes/needs-info/resubmit; and exact credential + enrollment
capability projection with read-time/staleness checks.

Cumulative-safe P0 proofs remain green: doctor isolation; patient isolation; exact anon surface;
audit no-clinical-payload; custodial-vs-practice authority; relationship-label non-authority;
DD-number non-authority; anon operational controls; public booking representability;
live-edge uniformity; positive-allowlist/no-exclusion authorization; and appointment
slot/DST/capacity/shared-serialization race behavior.

The no-exclusion regression initially rejected a bootstrap guard written as `session_user <> owner`.
The implementation was corrected to a positive DB-owner equality allowlist; the verifier then passed.
No P0 proof was weakened.

## Manifest integrity — 13/13 final LF hashes

| Step | File | SHA-256 |
| --- | --- | --- |
| 0001 | `db/schema/0001_p0_baseline.sql` | `3072d21c2c6500ed89fd339f56edbca8212534a92d1d0fd7ea9eb3f610d38a06` |
| 0002 | `db/functions/0002_p0_core.sql` | `162ddd5ba548c96b2648702b1ae892319113b2bfa60019e2a5507c1ce1bd613f` |
| 0003 | `db/policies/0003_p0_rls.sql` | `295fdc5e97c73d14539103ea5a28b0f3a1c1edbaead30ca58f3980b043c6bd61` |
| 0004 | `db/grants/0004_p0_grants.sql` | `74d2dd8d0ccfe5e93f8846dd9d709041e11702fc00ce334482d7d0b54617cd94` |
| 0005 | `db/storage/0005_p0_buckets.sql` | `6d0a8ac7852a9c4386f8cfc507114f3ee6a76d3c2539a917525599725a3683a3` |
| 0006 | `db/seed/0006_p0_reference.sql` | `1651b77c0677ed1d6182a8494ae2f37025cbb83647a90d81e8dd86be00f3c279` |
| 0007 | `db/p1/0007_p1_identity_schema.sql` | `53ba26d269e1c6622c6910a83fd08e0cbf9e881b9b43932b960dcefa19a9dce8` |
| 0008 | `db/p1/0008_p1_identity_functions.sql` | `429f46d16b06d4b832a6447011834612aa11b0d39151c3d5cadc140a569d77b0` |
| 0009 | `db/p1/0009_p1_identity_rls.sql` | `c8038a3f88ecf23260c24fef57ae1f9bf5810774f6f4f506614b1616ef8f2c77` |
| 0010 | `db/p1/0010_p1_identity_grants.sql` | `fbb6ad084025b21d609007ff2ba7b55450fbcfed0add2adb11f1885f4be8a8fd` |
| 0011 | `db/p1/0011_p1_reference.sql` | `b39eb1a48b0a00cbe25a377c37b878b7f100bf4c8f60a7cd7fcbac2d32cb8d01` |
| 0012 | `db/p1/0012_p1_identity_operational.sql` | `72473c2f900da264f8cf8258225cb1e69672b8be4202984a6873182ce480cef8` |
| 0013 | `db/p1/0013_p1_identity_operational_grants.sql` | `7dc0633e4f841bf5b3b0db89c82a6444fb18135e16697ad6c72d1b6e806ebb45` |

All 13 manifest hashes matched their final files and the six-step P0 prefix remained structurally identical.

## Deterministic local replay

Two independent fresh local Supabase substrates were reset and deployed cumulatively through
all 13 manifest steps. Canonical schema-only dumps compare byte-for-byte:

- replay A: PASS — 13/13 steps
- replay B: PASS — 13/13 steps
- A == B: PASS
- canonical SHA-256: `7484c6803b75c5fddd831c5e93b207f8688a109520c5b7e0c7d8ac8f02e0183c`

Canonicalization was limited to the same accepted PostgreSQL dump guard tokens and Supabase
Realtime rolling partition names/bounds. No Doctor's Diary-owned object was normalized.
## Application and repository gates

Central independently reran the interrupted application quality gates in this exact worktree:

- `npm run lint`: PASS
- `npm run build`: PASS
- `npm run typecheck`: PASS after build-generated route types
- full test suite: PASS — 57 files / 963 tests
- `git diff --check`: PASS
- P0 frozen-product drift: 0
- 0012/0013 hashes independently matched the manifest

## Final safety state

- Protected/shared Supabase contacts: 0
- Production actions: 0
- Remote P1 deployment: NO
- `--linked`: never used
- Service-role bootstrap/shortcut: NO
- Storage expansion: 0
- P0 product drift: 0
- CSU/M1 overlap: 0
- Main merge: NO
- App V2 cutover: NO
- Voice/DGDA: untouched

This checkpoint is ready only for Central review. It does not authorize merge, protected/shared
Supabase work, remote P1 deployment, application cutover, or another MD slice.
