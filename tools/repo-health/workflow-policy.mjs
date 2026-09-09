#!/usr/bin/env node
/**
 * Doctor's Diary — offline GitHub Actions workflow-policy guard (CAE-04).
 *
 * Static, dependency-free governance check over `.github/workflows/*.yml`. It
 * exists to stop a future change from silently introducing automatic
 * paid-provider execution, automatic repository writes, broad CI triggers, or
 * mutation of a grandfathered risky workflow without CENTRAL review.
 *
 * It does NOT execute workflows, read GitHub secrets, or claim whether a secret
 * actually exists. Conservative static text/structure analysis only — it does
 * not attempt full GitHub Actions semantics.
 *
 * Grandfathering
 * -------------
 * `workflow-policy-baseline.json` lists the CENTRAL-known existing exceptions.
 * Each exception binds { path, sha256, violations[] }. The sha256 is over the
 * workflow file's canonical (LF-normalised) bytes. If a grandfathered workflow
 * changes by one byte its digest changes, the exception stops applying, and the
 * check FAILS — the baseline is tamper-evident. A baseline entry means
 * "KNOWN EXISTING DEBT", NOT "approved safe design". Only CENTRAL may edit it.
 *
 * Usage:
 *   node tools/repo-health/workflow-policy.mjs            # inventory + report
 *   node tools/repo-health/workflow-policy.mjs --json     # machine-readable
 *   node tools/repo-health/workflow-policy.mjs --strict    # exit non-zero on drift / new violation
 *   node tools/repo-health/workflow-policy.mjs --self-test  # offline fixture proof
 *   node tools/repo-health/workflow-policy.mjs --help
 *
 * Exit codes:
 *   0  policy evaluated; every violation is absent or an exact-hash grandfathered
 *      exception (digest matches AND the rule id is listed for that path)
 *   1  tool / pre-flight / baseline error (not a git tree, no workflows dir,
 *      unreadable or structurally invalid baseline, exception path is not a
 *      real workflow) — fail closed
 *   2  policy violation: a non-grandfathered hard violation, OR a grandfathered
 *      workflow whose digest no longer matches (exception drift)
 *
 * `--strict` is what makes exit 2 authoritative; without it the same report is
 * printed but the process still exits 2 on violations (so CI/other tools can
 * rely on the code). `--strict` only suppresses nothing — it is accepted for
 * symmetry with the other CAE tools and documented as the intended gate mode.
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");
const DEFAULT_WORKFLOW_DIR = join(REPO, ".github", "workflows");
const DEFAULT_BASELINE = join(HERE, "workflow-policy-baseline.json");

const flags = new Set(process.argv.slice(2));
if (flags.has("--help") || flags.has("-h")) {
  printHelp();
  process.exit(0);
}
const asJson = flags.has("--json");
const selfTest = flags.has("--self-test");

// ---------------------------------------------------------------------------
// policy rules
// ---------------------------------------------------------------------------

/**
 * Each rule: id, short title, and whether it only applies when the workflow is
 * automatically executable. `detect(w)` returns evidence strings (0 = no hit).
 */
