# Doctor's Diary Database V2 — Sprint 1 Central Review Handoff

Date: 2026-09-05
Lane: Loop A implementation writer → Central Controller review
Architecture authority: Database V2 Rev 4.3.2f + accepted narrow C2 anon/booking addenda

This is a **review handoff**, not a self-acceptance declaration. Central Controller remains the authority for Sprint-1 acceptance and any later gate.

## Repository-state reconciliation

- Authorized Sprint-1 starting SHA: `267a814736a0953b64d5eb7ae96a1f3b52952a46`
- Starting parent: `b9dfceb65d97ec8a0f649bd54d5bc448c8422de1`
- Sprint-1 correction checkpoint: `a2b3a37a52536db38ee3aebce89a1fa6a84465c3`
- Correction parent: exactly `267a814736a0953b64d5eb7ae96a1f3b52952a46`
- Current pushed `origin/v2/p0-baseline`: `1b4d943214d52c46180a48ff595d342cd55d3251`
- Current pushed head parent: exactly `a2b3a37a52536db38ee3aebce89a1fa6a84465c3`

Therefore the pushed ancestry is linear for this checkpoint: `267a814 → a2b3a37 → 1b4d943`. No force-push or history rewrite is required or authorized.

## 1. Starting SHA

`267a814736a0953b64d5eb7ae96a1f3b52952a46`

## 2. Ending SHA

Sprint-1 correction checkpoint: `a2b3a37a52536db38ee3aebce89a1fa6a84465c3`.
The repository later advanced to `1b4d943214d52c46180a48ff595d342cd55d3251`; this handoff does not use that later commit to retroactively self-accept Sprint 1.

## 3. Parent / commit-chain proof

- `a2b3a37^ = 267a814`
- `1b4d943^ = a2b3a37`
- `origin/v2/p0-baseline` contains `a2b3a37`.

## 4. Complete Sprint-1 changed-file set

- `db/functions/0002_p0_core.sql`
- `db/golden-p0.sql`
- `db/grants/0004_p0_grants.sql`
- `db/manifest.toml`
- `db/policies/0003_p0_rls.sql`
- `db/schema/0001_p0_baseline.sql`
- `db/seed/0006_p0_reference.sql`
- `docs/evidence/p0/sprint-1-correction-2026-09-04.md`
- `package.json`
- `scripts/p0-b2-lib.mjs`
- `scripts/p0-run.mjs`
- `scripts/verify-anon-operational-controls.mjs`
- `scripts/verify-anon-surface.mjs`
- `scripts/verify-appointments-p0.mjs`
- `scripts/verify-audit-no-clinical-payload.mjs`
- `scripts/verify-capability-projection.mjs`
- `scripts/verify-custodial-vs-practice-authority.mjs`
- `scripts/verify-definer-grants.mjs`
- `scripts/verify-definer-search-path-trust.mjs`
- `scripts/verify-phone-canonicalization.mjs`
- `scripts/verify-public-booking-representability.mjs`

## 5. Implementation corrections

Sprint 1 hardened SECURITY DEFINER trust, extension qualification, credential-derived capability, custodial-read versus live-practice authority, public booking representation, trusted anonymous ingress, database-authoritative rate limiting, bounded anonymous audit, and the final P0 scheduling/serialization contract.

Independent continuation on 2026-09-05 also rediscovered and runtime-proved the E.164 constraint correction: literal `+` matching uses `^[+][1-9][0-9]{1,14}$`, preserving valid explicit E.164 while refusing pseudo-canonical local guessing.

## 6. SECURITY DEFINER / service_role result

Sprint checkpoint proof:
- SECURITY DEFINER grant audit: PASS.
- Trusted search-path audit: PASS.
- `service_role` effective EXECUTE on DD-owned P0 SECURITY DEFINER functions: `0`.
- No service-role shortcut was introduced for public ingress.

## 7. pgcrypto result

Unsafe/unqualified cryptographic resolution was removed where required; trusted extension references are schema-qualified and `pg_temp` remains last in trusted definer search paths.

## 8. Credential matrix

VERIFIED credential yields usable DOCTOR authority. SUSPENDED, EXPIRED, PENDING, UNVERIFIED, NEEDS_INFORMATION, REJECTED and REVOKED states do not retain practice-write authority.
## 9. CI-1 / CI-2 / CI-3

- CI-1: PASS
- CI-2: PASS
- CI-3: PASS
- Direct `profile_capabilities` INSERT/UPDATE/DELETE denial for P0 application roles: PASS.
- Read-time expiry withdrawal: PASS.

## 10. Custodial / practice / export proof

- Suspended doctor retains permitted owned historical read/export surfaces.
- Foreign-doctor rows remain excluded.
- New practice mutations and finalization require live DOCTOR authority.
- The Sprint checkpoint inventory covered the current practice-authority mutation paths and denied all tested non-live credential states.

## 11. Sprint-1 / C2 verifier results

Previously recorded Gates 1–8: PASS. The 2026-09-05 continuation independently completed:
- Gate 9 `verify-audit-no-clinical-payload`: PASS.
- Gate 10 `verify-phone-canonicalization`: PASS after the narrow E.164 product-constraint correction.
- Gate 11 `verify-appointments-p0`: PASS.

