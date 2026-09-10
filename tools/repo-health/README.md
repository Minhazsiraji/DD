# tools/repo-health

Offline, dependency-free engineering tooling for Doctor's Diary. Read-only with
respect to tracked files. No network provider calls. No secret values read or
printed.

| script | built under | purpose |
| ------ | ----------- | ------- |
| `repo-health.mjs`    | CAE-01 | one-shot repository-health snapshot (git / frozen / workflows / tests) |
| `offline-verify.mjs` | CAE-02 | run the standard safe/offline quality gate sequence |
| `workflow-policy.mjs` | CAE-04 | static GitHub Actions governance guard with a tamper-evident grandfather baseline |
| `build-size.mjs` | CAE-05 | measure `.next` build / route size and detect meaningful future growth |
| `frozen-manifest.json` | CAE-01 | pinned frozen blob hashes + expected `main` SHA |
| `workflow-policy-baseline.json` | CAE-04 | **CENTRAL-owned** list of grandfathered workflow exceptions (KNOWN DEBT) |
| `build-size-baseline.json` | CAE-05 | **CENTRAL-owned** recorded build-size metrics + thresholds (fingerprinted) |

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

full ≈ 1–2 min (`build` ~15–65 s, `lint` ~37 s, `npm test` ~7 s,
`workflow-policy` ~0.3 s) · quick ≈ 45 s · `--audit` adds ~9 s.

The full and `--quick` runs now execute **`workflow-policy --strict` as gate 2**
(right after `repo-health --strict`, before `npm test` / build). A failure there
is a scope/governance failure: the run fails closed (exit 1) and product gates
are **not** run.

---

# workflow-policy.mjs

Static, offline governance check over `.github/workflows/*.yml`. Its job is to
stop a future change from silently introducing automatic paid-provider
execution, automatic repository writes, broad CI triggers, or a byte-level
change to a grandfathered risky workflow without CENTRAL review. It does **not**
execute workflows, read GitHub secrets, or claim whether any secret exists —
conservative static text/structure analysis only, not full Actions semantics.

```
node tools/repo-health/workflow-policy.mjs            # inventory + report
node tools/repo-health/workflow-policy.mjs --json     # machine-readable
node tools/repo-health/workflow-policy.mjs --strict   # gate mode
node tools/repo-health/workflow-policy.mjs --self-test # offline fixture proof
node tools/repo-health/workflow-policy.mjs --help
```

## Policy rules

| ID | What it flags | Applies to |
| -- | ------------- | ---------- |
| WF-001 | `push` trigger targeting `main` / `master` | any |
| WF-002 | broad/wildcard automatic trigger (`**`, or `push`/`pull_request` with no branch/tag/path filter) | any |
| WF-003 | `pull_request` / `pull_request_target` trigger | any |
| WF-004 | `schedule` (cron) trigger | any |
| WF-005 | `permissions: contents: write` (or `write-all`) | any |
| WF-006 | a run step contains `git push` | any |
| WF-007 | a run step contains `git commit` | any |
| WF-008 | references `OPENAI_API_KEY` | automatic only |
| WF-009 | references `DEEPGRAM_API_KEY` / `DEEPGRAM` | automatic only |
| WF-010 | sets `PA1_SYNTHETIC_AI_EVAL` to `enabled` | automatic only |
| WF-011 | direct `api.openai.com` traffic | automatic only |
| WF-012 | automatic + provider-sensitive **and** no explicit human-dispatch guard | automatic only |
| WF-013 | deploy-like production-mutation command (`vercel deploy`, `supabase db push`, `supabase link`, `wrangler deploy`, `npm publish`, …) | automatic only |
| WF-014 | **trigger structure could not be confidently parsed** — fail-closed | any |

**Automatic vs manual is not decided from a finite list of event names**
(CAE-04-R1). The only manual events are `workflow_dispatch` and `workflow_call`.
**Every** other parsed `on:` event is AUTOMATIC — `push`, `schedule`,
`workflow_run`, `release`, `deployment`, `deployment_status`, `page_build`,
`registry_package`, `status`, `check_run`, `branch_protection_rule`, a name
GitHub adds next year, an unrecognised name. So a new automatic event can never
become "manual/safe" by not being in an allowlist. `workflow_call` alone is
reported as **`callable`** (a distinct classification; no call-graph analysis is
done — the chain is not proven safe). WF-001/003/004 still key off the specific
names `push` / `pull_request` / `schedule` for their own checks, but never for
the basic classification.

