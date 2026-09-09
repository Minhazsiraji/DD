# tools/repo-health

Offline, dependency-free engineering tooling for Doctor's Diary. Read-only with
respect to tracked files. No network provider calls. No secret values read or
printed.

| script | built under | purpose |
| ------ | ----------- | ------- |
| `repo-health.mjs`    | CAE-01 | one-shot repository-health snapshot (git / frozen / workflows / tests) |
| `offline-verify.mjs` | CAE-02 | run the standard safe/offline quality gate sequence |
| `frozen-manifest.json` | CAE-01 | pinned frozen blob hashes + expected `main` SHA |

---

# repo-health.mjs

## Run it

Node is not on this machine's PATH — prefix it (see `CLAUDE.md` →
"Working on this machine"):

```
$env:PATH = "E:\Minhaz Siraji\Claude\tools\node-v22.16.0-win-x64;$env:PATH"
node tools/repo-health/repo-health.mjs
```

| flag       | effect                                                                        |
| ---------- | ---------------------------------------------------------------------------- |
| *(none)*   | human-readable report to stdout                                               |
| `--json`   | machine-readable JSON                                                         |
| `--audit`  | additionally run `npm audit --omit=dev --json` (this reaches the npm registry) |
| `--strict` | exit `2` if a **hard finding** is present                                     |
| `--help`   | usage                                                                        |

Exit codes: `0` report produced · `1` tool could not run (not a git tree, no
manifest) · `2` `--strict` and a hard finding present.

A **hard finding** is one of: a frozen artifact whose blob hash drifted, a
missing critical path, or `origin/main` not equal to the pinned
`expectedMainSha`. Everything else in the report is informational.

## What it reports

- git: HEAD, branch, `origin/main` vs pinned SHA, ahead/behind, working-tree
  cleanliness, `git diff --check`
- toolchain: Node / npm versions, whether Node is on PATH, declared
  `next` / `vitest` / `typescript`
- frozen-artifact hash status (against `frozen-manifest.json`)
- presence of expected critical paths
- test-file inventory by feature area
- workflow inventory: triggers, push-branch filters, whether each can start
  without a human, write permissions, `git push`/`git commit` in steps
- live-provider term hits per workflow (`OPENAI_API_KEY`, `DEEPGRAM*`,
  `PA1_SYNTHETIC_AI_EVAL`, `api.openai.com`, …) — **static text match only**
- CI risk rollups: secret-aware workflows, auto-start + live-provider,
  auto-start + repo-write
- duplicate-config risks (e.g. two Vitest configs)
- production `npm audit` summary (only with `--audit`)

## Keeping it current

`frozen-manifest.json` holds the pinned hashes and SHAs. Update it **only when
Central re-locks an artifact or moves `main`**. The file is CAE engineering
metadata; it does not replace Central governance.

---

# offline-verify.mjs

One reusable runner for the standard safe/offline quality gate, so a lane can
reproduce the "green" bar locally without copying command sequences out of the
CI workflows. **Not an authoritative release gate — CENTRAL remains
authoritative.**

```
$env:PATH = "E:\Minhaz Siraji\Claude\tools\node-v22.16.0-win-x64;$env:PATH"
node tools/repo-health/offline-verify.mjs
```

`node_modules/` must already be present (install with your project's normal
flow first — the runner never touches `package.json` / `package-lock.json`).

| flag       | effect                                                                         |
| ---------- | --------------------------------------------------------------------------- |
| *(none)*   | full run: repo-health `--strict` → `npm test` → `next typegen` → `typecheck` → `lint` → `build` → `git diff --check` |
| `--quick`  | repo-health `--strict` → `next typegen` → `typecheck` → `lint` → `git diff --check` (no `npm test`, no build; **not** the authoritative full run) |
| `--audit`  | append one extra gate: `repo-health.mjs --audit`. **This reaches the network** (npm registry). Never part of the default run. |
| `--json`   | machine-readable final report on stdout                                        |
| `--help`   | usage                                                                        |

