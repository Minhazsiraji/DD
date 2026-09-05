# Doctor's Diary — P1 Identity Static Contract + Harness Closure

Date: 2026-09-05
Classification: P1 controlled implementation-preparation / local proof
Branch: `md/p1-identity-static-closure`
Worktree: `/workspaces/DD-md-p1-static`
Base: `11c4ecb8b83e1265a19fc503e225087d1e1c09b9`
Accepted P0 merge base: `5d58f154a8fd18129e28614ccc038f0a6af66b8f`

## Boundary

This checkpoint is local/isolated only. It is not full P1 acceptance, application cutover, production deployment, or authorization to design the credential-review discovery workflow or first-staff bootstrap. Protected/shared Supabase contacts: **0**. Production actions: **NO**.

## Original P1 WIP custody

The original untracked draft in `/workspaces/DD` was inventoried read-only before the isolated worktree was created and was re-hashed after implementation. The bytes remained unchanged.

| File | Bytes | Original SHA-256 |
| --- | ---: | --- |
| `db/manifest-p1.toml` | 1995 | `0952860107e71393228af162844cfae8d4f7a99d804d18b2ebb8238bde776d22` |
| `db/p1/0007_p1_identity_schema.sql` | 8473 | `8450f5dd4b7c84cc3468ba9936c205b5d0837cc517c902a210e8a5884e176e98` |
| `db/p1/0008_p1_identity_functions.sql` | 28841 | `78dc19a28beae9b5744699671e9508a7d9c08a63702d5ccf210bc96c6d77755f` |
| `db/p1/0009_p1_identity_rls.sql` | 3813 | `c8038a3f88ecf23260c24fef57ae1f9bf5810774f6f4f506614b1616ef8f2c77` |
| `db/p1/0010_p1_identity_grants.sql` | 7678 | `f92358342ffd19ceef911b36df718a0d6bdf7396afe0921a57c543cd4c9c0f7a` |
| `db/p1/0011_p1_reference.sql` | 881 | `b39eb1a48b0a00cbe25a377c37b878b7f100bf4c8f60a7cd7fcbac2d32cb8d01` |
| `scripts/deploy-p1.mjs` | 1840 | `17928ffb91d2e0f871ec8a712b5697da8ac16914bb33b9d45823a758f798b0ab` |
| `scripts/p1-run.mjs` | 2536 | `34c54e5caa05fb56b7be4183fa914809449d589fbfe10f8b315b7b484a12c54a` |

Local runtime files `supabase/config.toml`, `supabase/.gitignore`, `supabase/.temp/**`, credentials, and environment files were excluded from product custody and are not committed.

## Static defects corrected

1. The invalid `CHECK ((select count(*) from jsonb_object_keys(detail)) <= 12)` was replaced by deterministic immutable helper `public.p1_jsonb_object_key_count(jsonb)`, preserving the 12-key bound.
2. The P1 health-detail trigger used nonexistent `jsonb_object_length(...)`; it now uses the same bounded helper.
3. The helper's default execute surface is explicitly revoked.
4. P1 creates `credential_review_events_seq_seq` after P0's global sequence revoke; P1 now explicitly revokes all application/public/service-role sequence authority.
5. PostgreSQL 17 ownership transfer to `dd_metrics_reader` initially failed because CREATEROLE-created NOINHERIT memberships have SET false and the new owner lacked CREATE on `public`. Step 0010 now grants SET and schema CREATE only for the transfer, then immediately revokes CREATE and restores SET false.
6. `deploy-p1.mjs` now enforces 11-step IDs/kinds, exact P0 prefix equality, hash verification, and exact P1 SQL on-disk vs manifest inventory.
7. `p1-run.mjs` retains the original cumulative verifier allowlist and adds the new P1 proof scripts; it still obtains its target only through the accepted loopback guard.
8. `verify-live-edge-uniformity.mjs` now uses a whitespace-tolerant regex for the unchanged `verification_status='VERIFIED'` term so formatting changes in the P1 replacement function do not weaken or falsely fail the semantic assertion.

## Final manifest state

All 11 cumulative manifest entries match their final LF bytes. The first six P1-manifest entries are structurally identical to `db/manifest.toml`.