Gate 11 covered source shape, exact 30-minute anchored slots, 31-local-date limit, past-slot omission, DST invalid-candidate omission, capacity/overlap boundaries, status capacity matrix, prospective hours, writer inventory and public/public + doctor/public + receptionist/public serialization races.

## 12. Determinism

Fresh local Track-A replay proved `Replay A == Replay B` byte-for-byte. Golden drift was then classified before refresh; Supabase Realtime rolling date partitions were canonicalized as platform-substrate noise while DD-owned objects remained byte-sensitive.
After explained refresh, final Sprint replay proved `A == B == golden`.

Sprint correction golden:
- disk SHA-256: `a691fe6747c4998c33328770ff845833c654941cedd85ca3e64027cc8f05ca85`
- canonical replay SHA-256 after permitted normalization: `51d47060eb2e44c77291ff3bfe112511c29464dfd18a16a14aa0120fa5947e7e`

The later pushed P0 head contains a broader golden (`ddccd1ae...`); that later state is not substituted for the Sprint checkpoint proof in this review handoff.

## 13. Final `db:verify:p0`

Sprint checkpoint final rerun: PASS with `42` public app-owned tables, `42/42` RLS + FORCE RLS.

The later pushed P0 head reports `43/43`; this is later repository state and is explicitly separated from Sprint-1 review evidence.

## 14. Lint / typecheck / tests / build

Final coherent Sprint-state run:
- focused P0 tests: `79/79` PASS.
- `npm run lint`: PASS.
- `npm run typecheck`: PASS after generating Next.js route types in the isolated worktree; no source correction required.
- `npm test`: PASS — `57` files / `963` tests.
- `npm run build`: PASS — Next.js 16.3.0 production build, `46/46` static pages generated.

The initial build interruption was caused only by a cross-worktree `node_modules` symlink rejected by Turbopack; installing dependencies normally inside the isolated worktree resolved it without source changes.

## 15. Manifest old → new hashes

| Step | File | Starting SHA-256 | Sprint-1 SHA-256 |
|---|---|---|---|
| 0001 | `db/schema/0001_p0_baseline.sql` | `0c095c4678c2aee235b7f7153d1b390ebc0a7aad82e7a2369b38271b10388a74` | `6c30d4d2b727c6c41577088e09510bafe7bcb7a85f3e0df8c616e231fab2a105` |
| 0002 | `db/functions/0002_p0_core.sql` | `9a62873d4febee942d5430fffcae478ce5e5e36a680dd07ebe5730f2126606c6` | `7f03bf084f0130c8b12052f4c3dbf421a55e56f211662f764151754360d09b5c` |
| 0003 | `db/policies/0003_p0_rls.sql` | `2a73cdf2b238b3fc7ef40f905470412cd0f7590bb2d61e659a21b0aba00ba652` | `44eae215ce879305bcc864d81ac11d2ee583d100532a4871df82c88dff2e0395` |
| 0004 | `db/grants/0004_p0_grants.sql` | `cd134dec58c6a802bd2a353529d420fa19edce86ddec05b45e442500f067d176` | `9078f47082e1b9b12ce87cc1a36be4c157a2de91476e574907954a2f9e5dd7c6` |
| 0005 | `db/storage/0005_p0_buckets.sql` | `4e0cd8698aab9e771743aa337de28fe33292c2c9cf4e17a02e3c2c8163cbc47a` | unchanged |
| 0006 | `db/seed/0006_p0_reference.sql` | `52ed860e602f8bbe779ca8d79ae0c0bcc23c821588ee5ac8c438da0d2449990a` | `3e5dcf628806031d03078292cbc46b2b4316ce22e8891c68fb80052da74eaeb6` |

`db/manifest.toml` remained the sole six-step deployment authority.

## 16. Golden SHA + explained drift

Authorized Sprint drift includes the booking-contact model, rate-limit structures, bounded anonymous audit fields/constraints, trusted-ingress functions, scheduling/locking behavior, RLS/policy/grant changes, and reference-policy seed additions.

No unexplained DD-owned golden drift was accepted. Realtime rolling partition date names/bounds are platform-generated substrate noise and are narrowly canonicalized by the determinism harness.

## 17. Git status / repository hygiene

The clean `origin/v2/p0-baseline` worktree used to prepare this handoff had no unstaged changes before this documentation file was added.

The following remain absent from the committed P0 handoff tree:
- `supabase/.gitignore`
- `supabase/config.toml`
- `db/manifest-p1.toml`
- `scripts/deploy-p1.mjs`
- `scripts/p1-run.mjs`
## 18. Explicit security boundary declarations

For this Loop-A completion/re-verification activity:
- Track-B database contacts: `0`.
- Protected/shared reset: `0`.
- Protected/shared migration/cutover: `0`.
- Service-role shortcut: `0`.
- P1+/Voice/DGDA implementation: `0`.
- New merge action by this lane: `0`.
- Production deployment by this lane: `0`.
- Force-push/history rewrite: `0`.

