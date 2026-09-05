# Doctor's Diary Database V2 — P0 Acceptance Evidence

Date: 2026-09-05
Lane: isolated Track A (`v2/p0-baseline`)
Architecture authority: Database V2 Rev 4.3.2f (fingerprint pinned by `db/manifest.toml`)
Starting checkpoint: `a2b3a37a52536db38ee3aebce89a1fa6a84465c3`

This evidence records the final local P0 implementation/proof state. The commit containing this file is intentionally not embedded here because a commit cannot truthfully contain its own SHA. Central verifies the pushed checkpoint SHA independently after commit.

## 1. Isolation and toolchain

- Node.js: `v24.14.0`
- npm: `11.9.0`
- Supabase CLI: `2.116.0` exact/pinned
- Local PostgreSQL: `17.6`
- P0 database target: Codespace-local Supabase only (`127.0.0.1`)
- No Track B connection was used.
- No protected/shared reset, migration, cutover, merge, production deployment, P1+, Voice, or DGDA operation occurred.

## 2. Canonical six-step manifest

1. schema `3072d21c2c6500ed89fd339f56edbca8212534a92d1d0fd7ea9eb3f610d38a06`
2. functions `162ddd5ba548c96b2648702b1ae892319113b2bfa60019e2a5507c1ce1bd613f`
3. policies `295fdc5e97c73d14539103ea5a28b0f3a1c1edbaead30ca58f3980b043c6bd61`
4. grants `74d2dd8d0ccfe5e93f8846dd9d709041e11702fc00ce334482d7d0b54617cd94`
5. storage `6d0a8ac7852a9c4386f8cfc507114f3ee6a76d3c2539a917525599725a3683a3`
6. seed `1651b77c0677ed1d6182a8494ae2f37025cbb83647a90d81e8dd86be00f3c279`

All six hashes are pinned and manifest order is exactly schema → functions → policies → grants → storage → seed.

## 3. Runtime database boundary

- Public P0 tables: **43**
- Public P0 tables with both RLS and FORCE RLS: **43/43**
- Public functions: **80**
- SECURITY DEFINER functions: **66**
- Effective `service_role` EXECUTE on DD-owned P0 SECURITY DEFINER functions: **0**
- Anonymous EXECUTE surface: exactly **3** functions:
  - `create_public_booking(uuid, timestamptz, text, text, text, text)`
  - `public_booking_status(uuid)`
  - `public_chamber_availability(uuid, date, date)`
- P0 private storage buckets: exactly `doctor-profile-photos`, `doctor-signatures`, `prescription-assets`.
- Later-phase storage buckets are absent from the P0 physical deployment.

`verify-p0` final result: **PASS — P0 static manifest/DD-CHK-31 + 43-table FORCE-RLS boundary**.

## 4. Set-A regression proof — 21/21 PASS

`security`, `patients`, `doctor-isolation`, `templates`, `appointments`, `queue`, `encounters`, `prescriptions`, `signature-freeze`, `handover`, `api-auth`, `correction`, `doctor-identity`, `encounter-close`, `history`, `rx-immutability`, `rx-v4`, `professional-profile`, `qa-provenance`, `qa-cleanup`, `migrations`.
## 5. B1 extensions — 2/2 PASS

- `verify-doctor-isolation`: V2 runtime adversarial doctor/colleague isolation proof PASS.
- `verify-rx-immutability`: finalized prescription and item immutability proof PASS.

## 6. P0 Set-B2 — 18/18 PASS

1. credential-integrity — CI-1/CI-2/CI-3 + capability write denial
2. custodial-vs-practice-authority — historical export preserved; 16 practice-authority RPC inventory; 7 non-live credential states denied
3. definer-grants — exact ACL contract across 66 definers
4. anon-surface — 43 relations / 9 sequences / 80 functions checked; anon EXECUTE exact=3
5. no-hardcoded-jurisdiction — empty exception list
6. deployment-determinism — two fresh substrates, A == B == golden
7. dd-number-immutable — application roles denied; RETIRED cannot return LIVE
8. dd-number-not-authority — zero DD-number authorization/resolver paths
9. control-plane-isolation — analytics/rollup boundary and opaque source UUID
10. rollup-consistency — all 11 metric semantics, exactly-once, SUM(delta), rebuild idempotence, rollback atomicity
11. storage-paths — owned positive path, server-only frozen write, no overwrite/delete, row-resolved reads
12. phone-canonicalization — canonical three-field model, explicit E.164 only, no country guessing
13. definer-search-path-trust — all 66 definers explicitly trusted
14. no-exclusion-predicates — 35 policies + 80 functions checked
15. audit-no-clinical-payload — bounded audit writers and no clinical/raw network/contact payload
16. relationship-label-not-authority — display metadata only
17. live-edge-uniformity — edge policies, credential authority and read-time validity agree
18. capability-projection — exact credential-derived projection, read-time expiry, role write denial
## 7. C2 auxiliary P0 proofs — PASS

- public booking representability: PUBLIC_WEB/PUBLIC_APP representation, exact operational-PII companion, no automatic identity creation, explicit patient resolution
- anonymous operational controls: durable rate policy/buckets, concurrency, rotation resistance, trusted-ingress refusal, audit outcome matrix, exact safe return shapes
- appointments P0: 30-minute anchored slots, DST handling, capacity/status matrix, prospective hours, and shared serialization
- races: public vs public, doctor vs public, receptionist vs public all PASS

## 8. Deployment determinism / golden

The manifest was replayed onto two separate fresh local Supabase substrates with V1 migrations disabled and no seed replay outside the manifest.

- replay A canonical bytes: **402,499**
- replay B canonical bytes: **402,499**
- replay A == replay B: **PASS byte-for-byte**
- replay A == canonical golden: **PASS byte-for-byte**
- `db/golden-p0.sql` disk bytes: **402,500** including final newline
- canonical golden SHA-256: `ddccd1ae741d7af58b053c301e4703d0f28d2f67ad7585c51e67f71b66ff9b42`

Canonicalization is restricted to PostgreSQL dump guard tokens and Supabase Realtime's rolling date-named platform partitions. DD-owned objects remain byte-sensitive.

## 9. Final application quality gates

Final sequential run on 2026-09-05:

- `npm run lint`: **PASS**, zero reported errors/warnings
- `npm run typecheck`: **PASS**
- `npm test`: **PASS — 57 files / 963 tests**
- `npm run build`: **PASS — Next.js 16.3.0 production build; 46/46 static page generation**
## 10. Final gate interpretation

The following distinctions remain explicit:

- Architecture accepted: yes, Rev 4.3.2f + accepted C2 addenda.
- Isolated P0 implementation authorized: yes.
- P0 implementation proof: **PASS**.
- P0 backup/restore on protected/shared environment: **not performed / not authorized here**.
- Protected reset/migration/cutover: **not authorized**.
- Merge to protected branch: **not authorized**.
- Production deployment: **not authorized**.
- P1+ implementation: outside this P0 checkpoint.

Therefore this evidence supports the Central gate:

> **P0 IMPLEMENTATION & PROOF ACCEPTED**

It does not authorize protected/shared reset, migration, merge, production, Voice, DGDA, or any later-phase implementation by itself.