**Fail-closed parser (WF-014).** If the dependency-free `on:` parser cannot
confidently interpret the trigger structure — an `on:` key present with zero
events, a malformed/ambiguous form, an unterminated flow `[…]` / `{…}`, an
unreadable line in the block — the workflow is treated as **automatic** and
WF-014 fires as a hard governance failure. The guard is allowed a conservative
false positive that needs CENTRAL review; it must never let an automatic
provider / deploy / repo-write workflow look manual. WF-014 should essentially
never be grandfathered — fix the workflow's `on:` syntax instead.

**Human-dispatch guard** (WF-012 exemption) = `workflow_dispatch` with a
confirmation-style input **and** a run step that tests it (e.g.
`test "${{ inputs.confirmation }}" = "RUN_AUTHORIZED_LIVE_EVAL"`).

**Provider-sensitive** and **repo-write-sensitive** are reported per workflow
regardless of trigger, so a manual workflow that carries a provider secret is
still visible in the inventory.

## Grandfathering — `workflow-policy-baseline.json`

The current accepted repository already violates several rules. The baseline
lists those exact exceptions so the guard does not block the accepted state
while still failing on anything new. Each exception binds:

```json
{ "path": ".github/workflows/<file>.yml",
  "sha256": "<64-hex digest of the file's LF-normalised bytes>",
  "violations": ["WF-008", "WF-012"] }
```

- **A baseline entry means _KNOWN EXISTING DEBT_, not _approved-safe design_.**
  The human report prints these under a `KNOWN EXISTING DEBT` heading and never
  as an all-clear.
- **Why an exact file hash:** it makes the baseline tamper-evident. Change a
  grandfathered workflow by one byte → its digest changes → the exception stops
  applying → the check FAILS → CENTRAL must review and re-baseline (or revert).
  The digest is over canonical **LF-normalised** bytes so it is identical on a
  Windows (CRLF) and Linux (LF) checkout.
- A rule id that fires on a listed workflow but is **not** in that entry's
  `violations` array is treated as a **new** violation and FAILS.
- **Only CENTRAL may edit `workflow-policy-baseline.json`**, and only after
  reviewing the workflow change that motivates it.

## Exit codes

| code | meaning |
| ---- | ------- |
| `0`  | evaluated; every violation is absent or an exact-hash grandfathered exception (digest matches **and** the rule id is listed) |
| `1`  | tool / pre-flight / baseline error — not a git tree, no workflows dir, unreadable or structurally invalid baseline, or an exception `path` that is not a workflow in the tree (fail closed) |
| `2`  | policy violation: a non-grandfathered hard violation, **or** a grandfathered workflow whose digest no longer matches (exception drift) |

## `--self-test`

Builds throwaway workflow fixtures + baselines under the OS temp dir (never
touches real `.github/workflows`). **33 assertions.** Core (16): safe
dispatch-only → clean; `push`+`OPENAI_API_KEY` → WF-008/WF-012;
`schedule`+`api.openai.com` → WF-004/WF-011; `contents: write` → WF-005;
`git push`/`git commit` → WF-006/WF-007; exact-hash exception recognised;
one-byte change → `EXCEPTION_DRIFT`; unknown baseline path reported;
structurally invalid baseline fails closed; `workflow_dispatch`-only provider
workflow is provider-sensitive but raises no automatic-provider finding; no
secret values read. Trigger-parser hardening (17, CAE-04-R1): `on: workflow_run`
/ `release` / `deployment_status` → automatic + the right provider/deploy rule;
unknown future event → automatic, not manual; inline list `[push, …]` → automatic;
multi-event block → all events extracted; inline map `{ push: {}, … }` → parsed
or explicit parser error; `"on":` / `'on':` quoted key → parsed or fail-closed;
malformed / empty `on:` → WF-014 hard failure (never manual PASS);
`workflow_dispatch` only → manual; `workflow_call` only → callable;
`workflow_dispatch`+`workflow_call` → no automatic trigger;
`workflow_run`+`workflow_dispatch` → automatic; WF-014 fails `--strict`;
no-allowlist-regression invariant.

## JSON contract