Repository history already contains later commits beyond the Sprint checkpoint. Their existence is reported for custody; this document does not convert them into Central authorization for any protected operation.

# Anonymous Booking / C2 Appendix

## A. Exact anonymous surface

Effective anonymous execution at the Sprint checkpoint is exactly:
1. `public.public_chamber_availability(uuid,date,date)`
2. `public.create_public_booking(uuid,timestamptz,text,text,text,text)`
3. `public.public_booking_status(uuid)`

Anonymous direct SELECT on application tables/views/materialized views: `0`.

## B. Trusted ingress

The narrow login role `dd_public_ingress` establishes canonical transaction-local ingress context through `public.set_public_ingress_context(...)`. The verifier uses local `supabase_admin` only to establish the exact session authorization for proof; it does not create a service-role application shortcut.
## C. Rate-limit policy

Policy version: `P0-2026-09-04-V1`.

| RPC | Bucket | Window | Max |
|---|---|---:|---:|
| CREATE_PUBLIC_BOOKING | SESSION_GLOBAL | 60s | 6 |
| CREATE_PUBLIC_BOOKING | NETWORK_GLOBAL | 60s | 24 |
| CREATE_PUBLIC_BOOKING | SESSION_RESOURCE | 60s | 3 |
| CREATE_PUBLIC_BOOKING | NETWORK_RESOURCE | 60s | 12 |
| PUBLIC_BOOKING_STATUS | SESSION_GLOBAL | 60s | 30 |
| PUBLIC_BOOKING_STATUS | NETWORK_GLOBAL | 60s | 120 |
| PUBLIC_BOOKING_STATUS | SESSION_RESOURCE | 60s | 15 |
| PUBLIC_BOOKING_STATUS | NETWORK_RESOURCE | 60s | 60 |
| PUBLIC_CHAMBER_AVAILABILITY | SESSION_GLOBAL | 60s | 60 |
| PUBLIC_CHAMBER_AVAILABILITY | NETWORK_GLOBAL | 60s | 240 |
| PUBLIC_CHAMBER_AVAILABILITY | SESSION_RESOURCE | 60s | 30 |
| PUBLIC_CHAMBER_AVAILABILITY | NETWORK_RESOURCE | 60s | 120 |

Rate state stores keyed digests rather than raw network addresses, raw booking references, or contact PII. Gate 8 previously proved atomic shared-bucket behavior, rotation resistance, trusted-ingress refusal, outcome auditing, and exact safe return shapes.

## D. Booking representation

- `appointments` remains canonical.
- `public_booking_contacts` is the one-to-one operational contact companion.
- Genuine anonymous booking initially has no fabricated profile, clinical patient, health subject, subject link, or DD number.
- `booked_by_profile_id`, `clinical_patient_id`, and `health_subject_id` may be NULL for genuine public booking.
- Doctor, chamber, practice location and session are server-derived from the exact chamber context.
- Public visit type is `GENERAL_CONSULTATION`.
- Mode is `IN_PERSON`.
- Duration is `30` minutes.
- Initial status is `SCHEDULED`.
- Source is `PUBLIC_WEB` or `PUBLIC_APP`.
- Later patient association is explicit and controlled.

## E. Scheduling / capacity

- Slots are exact 30-minute intervals anchored to chamber-hours start.
- Capacity is one concurrent appointment per chamber.
- Overlap semantics are half-open `[A,B)`.
- `CANCELLED` and `NO_SHOW` do not consume capacity; the other current statuses do.
- Past slots are omitted.
- Availability is capped at 31 consecutive local dates.
- Location timezone is authoritative; no hard-coded Asia/Dhaka assumption is required by the contract.
- Invalid/nonexistent DST local candidates are omitted.
- Chamber-row serialization produced exactly one winner in public/public, doctor/public and receptionist/public race proofs.
- Chamber-hours edits are prospective and do not rewrite existing appointments.

## F. Phone contract

Canonical fields are exactly `phone_raw`, `phone_e164`, and `phone_country_hint`. `phone_normalized` is forbidden. Explicit valid E.164 is preserved; unresolved local numbers remain raw with `phone_e164 = NULL` rather than being guessed.

## G. Audit contract

Anonymous audit uses `actor_kind='SYSTEM'`, `actor_id=NULL`. Audit storage has no generic clinical JSON payload and anonymous rows do not retain raw IP, user agent, raw booking reference, contact PII or clinical free text.
Required anonymous audit outcomes include `SUCCESS`, `VALIDATION_FAILURE`, `NOT_FOUND`, `RATE_LIMITED`, and restricted `INTERNAL_FAILURE`. Audit rows remain append-only.

## H. Exact public return projections

- availability → `starts_at`, `ends_at`, `remaining_capacity`
- create booking → `public_booking_ref`
- booking status → `status`, `scheduled_for`, `location_name`

# Central decision requested

Loop A stops here and requests independent Central Controller review of Sprint 1.

Central may return only the governance verdict appropriate to the evidence:
- ✅ Sprint 1 accepted
- 🟡 corrections still required
- 🔴 checkpoint rejected

This handoff does **not** authorize protected/shared reset or migration, merge, production deployment, P1+, Voice, or DGDA work.
