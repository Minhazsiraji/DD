# Repository Health Baseline

Owner lane: **CAE** (Claude Auxiliary Engineering). Produced by **CAE-01**.
Base SHA: `9ec7127611dd5576f9591cbd210be8075b8626ee`
Pinned repository `main`: `5d58f154a8fd18129e28614ccc038f0a6af66b8f` (verified equal at time of writing).

This document is an engineering reference. It contains **no secrets and no
clinical data**. It does not carry governance authority — CENTRAL does.

---

## 1. How to read repository health without redoing the work

Run the offline tool (Node is not on PATH — see `CLAUDE.md`):

```
$env:PATH = "E:\Minhaz Siraji\Claude\tools\node-v22.16.0-win-x64;$env:PATH"
node tools/repo-health/repo-health.mjs           # full report
node tools/repo-health/repo-health.mjs --json    # machine-readable
node tools/repo-health/repo-health.mjs --strict  # exit 2 on frozen drift / main mismatch
node tools/repo-health/repo-health.mjs --audit   # also summarise `npm audit --omit=dev`
```

The tool is read-only, dependency-free, makes no provider calls, and reads no
secret values. Pinned hashes/SHAs live in
[`tools/repo-health/frozen-manifest.json`](../../tools/repo-health/frozen-manifest.json).

### Architecture

```
tools/repo-health/
  repo-health.mjs        one Node stdlib script; sections = git, toolchain,
                         frozen artifacts, critical paths, tests, workflows,
                         CI risk rollups, config risks, optional npm audit
  frozen-manifest.json   pinned blob hashes + expected main SHA + path lists
  README.md              usage
docs/engineering/
  repository-health-baseline.md      this file
  frozen-integrity-manifest.md       human-readable frozen list + verify steps
```

### Safe commands (offline / read-only)

| Command                                              | What it proves                                  |
| --------------------------------------------------- | ---------------------------------------------- |
| `node tools/repo-health/repo-health.mjs`            | whole-repo health snapshot                      |
| `node tools/repo-health/repo-health.mjs --strict`   | frozen blobs intact, `main` on pinned SHA       |
| `git hash-object <path>`                            | one frozen blob                                 |
| `git diff --check`                                  | no whitespace/conflict-marker corruption        |
| `git rev-parse origin/main`                         | current `main` (fetch first)                    |
| `npm run typecheck` / `npm run lint` / `npm run build` | standing quality gates (need portable Node)  |
| `npm test` (`vitest run`)                           | full offline test suite                         |

### Commands that are **not** offline — do not wire into automation without CENTRAL

`npm run db:*`, `npm run qa:*`, `npm run db:gate`, `scripts/p0-run.mjs …`,
`scripts/verify-*.mjs` — these need a live database URL. `npm audit` reaches the
npm registry. Anything gated on `OPENAI_API_KEY` / `DEEPGRAM_API_KEY` /
`PA1_SYNTHETIC_AI_EVAL=enabled` reaches a paid provider.

---

## 2. Toolchain & configuration overview

| Area        | State at base                                                                 |
| ----------- | --------------------------------------------------------------------------- |
| Runtime     | Node (portable) `v22.16.0`, npm `10.9.2`. Node is **not** on system PATH.    |
| Framework   | `next@16.3.4`, `react@19.2.8`. `next lint` removed — `eslint` runs directly. |
| Language    | TypeScript `^5`, `strict: true`, `noEmit`, `moduleResolution: bundler`.      |
| Lint        | `eslint.config.mjs` — flat config, `eslint-config-next` core-web-vitals + ts, plus an enforced `no-restricted-imports` boundary around `src/db/admin.ts` and the service-role Storage client. |
| Tests       | Vitest `4.1.11`, node environment, `include: src/**/*.{test,spec}.{ts,tsx}`. 88 test files. |
| Build       | `next build` (Turbopack default). `devIndicators: false` in `next.config.ts`. |
| Deploy cfg  | `vercel.json` pins `regions: ["icn1"]` — asserted by 6 of 8 workflows.       |
| DB tooling  | Drizzle Kit `0.31.10`; migrations in `drizzle/migrations/` + `supabase/`; P0 substrate in `db/`. |
| Scripts     | `scripts/*.mjs` — 70+ `.mjs`, almost all live-DB verifiers invoked via `npm run db:verify:*`. No `scripts/dev/` subdir. |

