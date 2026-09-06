# PERF-01 — M1 Region Alignment Root-Cause Closure

Date: 2026-09-06
Lane: MD / controlled Preview-only performance investigation
Base: `0e582efd8010485488a58f8e69d298c9538c43bb`
Branch: `md/m1-perf-root-cause`

## Control checkpoints

- Gate A diagnostic checkpoint: `11c9fdf863d637bb3aaa81bd88fd8a8df00c35a9`
- Gate B Seoul experiment checkpoint: `4784d33408c9e1553b2f922e8688d6c1c3b8d197`
- Gate B Preview: `https://dd-gei2gwy9a-minhazs-projects-d28f7aed.vercel.app`
- Region experiment config: one Vercel Function region, `icn1` only.
- DD Supabase region: `ap-northeast-2` / Seoul.

PERF-01 was evidence-driven. No SQL, schema, index, service-role, auth/MFA, clinical-cache, M2, Voice, DGDA, or production change was authorized or made.

## Gate A — confirmed mismatch

Three authenticated warm Preview diagnostic samples all reported `VERCEL_REGION=iad1`.
The accepted diagnostic preserved `auth.getUser()`, MFA AAL enforcement, explicit caller membership filtering, doctor scope, and normal RLS-scoped application reads.
### Gate A timings — `iad1`

| Stage | Run 1 | Run 2 | Run 3 |
| --- | ---: | ---: | ---: |
| verified_user | 238 ms | 236 ms | 224 ms |
| mfa_aal | 1 ms | 2 ms | 2 ms |
| memberships | 247 ms | 636 ms | 231 ms |
| doctor_scope | 249 ms | 267 ms | 228 ms |
| patient_count | 250 ms | 269 ms | 237 ms |
| recent_patients | 677 ms | 684 ms | 640 ms |
| day_counts | 240 ms | 586 ms | 629 ms |
| get_queue | 245 ms | 663 ms | 619 ms |
| total_server | 2148 ms | 3344 ms | 2811 ms |

Average `total_server`: approximately 2768 ms.

The mismatch was therefore proven rather than assumed: Vercel Functions executed in `iad1` while the DD data plane was in Seoul.

## Gate B — Seoul alignment

Central authorized a Preview-only experiment with:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "regions": ["icn1"]
}
```
All three authenticated aligned diagnostic runs reported `VERCEL_REGION=icn1`.

### Gate B timings — `icn1`

| Stage | Run 1 | Run 2 | Run 3 |
| --- | ---: | ---: | ---: |
| verified_user | 86 ms | 55 ms | 41 ms |
| memberships | 33 ms | 36 ms | 33 ms |
| doctor_scope | 28 ms | 49 ms | 33 ms |
| patient_count | 45 ms | 45 ms | 40 ms |
| recent_patients | 50 ms | 52 ms | 34 ms |
| day_counts | 37 ms | 31 ms | 23 ms |
| get_queue | 45 ms | 37 ms | 45 ms |
| total_server | 327 ms | 307 ms | 250 ms |

Average `total_server`: approximately 295 ms.
Relative improvement versus Gate A average: approximately 89% faster.

`get_queue()` fell to 37–45 ms. This is far below the Central database-escalation threshold of 2.5–3 seconds, so PERF-01 does not justify SQL/index/schema work.

## Root-cause verdict

PERF-01 root cause is confirmed primarily as geographic Vercel-to-Supabase latency amplification. The accepted deployment direction is:

- Vercel Functions: `icn1` / Seoul
- Supabase: `ap-northeast-2` / Seoul

DD should not return to the prior `iad1` runtime direction without a new architecture decision.
## Real-browser M1 UAT after alignment

User-observed warm Preview behavior after Seoul alignment:

- Dashboard usable: approximately 1.5 s
- Chamber/context change: approximately 2–2.5 s
- Work Now perceived completion: approximately 3–4 s maximum

Central classified PERF-01 as closed for the M1 freeze gate. The remaining Work Now perceived latency is recorded separately as:

`PERF-02 — Work Now perceived completion latency`

Status: non-blocking pre-launch hardening. Target remains approximately <=2–2.5 s where practical, but no further optimization is authorized in this slice.

## Repository quality evidence

Before Gate B deployment the experiment passed:

- Vercel region config validation: exactly `["icn1"]`
- lint: PASS
- production build: PASS
- typecheck: PASS
- diagnostic contract: 5/5 PASS
- `git diff --check`: PASS

The Gate A diagnostic checkpoint had also passed the full repository suite: 61 files / 1,038 tests.
## Safety / closure state

- Production deployment: 0
- Merge to main: 0
- SQL/schema/index changes: 0
- Protected/shared Supabase contact: 0
- service_role use: 0
- Auth or MFA weakening: 0
- Global/cross-user clinical cache: 0
- CSU/M1 feature modification: 0
- P1 cutover: 0
- M2: closed
- Voice/DGDA: untouched

The temporary `/dev/perf/m1` diagnostic remains isolated on the MD performance branch for evidence preservation and is NOT authorized for merge into the product line.
The product-facing region direction is the single-region `icn1` configuration only; Central/CSU controls how that config is carried into the active M1 line.

## Controller state

- PERF-01: CLOSED as M1 freeze blocker
- PERF-02: non-blocking pre-launch hardening
- M1 user UAT: active under Central/CSU
- MD performance branch: HOLD

No further MD optimization, diagnostic merge, database proposal, or deployment action is authorized without a new Central gate.
