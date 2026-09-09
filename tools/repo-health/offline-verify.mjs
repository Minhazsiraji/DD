#!/usr/bin/env node
/**
 * Doctor's Diary — safe offline verification runner (CAE-02).
 *
 * One reusable local gate so any engineering lane can reproduce the standard
 * safe/offline quality bar without hand-copying command sequences.
 *
 * It is NOT an authoritative release gate. CENTRAL remains authoritative.
 *
 * Guarantees
 * ----------
 *  - Every gate runs OFFLINE. No OpenAI, Deepgram, Supabase, Vercel or database
 *    traffic. `npm audit` (network) is never part of the default/full run.
 *  - Before any child process starts, the child environment is sanitised:
 *    provider/database credentials are removed and safe mock values are forced,
 *    so a developer's real `.env`-populated shell cannot flip a test or build
 *    into live-provider mode. `.env.local` is never read.
 *  - The runner never writes product source or configuration. `next typegen` /
 *    `next build` may create the normal ignored `.next/**` artifacts; nothing
 *    tracked changes.
 *
 * Usage
 * -----
 *   node tools/repo-health/offline-verify.mjs            full offline run
 *   node tools/repo-health/offline-verify.mjs --json     machine-readable report
 *   node tools/repo-health/offline-verify.mjs --quick    fast subset (NOT authoritative)
 *   node tools/repo-health/offline-verify.mjs --audit     append the network npm-audit gate
 *   node tools/repo-health/offline-verify.mjs --help
 *
 * Exit-code contract
 * ------------------
 *   0  every requested verification gate passed
 *   1  runner / tooling execution error, OR fail-closed pre-flight
 *      (not a git work tree, missing repo-health / workflow-policy tool, missing
 *       npm, wrong cwd, or a scope/governance gate failed — repo-health --strict
 *       or workflow-policy --strict)
 *   2  the runner executed but one or more ordinary quality gates FAILED
 *
 * `--audit` adds a gate that REACHES THE NETWORK (npm registry). Its result is
 * reported separately and, when it fails, contributes exit code 2 like any
 * other requested gate. It is never run unless explicitly asked for.
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");
const REPO_HEALTH = join(HERE, "repo-health.mjs");
const WORKFLOW_POLICY = join(HERE, "workflow-policy.mjs");
const FROZEN_MANIFEST = join(HERE, "frozen-manifest.json");
const IS_WIN = process.platform === "win32";

// Invoke package tooling as `node <cli.js> …`, never a `.cmd`/`.bat` shim:
// current Node refuses to spawn those without `shell: true`, and we want no
// shell in the loop. NPM_CLI keeps the exact `npm test` / `npm run …`
// semantics the task specifies. NEXT_BIN runs `next typegen` directly.
const NPM_CLI = join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
const NEXT_BIN = join(REPO, "node_modules", "next", "dist", "bin", "next");

const flags = new Set(process.argv.slice(2));
if (flags.has("--help") || flags.has("-h")) {
  printHelp();
  process.exit(0);
}
const asJson = flags.has("--json");
const quick = flags.has("--quick");
const withAudit = flags.has("--audit");

// ---------------------------------------------------------------------------
// 1. Child-process environment sanitisation
// ---------------------------------------------------------------------------

/**
 * Build the environment every gate runs under. Start from the current env
 * (Windows `next build` needs a lot of system vars), then:
 *   - delete known provider / database credentials outright
 *   - delete anything that still smells like a credential (pattern sweep),
 *     preserving NEXT_PUBLIC_* and a small infrastructure allowlist
 *   - force safe mock/offline modes
 *   - inject synthetic, non-secret public build values
 */