### Package scripts

`package.json` has `dev`, `build`, `start`, `lint`, `lint:fix`, `typecheck`,
`test`, `test:watch`, then ~60 `db:*` / `qa:*` entries that all shell out to
`node --env-file=.env.local scripts/…` or `node scripts/p0-run.mjs …`. All of the
`db:*` / `qa:*` scripts require a live database and are **not** safe for
unattended CI.

---

## 3. Test organisation

- **88 test files**, all colocated under `src/` next to the code they cover
  (no separate `tests/` tree; `tests/policies/**` is referenced in
  `vitest.config.mts` `exclude` but does not exist at this SHA).
- Heaviest areas: `src/features/prescriptions` (25), `src/features/encounters`
  (14), `src/features/ai` (9).
- Live-provider-gated specs exist and are **off by default**:
  `src/features/ai/terra-live-synthetic-eval.test.ts` runs only when
  `PA1_SYNTHETIC_AI_EVAL=enabled` **and** `OPENAI_API_KEY` is present. Leave
  disabled. `src/features/ai/synthetic-eval.test.ts` is the deterministic
  offline counterpart.
- `npm test` (`vitest run`) is fully offline and is the right pre-push gate.
- Runtime distribution was **not** measured in CAE-01 (needs an instrumented
  run; see recommended CAE-03).

---

## 4. CI / workflow inventory

Eight workflow files, all in `.github/workflows/`. **There is no general
`ci.yml`** — no lint/typecheck/build/test gate on arbitrary branches or pull
requests. Every workflow is a milestone/candidate verifier pinned to one
feature branch, plus `workflow_dispatch`.

| Workflow                          | Auto trigger (push branch)          | `workflow_dispatch` | Live provider | Repo write |
| --------------------------------- | ---------------------------------- | ------------------- | ------------- | ---------- |
| `int-sec01-verify.yml`            | `integration/m3-sec01b`             | yes                 | no            | no         |
| `pa1-c1-verify.yml`               | `md/pa1-c1-closure`                 | yes                 | **yes** (`OPENAI_API_KEY`, `PA1_SYNTHETIC_AI_EVAL`) | no |
| `pa1-terra-name-fix02.yml`        | — (dispatch only)                   | yes + typed inputs  | **yes** (double-guarded: `authorized_sha`==`github.sha` and `confirmation`==`RUN_AUTHORIZED_LIVE_EVAL`) | no |
| `pa1-terra-schema-01.yml`         | `md/pa1-terra-schema-compat`        | yes                 | **yes** (`OPENAI_API_KEY`, direct `api.openai.com`) | no |
| `pa1-terra-sem-fix01.yml`         | `md/pa1-terra-semantic-hardening`   | yes                 | **yes** (`OPENAI_API_KEY`, `PA1_SYNTHETIC_AI_EVAL`) | no |
| `prelaunch-sec01b-candidate.yml`  | `md/prelaunch-sec01b-corrections`   | yes                 | no            | **yes** — `permissions: contents: write`, ends with `git commit` + `git push` |
| `sec01c-dep01-verify.yml`         | `md/sec01c-dep01`                   | yes                 | no            | no         |
| `sec01c-mfa-routing.yml`          | `md/sec01c-mfa-routing-r2`          | yes                 | no            | no         |

Common properties (good):

- No workflow triggers on `main`, on `**`, on `pull_request`, or on `schedule`.
- All but one declare `permissions: contents: read`.
- Every "verify" workflow re-asserts frozen blob hashes and the `icn1` region,
  and most re-check `origin/main == 5d58f154…`.
- Postgres-dependent workflows use an ephemeral `services: postgres:17`
  container with throwaway credentials — no production Supabase.
