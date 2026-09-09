#!/usr/bin/env node
/**
 * Doctor's Diary — offline repository-health baseline (CAE-01).
 *
 * A dependency-free developer tool. It READS repository state and prints a
 * single consolidated report so CENTRAL, MD2 and CSU do not have to reconstruct
 * the same git / workflow / frozen-integrity picture by hand every time.
 *
 * It does NOT modify anything, does NOT call any network provider, and does NOT
 * read secret values. The one action that reaches the network is an explicit,
 * opt-in `npm audit` behind the `--audit` flag.
 *
 * Usage:
 *   node tools/repo-health/repo-health.mjs                 # human-readable report
 *   node tools/repo-health/repo-health.mjs --json          # machine-readable JSON
 *   node tools/repo-health/repo-health.mjs --audit         # also run `npm audit --omit=dev`
 *   node tools/repo-health/repo-health.mjs --strict         # exit non-zero on drift / main mismatch
 *   node tools/repo-health/repo-health.mjs --help
 *
 * Exit codes:
 *   0  report produced (default — findings are informational)
 *   1  a check the tool itself could not run (e.g. not a git repo)
 *   2  --strict was set and at least one hard finding is present
 *      (frozen-artifact drift, origin/main SHA mismatch, missing critical path)
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");
const MANIFEST_PATH = join(HERE, "frozen-manifest.json");

const args = new Set(process.argv.slice(2));
if (args.has("--help") || args.has("-h")) {
  printHelp();
  process.exit(0);
}
const asJson = args.has("--json");
const runAudit = args.has("--audit");
const strict = args.has("--strict");

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------

/** Run git in the repo, return trimmed stdout, or null on any failure. */
function git(gitArgs) {
  try {
    return execFileSync("git", ["-C", REPO, ...gitArgs], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 64 * 1024 * 1024,
    }).trim();
  } catch {
    return null;
  }
}

function safeRead(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

/** Recursively list files under dir (absolute paths). Never throws. */
function walk(dir, acc = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".next" || entry.name === ".git") continue;
      walk(full, acc);
    } else if (entry.isFile()) {
      acc.push(full);
    }
  }
  return acc;
}

// ---------------------------------------------------------------------------
// sections
// ---------------------------------------------------------------------------

function collectGit() {
  const isRepo = git(["rev-parse", "--is-inside-work-tree"]) === "true";
  if (!isRepo) return { isRepo: false };

  const head = git(["rev-parse", "HEAD"]);
  const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]);
  const status = git(["status", "--porcelain"]);
  const originMain = git(["rev-parse", "origin/main"]);
  const diffCheck = (() => {
    try {
      execFileSync("git", ["-C", REPO, "diff", "--check"], { stdio: ["ignore", "pipe", "pipe"] });
      return { clean: true, detail: "" };
    } catch (err) {
      return { clean: false, detail: String(err.stdout || err.stderr || "").trim() };
    }
  })();

  let ahead = null;
  let behind = null;
  if (originMain) {
    const counts = git(["rev-list", "--left-right", "--count", `origin/main...HEAD`]);
    if (counts) {
      const [b, a] = counts.split(/\s+/).map((n) => Number(n));
      behind = b;
      ahead = a;
    }
  }

  return {
    isRepo: true,
    head,
    branch,
    workingTreeClean: status === "",
    dirtyFileCount: status ? status.split("\n").length : 0,
    originMainSha: originMain,
    aheadOfOriginMain: ahead,
    behindOriginMain: behind,
    diffCheckClean: diffCheck.clean,
    diffCheckDetail: diffCheck.detail,
  };
}