P1 hashes:
- 0007: `53ba26d269e1c6622c6910a83fd08e0cbf9e881b9b43932b960dcefa19a9dce8`
- 0008: `429f46d16b06d4b832a6447011834612aa11b0d39151c3d5cadc140a569d77b0`
- 0009: `c8038a3f88ecf23260c24fef57ae1f9bf5810774f6f4f506614b1616ef8f2c77`
- 0010: `fbb6ad084025b21d609007ff2ba7b55450fbcfed0add2adb11f1885f4be8a8fd`
- 0011: `b39eb1a48b0a00cbe25a377c37b878b7f100bf4c8f60a7cd7fcbac2d32cb8d01`
## P1 proof inventory and runtime results

The proof scripts execute against the isolated local database; runtime assertions are not replaced by SQL-text grep.

- `verify-health-signal-detail-bound.mjs`: PASS — valid object accepted, 12-key boundary accepted, 13-key object rejected, non-object rejected.
- `verify-student-no-clinical.mjs`: PASS — student projection only; clinical read/create/consult/prescribe denied; no professional credential authority.
- `verify-role-enum-separation.mjs`: PASS — platform staff role, practice role, capability, and profession vocabularies remain separated; staff role alone creates no clinical/persona capability.
- `verify-staff-role-inventory.mjs`: PASS — exactly 9 canonical platform roles; revocation/inactive semantics and health-editor/source-steward mutual exclusion enforced.
- `verify-owner-designation-not-authority.mjs`: PASS — owner designation creates zero staff roles, analytics authority, or clinical authority.
- `verify-p1-credential-workflow.mjs`: PASS — submit, self-decision denial, distinct four-eyes verification, verified DOCTOR projection, needs-information/resubmit, append-only review events.
- `verify-p1-security-surface.mjs`: PASS — 9 new P1 tables have RLS + FORCE RLS; no service_role P1 table/function shortcut; new sequence closed; SECURITY DEFINER search paths trusted; internal functions hidden.
- `verify-capability-projection.mjs`: PASS — 10 credential fixtures + 6 student fixtures; exact credential/enrollment set equality; student staleness; credential read-time expiry; 6 application roles x 3 direct projection writes denied.

Existing proof classification:
- `verify-capability-projection.mjs`: **needed extension**; extended without removing its P0 credential assertions.
- `verify-doctor-claim.mjs`: **legacy/P0-only and insufficient for P1 identity verification**; it exercises `doctor_profile_claims`/legacy owner approval, not P1 `professional_credentials` + `platform_staff`.
- `verify-owner-authority.mjs`: **legacy/P0-only and insufficient for P1 staff authority**; it requires generic `DIRECT_URL`/`DATABASE_URL`, so it was not forced through the P1 lane in violation of target safety. P1 owner authority is proven by the new owner-designation verifier.
- `verify-p0.mjs`, `verify-definer-grants.mjs`, and `verify-control-plane-isolation.mjs` contain exact P0-only cardinality/grant inventories and therefore intentionally flag additive P1 objects/grants; they are classified as non-cumulative rather than treated as P1 regressions.

## Local deployment and determinism

Local target: unlinked Supabase CLI 2.116.0, Postgres 17, loopback `127.0.0.1:54322`. For stability, optional Supabase service containers were excluded; the real Supabase Postgres substrate still initialized `auth` and `storage`. Predeploy public-table count was 0.

Fresh replay A: P0 steps 0001-0006 + P1 steps 0007-0011 all applied successfully.
Fresh replay B: independently reset and all 11 steps applied successfully.

Canonical schema dump comparison used the accepted P0 normalization only: PostgreSQL 17 guard tokens and Supabase Realtime rolling partition names/bounds. No DD-owned object was canonicalized.

`A == B`: **PASS byte-for-byte**
Canonical SHA-256: `c6567f50e36c7d09f64f2d755379a2fee0a82d0e3e9c07c98205073518350a26`
## Cumulative P0 regression on P1 database

Cumulative-safe P0 proofs passed after P1 deployment:

