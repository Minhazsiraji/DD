# P0 Sprint 1 Correction Evidence — 2026-09-04

Status: implementation/proof checkpoint evidence for Central review. This file does **not** self-declare Sprint 1 accepted.

## Custody and toolchain
- Branch: `v2/p0-baseline`
- Starting SHA: `267a814736a0953b64d5eb7ae96a1f3b52952a46`
- Starting parent: `b9dfceb65d97ec8a0f649bd54d5bc448c8422de1`
- Architecture: Database V2 Rev 4.3.2f plus accepted C2 anon/booking narrow addenda
- Node: `v24.14.0`
- npm: `11.9.0`
- Supabase CLI: `2.116.0` pinned and runtime-checked
- PostgreSQL: `17.6`
- Execution target: isolated local Supabase only via `DD_V2_LOCAL_DATABASE_URL`

## Safety boundary
- Track B contacts: `0`
- Protected writes: `0`
- P1+ objects added: `0`
- Merge: `NO`
- Production: `NO`
- Generic DB target variables were not used as P0 inputs.
- Local CLI had no project-ref/pooler link before deterministic resets.

## Manifest hash changes
| Step | File | Starting SHA-256 | Final SHA-256 |
|---|---|---|---|
| 0001 | `db/schema/0001_p0_baseline.sql` | `0c095c4678c2aee235b7f7153d1b390ebc0a7aad82e7a2369b38271b10388a74` | `6c30d4d2b727c6c41577088e09510bafe7bcb7a85f3e0df8c616e231fab2a105` |
| 0002 | `db/functions/0002_p0_core.sql` | `9a62873d4febee942d5430fffcae478ce5e5e36a680dd07ebe5730f2126606c6` | `7f03bf084f0130c8b12052f4c3dbf421a55e56f211662f764151754360d09b5c` |
| 0003 | `db/policies/0003_p0_rls.sql` | `2a73cdf2b238b3fc7ef40f905470412cd0f7590bb2d61e659a21b0aba00ba652` | `44eae215ce879305bcc864d81ac11d2ee583d100532a4871df82c88dff2e0395` |
| 0004 | `db/grants/0004_p0_grants.sql` | `cd134dec58c6a802bd2a353529d420fa19edce86ddec05b45e442500f067d176` | `9078f47082e1b9b12ce87cc1a36be4c157a2de91476e574907954a2f9e5dd7c6` |
| 0005 | `db/storage/0005_p0_buckets.sql` | `4e0cd8698aab9e771743aa337de28fe33292c2c9cf4e17a02e3c2c8163cbc47a` | unchanged |
| 0006 | `db/seed/0006_p0_reference.sql` | `52ed860e602f8bbe779ca8d79ae0c0bcc23c821588ee5ac8c438da0d2449990a` | `3e5dcf628806031d03078292cbc46b2b4316ce22e8891c68fb80052da74eaeb6` |

`db/manifest.toml` remained the sole six-step V2 deployment authority. All executable SQL under the manifest deployment directories is covered by the manifest and pinned hashes.

## Determinism / golden
- Fresh replay A canonical bytes: `329932`
- Fresh replay B canonical bytes: `329932`
- Replay A == Replay B: `PASS` byte-for-byte
- Replay A == committed golden: `PASS` after authorized golden refresh
- Golden file bytes on disk: `329933` including final newline
- Golden lines: `10548` by `wc -l`
- Canonical golden SHA-256: `a691fe6747c4998c33328770ff845833c654941cedd85ca3e64027cc8f05ca85`

## P0 object boundary
- Public app-owned P0 tables: `42`
- All 42 have RLS enabled and forced: `PASS`
- Added P0 tables in this correction: `public_booking_contacts`, `anon_rate_limit_policies`, `anon_rate_limit_buckets`
- No P1+ table appeared.
- SECURITY DEFINER functions in public: `28`
- `service_role` effective EXECUTE on DD-owned P0 SECURITY DEFINER functions: `0`

Public table inventory:
`anon_rate_limit_buckets`, `anon_rate_limit_policies`, `appointment_events`, `appointments`, `audit_events`, `clinical_patients`, `consent_events`, `consent_records`, `dd_number_allocations`, `doctor_chamber_hours`, `doctor_chambers`, `encounter_diagnoses`, `encounter_events`, `encounter_investigations`, `encounters`, `health_subject_access`, `health_subject_access_events`, `health_subject_number_aliases`, `health_subject_origins`, `health_subjects`, `healthcare_organizations`, `metric_classification_registry`, `metric_contributions`, `metric_definitions`, `metric_rollups`, `metric_source_refs`, `practice_locations`, `practice_memberships`, `prescription_events`, `prescription_items`, `prescription_templates`, `prescriptions`, `professional_credentials`, `professional_profiles`, `profile_capabilities`, `profiles`, `public_booking_contacts`, `queue_entries`, `queue_token_counters`, `regulator_professions`, `regulators`, `subject_acquisition_events`.