function collectToolchain() {
  const nodeOnPath = (() => {
    try {
      return execFileSync(process.platform === "win32" ? "where" : "which", ["node"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      })
        .trim()
        .split("\n")[0];
    } catch {
      return null;
    }
  })();
  let npmVersion = null;
  try {
    npmVersion = execFileSync("npm", ["--version"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      shell: process.platform === "win32",
    }).trim();
  } catch {
    npmVersion = null;
  }
  const pkg = JSON.parse(safeRead(join(REPO, "package.json")) || "{}");
  return {
    nodeVersion: process.version,
    nodeExecPath: process.execPath,
    nodeOnSystemPath: nodeOnPath,
    npmVersion,
    packageName: pkg.name ?? null,
    packageVersion: pkg.version ?? null,
    declaredNext: pkg.dependencies?.next ?? null,
    declaredVitest: pkg.devDependencies?.vitest ?? null,
    declaredTypescript: pkg.devDependencies?.typescript ?? null,
  };
}

function collectFrozen(manifest) {
  const results = [];
  for (const artifact of manifest.frozenArtifacts ?? []) {
    const abs = join(REPO, artifact.path);
    if (!existsSync(abs)) {
      results.push({ ...artifact, state: "MISSING", actual: null });
      continue;
    }
    const actual = git(["hash-object", artifact.path]);
    results.push({
      ...artifact,
      state: actual === artifact.blob ? "OK" : "DRIFT",
      actual,
    });
  }
  return results;
}

function collectCriticalPaths(manifest) {
  return (manifest.criticalPaths ?? []).map((p) => ({
    path: p,
    present: existsSync(join(REPO, p)),
  }));
}

function collectTests() {
  const srcDir = join(REPO, "src");
  const files = walk(srcDir).map((f) => relative(REPO, f).replace(/\\/g, "/"));
  const testFiles = files.filter((f) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(f));
  const byTopDir = {};
  for (const f of testFiles) {
    const parts = f.split("/");
    const key = parts.slice(0, 3).join("/"); // e.g. src/features/prescriptions
    byTopDir[key] = (byTopDir[key] ?? 0) + 1;
  }
  return {
    totalTestFiles: testFiles.length,
    totalSourceFiles: files.length,
    byArea: Object.fromEntries(
      Object.entries(byTopDir).sort((a, b) => b[1] - a[1]),
    ),
  };
}

/**
 * Static, read-only inspection of .github/workflows/*.yml.
 * We deliberately parse with line scanning, not a YAML library, to stay
 * dependency-free. The signals we extract are coarse but sufficient:
 *   - trigger kinds (push / pull_request / schedule / workflow_dispatch / etc.)
 *   - push branch filters
 *   - whether the workflow can start WITHOUT a human (any non-dispatch trigger)
 *   - `permissions:` grants that allow writing back to the repo
 *   - presence of `git push` / `git commit` in run steps
 *   - live-provider term hits (OpenAI / Deepgram / synthetic-eval / service role)
 */
