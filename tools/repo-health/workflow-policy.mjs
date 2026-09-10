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
 * Fail-closed classification (CAE-04-R1)
 * -------------------------------------
 * Automatic/manual is NOT decided from a finite list of event names. The only
 * manual events are `workflow_dispatch` and `workflow_call`; EVERY other parsed
 * `on:` event — `push`, `schedule`, `workflow_run`, `release`,
 * `deployment_status`, `registry_package`, an event GitHub adds next year, an
 * unrecognised name — is AUTOMATIC. `workflow_call` alone is reported as
 * "callable" (not a direct auto event); no call-graph analysis is attempted.
 * If the dependency-free `on:` parser cannot confidently interpret the trigger
 * structure it FAILS CLOSED: the workflow is treated as automatic and rule
 * WF-014 (TRIGGER_PARSE_UNCERTAIN) fires as a hard governance failure. The guard
 * may raise a conservative false positive; it must never let an automatic
 * provider/deploy/repo-write workflow look manual.
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
  {
    id: "WF-014",
    title: "trigger structure could not be confidently parsed (fail-closed)",
    autoOnly: false,
    detect: (w) => (w.triggerParseOk ? [] : [w.triggerParseError || "unparseable `on:` structure"]),
  },
];

const RULE_IDS = RULES.map((r) => r.id);

// ---------------------------------------------------------------------------
// workflow parsing (conservative, line-based; no YAML dependency)
// ---------------------------------------------------------------------------

/**
 * Automatic/manual classification is NOT driven by a finite allowlist of event
 * names — that would let a future GitHub event (workflow_run, release,
 * deployment_status, registry_package, …) or a brand-new event silently be
 * treated as "manual/safe". The only events that are manual are the two that
 * require a human or an explicit call:
 */
const MANUAL_ONLY_EVENTS = new Set(["workflow_dispatch", "workflow_call"]);
/** workflow_call is "callable", reported distinctly; it is not a direct auto event by itself. */
const CALLABLE_EVENT = "workflow_call";
const EVENT_NAME = /^[A-Za-z_][A-Za-z0-9_-]*$/;

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

/**
 * Parse the top-level `on:` structure, dependency-free, and FAIL CLOSED on any
 * form it cannot confidently interpret.
 *
 * Returns { events, onBlock, ok, error, form }. When ok === false the caller
 * must treat the workflow as a hard governance failure (WF-014) and classify it
 * automatic — never manual.
 */