## P0 anonymous surface
Effective anon EXECUTE set is exactly:
1. `create_public_booking(uuid,timestamp with time zone,text,text,text,text)`
2. `public_booking_status(uuid)`
3. `public_chamber_availability(uuid,date,date)`

Anon direct table/view/materialized-view SELECT: `0` by verifier.
PUBLIC unintended EXECUTE: denied by definer-grant verifier.
P5/P7 anon functions are not reachable at P0.

## Anonymous operational controls
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

Canonical enforcement is inside the PostgreSQL SECURITY DEFINER RPC path. A narrow `dd_public_ingress` login establishes trusted transaction-local context; direct/fabricated context attempts are refused. Rate-state keys are keyed digests, not raw network addresses, raw booking refs, or contact PII.

Concurrency proof: `12` parallel trusted status-RPC calls updated all four shared bucket kinds atomically and produced the expected append-only anonymous audit rows.

## Public booking representation and scheduling
- Anonymous PUBLIC_WEB/PUBLIC_APP booking is representable with no clinical patient, health subject, or booked-by profile.
- `public_booking_contacts` is the one-to-one operational-PII companion and is never a clinical-authority predicate.
- No automatic DD number, health subject, clinical patient, or subject link is created by public booking.
- Public booking uses exact chamber context; no fallback/substitution is allowed.
- P0 public visit type: `GENERAL_CONSULTATION`.
- Mode: `IN_PERSON`; duration: `30` minutes; initial status: `SCHEDULED`.
- Capacity: one concurrent appointment per chamber using half-open interval overlap semantics.
- `CANCELLED` and `NO_SHOW` do not consume capacity; other current statuses do.
- Chamber-row serialization prevented public/public, doctor/public, and receptionist/public overbooking races.
- Chamber-hours edits affect prospective availability only and do not rewrite existing appointments.

Return projections were behaviorally asserted as exact:
- availability: `starts_at`, `ends_at`, `remaining_capacity`
- create: `public_booking_ref`
- status: `status`, `scheduled_for`, `location_name`

Phone proof: canonical three-field model (`phone_raw`, `phone_e164`, `phone_country_hint`), explicit +E164 preservation, local-number no-guess behavior, no `phone_normalized` or digits-only canonical alternative.

## Credential / capability authority proof
- CI-1: PASS
- CI-2: PASS
- CI-3: PASS
- VERIFIED credential produces usable DOCTOR authority: PASS
- SUSPENDED, EXPIRED, PENDING, UNVERIFIED, NEEDS_INFORMATION, REJECTED, REVOKED practice writes denied: PASS
- SUSPENDED owned historical read/exportability with zero foreign rows: PASS
- Current practice-authority RPC inventory: `7` RPCs, all denied for non-live credential states.
- Credential-source capability projection set equality: PASS across synthetic P0 credential fixtures.
- Read-time expiry withdrawal: PASS.
- Direct `profile_capabilities` INSERT/UPDATE/DELETE denial: PASS for six P0 application roles.

## SECURITY DEFINER / DD-number proof
- Definer grant verifier: PASS (`28` definers).
- Definer trusted-search-path verifier: PASS (`28` definers).
- `service_role` undeclared definer EXECUTE: `0`.
- `extensions.gen_random_bytes(...)` remains schema-qualified where required.
- DD-number allocator runtime proof generated a valid 10-character DD number and exactly one allocation row inside a rolled-back local transaction.
- No sample identifier is retained in this evidence file.

## Audit proof
Anonymous audit actor contract: `actor_kind='SYSTEM'`, `actor_id=NULL`.
Success, validation failure, not-found, rate-limited, and restricted internal-failure audit paths were proven.
Audit verifier found no generic JSON clinical payload and no raw network/ref/contact/clinical payload in anonymous audit rows.

## Runtime verifier results
- `db:verify:credential-integrity`: PASS
- `db:verify:custodial-vs-practice-authority`: PASS
- `db:verify:definer-grants`: PASS
- `db:verify:definer-search-path-trust`: PASS
- `db:verify:anon-surface`: PASS
- `db:verify:capability-projection`: PASS
- `db:verify:public-booking-representability`: PASS
- `db:verify:anon-operational-controls`: PASS
- `db:verify:audit-no-clinical-payload`: PASS
- `db:verify:phone-canonicalization`: PASS
- `db:verify:appointments-p0`: PASS
- `db:verify:p0`: PASS (`42` forced-RLS tables)
- `db:verify:determinism`: PASS (`A == B == golden`)

## Application quality gates
- `npm run lint`: PASS, zero warnings/errors on final run
- `npm run typecheck`: PASS
- `npm test`: PASS — `57` files, `963` tests
- `npm run build`: PASS — Next.js production build completed and `46/46` static pages generated
- `git diff --check`: PASS

## Evidence hygiene
This artifact intentionally contains no credentials, URLs carrying secrets, raw IP addresses, raw public booking refs, contact PII, clinical payload, or protected Track-B connection information.
The ending commit SHA is intentionally not embedded here because that would make the checkpoint commit self-referential. Central should use the returned/pushed Git SHA as the ending identity.