`--json` prints: `tool`, `overall` (`PASS`/`FAIL`), `exitCode`, `preflight`,
`baselineInvalid`, `workflowDir`, `baselinePath`, `baselineMeta`,
`unknownBaselinePaths`, `workflowCount`, `ruleIds` (WF-001…WF-014),
`workflows[]` (`path`, `triggers`, `triggerForm`, `triggerParseOk`,
`triggerParseError`, `classification` = `automatic` | `manual` | `callable` |
`parse-error (treated automatic)`, `automatic`, `automaticTriggers`, `callable`,
`providerSensitive`, `repoWriteSensitive`, `hasHumanDispatchGuard`, `sha256`,
`grandfathered`), `findings[]` (`path`, `ruleId`, `ruleTitle`, `severity`,
`evidence`, `automatic`, `classification`, `triggerParseOk`,
`providerSensitive`, `repoWriteSensitive`, `grandfathered`, `status` =
`GRANDFATHERED` | `NEW_VIOLATION` | `EXCEPTION_DRIFT`, `expectedDigest`,
`actualDigest`), `grandfatheredCount`, `hardFailureCount`, `staleExceptions[]`.
No secret values.

## Limitations

Line-based parsing, not a YAML engine — but it **fails closed** (WF-014) on any
`on:` form it cannot confidently read, rather than guessing manual. Multi-line
flow `on: [ … ]` / `on: { … }` and unusual representations are reported as a
parse failure, not silently misclassified. It cannot see reusable-workflow
callers, composite-action internals, or `run:` logic reached only at runtime. It
reports static repository evidence — never whether a secret is actually
configured, and never by executing anything.

## Current grandfathered debt (baseline v1, `b0efa46`)

| Workflow | Rules | Why (KNOWN DEBT — not approved) |
| -------- | ----- | ------------------------------ |
| `pa1-c1-verify.yml` | WF-008, WF-010, WF-012 | live OpenAI synthetic-eval job on push to `md/pa1-c1-closure` when the secret is set (guard fails **open** when absent) |
| `pa1-terra-schema-01.yml` | WF-008, WF-011, WF-012 | inline test calls `api.openai.com` directly on push to `md/pa1-terra-schema-compat` |
| `pa1-terra-sem-fix01.yml` | WF-008, WF-010, WF-012 | live step sets `PA1_SYNTHETIC_AI_EVAL=enabled` on push to `md/pa1-terra-semantic-hardening` |
| `prelaunch-sec01b-candidate.yml` | WF-005, WF-006, WF-007 | `contents: write` + `git commit`/`git push` back to `md/prelaunch-sec01b-corrections` |

`pa1-terra-name-fix02.yml` is provider-sensitive but **dispatch-only with a
`RUN_AUTHORIZED_LIVE_EVAL` confirmation guard** → no violation, not baselined.
Remediation recommendations for the four above are in
[`../../docs/engineering/repository-health-baseline.md`](../../docs/engineering/repository-health-baseline.md).

---

# build-size.mjs

Offline build / route **size regression baseline** (CAE-05). MEASURE → RECORD →
COMPARE → REPORT. It reads `.next/**` after a successful `npm run build` and
reports deterministic size + route metrics, and — with a baseline present —
diffs them under conservative engineering thresholds. It never modifies product
code, optimises anything, scrapes a CDN, or calls a network / provider /
database / Vercel endpoint, and never reads secrets.

```
node tools/repo-health/build-size.mjs            # measure + compare (if baseline present)
node tools/repo-health/build-size.mjs --compare  # measure + compare + apply thresholds
node tools/repo-health/build-size.mjs --json
node tools/repo-health/build-size.mjs --self-test
node tools/repo-health/build-size.mjs --write-baseline --confirm-central
```

Needs a prior `npm run build`. **Build it with the canonical `NEXT_PUBLIC_*`
values** (recorded in `build-size-baseline.json` → `buildEnvironment`, identical
to `offline-verify.mjs`): Next inlines `process.env.NEXT_PUBLIC_*` into the
client bundle, so a different-length placeholder shifts `js.rawBytes` by a few
bytes.

## Metrics (canonical — raw bytes, fingerprinted, gated)

`static.rawBytes` / `js.rawBytes` / `css.rawBytes` / `media.rawBytes` (+ file
counts) — sums over `.next/static/**`, **source maps excluded**; `largestJsBytes`
/ `largestCssBytes` — size of the single largest `.js` / `.css` asset (filenames
are content-hashed → compared by size, never by name); `routes` / `routeCount` —
sorted union of `routes-manifest.json` `staticRoutes[].page` + `dynamicRoutes[].page`.