function buildSafeEnv() {
  const env = { ...process.env };
  const removed = [];

  // Always reported as "targeted", whether or not the key was actually present
  // in this shell — so the run is auditable regardless of the caller's env.
  const EXPLICIT_REMOVE = [
    "OPENAI_API_KEY",
    "OPENAI_BASE_URL",
    "OPENAI_API_BASE",
    "OPENAI_ORG_ID",
    "OPENAI_ORGANIZATION",
    "DEEPGRAM_API_KEY",
    "DEEPGRAM_PROJECT_ID",
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_DB_URL",
    "SUPABASE_ACCESS_TOKEN",
    "DATABASE_URL",
    "DIRECT_URL",
    "DD_V2_LOCAL_DATABASE_URL",
    "ANTHROPIC_API_KEY",
    "VERCEL_TOKEN",
  ];

  // Keys that look like secrets but must survive (none are secrets).
  const KEEP = new Set([
    "npm_config_cache",
    "npm_config_userconfig",
    "npm_config_globalconfig",
  ]);
  const SECRETISH = /(_API_KEY|_SECRET|_SECRET_KEY|_ACCESS_TOKEN|_AUTH_TOKEN|_PASSWORD|_PRIVATE_KEY|SERVICE_ROLE)$/i;
  const PROVIDER_PREFIX = /^(OPENAI|DEEPGRAM|ANTHROPIC|SUPABASE)_/i;

  for (const key of Object.keys(env)) {
    if (key.startsWith("NEXT_PUBLIC_")) continue; // public by definition
    if (KEEP.has(key)) continue;
    if (
      EXPLICIT_REMOVE.includes(key) ||
      SECRETISH.test(key) ||
      (PROVIDER_PREFIX.test(key) && /KEY|TOKEN|SECRET|URL|DSN/i.test(key))
    ) {
      if (env[key] !== undefined) {
        delete env[key];
        removed.push(key);
      }
    }
  }

  // Force safe offline / mock behaviour. These override whatever the shell had.
  const forced = {
    PA1_SYNTHETIC_AI_EVAL: "disabled",
    AI_MODE: "mock",
    NOTIFICATION_MODE: "mock",
    PAYMENT_MODE: "mock",
    // Synthetic, non-secret public build values (mirrors the CI placeholders).
    NEXT_PUBLIC_SUPABASE_URL: "https://offline-verify.invalid.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "offline_verify_placeholder_anon_key_000000000000",
    NEXT_PUBLIC_SITE_URL: "http://localhost:3000",
    // Bounded non-secret value for modules that expect a signing secret to exist.
    PA1_PROPOSAL_SIGNING_SECRET: "offline-verify-non-secret-signing-value-min-32-bytes",
    // Quiet, deterministic tooling.
    CI: "1",
    NEXT_TELEMETRY_DISABLED: "1",
    DO_NOT_TRACK: "1",
  };
  Object.assign(env, forced);

  return {
    env,
    removed: removed.sort(),
    targeted: EXPLICIT_REMOVE.slice().sort(),
    forced: Object.keys(forced).sort(),
  };
}

const {
  env: SAFE_ENV,
  removed: REMOVED_KEYS,
  targeted: TARGETED_KEYS,
  forced: FORCED_KEYS,
} = buildSafeEnv();

// ---------------------------------------------------------------------------
// 2. Gate definitions
// ---------------------------------------------------------------------------

/** Ordered. `scope: true` marks a gate that fails the run closed (exit 1). */
const GATE = {
  repoHealth: {
    name: "repository-health (strict)",
    display: "node tools/repo-health/repo-health.mjs --strict",
    argv: [process.execPath, [REPO_HEALTH, "--strict"]],
    scope: true,
  },
  workflowPolicy: {
    name: "workflow-policy (strict)",
    display: "node tools/repo-health/workflow-policy.mjs --strict",
    argv: [process.execPath, [WORKFLOW_POLICY, "--strict"]],
    scope: true,
  },
  test: {
    name: "offline test suite (npm test)",
    display: "npm test",
    argv: [process.execPath, [NPM_CLI, "test"]],
  },
  typegen: {
    name: "next typegen",
    display: "next typegen",
    argv: [process.execPath, [NEXT_BIN, "typegen"]],
  },
  typecheck: {
    name: "typecheck (npm run typecheck)",
    display: "npm run typecheck",
    argv: [process.execPath, [NPM_CLI, "run", "typecheck"]],
  },
  lint: {
    name: "eslint (npm run lint)",
    display: "npm run lint",
    argv: [process.execPath, [NPM_CLI, "run", "lint"]],
  },
  build: {
    name: "production build (npm run build)",
    display: "npm run build",
    argv: [process.execPath, [NPM_CLI, "run", "build"]],
  },
  diffCheck: {
    name: "git diff --check",
    display: "git diff --check",
    argv: ["git", ["-C", REPO, "diff", "--check"]],
  },
};

const FULL_GATES = [
  GATE.repoHealth,
  GATE.workflowPolicy,
  GATE.test,
  GATE.typegen,
  GATE.typecheck,
  GATE.lint,
  GATE.build,
  GATE.diffCheck,
];