- No Vercel deploy, no `supabase db push`, no `supabase link` in any workflow.

### 4.1 Automatic-execution risks

1. **Auto-start + paid provider.** `pa1-c1-verify.yml`, `pa1-terra-schema-01.yml`
   and `pa1-terra-sem-fix01.yml` run a live OpenAI step **on push** to their
   pinned `md/*` branch when the `OPENAI_API_KEY` secret is configured.
   - `pa1-c1-verify.yml` fails *open* (guard `exit 0` "BLOCKED" when the secret
     is absent) — so it is safe only while the secret is unset.
   - `pa1-terra-schema-01.yml` / `pa1-terra-sem-fix01.yml` fail *closed*
     (`exit 1` when the secret is absent) and otherwise call the provider.
   - `pa1-terra-name-fix02.yml` is the hardened counter-example: dispatch-only,
     with an explicit typed confirmation string. This is the pattern the others
     do not follow. (Commit `9ec7127` — the CAE-01 base — is `ci(pa1): guard
     live provider workflow execution`, i.e. this hardening is in progress.)
   - **Owner: MD2 / CENTRAL.** CAE must not edit these files.

2. **Auto-start + repo write.** `prelaunch-sec01b-candidate.yml` has
   `permissions: contents: write` and, on push to
   `md/prelaunch-sec01b-corrections`, can `git commit` a lockfile/log-scrub
   change and `git push` it back to that branch (as `github-actions[bot]`,
   only when a prepared diff exists). Scoped to one non-`main` branch, but it is
   the only workflow that writes to the repo. **Owner: MD2 / CENTRAL.**

3. **CI duplication.** The ~10 tail steps (`npm ci` → focused vitest → `npm
   test` → `next typegen` → `typecheck` → `lint` → `build` → prod `npm audit` →
   `git diff --check` → frozen-hash block → `icn1` invariant) are copy-pasted
   across 5–6 workflows with per-workflow `echo` label prefixes. Divergence risk
   is real: audit severity gate is `high|critical` in some files and
   `moderate|high|critical` in others; Node is `22` in `pa1-c1` but `24`
   elsewhere. A shared reusable workflow (`workflow_call`) or composite action
   would remove the duplication — **proposal to CENTRAL, not a CAE edit.**

### 4.2 Live-provider workflow detection (static)

| Term                    | Workflows referencing it                                                        | Can any start automatically? |
| ----------------------- | ----------------------------------------------------------------------------- | ---------------------------- |
| `OPENAI_API_KEY`        | `pa1-c1-verify.yml`, `pa1-terra-name-fix02.yml`, `pa1-terra-schema-01.yml`, `pa1-terra-sem-fix01.yml` | **yes** — all except `pa1-terra-name-fix02.yml` |
| `PA1_SYNTHETIC_AI_EVAL` | `pa1-c1-verify.yml`, `pa1-terra-name-fix02.yml`, `pa1-terra-sem-fix01.yml` | **yes** — set to `enabled` in the auto-start ones' live step |
| `api.openai.com`        | `pa1-terra-schema-01.yml` (direct `fetch` in an inline test)                     | **yes** (push to `md/pa1-terra-schema-compat`) |
| `DEEPGRAM` / `DEEPGRAM_API_KEY` | none                                                                    | n/a                          |
| `SUPABASE_SERVICE_ROLE_KEY` | none (workflows use placeholder anon keys + local postgres)                  | n/a                          |

`pa1-terra-schema-01.yml` does not set `PA1_SYNTHETIC_AI_EVAL` as an env var; its
inline live test passes `syntheticEvaluationEnabled: true` to the parser
constructor and calls `api.openai.com` directly with the `OPENAI_API_KEY` secret.

This is **static text inspection only.** Nothing here was executed. Whether a
secret named `OPENAI_API_KEY` actually exists in the GitHub repo/environment is
not visible to CAE and was not checked.

---

## 5. Frozen-integrity verification

All seven Central-locked artifacts match their pinned `git hash-object` values at
base `9ec7127`:

```
[OK] supabase/policies/0041_prescription_correction_window.sql
[OK] supabase/policies/0042_m3_prescription_reuse.sql
[OK] supabase/policies/0043_m3_signed_medicine_history.sql
[OK] supabase/policies/0044_m3_prescription_print_audit.sql
[OK] supabase/policies/0045_prelaunch_sec01b_security_closure.sql
[OK] src/app/globals.css
[OK] src/features/prescriptions/components/print-sheet.tsx
```

Details and per-file verify commands: [`frozen-integrity-manifest.md`](./frozen-integrity-manifest.md).

`git diff --check` is clean at base. `origin/main` equals the pinned
`5d58f154a8fd18129e28614ccc038f0a6af66b8f`. The base is a direct descendant of
that `main` (merge-base = `main`; base is 247 commits ahead, 0 behind).

---

## 6. Known non-blocking engineering debt

| # | Observation | Suggested owner |
| - | ----------- | --------------- |
| D1 | **Two Vitest configs.** `vitest.config.ts` (resolve aliases incl. a `server-only` stub, no `test` block) **and** `vitest.config.mts` (`test.include`/`exclude`/`environment`, no `server-only` stub) both exist. Only one is used at runtime; the other is silently dead, and they disagree on the `server-only` alias. `int-sec01-verify.yml` treats `vitest.config.ts` as the accepted file. | CENTRAL to assign (root config; outside CAE surface) |
| D2 | **`vitest.config.mts` excludes `tests/policies/**` which does not exist** at this SHA — stale reference. | same as D1 |
| D3 | **No baseline CI.** Nothing runs lint/typecheck/build/test on a normal branch or PR; quality relies on per-milestone verifier workflows and local `check.cmd`. A minimal offline PR gate would catch regressions before a milestone verifier does. | CENTRAL (proposal, not auto-created) |
| D4 | **Workflow step duplication & drift** (§4.1.3): inconsistent Node version (22 vs 24) and inconsistent `npm audit` severity gate across the verifier workflows. | MD2 / CENTRAL |
| D5 | **`scripts/` is flat** — 70+ `.mjs` verifiers with no `scripts/dev/` vs `scripts/ci/` separation; the `db:verify:*` script names in `package.json` are a long undifferentiated list. Purely organisational. | CENTRAL to assign |
| D6 | **`AGENTS.md` / the `next dev` agent-rules block** is re-generated by `next dev` and can show up as an uncommitted change; noted in the file itself. Not a defect, but a recurring diff-noise source. | informational |

None of the above blocks the pilot. None were changed by CAE-01.

---

## 7. Recommended future CAE tasks

See the CAE-01 return report for full framing. In short:

- **CAE-02 — Offline verification runner.** One script that runs the safe
  offline gates (`typecheck`, `lint`, `build`, `vitest run`, frozen-integrity,
  `git diff --check`) with a single summary and machine-readable output, so any
  lane can reproduce the "green" bar locally without copying workflow steps.
- **CAE-03 — Test observability.** Capture per-file / per-suite Vitest timing
  and a stable slowest-N list; land it as `docs/engineering/test-runtime.md`
  plus a refresh script. No product code.
- **CAE-04 — Workflow lint / policy check.** Extend `repo-health.mjs` (or a
  sibling) into an assertion tool: fail if any workflow gains a `main` / `**` /
  `pull_request` / `schedule` trigger, a `contents: write` without CENTRAL
  sign-off, or an auto-start path to a paid provider. Offline, `workflow_dispatch`
  or local only.
- **CAE-05 — Reusable-CI proposal.** Design (not build) a `workflow_call`
  reusable workflow / composite action that collapses the duplicated verifier
  tail, with the Node version and audit gate centralised. Return the proposal to
  CENTRAL.

---

## 8. Change log

| Date (base SHA)          | Change |
| ----------------------- | ------ |
| CAE-01 / `9ec7127`      | Baseline created: `tools/repo-health/` tool + manifest, this document, `frozen-integrity-manifest.md`. |