**Informational (not fingerprinted, not gated):** `gzip.jsBytes` / `gzip.cssBytes`
(Node `zlib.gzipSync` per file, summed — **not** the CDN transfer size),
`serverBuildRawBytes` (`.next/server/**` — not browser-shipped, determinism not
gate-validated), `sourceMapBytes`, `largestAssets[]` (name + size), and
`perRouteJsBytes` which is **`UNAVAILABLE`** — this Next 16 Turbopack build emits
no `app-build-manifest.json`, so route→chunk byte attribution is not
deterministically available; the tool labels it rather than estimating.

## Determinism

Four+ clean rebuilds of the same product tree with the same env gave
byte-identical `static` / `js` / `css` / `media` / `largestJsBytes` and a
byte-identical route manifest, **except** a handful of bytes (`0–~15 B`) of
Turbopack jitter in `js.rawBytes`. That is ~0.001 % of the ~1.8 MB JS aggregate
and is absorbed by the KB-scale thresholds below (it never trips a warning).
Chunk *filenames* are content-hashed and some are not stable build-to-build,
which is why nothing is compared by filename.

## Thresholds & rationale

Validated against the real DD build (JS aggregate ≈ 1.79 MB, largest chunk
≈ 277 KB, CSS ≈ 128 KB). Every change is reported; a **WARN** needs **both** the
absolute **and** the percentage bound crossed, so incidental drift stays quiet:

| metric | WARN when | HARD FAIL when |
| ------ | --------- | -------------- |
| JS aggregate (`js.rawBytes`) | `> +100 KB` **and** `> +10 %` | `> +500 KB` **and** `> +25 %` |
| largest JS chunk (`largestJsBytes`) | `> +75 KB` **and** `> +15 %` | — |
| CSS aggregate (`css.rawBytes`) | `> +25 KB` **and** `> +15 %` | — |
| static aggregate (`static.rawBytes`) | — | `> +750 KB` **and** `> +25 %` |
| baseline integrity | — | missing / malformed / schema mismatch / fingerprint mismatch |

Route additions / removals are **reported, never a WARN or FAIL** — this is
observability, not product governance.

## Baseline & fingerprint

`build-size-baseline.json` (CENTRAL-owned): `schemaVersion`, `recordedAt`,
`recordedFromCommit`, `productTreeNote`, `toolchain`, `buildEnvironment`,
`measurementDefinitions`, `thresholds`, `metrics`, `fingerprint`. The
`fingerprint` is `sha256` over a stable (recursively key-sorted) serialisation
of `metrics`. `loadBaseline` **fails closed** (exit 1) on a missing file, bad
JSON, wrong `schemaVersion`, missing `metrics`, a non-sha256 `fingerprint`, or a
`fingerprint` that does not match a recompute of `metrics` (i.e. someone edited
the numbers by hand). No secrets, local paths, or machine identifiers go into
it.

`--write-baseline` refuses without `--confirm-central`. **Updating the accepted
baseline is a CENTRAL decision** — it must be reviewed against the product
change that moved the numbers, and the rebuild must use the canonical
`buildEnvironment`.

## Exit codes

| code | meaning |
| ---- | ------- |
| `0`  | measurement complete; **no hard regression** (warnings do **not** fail) |
| `1`  | tool / pre-flight / baseline / build-output error — fail closed (`--compare` with no valid baseline, no `.next/static`, etc.) |
| `2`  | hard size regression detected |

## `--self-test`

15 assertions, synthetic metric objects + temp baseline files (real `.next`
untouched): identical → clean; small growth → report only; WARN threshold →
WARN + exit 0; HARD threshold → FAIL + exit 2; baseline missing / malformed /
no-metrics / fingerprint-mismatch → fail closed; correctly-fingerprinted
baseline loads; new route → `routeAdditions`; removed route → `routeRemovals`;
route change alone → no warn/fail; gzip fields separate + labelled and never
used by the comparison; per-route JS attribution explicit `UNAVAILABLE`; no
secret / env / personal-path values in output JSON.

## Not wired into `offline-verify.mjs` (yet)

CAE-05 ships `build-size.mjs` as a **standalone** tool. It is not a gate in the
authoritative offline verifier. Maturity assessment + an integration proposal
are in the CAE-05 return report and
[`../../docs/engineering/repository-health-baseline.md`](../../docs/engineering/repository-health-baseline.md) §10.