- `verify-doctor-isolation.mjs`
- `verify-patients.mjs`
- `verify-anon-surface.mjs` — 52 relations, 10 sequences, 100 functions; anon EXECUTE exact=3.
- `verify-audit-no-clinical-payload.mjs`
- `verify-custodial-vs-practice-authority.mjs` — historical export preserved; 16 practice-authority RPC inventory; seven non-live credential states denied.
- `verify-relationship-label-not-authority.mjs`
- `verify-dd-number-not-authority.mjs`
- `verify-anon-operational-controls.mjs`
- `verify-public-booking-representability.mjs`
- `verify-live-edge-uniformity.mjs`
- `verify-no-exclusion-predicates.mjs` — 48 policies + 100 functions use positive allowlists for sensitive authority dimensions.
- `verify-appointments-p0.mjs` — slot/DST/capacity/hours/serialization-race matrix passed.
- Expanded `verify-capability-projection.mjs` preserved the P0 credential matrix while adding P1 enrollment projection.

P0 product files remain byte-for-byte unchanged: `db/schema/`, `db/functions/`, `db/policies/`, `db/grants/`, `db/storage/`, `db/seed/`, `db/manifest.toml`, and `db/golden-p0.sql` have zero diff.

## Application/repository gates

- Node: 24.14.0
- npm: 11.9.0
- Supabase CLI: 2.116.0
- `npm run lint`: PASS
- `npm run typecheck`: PASS
- `npm test -- --run`: PASS — 57 files / 963 tests
- `npm run build`: PASS — Next.js 16.3.0; 46/46 static pages generated
- `git diff --check`: PASS on the final staged delta
- P1/modified verifier `node --check`: PASS

## Unresolved architecture decisions — intentionally not invented

1. **Credential-verifier discovery/read workflow**: P1 can submit/respond/decide a known credential key and enforces self-decision/four-eyes rules, but no authorized contract exists yet for the human pending-review queue, reviewer assignment, discovery RPC, or reviewer read workflow.
2. **Initial platform-staff bootstrap**: P1 defines `platform_staff`, explicit roles, and PLATFORM_ADMIN-mediated role grant/revoke, but no authorized mechanism exists to create/bootstrap the first real platform administrator/staff authority. No seed, hidden PLATFORM_OWNER bypass, or privileged real user was invented.

These two decisions remain blockers to **full P1 acceptance**, but they do not block this static/harness/local-proof checkpoint.

## Safety and lane status

- Protected/shared project contacts: **0**
- `--linked`: never used
- Generic production DB fallback: not used
- Production deployment/write: **NO**
- Main merge: **NO**
- Application V2 cutover: **NO**
- Voice/DGDA work: **NO**
- CSU application/UI files modified by MD: **NO**
## Exact checkpoint file delta

- `db/manifest-p1.toml`
- `db/p1/0007_p1_identity_schema.sql`
- `db/p1/0008_p1_identity_functions.sql`
- `db/p1/0009_p1_identity_rls.sql`
- `db/p1/0010_p1_identity_grants.sql`
- `db/p1/0011_p1_reference.sql`
- `scripts/deploy-p1.mjs`
- `scripts/p1-proof-lib.mjs`
- `scripts/p1-run.mjs`
- `scripts/verify-capability-projection.mjs`
- `scripts/verify-health-signal-detail-bound.mjs`
- `scripts/verify-live-edge-uniformity.mjs`
- `scripts/verify-owner-designation-not-authority.mjs`
- `scripts/verify-p1-credential-workflow.mjs`
- `scripts/verify-p1-security-surface.mjs`
- `scripts/verify-role-enum-separation.mjs`
- `scripts/verify-staff-role-inventory.mjs`
- `scripts/verify-student-no-clinical.mjs`
- `docs/evidence/p1/identity-static-closure-2026-09-05.md`

## CSU overlap check

Final CSU branch: `ui/m1-doctor-home-patient-consultation` at `cb16ae7bfdf18a7ccd1b2de96b9fd4bc61cbf1b8`. Its changes remain in application/UI/patient/appointment/encounter/queue scope; zero CSU changes overlap `db/**`, P1 harness scripts, or P1 evidence. MD changed no CSU application/UI file.