function collectWorkflows(manifest) {
  const dir = join(REPO, ".github", "workflows");
  const providerTerms = manifest.liveProviderTerms ?? [];
  let names = [];
  try {
    names = readdirSync(dir).filter((n) => /\.ya?ml$/.test(n)).sort();
  } catch {
    return { dir: ".github/workflows", present: false, workflows: [] };
  }

  const workflows = names.map((name) => {
    const text = safeRead(join(dir, name)) || "";
    const lines = text.split(/\r?\n/);

    // ---- trigger block (from `on:` to the next top-level key) ----
    const onStart = lines.findIndex((l) => /^on:\s*(\{.*\}\s*)?$/.test(l) || /^on:\s*\S/.test(l));
    let onBlock = [];
    if (onStart >= 0) {
      onBlock.push(lines[onStart]);
      for (let i = onStart + 1; i < lines.length; i++) {
        if (/^\S/.test(lines[i]) && !/^\s/.test(lines[i])) break;
        onBlock.push(lines[i]);
      }
    }
    const onText = onBlock.join("\n");
    const triggers = [];
    for (const kind of [
      "push",
      "pull_request",
      "pull_request_target",
      "schedule",
      "workflow_dispatch",
      "workflow_call",
      "repository_dispatch",
      "issue_comment",
    ]) {
      if (new RegExp(`^\\s*${kind}:`, "m").test(onText)) triggers.push(kind);
    }
    const pushBranches = [];
    {
      const m = onText.match(/push:[\s\S]*?branches:\s*\n((?:\s*-\s*\S+\s*\n?)+)/);
      if (m) {
        for (const bl of m[1].split("\n")) {
          const bm = bl.match(/-\s*(\S+)/);
          if (bm) pushBranches.push(bm[1]);
        }
      }
    }

    const nonDispatchTriggers = triggers.filter(
      (t) => t !== "workflow_dispatch" && t !== "workflow_call",
    );
    const canStartAutomatically = nonDispatchTriggers.length > 0;
    const manualOnly = triggers.length > 0 && !canStartAutomatically;

    // ---- permissions ----
    const permWrites = [];
    for (const m of text.matchAll(/^\s*(contents|packages|pull-requests|id-token|actions|deployments):\s*write\s*$/gim)) {
      permWrites.push(m[1]);
    }

    // ---- run-step repo mutation ----
    const hasGitPush = /^\s*git push(\s|$)/m.test(text) || /\bgit push\b/.test(text);
    const hasGitCommit = /\bgit commit\b/.test(text);

    // ---- live provider term hits ----
    const providerHits = {};
    for (const term of providerTerms) {
      const re = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g");
      const count = (text.match(re) || []).length;
      if (count > 0) providerHits[term] = count;
    }
    const referencesSecrets = /\bsecrets\.[A-Z0-9_]+/.test(text);
    const referencesLiveProvider = Object.keys(providerHits).length > 0;

    return {
      file: name,
      triggers,
      pushBranches,
      canStartAutomatically,
      manualOnly,
      permissionWrites: permWrites,
      hasGitPush,
      hasGitCommit,
      referencesSecrets,
      referencesLiveProvider,
      providerHits,
    };
  });

  // ---- cross-workflow risk rollups ----
  const autoLiveProvider = workflows
    .filter((w) => w.canStartAutomatically && w.referencesLiveProvider)
    .map((w) => w.file);
  const autoRepoWrite = workflows
    .filter((w) => w.canStartAutomatically && (w.permissionWrites.length > 0 || w.hasGitPush))
    .map((w) => w.file);
  const secretAwareWorkflows = workflows.filter((w) => w.referencesSecrets).map((w) => w.file);

  return {
    dir: ".github/workflows",
    present: true,
    count: workflows.length,
    workflows,
    risks: {
      automaticLiveProviderWorkflows: autoLiveProvider,
      automaticRepoWriteWorkflows: autoRepoWrite,
      secretAwareWorkflows,
    },
  };
}

function collectDuplicateConfigRisks() {
  const findings = [];
  const vt = existsSync(join(REPO, "vitest.config.ts"));
  const vm = existsSync(join(REPO, "vitest.config.mts"));
  if (vt && vm) {
    findings.push(
      "Two Vitest configs present (vitest.config.ts AND vitest.config.mts). " +
        "Only one wins at runtime by Vitest's own resolution order; the other is " +
        "silently dead. Confirm which is authoritative.",
    );
  }
  return findings;
}

function collectAudit() {
  if (!runAudit) return { ran: false };
  try {
    const out = execFileSync("npm", ["audit", "--omit=dev", "--json"], {
      cwd: REPO,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      shell: process.platform === "win32",
      maxBuffer: 32 * 1024 * 1024,
    });
    const parsed = JSON.parse(out);
    return { ran: true, vulnerabilities: parsed.metadata?.vulnerabilities ?? null };
  } catch (err) {
    // npm audit exits non-zero when vulnerabilities exist; stdout still holds JSON.
    const out = String(err.stdout || "");
    try {
      const parsed = JSON.parse(out);
      return { ran: true, vulnerabilities: parsed.metadata?.vulnerabilities ?? null };
    } catch {
      return { ran: true, error: "npm audit could not be parsed (offline or npm missing?)" };
    }
  }
}

// ---------------------------------------------------------------------------
// assemble
// ---------------------------------------------------------------------------

const manifestRaw = safeRead(MANIFEST_PATH);
if (!manifestRaw) {
  console.error(`repo-health: cannot read ${relative(REPO, MANIFEST_PATH)}`);
  process.exit(1);
}
const manifest = JSON.parse(manifestRaw);