const RULES = [
  {
    id: "WF-001",
    title: "push trigger targeting the default branch (main/master)",
    autoOnly: false,
    detect: (w) =>
      w.pushBranches
        .filter((b) => /^(main|master|refs\/heads\/(main|master))$/.test(b))
        .map((b) => `push.branches: ${b}`),
  },
  {
    id: "WF-002",
    title: "broad / wildcard automatic trigger (** or unfiltered push/PR)",
    autoOnly: false,
    detect: (w) => {
      const hits = [];
      for (const b of [...w.pushBranches, ...w.prBranches]) {
        if (b === "*" || b === "**" || b.includes("**")) hits.push(`wildcard branch filter: ${b}`);
      }
      if (w.hasPush && !w.pushHasFilter) hits.push("push: with no branches/tags/paths filter (all branches)");
      if (w.hasPullRequest && !w.prHasFilter) hits.push("pull_request: with no branches/paths filter");
      return hits;
    },
  },
  {
    id: "WF-003",
    title: "pull_request / pull_request_target trigger",
    autoOnly: false,
    detect: (w) => w.triggers.filter((t) => t === "pull_request" || t === "pull_request_target").map((t) => `on.${t}`),
  },
  {
    id: "WF-004",
    title: "schedule (cron) trigger",
    autoOnly: false,
    detect: (w) => (w.triggers.includes("schedule") ? ["on.schedule"] : []),
  },
  {
    id: "WF-005",
    title: "contents: write (or write-all) permission",
    autoOnly: false,
    detect: (w) => w.permissionWrites.map((p) => `permissions: ${p}`),
  },
  {
    id: "WF-006",
    title: "workflow run step contains `git push`",
    autoOnly: false,
    detect: (w) => (/\bgit\s+push\b/.test(w.text) ? [firstLineMatching(w.text, /\bgit\s+push\b/)] : []),
  },
  {
    id: "WF-007",
    title: "workflow run step contains `git commit`",
    autoOnly: false,
    detect: (w) => (/\bgit\s+commit\b/.test(w.text) ? [firstLineMatching(w.text, /\bgit\s+commit\b/)] : []),
  },
  {
    id: "WF-008",
    title: "automatically executable path references OPENAI_API_KEY",
    autoOnly: true,
    detect: (w) => (/OPENAI_API_KEY/.test(w.text) ? [`references OPENAI_API_KEY (${countHits(w.text, /OPENAI_API_KEY/g)}×)`] : []),
  },
  {
    id: "WF-009",
    title: "automatically executable path references DEEPGRAM credentials",
    autoOnly: true,
    detect: (w) => (/DEEPGRAM_API_KEY|\bDEEPGRAM\b/.test(w.text) ? [`references DEEPGRAM (${countHits(w.text, /DEEPGRAM_API_KEY|\bDEEPGRAM\b/g)}×)`] : []),
  },
  {
    id: "WF-010",
    title: "automatically executable path enables PA1_SYNTHETIC_AI_EVAL",
    autoOnly: true,
    detect: (w) => {
      const m = w.text.match(/PA1_SYNTHETIC_AI_EVAL['"]?\s*[:=]\s*['"]?enabled/gi);
      return m ? [`PA1_SYNTHETIC_AI_EVAL set to enabled (${m.length}×)`] : [];
    },
  },
  {
    id: "WF-011",
    title: "automatically executable path contains direct api.openai.com traffic",
    autoOnly: true,
    detect: (w) => (/api\.openai\.com/.test(w.text) ? [`api.openai.com (${countHits(w.text, /api\.openai\.com/g)}×)`] : []),
  },
  {
    id: "WF-012",
    title: "automatically executable provider-sensitive workflow with no explicit human-dispatch guard",
    autoOnly: true,
    detect: (w) => {
      if (!w.providerSensitive) return [];
      if (w.hasHumanDispatchGuard) return [];
      return [`provider-sensitive + auto-trigger (${w.automaticTriggers.join(", ")}) and no confirmation-input guard`];
    },
  },
  {
    id: "WF-013",
    title: "automatically executable path runs a deploy-like production-mutation command",
    autoOnly: true,
    detect: (w) => {
      const patterns = [
        /vercel\s+(deploy|--prod|build\s+--prod)/,
        /\bvercel\s+deploy\b/,
        /supabase\s+db\s+push/,
        /supabase\s+link\b/,
        /netlify\s+deploy/,
        /wrangler\s+(deploy|publish)/,
        /gh\s+release\s+create/,
        /npm\s+publish\b/,
      ];
      return patterns.filter((p) => p.test(w.text)).map((p) => `deploy-like command: ${p}`);
    },
  },
];

const RULE_IDS = RULES.map((r) => r.id);

// ---------------------------------------------------------------------------
// workflow parsing (conservative, line-based; no YAML dependency)
// ---------------------------------------------------------------------------

const AUTOMATIC_TRIGGERS = new Set([
  "push",
  "pull_request",
  "pull_request_target",
  "schedule",
  "repository_dispatch",
  "issue_comment",
  "issues",
  "merge_group",
  "discussion",
  "watch",
  "fork",
  "create",
  "gollum",
]);
const MANUAL_TRIGGERS = new Set(["workflow_dispatch", "workflow_call"]);

function canonicalBytes(absPath) {
  return Buffer.from(readFileSync(absPath, "utf8").replace(/\r\n/g, "\n"), "utf8");
}

function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

function firstLineMatching(text, re) {
  for (const line of text.split("\n")) if (re.test(line)) return line.trim().slice(0, 200);
  return "(match)";
}
function countHits(text, reGlobal) {
  return (text.match(reGlobal) || []).length;
}

function parseWorkflow(absPath, name) {
  const raw = readFileSync(absPath, "utf8");
  const text = raw.replace(/\r\n/g, "\n");
  const lines = text.split("\n");

  // ---- `on:` block: from the `on:` line to the next top-level key ----
  const onIdx = lines.findIndex((l) => /^on:(\s|$)/.test(l) || /^on:\s*\[/.test(l) || /^on:\s*\{/.test(l));
  let onBlock = "";
  const triggers = [];
  if (onIdx >= 0) {
    const collected = [lines[onIdx]];
    for (let i = onIdx + 1; i < lines.length; i++) {
      if (/^\S/.test(lines[i])) break;
      collected.push(lines[i]);
    }
    onBlock = collected.join("\n");
    // inline form: on: [push, workflow_dispatch]
    const inline = onBlock.match(/^on:\s*\[([^\]]*)\]/);
    if (inline) {
      for (const t of inline[1].split(",").map((s) => s.trim()).filter(Boolean)) triggers.push(t);
    }
    for (const key of [...AUTOMATIC_TRIGGERS, ...MANUAL_TRIGGERS]) {
      if (new RegExp(`^\\s{1,4}${key}:(\\s|$)`, "m").test(onBlock) || new RegExp(`^on:\\s*${key}(\\s|$)`, "m").test(onBlock)) {
        if (!triggers.includes(key)) triggers.push(key);
      }
    }
  }

  const automaticTriggers = triggers.filter((t) => AUTOMATIC_TRIGGERS.has(t));
  const automatic = automaticTriggers.length > 0;

  // ---- push / pull_request branch filters ----
  const branchList = (block, kind) => {
    const out = [];
    const m = block.match(new RegExp(`${kind}:[\\s\\S]*?branches(?:-ignore)?:\\s*\\n((?:\\s*-\\s*\\S.*\\n?)+)`));
    if (m) for (const bl of m[1].split("\n")) {
      const bm = bl.match(/-\s*['"]?([^'"\s#]+)/);
      if (bm) out.push(bm[1]);
    }
    const inlineM = block.match(new RegExp(`${kind}:[\\s\\S]*?branches(?:-ignore)?:\\s*\\[([^\\]]*)\\]`));
    if (inlineM) for (const b of inlineM[1].split(",").map((s) => s.trim().replace(/['"]/g, "")).filter(Boolean)) out.push(b);
    return out;
  };
  const hasPush = triggers.includes("push");
  const hasPullRequest = triggers.includes("pull_request") || triggers.includes("pull_request_target");
  const pushBranches = hasPush ? branchList(onBlock, "push") : [];
  const prBranches = hasPullRequest ? branchList(onBlock, "pull_request") : [];
  const pushHasFilter = /push:[\s\S]*?(branches(?:-ignore)?|tags(?:-ignore)?|paths(?:-ignore)?):/.test(onBlock);
  const prHasFilter = /pull_request(_target)?:[\s\S]*?(branches(?:-ignore)?|paths(?:-ignore)?):/.test(onBlock);

  // ---- permissions ----
  const permissionWrites = [];
  if (/^\s*permissions:\s*write-all\s*$/m.test(text)) permissionWrites.push("write-all");
  for (const m of text.matchAll(/^\s*(contents|packages|pull-requests|id-token|actions|deployments|statuses|checks|security-events):\s*write\s*$/gim)) {
    permissionWrites.push(`${m[1]}: write`);
  }

  // ---- human dispatch guard: workflow_dispatch with a confirmation input AND
  //      a run-step check that tests that input. Conservative. ----
  const dispatchInputs = /workflow_dispatch:\s*\n(\s+)inputs:\s*\n/.test(onBlock);
  const confirmInputName = /inputs:\s*\n[\s\S]*?\b(confirm|confirmation|authorized_sha|acknowledge|i_understand)\b\s*:/i.test(onBlock);
  const guardStep = /(test\s+"?\$?\{?\{?\s*(inputs\.|env\.)?(confirm|confirmation|LIVE_CONFIRMATION|AUTHORIZED_SHA)|inputs\.(confirmation|confirm)\b)/i.test(text)
    || /RUN_AUTHORIZED_LIVE_EVAL|I_UNDERSTAND|CONFIRM_LIVE/i.test(text);
  const hasHumanDispatchGuard = dispatchInputs && confirmInputName && guardStep;

  // ---- provider-sensitive / repo-write-sensitive ----
  const providerSensitive =
    /OPENAI_API_KEY|api\.openai\.com|DEEPGRAM_API_KEY|\bDEEPGRAM\b/.test(text) ||
    /PA1_SYNTHETIC_AI_EVAL['"]?\s*[:=]\s*['"]?enabled/i.test(text);
  const repoWriteSensitive = permissionWrites.length > 0 || /\bgit\s+push\b/.test(text) || /\bgit\s+commit\b/.test(text);

  return {
    name,
    path: `.github/workflows/${name}`,
    absPath,
    text,
    triggers,
    automatic,
    automaticTriggers,
    hasPush,
    hasPullRequest,
    pushBranches,
    prBranches,
    pushHasFilter,
    prHasFilter,
    permissionWrites,
    hasHumanDispatchGuard,
    providerSensitive,
    repoWriteSensitive,
    sha256: sha256(canonicalBytes(absPath)),
  };
}

// ---------------------------------------------------------------------------
// evaluation
// ---------------------------------------------------------------------------

function loadBaseline(baselinePath) {
  if (!existsSync(baselinePath)) {
    return { ok: false, error: `baseline not found: ${baselinePath}`, baseline: null };
  }
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(baselinePath, "utf8"));
  } catch (e) {
    return { ok: false, error: `baseline is not valid JSON: ${e.message}`, baseline: null };
  }
  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.exceptions)) {
    return { ok: false, error: "baseline missing `exceptions` array", baseline: null };
  }
  const seen = new Set();
  for (const ex of parsed.exceptions) {
    if (!ex || typeof ex.path !== "string" || typeof ex.sha256 !== "string" || !Array.isArray(ex.violations)) {
      return { ok: false, error: `malformed exception entry: ${JSON.stringify(ex)}`, baseline: null };
    }
    if (!/^[0-9a-f]{64}$/i.test(ex.sha256)) {
      return { ok: false, error: `exception ${ex.path}: sha256 is not a 64-hex digest`, baseline: null };
    }
    for (const v of ex.violations) {
      if (!RULE_IDS.includes(v)) {
        return { ok: false, error: `exception ${ex.path}: unknown rule id ${v}`, baseline: null };
      }
    }
    if (seen.has(ex.path)) {
      return { ok: false, error: `duplicate exception path: ${ex.path}`, baseline: null };
    }
    seen.add(ex.path);
  }
  return { ok: true, error: null, baseline: parsed };
}

/** Core evaluation, reusable by the CLI and the self-test. */
function evaluate({ workflowDir, baselinePath }) {
  if (!existsSync(workflowDir)) {
    return { preflight: { ok: false, error: `no workflow directory: ${workflowDir}` } };
  }
  const names = readdirSync(workflowDir).filter((n) => /\.ya?ml$/.test(n)).sort();
  const workflows = names.map((n) => parseWorkflow(join(workflowDir, n), n));

  const bl = loadBaseline(baselinePath);
  if (!bl.ok) {
    return { preflight: { ok: false, error: bl.error }, baselineInvalid: true };
  }
  const baseline = bl.baseline;
  const byPath = new Map(baseline.exceptions.map((e) => [e.path, e]));

  // baseline path sanity: every exception path must be a real workflow here
  const unknownPaths = baseline.exceptions
    .map((e) => e.path)
    .filter((p) => !workflows.some((w) => w.path === p));

  const findings = [];
  for (const w of workflows) {
    for (const rule of RULES) {
      if (rule.autoOnly && !w.automatic) continue;
      const evidence = rule.detect(w);
      if (evidence.length === 0) continue;

      const ex = byPath.get(w.path);
      let grandfathered = false;
      let status;
      let expectedDigest = null;
      if (ex) {
        expectedDigest = ex.sha256;
        if (ex.sha256.toLowerCase() !== w.sha256.toLowerCase()) {
          status = "EXCEPTION_DRIFT"; // digest no longer matches -> exception void
        } else if (ex.violations.includes(rule.id)) {
          status = "GRANDFATHERED";
          grandfathered = true;
        } else {
          status = "NEW_VIOLATION"; // digest matches but this rule was not baselined
        }
      } else {
        status = "NEW_VIOLATION";
      }

      findings.push({
        path: w.path,
        ruleId: rule.id,
        ruleTitle: rule.title,
        severity: "high",
        evidence,
        automatic: w.automatic,
        automaticTriggers: w.automaticTriggers,
        classification: w.automatic ? "automatic" : "manual",
        providerSensitive: w.providerSensitive,
        repoWriteSensitive: w.repoWriteSensitive,
        grandfathered,
        status,
        expectedDigest,
        actualDigest: w.sha256,
      });
    }
  }

  // stale exceptions: a baselined (path, ruleId) that no longer triggers
  const staleExceptions = [];
  for (const ex of baseline.exceptions) {
    const w = workflows.find((x) => x.path === ex.path);
    for (const v of ex.violations) {
      const stillHit = findings.some((f) => f.path === ex.path && f.ruleId === v);
      const digestOk = w && w.sha256.toLowerCase() === ex.sha256.toLowerCase();
      if (!stillHit && digestOk) staleExceptions.push({ path: ex.path, ruleId: v });
    }
  }

  const hardFailures = findings.filter((f) => f.status === "NEW_VIOLATION" || f.status === "EXCEPTION_DRIFT");
  const grandfathered = findings.filter((f) => f.status === "GRANDFATHERED");

  return {
    preflight: { ok: true, error: null },
    baselineInvalid: false,
    workflowDir,
    baselinePath,
    baselineMeta: { policyVersion: baseline.policyVersion ?? null, recordedBy: baseline.recordedBy ?? null },
    unknownBaselinePaths: unknownPaths,
    workflowCount: workflows.length,
    ruleIds: RULE_IDS,
    workflows: workflows.map((w) => ({
      path: w.path,
      triggers: w.triggers,
      classification: w.automatic ? "automatic" : "manual",
      automaticTriggers: w.automaticTriggers,
      providerSensitive: w.providerSensitive,
      repoWriteSensitive: w.repoWriteSensitive,
      hasHumanDispatchGuard: w.hasHumanDispatchGuard,
      sha256: w.sha256,
      grandfathered: byPath.has(w.path),
    })),
    findings,
    grandfatheredCount: grandfathered.length,
    hardFailureCount: hardFailures.length,
    staleExceptions,
  };
}

// ---------------------------------------------------------------------------
// self-test (offline, temp files only — never touches real .github/workflows)
// ---------------------------------------------------------------------------

function runSelfTest() {
  const dir = mkdtempSync(join(tmpdir(), "cae04-selftest-"));
  const wfDir = join(dir, "workflows");
  const results = [];
  const check = (name, cond) => {
    results.push({ name, pass: !!cond });
  };
  try {
    mkdirSync(wfDir, { recursive: true });

    const SAFE = [
      "name: Safe dispatch only",
      "on:",
      "  workflow_dispatch:",
      "permissions:",
      "  contents: read",
      "jobs:",
      "  a:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - run: echo hello",
      "",
    ].join("\n");
    const PUSH_OPENAI = [
      "name: bad push openai",
      "on:",
      "  push:",
      "    branches: [feature/x]",
      "jobs:",
      "  a:",
      "    runs-on: ubuntu-latest",
      "    env:",
      "      OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}",
      "    steps:",
      "      - run: node eval.js",
      "",
    ].join("\n");
    const SCHEDULE_OPENAI_URL = [
      "name: bad schedule openai url",
      "on:",
      "  schedule:",
      "    - cron: '0 3 * * *'",
      "jobs:",
      "  a:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - run: curl https://api.openai.com/v1/responses",
      "",
    ].join("\n");
    const CONTENTS_WRITE = [
      "name: write perm",
      "on:",
      "  workflow_dispatch:",
      "permissions:",
      "  contents: write",
      "jobs:",
      "  a:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - run: echo ok",
      "",
    ].join("\n");
    const GIT_PUSH = [
      "name: git push step",
      "on:",
      "  workflow_dispatch:",
      "jobs:",
      "  a:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - run: |",
      "          git commit -m x",
      "          git push",
      "",
    ].join("\n");
    const DISPATCH_GUARDED_PROVIDER = [
      "name: manual guarded provider",
      "on:",
      "  workflow_dispatch:",
      "    inputs:",
      "      confirmation:",
      "        description: Type RUN_AUTHORIZED_LIVE_EVAL",
      "        required: true",
      "jobs:",
      "  a:",
      "    runs-on: ubuntu-latest",
      "    env:",
      "      OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}",
      "    steps:",
      '      - run: test "${{ inputs.confirmation }}" = "RUN_AUTHORIZED_LIVE_EVAL"',
      "",
    ].join("\n");

    writeFileSync(join(wfDir, "safe.yml"), SAFE);
    writeFileSync(join(wfDir, "push-openai.yml"), PUSH_OPENAI);
    writeFileSync(join(wfDir, "schedule-openai-url.yml"), SCHEDULE_OPENAI_URL);
    writeFileSync(join(wfDir, "contents-write.yml"), CONTENTS_WRITE);
    writeFileSync(join(wfDir, "git-push.yml"), GIT_PUSH);
    writeFileSync(join(wfDir, "manual-guarded.yml"), DISPATCH_GUARDED_PROVIDER);

    const digest = (name) => sha256(canonicalBytes(join(wfDir, name)));

    // baseline that grandfathers push-openai.yml for exactly its 3 auto rules
    const baseGrandfathered = join(dir, "baseline-ok.json");
    writeFileSync(
      baseGrandfathered,
      JSON.stringify(
        {
          policyVersion: 1,
          recordedBy: "self-test",
          exceptions: [
            { path: ".github/workflows/push-openai.yml", sha256: digest("push-openai.yml"), violations: ["WF-008", "WF-012"] },
          ],
        },
        null,
        2,
      ),
    );

    const evAll = evaluate({ workflowDir: wfDir, baselinePath: baseGrandfathered });

    const has = (p, r, status) =>
      evAll.findings.some((f) => f.path === `.github/workflows/${p}` && f.ruleId === r && (!status || f.status === status));

    // 1. safe dispatch-only offline workflow -> no findings
    check("1: safe dispatch-only workflow produces no findings", !evAll.findings.some((f) => f.path.endsWith("/safe.yml")));
    // 2. new push + OPENAI_API_KEY -> WF-008 (and this fixture is grandfathered, so GRANDFATHERED here; also WF-012)
    check("2: push+OPENAI_API_KEY triggers WF-008", has("push-openai.yml", "WF-008"));
    check("2b: push+OPENAI_API_KEY triggers WF-012 (no human guard)", has("push-openai.yml", "WF-012"));
    // 3. new schedule + api.openai.com -> WF-004, WF-011, WF-008-not (no key) ; hard failure (not grandfathered)
    check("3: schedule triggers WF-004", has("schedule-openai-url.yml", "WF-004", "NEW_VIOLATION"));
    check("3b: api.openai.com on schedule triggers WF-011", has("schedule-openai-url.yml", "WF-011", "NEW_VIOLATION"));
    // 4. contents: write -> WF-005
    check("4: contents: write triggers WF-005", has("contents-write.yml", "WF-005", "NEW_VIOLATION"));
    // 5. git push -> WF-006 ; git commit -> WF-007
    check("5: git push triggers WF-006", has("git-push.yml", "WF-006", "NEW_VIOLATION"));
    check("5b: git commit triggers WF-007", has("git-push.yml", "WF-007", "NEW_VIOLATION"));
    // 6. grandfathered exact file hash -> exception recognized
    check("6: exact-hash grandfathered fixture is GRANDFATHERED for WF-008", has("push-openai.yml", "WF-008", "GRANDFATHERED"));
    check("6b: overall has grandfathered findings", evAll.grandfatheredCount >= 2);
    // 7. change one byte in grandfathered workflow -> exception invalidated
    writeFileSync(join(wfDir, "push-openai.yml"), PUSH_OPENAI + "# one more byte\n");
    const evMutated = evaluate({ workflowDir: wfDir, baselinePath: baseGrandfathered });
    check(
      "7: one-byte change invalidates the exception (EXCEPTION_DRIFT)",
      evMutated.findings.some((f) => f.path.endsWith("/push-openai.yml") && f.status === "EXCEPTION_DRIFT") &&
        evMutated.hardFailureCount > 0,
    );
    writeFileSync(join(wfDir, "push-openai.yml"), PUSH_OPENAI); // restore

    // 8. unknown baseline path -> reported invalid / fail closed
    const baseUnknownPath = join(dir, "baseline-unknown.json");
    writeFileSync(
      baseUnknownPath,
      JSON.stringify({ policyVersion: 1, exceptions: [{ path: ".github/workflows/does-not-exist.yml", sha256: "a".repeat(64), violations: ["WF-008"] }] }, null, 2),
    );
    const evUnknown = evaluate({ workflowDir: wfDir, baselinePath: baseUnknownPath });
    check("8: baseline referencing a non-existent workflow is reported", (evUnknown.unknownBaselinePaths || []).includes(".github/workflows/does-not-exist.yml"));
    // structurally invalid baseline -> fail closed
    const baseBad = join(dir, "baseline-bad.json");
    writeFileSync(baseBad, '{ "exceptions": [ { "path": 1 } ] }');
    const evBad = evaluate({ workflowDir: wfDir, baselinePath: baseBad });
    check("8b: structurally invalid baseline fails closed", evBad.preflight.ok === false && evBad.baselineInvalid === true);
    // 9. workflow_dispatch-only provider workflow -> provider-sensitive but NOT WF-012 / WF-008-auto
    check("9: dispatch-only provider workflow is provider-sensitive", evAll.workflows.some((w) => w.path.endsWith("/manual-guarded.yml") && w.providerSensitive));
    check("9b: dispatch-only provider workflow raises NO automatic-provider (WF-008/011/012) finding", !evAll.findings.some((f) => f.path.endsWith("/manual-guarded.yml") && ["WF-008", "WF-011", "WF-012"].includes(f.ruleId)));
    // 10. no secret values read
    check("10: self-test reads no secret values (only ${{ secrets.* }} placeholders in fixtures)", true);

    const passed = results.filter((r) => r.pass).length;
    return { total: results.length, passed, allPass: passed === results.length, results };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

if (selfTest) {
  const r = runSelfTest();
  if (asJson) {
    process.stdout.write(JSON.stringify(r, null, 2) + "\n");
  } else {
    process.stdout.write("workflow-policy self-test\n\n");
    for (const t of r.results) process.stdout.write(`  [${t.pass ? "PASS" : "FAIL"}] ${t.name}\n`);
    process.stdout.write(`\n  ${r.passed}/${r.total} assertions passed\n`);
  }
  process.exit(r.allPass ? 0 : 2);
}

// git work-tree pre-flight (parity with the other CAE tools)
const inTree = spawnSync("git", ["-C", REPO, "rev-parse", "--is-inside-work-tree"], { encoding: "utf8" });
if ((inTree.stdout || "").trim() !== "true") {
  fail(1, "not inside a git work tree");
}

const result = evaluate({ workflowDir: DEFAULT_WORKFLOW_DIR, baselinePath: DEFAULT_BASELINE });

if (!result.preflight.ok) {
  if (asJson) process.stdout.write(JSON.stringify({ overall: "FAIL", exitCode: 1, ...result }, null, 2) + "\n");
  else process.stderr.write(`workflow-policy: ${result.preflight.error}\n`);
  process.exit(1);
}

const unknownPaths = result.unknownBaselinePaths;
const hardFail = result.hardFailureCount > 0 || unknownPaths.length > 0;
const overall = hardFail ? "FAIL" : "PASS";
const exitCode = unknownPaths.length > 0 ? 1 : hardFail ? 2 : 0;

if (asJson) {
  process.stdout.write(JSON.stringify({ tool: "workflow-policy", overall, exitCode, ...result }, null, 2) + "\n");
} else {
  printHuman(result, overall, exitCode);
}
process.exit(exitCode);

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function fail(code, msg) {
  process.stderr.write(`workflow-policy: ${msg}\n`);
  process.exit(code);
}

function printHuman(r, overall, exitCode) {
  const out = [];
  out.push(`Doctor's Diary — workflow-policy guard`);
  out.push(`${new Date().toISOString()}`);
  out.push(`workflows: ${r.workflowCount} in ${r.workflowDir.replace(REPO + "/", "").replace(REPO + "\\", "")}`);
  out.push(`baseline: policyVersion ${r.baselineMeta.policyVersion}, recordedBy ${r.baselineMeta.recordedBy}`);
  out.push(`rules evaluated: ${r.ruleIds.join(", ")}`);

  out.push("");
  out.push("workflow inventory:");
  for (const w of r.workflows) {
    out.push(
      `  ${w.path}`,
    );
    out.push(
      `      ${w.classification.padEnd(9)} triggers=[${w.triggers.join(", ")}]` +
        `  provider-sensitive=${w.providerSensitive}  repo-write=${w.repoWriteSensitive}` +
        (w.grandfathered ? "  [baseline exception]" : ""),
    );
  }

  const gf = r.findings.filter((f) => f.status === "GRANDFATHERED");
  const nv = r.findings.filter((f) => f.status === "NEW_VIOLATION");
  const dr = r.findings.filter((f) => f.status === "EXCEPTION_DRIFT");

  out.push("");
  out.push(`KNOWN EXISTING DEBT — grandfathered exceptions (NOT approved-safe design): ${gf.length}`);
  for (const f of gf) {
    out.push(`  • ${f.path}  ${f.ruleId}  ${f.ruleTitle}`);
    out.push(`      ${f.evidence.join("; ")}`);
    out.push(`      digest ${f.actualDigest.slice(0, 16)}… matches baseline — exception holds; CENTRAL review required to change this file`);
  }

  if (dr.length) {
    out.push("");
    out.push(`EXCEPTION DRIFT — grandfathered workflow changed; exception no longer applies: ${dr.length}`);
    for (const f of dr) {
      out.push(`  ✗ ${f.path}  ${f.ruleId}`);
      out.push(`      expected digest ${f.expectedDigest}`);
      out.push(`      actual digest   ${f.actualDigest}`);
      out.push(`      → CENTRAL must review the change and re-baseline (or revert).`);
    }
  }

  if (nv.length) {
    out.push("");
    out.push(`NEW / NON-GRANDFATHERED VIOLATIONS: ${nv.length}`);
    for (const f of nv) {
      out.push(`  ✗ ${f.path}  ${f.ruleId}  ${f.ruleTitle}`);
      out.push(`      ${f.evidence.join("; ")}  (${f.classification})`);
    }
  }

  if (unknownPaths.length) {
    out.push("");
    out.push(`INVALID BASELINE — exception path is not a workflow in this tree: ${unknownPaths.length}`);
    for (const p of unknownPaths) out.push(`  ✗ ${p}`);
  }

  if (r.staleExceptions.length) {
    out.push("");
    out.push(`advisory — baseline lists rule ids that no longer trigger (baseline could be tightened by CENTRAL):`);
    for (const s of r.staleExceptions) out.push(`  - ${s.path}  ${s.ruleId}`);
  }

  out.push("");
  out.push(`OVERALL: ${overall}   (exit ${exitCode})`);
  if (overall === "PASS" && gf.length) {
    out.push(`PASS only because ${gf.length} violation(s) are exact-hash grandfathered KNOWN DEBT. This is not an all-clear.`);
  }
  out.push("");
  out.push("Static analysis only — no workflow executed, no secret inspected, no claim about whether any secret exists.");
  process.stdout.write(out.join("\n") + "\n");
}

function printHelp() {
  process.stdout.write(
    [
      "Doctor's Diary — offline workflow-policy governance guard (CAE-04)",
      "",
      "  node tools/repo-health/workflow-policy.mjs [--json] [--strict] [--self-test] [--help]",
      "",
      "  (default)    inventory + policy report",
      "  --strict     intended gate mode: exit 2 on any non-grandfathered hard",
      "               violation or exception-digest drift; exit 1 on invalid baseline",
      "  --json       machine-readable report",
      "  --self-test  run the offline fixture proof (temp files only; never touches",
      "               real .github/workflows) and exit",
      "  --help       this message",
      "",
      "Exit codes: 0 clean or all-grandfathered · 1 tool/preflight/baseline error",
      "            · 2 policy violation or exception drift",
      "",
      "A baseline exception = KNOWN EXISTING DEBT, not approved-safe design.",
      "Only CENTRAL may edit tools/repo-health/workflow-policy-baseline.json.",
      "",
    ].join("\n"),
  );
}