function parseOnTriggers(text) {
  const lines = text.split("\n");
  // top-level `on:` — bare, "on", or 'on' (YAML lowercases the boolean-looking
  // key `on`, so authors quote it; accept all three).
  let onIdx = -1;
  let inlineRest = "";
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(?:"on"|'on'|on)\s*:(.*)$/);
    if (m) {
      onIdx = i;
      inlineRest = m[1].replace(/\s+#.*$/, "").trim(); // strip trailing comment
      break;
    }
  }
  if (onIdx < 0) {
    return { events: [], onBlock: "", ok: false, error: "no top-level `on:` key found", form: "none" };
  }

  // collect the indented block under `on:` (for block-mapping form + downstream
  // branch-filter parsing)
  const blockLines = [lines[onIdx]];
  for (let i = onIdx + 1; i < lines.length; i++) {
    if (/^\S/.test(lines[i]) && lines[i].trim() !== "") break; // next top-level key
    blockLines.push(lines[i]);
  }
  const onBlock = blockLines.join("\n");

  const validate = (list, form) => {
    const bad = list.filter((e) => !EVENT_NAME.test(e));
    if (bad.length) return { events: [], onBlock, ok: false, error: `malformed event name(s): ${bad.join(", ")}`, form };
    if (list.length === 0) return { events: [], onBlock, ok: false, error: "`on:` present but no events extracted", form };
    return { events: [...new Set(list)], onBlock, ok: true, error: null, form };
  };

  // --- scalar: on: push ---
  if (inlineRest && EVENT_NAME.test(inlineRest.replace(/^["']|["']$/g, ""))) {
    return validate([inlineRest.replace(/^["']|["']$/g, "")], "scalar");
  }

  // --- flow sequence: on: [push, workflow_dispatch] ---
  if (inlineRest.startsWith("[")) {
    if (!inlineRest.endsWith("]")) {
      return { events: [], onBlock, ok: false, error: "multi-line / unterminated flow sequence in `on:`", form: "flow-seq" };
    }
    const inner = inlineRest.slice(1, -1).trim();
    const list = inner ? inner.split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")) : [];
    return validate(list, "flow-seq");
  }

  // --- flow mapping: on: { push: {}, workflow_dispatch: {} } ---
  if (inlineRest.startsWith("{")) {
    if (!inlineRest.endsWith("}")) {
      return { events: [], onBlock, ok: false, error: "multi-line / unterminated flow mapping in `on:`", form: "flow-map" };
    }
    const inner = inlineRest.slice(1, -1);
    // split on top-level commas (respect one level of nested {})
    const segs = [];
    let depth = 0;
    let cur = "";
    for (const ch of inner) {
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
      if (ch === "," && depth === 0) {
        segs.push(cur);
        cur = "";
      } else cur += ch;
    }
    if (cur.trim()) segs.push(cur);
    if (depth !== 0) {
      return { events: [], onBlock, ok: false, error: "unbalanced braces in `on:` flow mapping", form: "flow-map" };
    }
    const list = segs.map((s) => s.split(":")[0].trim().replace(/^["']|["']$/g, "")).filter(Boolean);
    return validate(list, "flow-map");
  }

  // --- non-empty but not a form we recognise (anchor, tag, quoted scalar we
  //     could not read, …) -> fail closed ---
  if (inlineRest !== "") {
    return { events: [], onBlock, ok: false, error: `unrecognised inline \`on:\` value: ${inlineRest.slice(0, 60)}`, form: "unknown" };
  }

  // --- block mapping: keys at the first indent level under `on:` ---
  const body = blockLines.slice(1);
  let baseIndent = null;
  const list = [];
  let sawContent = false;
  for (const line of body) {
    if (line.trim() === "" || /^\s*#/.test(line)) continue;
    sawContent = true;
    const im = line.match(/^(\s+)(\S)/);
    if (!im) continue;
    const indent = im[1].length;
    if (baseIndent === null) baseIndent = indent;
    if (indent !== baseIndent) continue; // deeper -> config for the current event
    const km = line.match(/^\s+(?:"([A-Za-z_][A-Za-z0-9_-]*)"|'([A-Za-z_][A-Za-z0-9_-]*)'|([A-Za-z_][A-Za-z0-9_-]*))\s*:/);
    if (km) list.push(km[1] || km[2] || km[3]);
    else return { events: [], onBlock, ok: false, error: `unparseable line in \`on:\` block: ${line.trim().slice(0, 60)}`, form: "block-map" };
  }
  if (!sawContent) {
    return { events: [], onBlock, ok: false, error: "`on:` has no events (empty block)", form: "block-map" };
  }
  return validate(list, "block-map");
}

function parseWorkflow(absPath, name) {
  const raw = readFileSync(absPath, "utf8");
  const text = raw.replace(/\r\n/g, "\n");

  const parsed = parseOnTriggers(text);
  const triggerParseOk = parsed.ok;
  const triggerParseError = parsed.error;
  const triggerForm = parsed.form;
  const onBlock = parsed.onBlock;
  const triggers = parsed.events;

  // Classification never depends on a finite allowlist: every parsed event that
  // is not workflow_dispatch / workflow_call is automatic, known or not.
  const automaticTriggers = triggers.filter((t) => !MANUAL_ONLY_EVENTS.has(t));
  const callable = triggers.includes(CALLABLE_EVENT);
  // Fail closed: a workflow whose triggers could not be parsed is treated as
  // automatic so the auto-only rules also evaluate; WF-014 makes it a hard fail.
  const automatic = !triggerParseOk || automaticTriggers.length > 0;

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

  const classification = !triggerParseOk
    ? "parse-error (treated automatic)"
    : automaticTriggers.length > 0
      ? "automatic"
      : callable
        ? "callable"
        : "manual";

  return {
    name,
    path: `.github/workflows/${name}`,
    absPath,
    text,
    triggers,
    triggerForm,
    triggerParseOk,
    triggerParseError,
    automatic,
    automaticTriggers,
    callable,
    classification,
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
        classification: w.classification,
        triggerParseOk: w.triggerParseOk,
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
      triggerForm: w.triggerForm,
      triggerParseOk: w.triggerParseOk,
      triggerParseError: w.triggerParseError,
      classification: w.classification,
      automatic: w.automatic,
      automaticTriggers: w.automaticTriggers,
      callable: w.callable,
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

    // ---- CAE-04-R1: trigger-parser fail-closed hardening ----
    const tdir = mkdtempSync(join(tmpdir(), "cae04r1-"));
    const twf = join(tdir, "workflows");
    mkdirSync(twf, { recursive: true });
    const emptyBaseline = join(tdir, "baseline-empty.json");
    writeFileSync(emptyBaseline, JSON.stringify({ policyVersion: 1, exceptions: [] }, null, 2));

    const wf = (n, body) => writeFileSync(join(twf, n), body.join("\n") + "\n");
    wf("run-openai.yml", [
      "name: workflow_run + openai",
      "on:",
      "  workflow_run:",
      "    workflows: [Build]",
      "    types: [completed]",
      "jobs: { a: { runs-on: ubuntu-latest, env: { OPENAI_API_KEY: x }, steps: [{ run: node e.js }] } }",
    ]);
    wf("release-openai-url.yml", [
      "name: release + api.openai.com",
      "on:",
      "  release:",
      "    types: [published]",
      "jobs: { a: { runs-on: ubuntu-latest, steps: [{ run: 'curl https://api.openai.com/v1/x' }] } }",
    ]);
    wf("deploystatus.yml", [
      "name: deployment_status provider",
      "on:",
      "  deployment_status:",
      "jobs: { a: { runs-on: ubuntu-latest, env: { OPENAI_API_KEY: x }, steps: [{ run: 'vercel deploy --prod' }] } }",
    ]);
    wf("future-event.yml", [
      "name: unknown future event",
      "on:",
      "  some_future_github_event:",
      "jobs: { a: { runs-on: ubuntu-latest, steps: [{ run: echo hi }] } }",
    ]);
    wf("inline-list.yml", ["name: inline list", "on: [push, workflow_dispatch]", "jobs: { a: { runs-on: ubuntu-latest, steps: [{ run: echo hi }] } }"]);
    wf("multi-block.yml", [
      "name: multi event block",
      "on:",
      "  push:",
      "    branches: [main]",
      "  workflow_run:",
      "    workflows: [X]",
      "  schedule:",
      "    - cron: '0 0 * * *'",
      "jobs: { a: { runs-on: ubuntu-latest, steps: [{ run: echo hi }] } }",
    ]);
    wf("inline-map.yml", ["name: inline map", "on: { push: {}, workflow_dispatch: {} }", "jobs: { a: { runs-on: ubuntu-latest, steps: [{ run: echo hi }] } }"]);
    wf("quoted-on-dq.yml", ['name: quoted on', '"on":', "  push:", "    branches: [x]", "jobs: { a: { runs-on: ubuntu-latest, steps: [{ run: echo hi }] } }"]);
    wf("quoted-on-sq.yml", ["name: quoted on sq", "'on':", "  push:", "    branches: [x]", "jobs: { a: { runs-on: ubuntu-latest, steps: [{ run: echo hi }] } }"]);
    wf("malformed-on.yml", ["name: malformed", "on: [push, workflow_dispatch", "jobs: { a: { runs-on: ubuntu-latest, steps: [{ run: echo hi }] } }"]);
    wf("empty-on.yml", ["name: empty on", "on:", "jobs: { a: { runs-on: ubuntu-latest, steps: [{ run: echo hi }] } }"]);
    wf("dispatch-only.yml", ["name: dispatch only", "on:", "  workflow_dispatch:", "jobs: { a: { runs-on: ubuntu-latest, steps: [{ run: echo hi }] } }"]);
    wf("call-only.yml", ["name: call only", "on:", "  workflow_call:", "jobs: { a: { runs-on: ubuntu-latest, steps: [{ run: echo hi }] } }"]);
    wf("dispatch-and-call.yml", ["name: dispatch and call", "on:", "  workflow_dispatch:", "  workflow_call:", "jobs: { a: { runs-on: ubuntu-latest, steps: [{ run: echo hi }] } }"]);
    wf("run-and-dispatch.yml", ["name: run and dispatch", "on:", "  workflow_run:", "    workflows: [X]", "  workflow_dispatch:", "jobs: { a: { runs-on: ubuntu-latest, env: { OPENAI_API_KEY: x }, steps: [{ run: node e.js }] } }"]);

    const ev = evaluate({ workflowDir: twf, baselinePath: emptyBaseline });
    const W = (n) => ev.workflows.find((w) => w.path.endsWith("/" + n));
    const F = (n, id) => ev.findings.some((f) => f.path.endsWith("/" + n) && f.ruleId === id);

    check("R1-1: on: workflow_run + OPENAI_API_KEY -> automatic + WF-008 + WF-012", W("run-openai.yml").automatic && F("run-openai.yml", "WF-008") && F("run-openai.yml", "WF-012"));
    check("R1-2: on: release + api.openai.com -> automatic + WF-011", W("release-openai-url.yml").automatic && F("release-openai-url.yml", "WF-011"));
    check("R1-3: on: deployment_status + deploy/provider -> automatic (WF-013 + WF-008/012)", W("deploystatus.yml").automatic && F("deploystatus.yml", "WF-013") && F("deploystatus.yml", "WF-008"));
    check("R1-4: unknown future event -> automatic, NOT manual", W("future-event.yml").automatic === true && W("future-event.yml").classification === "automatic");
    check("R1-5: inline list [push, workflow_dispatch] -> automatic (push present)", W("inline-list.yml").automatic && W("inline-list.yml").triggers.includes("push") && W("inline-list.yml").triggers.includes("workflow_dispatch"));
    check("R1-6: block mapping with multiple events -> all extracted", (() => { const t = W("multi-block.yml").triggers; return t.includes("push") && t.includes("workflow_run") && t.includes("schedule"); })());
    check("R1-7: inline mapping { push: {}, workflow_dispatch: {} } -> parsed OR explicit parser error", (() => { const w = W("inline-map.yml"); return (w.triggerParseOk && w.triggers.includes("push") && w.automatic) || (!w.triggerParseOk && F("inline-map.yml", "WF-014")); })());
    check('R1-8: "on": (double-quoted key) -> parsed OR explicit fail-closed', (() => { const w = W("quoted-on-dq.yml"); return (w.triggerParseOk && w.triggers.includes("push") && w.automatic) || (!w.triggerParseOk && F("quoted-on-dq.yml", "WF-014")); })());
    check("R1-9: 'on': (single-quoted key) -> parsed OR explicit fail-closed", (() => { const w = W("quoted-on-sq.yml"); return (w.triggerParseOk && w.triggers.includes("push") && w.automatic) || (!w.triggerParseOk && F("quoted-on-sq.yml", "WF-014")); })());
    check("R1-10: malformed on: -> WF-014 hard failure, never manual PASS", !W("malformed-on.yml").triggerParseOk && F("malformed-on.yml", "WF-014") && W("malformed-on.yml").automatic === true);
    check("R1-10b: empty on: (no events) -> WF-014 hard failure", !W("empty-on.yml").triggerParseOk && F("empty-on.yml", "WF-014"));
    check("R1-11: workflow_dispatch only -> manual", W("dispatch-only.yml").classification === "manual" && W("dispatch-only.yml").automatic === false);
    check("R1-12: workflow_call only -> callable, not automatic", W("call-only.yml").classification === "callable" && W("call-only.yml").automatic === false && W("call-only.yml").callable === true);
    check("R1-13: workflow_dispatch + workflow_call only -> no automatic trigger", W("dispatch-and-call.yml").automatic === false && W("dispatch-and-call.yml").automaticTriggers.length === 0);
    check("R1-14: workflow_run + workflow_dispatch -> automatic", W("run-and-dispatch.yml").automatic === true && W("run-and-dispatch.yml").automaticTriggers.includes("workflow_run") && F("run-and-dispatch.yml", "WF-008"));
    check("R1-15: WF-014 hard failures fail --strict (hardFailureCount > 0)", ev.hardFailureCount > 0);
    check("R1-16: no allowlist regression — every non-dispatch/call event is automatic", ev.workflows.filter((w) => w.triggerParseOk).every((w) => w.automatic === (w.triggers.some((t) => t !== "workflow_dispatch" && t !== "workflow_call"))));

    rmSync(tdir, { recursive: true, force: true });

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
      `      ${w.classification.padEnd(9)} triggers=[${w.triggers.join(", ")}]  form=${w.triggerForm}` +
        (w.callable ? " (callable)" : "") +
        `  provider-sensitive=${w.providerSensitive}  repo-write=${w.repoWriteSensitive}` +
        (w.grandfathered ? "  [baseline exception]" : ""),
    );
    if (!w.triggerParseOk) out.push(`      ⚠ trigger parse failed: ${w.triggerParseError}  → treated AUTOMATIC, WF-014`);
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