// `next typegen` is a prerequisite for a meaningful `typecheck` under Next 16
// (the App Router `PageProps` / `LayoutProps` globals live in generated
// `.next/types/**`). It is fast, writes only ignored artifacts, and keeps
// --quick's typecheck honest, so it is included here despite the task's
// minimal list.
const QUICK_GATES = [
  GATE.repoHealth,
  GATE.workflowPolicy,
  GATE.typegen,
  GATE.typecheck,
  GATE.lint,
  GATE.diffCheck,
];

const AUDIT_GATE = {
  name: "npm audit (NETWORK — production deps)",
  display: "node tools/repo-health/repo-health.mjs --audit",
  argv: [process.execPath, [REPO_HEALTH, "--audit"]],
  network: true,
};

// ---------------------------------------------------------------------------
// 3. Runner
// ---------------------------------------------------------------------------

const MAX_CAPTURE = 16000; // chars of stdout+stderr kept per failing gate

function runGate(gate) {
  const [cmd, args] = gate.argv;
  const started = Date.now();
  const res = spawnSync(cmd, args, {
    cwd: REPO,
    env: SAFE_ENV,
    encoding: "utf8",
    shell: false,
    maxBuffer: 128 * 1024 * 1024,
    windowsHide: true,
  });
  const durationMs = Date.now() - started;

  const spawnError = res.error ? String(res.error.message || res.error) : null;
  const exitCode = res.status;
  const signal = res.signal;
  const ok = !spawnError && exitCode === 0;

  let evidence = "";
  if (!ok) {
    const out = (res.stdout || "") + (res.stderr ? `\n--- stderr ---\n${res.stderr}` : "");
    evidence = out.length > MAX_CAPTURE ? out.slice(-MAX_CAPTURE) : out;
  }

  return {
    name: gate.name,
    command: gate.display || [cmd, ...args].join(" "),
    status: ok ? "PASS" : "FAIL",
    exitCode: exitCode ?? null,
    signal: signal ?? null,
    durationMs,
    spawnError,
    scope: Boolean(gate.scope),
    network: Boolean(gate.network),
    evidence,
    // Keep the tail of stdout even on success only for the test gate, so the
    // report can show the skip line for the live-provider suite.
    note:
      ok && /npm test/.test(gate.name)
        ? extractSkipProof(res.stdout || "")
        : null,
  };
}

function extractSkipProof(stdout) {
  const lines = stdout.split(/\r?\n/);
  const hit = lines.filter((l) =>
    /terra-live-synthetic-eval|skipped|Test Files|Tests\s+\d/.test(l),
  );
  return hit.slice(-8).join("\n") || null;
}

// ---------------------------------------------------------------------------
// 4. Fail-closed pre-flight
// ---------------------------------------------------------------------------

function preflight() {
  const problems = [];
  const inWorkTree = spawnSync("git", ["-C", REPO, "rev-parse", "--is-inside-work-tree"], {
    encoding: "utf8",
  });
  if ((inWorkTree.stdout || "").trim() !== "true") {
    problems.push("not inside a git work tree");
  }
  if (!existsSync(REPO_HEALTH)) problems.push(`missing ${rel(REPO_HEALTH)}`);
  if (!existsSync(WORKFLOW_POLICY)) problems.push(`missing ${rel(WORKFLOW_POLICY)}`);
  if (!existsSync(FROZEN_MANIFEST)) problems.push(`missing ${rel(FROZEN_MANIFEST)}`);
  if (!existsSync(join(REPO, "package.json"))) problems.push("missing package.json (wrong cwd?)");
  if (!existsSync(NPM_CLI)) problems.push(`npm CLI not found next to node (${rel(NPM_CLI)})`);
  if (!existsSync(join(REPO, "node_modules"))) {
    problems.push("node_modules/ absent — run your project's install first (deps are not modified by this tool)");
  } else if (!existsSync(NEXT_BIN) && !quick) {
    problems.push(`next binary not found (${rel(NEXT_BIN)}) — incomplete install`);
  }
  return problems;
}

function rel(p) {
  return p.replace(REPO + (IS_WIN ? "\\" : "/"), "").replace(/\\/g, "/");
}

