# tools/repo-health

Offline, dependency-free repository-health baseline for Doctor's Diary.
Built under **CAE-01**. Read-only. No network provider calls. No secret values
are read or printed.

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