const report = {
  tool: "tools/repo-health/repo-health.mjs",
  generatedAt: new Date().toISOString(),
  repoRoot: REPO,
  manifestBaseSha: manifest.baseSha ?? null,
  expectedMainSha: manifest.expectedMainSha ?? null,
  git: collectGit(),
  toolchain: collectToolchain(),
  frozenArtifacts: null,
  criticalPaths: null,
  tests: collectTests(),
  workflows: collectWorkflows(manifest),
  configRisks: collectDuplicateConfigRisks(),
  audit: collectAudit(),
};

if (!report.git.isRepo) {
  console.error("repo-health: not inside a git work tree — cannot produce a report.");
  process.exit(1);
}

report.frozenArtifacts = collectFrozen(manifest);
report.criticalPaths = collectCriticalPaths(manifest);

// ---- hard findings (only these can fail --strict) ----
const hardFindings = [];
for (const a of report.frozenArtifacts) {
  if (a.state !== "OK") hardFindings.push(`frozen ${a.state}: ${a.path}`);
}
for (const c of report.criticalPaths) {
  if (!c.present) hardFindings.push(`critical path missing: ${c.path}`);
}
if (
  report.expectedMainSha &&
  report.git.originMainSha &&
  report.git.originMainSha !== report.expectedMainSha
) {
  hardFindings.push(
    `origin/main is ${report.git.originMainSha}, expected ${report.expectedMainSha}`,
  );
}
report.hardFindings = hardFindings;

// ---------------------------------------------------------------------------
// output
// ---------------------------------------------------------------------------

if (asJson) {
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
} else {
  printHuman(report);
}

process.exit(strict && hardFindings.length > 0 ? 2 : 0);

// ---------------------------------------------------------------------------
// presentation
// ---------------------------------------------------------------------------

function h(title) {
  return `\n== ${title} ${"=".repeat(Math.max(0, 68 - title.length))}`;
}
function yn(v) {
  return v ? "yes" : "no";
}