/**
 * Read-only advisory: several suites in this repo assert against LF-exact file
 * contents or LF git-blob hashes (frozen-boundary checks, CSS block scans,
 * component source snapshots). On a Windows checkout with core.autocrlf=true
 * the working tree is CRLF and those suites fail spuriously while passing in CI.
 * Surface it so a `npm test` failure here is not misread as a code regression.
 */
function checkoutLineEndingAdvisory() {
  const res = spawnSync(
    "git",
    ["-C", REPO, "ls-files", "--eol", "--", "src", "supabase", "db", "scripts"],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  if (res.status !== 0 || !res.stdout) return { checked: false };
  const crlf = [];
  for (const line of res.stdout.split(/\r?\n/)) {
    // format: "i/lf    w/crlf  attr/…   \tpath"
    const m = line.match(/^i\/(\S+)\s+w\/(\S+)\s+attr\/(\S*)\s+\t(.+)$/);
    if (!m) continue;
    const [, index, work, , file] = m;
    if (index === "lf" && work === "crlf") crlf.push(file);
  }
  return {
    checked: true,
    autocrlf: (spawnSync("git", ["-C", REPO, "config", "--get", "core.autocrlf"], {
      encoding: "utf8",
    }).stdout || "").trim() || "(unset)",
    crlfWorkingTreeFileCount: crlf.length,
    examples: crlf.slice(0, 8),
    note:
      crlf.length > 0
        ? "Working tree has CRLF for LF-committed files; LF-sensitive tests (frozen-hash / source-snapshot) will fail here but pass in CI. Not a code defect on this branch."
        : "",
  };
}

// ---------------------------------------------------------------------------
// 5. Main
// ---------------------------------------------------------------------------

const preflightProblems = preflight();
if (preflightProblems.length > 0) {
  const report = {
    tool: "tools/repo-health/offline-verify.mjs",
    mode: quick ? "quick" : "full",
    generatedAt: new Date().toISOString(),
    preflight: { ok: false, problems: preflightProblems },
    overall: "FAIL",
    exitCode: 1,
  };
  emit(report, () => {
    console.error("offline-verify: fail-closed pre-flight:");
    for (const p of preflightProblems) console.error(`  - ${p}`);
  });
  process.exit(1);
}

const gates = quick ? [...QUICK_GATES] : [...FULL_GATES];
if (withAudit) gates.push(AUDIT_GATE);

const results = [];
let stoppedEarly = false;

for (const gate of gates) {
  const r = runGate(gate);
  results.push(r);
  // Scope/integrity gate failing => fail closed, do not run the rest.
  if (r.scope && r.status === "FAIL") {
    stoppedEarly = true;
    break;
  }
}

const anyScopeFail = results.some((r) => r.scope && r.status === "FAIL");
const anyGateFail = results.some((r) => r.status === "FAIL");
const allRequestedRan = results.length === gates.length;

let overall;
let exitCode;
if (anyScopeFail) {
  overall = "FAIL";
  exitCode = 1; // scope/integrity == fail-closed pre-flight class
} else if (anyGateFail) {
  overall = "FAIL";
  exitCode = 2;
} else {
  overall = "PASS";
  exitCode = 0;
}

const report = {
  tool: "tools/repo-health/offline-verify.mjs",
  mode: quick ? "quick" : "full",
  auditIncluded: withAudit,
  generatedAt: new Date().toISOString(),
  repoRoot: REPO,
  preflight: { ok: true, problems: [] },
  environmentSanitisation: {
    targetedForRemoval: TARGETED_KEYS,
    removedFromChildEnv: REMOVED_KEYS,
    forcedInChildEnv: FORCED_KEYS,
    forcedValues: {
      PA1_SYNTHETIC_AI_EVAL: "disabled",
      AI_MODE: "mock",
      NOTIFICATION_MODE: "mock",
      PAYMENT_MODE: "mock",
    },
    readsDotEnvLocal: false,
  },
  checkoutAdvisory: checkoutLineEndingAdvisory(),
  gatesPlanned: gates.map((g) => g.name),
  gatesRun: results.map((r) => r.name),
  stoppedEarly,
  allRequestedRan,
  results: results.map((r) => ({
    gate: r.name,
    command: r.command,
    status: r.status,
    exitCode: r.exitCode,
    signal: r.signal,
    durationMs: r.durationMs,
    durationHuman: humanMs(r.durationMs),
    network: r.network,
    scope: r.scope,
    spawnError: r.spawnError,
    note: r.note || undefined,
    evidence: r.status === "FAIL" ? r.evidence : undefined,
  })),
  overall,
  exitCode,
};

emit(report, () => printHuman(report));
process.exit(exitCode);

// ---------------------------------------------------------------------------
// output
// ---------------------------------------------------------------------------

function emit(report, humanFn) {
  if (asJson) process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  else humanFn();
}

function humanMs(ms) {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  return `${m}m${Math.round(s - m * 60)}s`;
}

function printHuman(r) {
  const out = [];
  out.push(`Doctor's Diary — offline verification (${r.mode}${r.auditIncluded ? " +audit" : ""})`);
  out.push(`${r.generatedAt}`);
  out.push("");
  out.push("child env sanitised:");
  out.push(`  targeted ${r.environmentSanitisation.targetedForRemoval.join(", ")}`);
  out.push(`  removed  ${r.environmentSanitisation.removedFromChildEnv.join(", ") || "(none were present in this shell)"}`);
  out.push(`  forced   ${r.environmentSanitisation.forcedInChildEnv.join(", ")}`);
  out.push(`  .env.local read: no`);
  const adv = r.checkoutAdvisory;
  if (adv && adv.checked && adv.crlfWorkingTreeFileCount > 0) {
    out.push("");
    out.push(
      `  ! checkout advisory: core.autocrlf=${adv.autocrlf}; ${adv.crlfWorkingTreeFileCount} ` +
        `LF-committed files are CRLF in the working tree.`,
    );
    out.push(`    ${adv.note}`);
    out.push(`    e.g. ${adv.examples.slice(0, 4).join(", ")}`);
  }
  out.push("");
  const w = Math.max(...r.results.map((x) => x.gate.length), 10);
  for (const g of r.results) {
    const mark = g.status === "PASS" ? "PASS" : "FAIL";
    out.push(
      `  [${mark}] ${g.gate.padEnd(w)}  exit ${String(g.exitCode).padStart(3)}  ${g.durationHuman}` +
        (g.network ? "   (network)" : ""),
    );
    if (g.note) out.push(indent(g.note, 10));
    if (g.status === "FAIL") {
      if (g.spawnError) out.push(`           spawn error: ${g.spawnError}`);
      out.push(`           command: ${g.command}`);
      if (g.evidence) {
        out.push("           ---- captured output (tail) ----");
        out.push(indent(g.evidence.trimEnd(), 11));
        out.push("           ---- end ----");
      }
    }
  }
  if (r.stoppedEarly) {
    out.push("");
    out.push("  scope/integrity gate failed — remaining gates were NOT run (fail-closed).");
  }
  out.push("");
  out.push(`OVERALL: ${r.overall}   (exit ${r.exitCode})`);
  out.push("");
  out.push("Not an authoritative release gate. CENTRAL remains authoritative.");
  process.stdout.write(out.join("\n") + "\n");
}

function indent(text, n) {
  const pad = " ".repeat(n);
  return text.split("\n").map((l) => pad + l).join("\n");
}

function printHelp() {
  process.stdout.write(
    [
      "Doctor's Diary — safe offline verification runner (CAE-02)",
      "",
      "  node tools/repo-health/offline-verify.mjs [--json] [--quick] [--audit] [--help]",
      "",
      "  (default)  full offline run:",
      "             repo-health --strict, workflow-policy --strict, npm test,",
      "             next typegen, typecheck, lint, production build, git diff --check",
      "  --quick    repo-health --strict, workflow-policy --strict, next typegen,",
      "             typecheck, lint, git diff --check  (fast subset: no npm test,",
      "             no build — NOT the authoritative full verification)",
      "  --audit    additionally run the npm-audit gate — THIS REACHES THE NETWORK;",
      "             never part of the default run",
      "  --json     machine-readable final report on stdout",
      "  --help     this message",
      "",
      "Exit codes:",
      "  0  all requested gates passed",
      "  1  runner/tooling error, or fail-closed pre-flight, or a scope/governance",
      "     gate (repo-health --strict / workflow-policy --strict) failed",
      "  2  the runner ran but one or more quality gates failed",
      "",
      "Offline guarantee: provider/database credentials are stripped from the",
      "child environment and PA1_SYNTHETIC_AI_EVAL is forced to 'disabled' before",
      "any gate runs. .env.local is never read. npm audit is opt-in only.",
      "",
    ].join("\n"),
  );
}