## Exit-code contract

| code | meaning |
| ---- | ------- |
| `0`  | every requested gate passed |
| `1`  | runner/tooling error, OR fail-closed pre-flight (not a git tree, missing `repo-health.mjs`, missing `node_modules`, npm CLI not found), OR the repo-health `--strict` scope/integrity gate failed (the run stops there) |
| `2`  | the runner executed but one or more ordinary quality gates FAILED |

Ordinary gate failures do **not** stop the run — every remaining gate still
executes so the summary is complete. Only a scope/integrity failure fails
closed.

## Offline guarantees

Before any child process starts, the runner builds a sanitised child
environment:

- **removed:** `OPENAI_API_KEY`, `OPENAI_*` (base URL / org), `DEEPGRAM_API_KEY`,
  `DEEPGRAM_PROJECT_ID`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL`,
  `SUPABASE_ACCESS_TOKEN`, `DATABASE_URL`, `DIRECT_URL`,
  `DD_V2_LOCAL_DATABASE_URL`, `ANTHROPIC_API_KEY`, `VERCEL_TOKEN`, plus a
  pattern sweep for any other `*_API_KEY` / `*_SECRET` / `*_ACCESS_TOKEN` /
  `*SERVICE_ROLE` (never `NEXT_PUBLIC_*`).
- **forced:** `PA1_SYNTHETIC_AI_EVAL=disabled`, `AI_MODE=mock`,
  `NOTIFICATION_MODE=mock`, `PAYMENT_MODE=mock`, plus synthetic non-secret
  public build values (`NEXT_PUBLIC_SUPABASE_URL/ANON_KEY/SITE_URL`) and a
  bounded non-secret `PA1_PROPOSAL_SIGNING_SECRET`.
- **`.env.local` is never read** and never passed with `--env-file`.

`terra-live-synthetic-eval.test.ts` gates on
`PA1_SYNTHETIC_AI_EVAL === "enabled" && OPENAI_API_KEY` — both are denied here,
so `describe.skipIf` skips the whole suite (it shows as the `1 skipped` file in
`npm test`). No OpenAI / Deepgram / Supabase / Vercel / DB traffic occurs in any
mode. `npm audit` (network) runs only with `--audit`, in its own labelled gate.

The runner never writes tracked files. `next typegen` / `next build` create the
normal ignored `.next/**` artifacts; nothing tracked changes.

## Checkout advisory

On a Windows checkout with `core.autocrlf=true` the working tree is CRLF while
the index is LF. Several suites assert LF-exact file bytes or LF git-blob
hashes and fail spuriously here (they pass in CI). The runner emits a read-only
advisory (`git ls-files --eol` count) so a `npm test` failure of that kind is
not misread as a code regression. See CAE-FINDING-006 in
[`../../docs/engineering/repository-health-baseline.md`](../../docs/engineering/repository-health-baseline.md).

## JSON output contract

`--json` prints one object: `mode`, `auditIncluded`, `preflight`,
`environmentSanitisation` (`targetedForRemoval`, `removedFromChildEnv`,
`forcedInChildEnv`, `forcedValues`, `readsDotEnvLocal:false`),
`checkoutAdvisory`, `gatesPlanned`, `gatesRun`, `stoppedEarly`,
`allRequestedRan`, `results[]` (`gate`, `command`, `status`, `exitCode`,
`signal`, `durationMs`, `durationHuman`, `network`, `scope`, `spawnError`,
optional `note`, and `evidence` only on failure — bounded to 16 KB tail),
`overall` (`PASS`/`FAIL`), `exitCode`.

## Approximate runtime (this machine, warm)

full ≈ 1–2 min (`build` ~15–65 s, `lint` ~37 s, `npm test` ~7 s) ·
quick ≈ 45 s · `--audit` adds ~9 s.