function printHuman(r) {
  const out = [];
  out.push(`Doctor's Diary repository health  —  ${r.generatedAt}`);
  out.push(`repo: ${r.repoRoot}`);

  out.push(h("git"));
  out.push(`  HEAD                 ${r.git.head}`);
  out.push(`  branch               ${r.git.branch}`);
  out.push(`  working tree clean   ${yn(r.git.workingTreeClean)}${r.git.workingTreeClean ? "" : ` (${r.git.dirtyFileCount} entries)`}`);
  out.push(`  git diff --check     ${r.git.diffCheckClean ? "clean" : "ISSUES\n" + indent(r.git.diffCheckDetail, 6)}`);
  out.push(`  origin/main          ${r.git.originMainSha ?? "(unknown — fetch first)"}`);
  out.push(`  expected main        ${r.expectedMainSha ?? "(none pinned)"}`);
  out.push(
    `  main match           ${
      r.git.originMainSha == null
        ? "unknown"
        : r.git.originMainSha === r.expectedMainSha
          ? "yes"
          : "NO — MISMATCH"
    }`,
  );
  out.push(`  HEAD vs origin/main   ahead ${r.git.aheadOfOriginMain ?? "?"}, behind ${r.git.behindOriginMain ?? "?"}`);
  out.push(`  CAE base SHA          ${r.manifestBaseSha ?? "(none)"}`);

  out.push(h("toolchain"));
  out.push(`  node (this process)  ${r.toolchain.nodeVersion}   ${r.toolchain.nodeExecPath}`);
  out.push(`  node on system PATH  ${r.toolchain.nodeOnSystemPath ?? "no"}`);
  out.push(`  npm                  ${r.toolchain.npmVersion ?? "not found"}`);
  out.push(`  package              ${r.toolchain.packageName}@${r.toolchain.packageVersion}`);
  out.push(`  next / vitest / ts   ${r.toolchain.declaredNext} / ${r.toolchain.declaredVitest} / ${r.toolchain.declaredTypescript}`);

  out.push(h("frozen artifacts"));
  for (const a of r.frozenArtifacts) {
    out.push(`  [${a.state.padEnd(7)}] ${a.id.padEnd(15)} ${a.path}`);
    if (a.state === "DRIFT") out.push(`            want ${a.blob}  got ${a.actual}`);
  }

  out.push(h("critical paths"));
  const missing = r.criticalPaths.filter((c) => !c.present);
  out.push(`  ${r.criticalPaths.length - missing.length}/${r.criticalPaths.length} present`);
  for (const c of missing) out.push(`  MISSING  ${c.path}`);

  out.push(h("tests"));
  out.push(`  ${r.tests.totalTestFiles} test files across ${r.tests.totalSourceFiles} source files under src/`);
  for (const [area, n] of Object.entries(r.tests.byArea)) {
    out.push(`  ${String(n).padStart(3)}  ${area}`);
  }

  out.push(h("workflows"));
  out.push(`  ${r.workflows.count} workflow file(s) in ${r.workflows.dir}`);
  for (const w of r.workflows.workflows) {
    out.push(`  - ${w.file}`);
    out.push(`      triggers        ${w.triggers.join(", ") || "(none parsed)"}`);
    if (w.pushBranches.length) out.push(`      push branches   ${w.pushBranches.join(", ")}`);
    out.push(`      starts w/o human ${yn(w.canStartAutomatically)}${w.manualOnly ? "   (manual dispatch only)" : ""}`);
    if (w.permissionWrites.length) out.push(`      write perms      ${w.permissionWrites.join(", ")}`);
    if (w.hasGitPush || w.hasGitCommit) out.push(`      repo mutation    ${[w.hasGitCommit && "git commit", w.hasGitPush && "git push"].filter(Boolean).join(" + ")}`);
    if (w.referencesSecrets) out.push(`      references secrets: yes`);
    if (w.referencesLiveProvider)
      out.push(`      live-provider terms: ${Object.entries(w.providerHits).map(([k, v]) => `${k}×${v}`).join(", ")}`);
  }

  out.push(h("CI risk rollups"));
  line(out, "workflows that reference secrets", r.workflows.risks.secretAwareWorkflows);
  line(out, "auto-start + live-provider", r.workflows.risks.automaticLiveProviderWorkflows);
  line(out, "auto-start + repo write / git push", r.workflows.risks.automaticRepoWriteWorkflows);

  out.push(h("config risks"));
  if (r.configRisks.length === 0) out.push("  none detected");
  for (const f of r.configRisks) out.push(`  - ${f}`);

  out.push(h("production dependency audit"));
  if (!r.audit.ran) out.push("  not run (pass --audit to run `npm audit --omit=dev`)");
  else if (r.audit.error) out.push(`  ${r.audit.error}`);
  else out.push(`  ${JSON.stringify(r.audit.vulnerabilities)}`);

  out.push(h("hard findings (fail --strict)"));
  if (r.hardFindings.length === 0) out.push("  none");
  for (const f of r.hardFindings) out.push(`  - ${f}`);

  out.push("");
  process.stdout.write(out.join("\n") + "\n");
}

function line(out, label, list) {
  out.push(`  ${label}: ${list.length ? list.join(", ") : "none"}`);
}
function indent(text, n) {
  const pad = " ".repeat(n);
  return text
    .split("\n")
    .map((l) => pad + l)
    .join("\n");
}

function printHelp() {
  process.stdout.write(
    [
      "Doctor's Diary — offline repository-health baseline (CAE-01)",
      "",
      "  node tools/repo-health/repo-health.mjs [--json] [--audit] [--strict]",
      "",
      "  --json     machine-readable output",
      "  --audit    additionally run `npm audit --omit=dev --json` (network)",
      "  --strict   exit 2 if a hard finding is present (frozen drift,",
      "             origin/main SHA mismatch, missing critical path)",
      "  --help     this message",
      "",
      "Read-only. No provider calls. No secret values are read or printed.",
      "Frozen hashes and pinned SHAs live in tools/repo-health/frozen-manifest.json.",
      "",
    ].join("\n"),
  );
}
