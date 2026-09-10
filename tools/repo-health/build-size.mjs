#!/usr/bin/env node
/**
 * Doctor's Diary — offline build / route size regression baseline (CAE-05).
 *
 * MEASURE -> RECORD -> COMPARE -> REPORT. Dependency-free. It reads the local
 * Next build output under `.next/` after a successful `npm run build` and
 * reports deterministic size + route metrics, and (with --compare) diffs them
 * against a recorded baseline using conservative engineering thresholds.
 *
 * It does NOT modify product code, optimise anything, call any network / provider
 * / database / Vercel endpoint, scrape a CDN, or read secrets. It never invents
 * a metric Next output does not support: anything not deterministically
 * attributable is labelled UNAVAILABLE.
 *
 * Canonical measurement = raw bytes under `.next/static/**` (the browser-shipped
 * set), split into js / css / media, plus the route inventory from
 * `.next/routes-manifest.json`. gzip sizes (Node `zlib` only) are reported
 * separately and are NOT the CDN transfer size and NOT used for the gate.
 *
 * Usage:
 *   node tools/repo-health/build-size.mjs                 # measure + (if baseline) compare
 *   node tools/repo-health/build-size.mjs --json          # machine-readable
 *   node tools/repo-health/build-size.mjs --compare        # measure + compare, apply thresholds
 *   node tools/repo-health/build-size.mjs --self-test      # offline synthetic proof
 *   node tools/repo-health/build-size.mjs --write-baseline --confirm-central
 *   node tools/repo-health/build-size.mjs --help
 *
 * Exit codes:
 *   0  measurement complete; no hard regression (warnings do NOT fail)
 *   1  tool / pre-flight / baseline / build-output error (fail closed)
 *   2  hard size regression detected
 *
 * --write-baseline refuses to run without --confirm-central. Updating the
 * accepted baseline is a CENTRAL decision.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");
const NEXT_DIR = join(REPO, ".next");
const STATIC_DIR = join(NEXT_DIR, "static");
const BASELINE_PATH = join(HERE, "build-size-baseline.json");
const SCHEMA_VERSION = 1;

const MEASUREMENT_DEFINITIONS = {
  "static.rawBytes": "sum of raw bytes of every file under .next/static/** except source maps (.map)",
  "js.rawBytes": "sum of raw bytes of .js/.mjs files under .next/static/**",
  "css.rawBytes": "sum of raw bytes of .css files under .next/static/**",
  "media.rawBytes": "sum of raw bytes of all other .next/static/** files (fonts, images, etc.)",
  largestJsBytes: "size of the single largest .js file under .next/static/** (filenames are content-hashed; compared by size)",
  largestCssBytes: "size of the single largest .css file under .next/static/**",
  routes: "sorted union of routes-manifest.json staticRoutes[].page + dynamicRoutes[].page",
  "informational.gzip": "Node zlib.gzipSync per file, summed — NOT the CDN transfer size, NOT part of the gate",
  "informational.perRouteJsBytes": "UNAVAILABLE — this Turbopack build emits no app-build-manifest.json",
  "informational.serverBuildRawBytes": "bytes under .next/server/** — not browser-shipped, determinism not gate-validated",
};

/**
 * The baseline is only comparable to a build produced with the SAME public env
 * values — Next inlines `process.env.NEXT_PUBLIC_*` into the client bundle, so a
 * different-length placeholder shifts js.rawBytes by a few bytes. These are the
 * canonical values (identical to tools/repo-health/offline-verify.mjs). Rebuild
 * with exactly these before `--write-baseline` or `--compare`.
 */
const CANONICAL_BUILD_ENV = {
  NEXT_PUBLIC_SUPABASE_URL: "https://offline-verify.invalid.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "offline_verify_placeholder_anon_key_000000000000",
  NEXT_PUBLIC_SITE_URL: "http://localhost:3000",
  PA1_SYNTHETIC_AI_EVAL: "disabled",
  AI_MODE: "mock",
  NOTIFICATION_MODE: "mock",
  PAYMENT_MODE: "mock",
};

const THRESHOLDS = {
  // WARN when BOTH the absolute AND the percentage growth are exceeded.
  warn: {
    jsAggregate: { absBytes: 100 * 1024, pct: 10 },
    largestJsChunk: { absBytes: 75 * 1024, pct: 15 },
    cssAggregate: { absBytes: 25 * 1024, pct: 15 },
  },
  // HARD FAIL — clearly excessive growth, or baseline-integrity failure.
  hardFail: {
    jsAggregate: { absBytes: 500 * 1024, pct: 25 },
    staticAggregate: { absBytes: 750 * 1024, pct: 25 },
  },
};

const flags = new Set(process.argv.slice(2));
if (flags.has("--help") || flags.has("-h")) {
  printHelp();
  process.exit(0);
}
const asJson = flags.has("--json");
const doCompare = flags.has("--compare");
const selfTest = flags.has("--self-test");
const writeBaseline = flags.has("--write-baseline");
const confirmCentral = flags.has("--confirm-central");

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function walk(dir, acc = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (e.isFile()) acc.push(p);
  }
  return acc;
}

function categorise(file) {
  const ext = extname(file).toLowerCase();
  if (ext === ".js" || ext === ".mjs") return "js";
  if (ext === ".css") return "css";
  if (ext === ".map") return "map"; // source maps — excluded from canonical totals
  return "media";
}

function sha256Hex(str) {
  return createHash("sha256").update(str).digest("hex");
}

/** Deterministic JSON: object keys sorted recursively. */
function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function fingerprint(metrics) {
  return sha256Hex(stableStringify(metrics));
}

function pct(deltaBytes, baseBytes) {
  if (baseBytes === 0) return deltaBytes === 0 ? 0 : Infinity;
  return (deltaBytes / baseBytes) * 100;
}

function human(bytes) {
  const sign = bytes < 0 ? "-" : "";
  const b = Math.abs(bytes);
  if (b < 1024) return `${sign}${b} B`;
  if (b < 1024 * 1024) return `${sign}${(b / 1024).toFixed(1)} KB`;
  return `${sign}${(b / (1024 * 1024)).toFixed(2)} MB`;
}

// ---------------------------------------------------------------------------
// measurement
// ---------------------------------------------------------------------------

function readRouteInventory() {
  const rm = join(NEXT_DIR, "routes-manifest.json");
  if (!existsSync(rm)) return { routes: [], source: "UNAVAILABLE (no routes-manifest.json)" };
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(rm, "utf8"));
  } catch {
    return { routes: [], source: "UNAVAILABLE (routes-manifest.json unreadable)" };
  }
  const routes = new Set();
  for (const r of parsed.staticRoutes ?? []) if (r.page) routes.add(r.page);
  for (const r of parsed.dynamicRoutes ?? []) if (r.page) routes.add(r.page);
  return { routes: [...routes].sort(), source: ".next/routes-manifest.json (staticRoutes + dynamicRoutes)" };
}

function measure({ withGzip = true } = {}) {
  if (!existsSync(STATIC_DIR)) {
    return { ok: false, error: `no ${rel(STATIC_DIR)} — run \`npm run build\` first` };
  }
  const files = walk(STATIC_DIR);
  if (files.length === 0) {
    return { ok: false, error: `${rel(STATIC_DIR)} is empty — build output missing` };
  }

  const cat = { js: [], css: [], media: [], map: [] };
  for (const f of files) cat[categorise(f)].push({ file: f, size: statSync(f).size });

  const sum = (arr) => arr.reduce((s, x) => s + x.size, 0);
  const jsFiles = cat.js.slice().sort((a, b) => b.size - a.size);
  const cssFiles = cat.css.slice().sort((a, b) => b.size - a.size);

  const staticRawBytes = sum(cat.js) + sum(cat.css) + sum(cat.media); // maps excluded
  const largestJsBytes = jsFiles[0]?.size ?? 0;
  const largestCssBytes = cssFiles[0]?.size ?? 0;

  const inv = readRouteInventory();

  // canonical, fingerprinted, gate-relevant metrics only
  const metrics = {
    static: { rawBytes: staticRawBytes, fileCount: cat.js.length + cat.css.length + cat.media.length },
    js: { rawBytes: sum(cat.js), fileCount: cat.js.length },
    css: { rawBytes: sum(cat.css), fileCount: cat.css.length },
    media: { rawBytes: sum(cat.media), fileCount: cat.media.length },
    largestJsBytes,
    largestCssBytes,
    routeCount: inv.routes.length,
    routes: inv.routes,
  };

  // informational — NOT fingerprinted, NOT gated
  const nameOf = (p) => p.slice(STATIC_DIR.length + 1).replace(/\\/g, "/");
  const largestAssets = [...jsFiles.slice(0, 8), ...cssFiles.slice(0, 3)]
    .sort((a, b) => b.size - a.size)
    .map((x) => ({ name: nameOf(x.file), rawBytes: x.size, note: "content-hashed filename; compare by size, not name" }));

  let gzip = { note: "Node zlib.gzipSync of each file, summed. NOT the CDN transfer size.", jsBytes: null, cssBytes: null };
  if (withGzip) {
    let jz = 0;
    let cz = 0;
    for (const x of cat.js) jz += gzipSync(readFileSync(x.file)).length;
    for (const x of cat.css) cz += gzipSync(readFileSync(x.file)).length;
    gzip.jsBytes = jz;
    gzip.cssBytes = cz;
  }

  const serverDir = join(NEXT_DIR, "server");
  const informational = {
    sourceMapBytes: sum(cat.map),
    sourceMapFileCount: cat.map.length,
    serverBuildRawBytes: existsSync(serverDir) ? walk(serverDir).reduce((s, f) => s + statSync(f).size, 0) : null,
    serverBuildNote: "server-side build artifacts incl. source maps / node-file-trace; not browser-shipped, determinism not gate-validated",
    perRouteJsBytes: "UNAVAILABLE",
    perRouteJsReason:
      "this Next 16 Turbopack build emits no app-build-manifest.json; route→chunk byte attribution is not deterministically available from a manifest",
    routeInventorySource: inv.source,
    largestAssets,
    gzip,
  };

  return { ok: true, error: null, metrics, informational };
}

// ---------------------------------------------------------------------------
// baseline
// ---------------------------------------------------------------------------

function loadBaseline(path) {
  if (!existsSync(path)) return { ok: false, error: `baseline not found: ${rel(path)}` };
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    return { ok: false, error: `baseline is not valid JSON: ${e.message}` };
  }
  if (!parsed || typeof parsed !== "object") return { ok: false, error: "baseline is not an object" };
  if (parsed.schemaVersion !== SCHEMA_VERSION) {
    return { ok: false, error: `baseline schemaVersion ${parsed.schemaVersion} != ${SCHEMA_VERSION}` };
  }
  if (!parsed.metrics || typeof parsed.metrics !== "object") return { ok: false, error: "baseline has no `metrics` object" };
  if (typeof parsed.fingerprint !== "string" || !/^[0-9a-f]{64}$/i.test(parsed.fingerprint)) {
    return { ok: false, error: "baseline `fingerprint` missing or not a sha256" };
  }
  const recomputed = fingerprint(parsed.metrics);
  if (recomputed.toLowerCase() !== parsed.fingerprint.toLowerCase()) {
    return {
      ok: false,
      error: `baseline fingerprint mismatch — metrics section was edited without re-fingerprinting (expected ${recomputed}, found ${parsed.fingerprint})`,
    };
  }
  for (const key of ["static", "js", "css"]) {
    if (!parsed.metrics[key] || typeof parsed.metrics[key].rawBytes !== "number") {
      return { ok: false, error: `baseline metrics.${key}.rawBytes missing` };
    }
  }
  if (!Array.isArray(parsed.metrics.routes)) return { ok: false, error: "baseline metrics.routes is not an array" };
  return { ok: true, error: null, baseline: parsed };
}

// ---------------------------------------------------------------------------
// comparison (pure — reused by --compare and --self-test)
// ---------------------------------------------------------------------------

function compareMetrics(base, cur, thresholds = THRESHOLDS) {
  const diff = (name, b, c) => ({ name, baseBytes: b, curBytes: c, deltaBytes: c - b, deltaPct: pct(c - b, b) });
  const diffs = [
    diff("static.rawBytes", base.static.rawBytes, cur.static.rawBytes),
    diff("js.rawBytes", base.js.rawBytes, cur.js.rawBytes),
    diff("css.rawBytes", base.css.rawBytes, cur.css.rawBytes),
    diff("media.rawBytes", base.media?.rawBytes ?? 0, cur.media?.rawBytes ?? 0),
    diff("largestJsBytes", base.largestJsBytes ?? 0, cur.largestJsBytes ?? 0),
    diff("largestCssBytes", base.largestCssBytes ?? 0, cur.largestCssBytes ?? 0),
  ];
  const get = (n) => diffs.find((d) => d.name === n);

  const trips = (d, t) => d.deltaBytes > t.absBytes && d.deltaPct > t.pct;

  const warnings = [];
  if (trips(get("js.rawBytes"), thresholds.warn.jsAggregate))
    warnings.push({ metric: "js.rawBytes", ...describe(get("js.rawBytes"), thresholds.warn.jsAggregate) });
  if (trips(get("largestJsBytes"), thresholds.warn.largestJsChunk))
    warnings.push({ metric: "largestJsBytes", ...describe(get("largestJsBytes"), thresholds.warn.largestJsChunk) });
  if (trips(get("css.rawBytes"), thresholds.warn.cssAggregate))
    warnings.push({ metric: "css.rawBytes", ...describe(get("css.rawBytes"), thresholds.warn.cssAggregate) });

  const hardFailures = [];
  if (trips(get("js.rawBytes"), thresholds.hardFail.jsAggregate))
    hardFailures.push({ metric: "js.rawBytes", ...describe(get("js.rawBytes"), thresholds.hardFail.jsAggregate) });
  if (trips(get("static.rawBytes"), thresholds.hardFail.staticAggregate))
    hardFailures.push({ metric: "static.rawBytes", ...describe(get("static.rawBytes"), thresholds.hardFail.staticAggregate) });

  const baseRoutes = new Set(base.routes ?? []);
  const curRoutes = new Set(cur.routes ?? []);
  const routeAdditions = [...curRoutes].filter((r) => !baseRoutes.has(r)).sort();
  const routeRemovals = [...baseRoutes].filter((r) => !curRoutes.has(r)).sort();

  return { diffs, warnings, hardFailures, routeAdditions, routeRemovals };
}

function describe(d, t) {
  return {
    deltaBytes: d.deltaBytes,
    deltaPct: Number(d.deltaPct.toFixed(2)),
    threshold: `> ${human(t.absBytes)} AND > ${t.pct}%`,
    baseBytes: d.baseBytes,
    curBytes: d.curBytes,
  };
}

// ---------------------------------------------------------------------------
// self-test
// ---------------------------------------------------------------------------

function runSelfTest() {
  const results = [];
  const check = (name, cond) => results.push({ name, pass: !!cond });
  const dir = mkdtempSync(join(tmpdir(), "cae05-"));
  try {
    const baseMetrics = {
      static: { rawBytes: 2_000_000, fileCount: 45 },
      js: { rawBytes: 1_800_000, fileCount: 42 },
      css: { rawBytes: 131_000, fileCount: 3 },
      media: { rawBytes: 69_000, fileCount: 12 },
      largestJsBytes: 280_000,
      largestCssBytes: 104_000,
      routeCount: 3,
      routes: ["/", "/login", "/queue"],
    };
    const mkBaselineFile = (metrics, mutate) => {
      const b = {
        schemaVersion: SCHEMA_VERSION,
        recordedAt: "2026-01-01",
        recordedFromCommit: "0".repeat(40),
        metrics,
        fingerprint: fingerprint(metrics),
      };
      if (mutate) mutate(b);
      const p = join(dir, `bl-${Math.random().toString(36).slice(2)}.json`);
      writeFileSync(p, JSON.stringify(b, null, 2));
      return p;
    };

    // 1. identical metrics -> PASS
    let r = compareMetrics(baseMetrics, baseMetrics);
    check("1: identical metrics -> no warnings, no hard failures", r.warnings.length === 0 && r.hardFailures.length === 0);

    // 2. small expected growth -> report only
    const small = { ...baseMetrics, js: { rawBytes: 1_810_000, fileCount: 42 }, static: { rawBytes: 2_010_000, fileCount: 45 } };
    r = compareMetrics(baseMetrics, small);
    check("2: +10 KB js -> report only (no warn, no fail)", r.warnings.length === 0 && r.hardFailures.length === 0 && r.diffs.some((d) => d.name === "js.rawBytes" && d.deltaBytes === 10_000));

    // 3. warn threshold -> WARN, no hard fail
    const warnGrow = { ...baseMetrics, js: { rawBytes: 1_800_000 + 220_000, fileCount: 44 }, static: { rawBytes: 2_000_000 + 220_000, fileCount: 47 } };
    r = compareMetrics(baseMetrics, warnGrow);
    check("3: +220 KB js (>100KB AND >10%) -> WARN, no hard fail", r.warnings.some((w) => w.metric === "js.rawBytes") && r.hardFailures.length === 0);

    // 4. hard threshold -> FAIL
    const hardGrow = { ...baseMetrics, js: { rawBytes: 1_800_000 + 600_000, fileCount: 50 }, static: { rawBytes: 2_000_000 + 600_000, fileCount: 53 } };
    r = compareMetrics(baseMetrics, hardGrow);
    check("4: +600 KB js (>500KB AND >25%) -> hard failure", r.hardFailures.some((h) => h.metric === "js.rawBytes"));

    // 5. baseline missing -> fail closed
    check("5: missing baseline -> loadBaseline fails closed", loadBaseline(join(dir, "nope.json")).ok === false);

    // 6. malformed baseline -> fail closed
    const badJson = join(dir, "bad.json");
    writeFileSync(badJson, "{ not json");
    check("6: malformed baseline -> fail closed", loadBaseline(badJson).ok === false);
    const noMetrics = join(dir, "nometrics.json");
    writeFileSync(noMetrics, JSON.stringify({ schemaVersion: SCHEMA_VERSION, fingerprint: "a".repeat(64) }));
    check("6b: baseline with no metrics -> fail closed", loadBaseline(noMetrics).ok === false);

    // 7. invalid fingerprint -> fail closed
    const tampered = mkBaselineFile(baseMetrics, (b) => {
      b.metrics.js.rawBytes = 999; // change metrics without re-fingerprinting
    });
    check("7: fingerprint mismatch -> fail closed", loadBaseline(tampered).ok === false);
    const goodBl = mkBaselineFile(baseMetrics);
    check("7b: correctly fingerprinted baseline loads", loadBaseline(goodBl).ok === true);

    // 8 / 9. route add / remove reported
    const routeChange = { ...baseMetrics, routes: ["/", "/login", "/reports"], routeCount: 3 };
    r = compareMetrics(baseMetrics, routeChange);
    check("8: new route reported in routeAdditions", r.routeAdditions.includes("/reports"));
    check("9: removed route reported in routeRemovals", r.routeRemovals.includes("/queue"));
    check("9b: route change alone -> no warn, no hard fail", r.warnings.length === 0 && r.hardFailures.length === 0);

    // 10. raw vs gzip never confused
    const m = measureSynthetic();
    check("10: gzip fields are separate + labelled, compare uses rawBytes only", m.informational.gzip.jsBytes !== m.metrics.js.rawBytes && /NOT the CDN transfer size/.test(m.informational.gzip.note) && !JSON.stringify(compareMetrics(baseMetrics, baseMetrics)).includes("gzip"));

    // 11. unavailable metric explicit
    check("11: per-route JS attribution is explicit UNAVAILABLE", m.informational.perRouteJsBytes === "UNAVAILABLE" && typeof m.informational.perRouteJsReason === "string");

    // 12. no secret/env values in JSON
    const jsonBlob = JSON.stringify({ metrics: baseMetrics, informational: m.informational, comparison: compareMetrics(baseMetrics, warnGrow) });
    const leak = /OPENAI_API_KEY|SUPABASE_SERVICE_ROLE_KEY|DEEPGRAM_API_KEY|DATABASE_URL|DIRECT_URL|[A-Za-z]:\\\\Users\\\\|\/home\/[a-z]/i.test(jsonBlob);
    check("12: no secret / env / personal-path values in output JSON", leak === false);

    const passed = results.filter((x) => x.pass).length;
    return { total: results.length, passed, allPass: passed === results.length, results };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** A synthetic measurement object shaped like measure(), for self-test only. */
function measureSynthetic() {
  const metrics = {
    static: { rawBytes: 2_000_000, fileCount: 45 },
    js: { rawBytes: 1_800_000, fileCount: 42 },
    css: { rawBytes: 131_000, fileCount: 3 },
    media: { rawBytes: 69_000, fileCount: 12 },
    largestJsBytes: 280_000,
    largestCssBytes: 104_000,
    routeCount: 3,
    routes: ["/", "/login", "/queue"],
  };
  return {
    ok: true,
    metrics,
    informational: {
      perRouteJsBytes: "UNAVAILABLE",
      perRouteJsReason: "synthetic",
      gzip: { note: "Node zlib.gzipSync of each file, summed. NOT the CDN transfer size.", jsBytes: 520_000, cssBytes: 24_000 },
      largestAssets: [],
      routeInventorySource: "synthetic",
    },
  };
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

function rel(p) {
  return p.replace(REPO + "\\", "").replace(REPO + "/", "").replace(/\\/g, "/");
}

function gitHead() {
  try {
    return execFileSync("git", ["-C", REPO, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

function nextVersion() {
  try {
    return JSON.parse(readFileSync(join(REPO, "node_modules", "next", "package.json"), "utf8")).version;
  } catch {
    return null;
  }
}

if (selfTest) {
  const r = runSelfTest();
  if (asJson) process.stdout.write(JSON.stringify(r, null, 2) + "\n");
  else {
    process.stdout.write("build-size self-test\n\n");
    for (const t of r.results) process.stdout.write(`  [${t.pass ? "PASS" : "FAIL"}] ${t.name}\n`);
    process.stdout.write(`\n  ${r.passed}/${r.total} assertions passed\n`);
  }
  process.exit(r.allPass ? 0 : 2);
}

const m = measure();
if (!m.ok) {
  if (asJson) process.stdout.write(JSON.stringify({ overall: "FAIL", exitCode: 1, error: m.error }, null, 2) + "\n");
  else process.stderr.write(`build-size: ${m.error}\n`);
  process.exit(1);
}

// --- write-baseline ---
if (writeBaseline) {
  if (!confirmCentral) {
    process.stderr.write(
      "build-size: --write-baseline needs --confirm-central.\n" +
        "Updating the accepted build-size baseline is a CENTRAL decision — it must\n" +
        "be reviewed against the product change that moved the numbers.\n",
    );
    process.exit(1);
  }
  const head = gitHead();
  const out = {
    $comment: [
      "CENTRAL-owned build-size regression baseline for tools/repo-health/build-size.mjs.",
      "Regenerate only when CENTRAL has reviewed the product change that moved these",
      "numbers. `metrics` is fingerprinted (sha256 over a stable serialisation); editing",
      "it without re-running --write-baseline makes the tool fail closed.",
    ],
    schemaVersion: SCHEMA_VERSION,
    recordedAt: new Date().toISOString().slice(0, 10),
    recordedFromCommit: head,
    productTreeNote:
      "CAE-05 commits touch only tools/repo-health/** and docs/engineering/**. src/**, " +
      "supabase/**, db/**, package.json, package-lock.json, next.config.ts, tsconfig.json, " +
      "postcss.config.mjs are byte-identical to fce4fe735b4ad249ba1c183adab087d25b524721 " +
      "(accepted CAE-04), so the build output measured here is that product tree's.",
    toolchain: { node: process.version, next: nextVersion() },
    buildEnvironment: CANONICAL_BUILD_ENV,
    measurementDefinitions: MEASUREMENT_DEFINITIONS,
    thresholds: THRESHOLDS,
    metrics: m.metrics,
    fingerprint: fingerprint(m.metrics),
  };
  writeFileSync(BASELINE_PATH, JSON.stringify(out, null, 2) + "\n");
  process.stdout.write(`build-size: wrote ${rel(BASELINE_PATH)} (fingerprint ${out.fingerprint.slice(0, 16)}…)\n`);
  process.exit(0);
}

// --- measure (+ compare) ---
const bl = loadBaseline(BASELINE_PATH);
const wantCompare = doCompare || bl.ok; // default run also compares when a baseline exists
let comparison = null;
let overall = "PASS";
let exitCode = 0;

if (doCompare && !bl.ok) {
  if (asJson) process.stdout.write(JSON.stringify({ overall: "FAIL", exitCode: 1, error: bl.error }, null, 2) + "\n");
  else process.stderr.write(`build-size: --compare needs a valid baseline: ${bl.error}\n`);
  process.exit(1);
}
if (wantCompare && bl.ok) {
  comparison = compareMetrics(bl.baseline.metrics, m.metrics);
  if (comparison.hardFailures.length > 0) {
    overall = "FAIL";
    exitCode = 2;
  } else if (comparison.warnings.length > 0) {
    overall = "WARN";
  }
}

const report = {
  tool: "build-size",
  generatedAt: new Date().toISOString(),
  commit: gitHead(),
  toolchain: { node: process.version, next: nextVersion() },
  canonicalBuildEnvironment: CANONICAL_BUILD_ENV,
  buildDurationMs: null, // this tool measures existing output; the runner that built it owns duration
  current: { metrics: m.metrics, informational: m.informational },
  baseline: bl.ok
    ? { recordedFromCommit: bl.baseline.recordedFromCommit, recordedAt: bl.baseline.recordedAt, fingerprint: bl.baseline.fingerprint, metrics: bl.baseline.metrics }
    : { error: bl.error },
  thresholds: THRESHOLDS,
  comparison,
  overall,
  exitCode,
};

if (asJson) process.stdout.write(JSON.stringify(report, null, 2) + "\n");
else printHuman(report);
process.exit(exitCode);

// ---------------------------------------------------------------------------
// presentation / constants
// ---------------------------------------------------------------------------

function printHuman(r) {
  const out = [];
  out.push(`Doctor's Diary — build size  ${r.generatedAt}`);
  out.push(`commit ${r.commit ?? "?"}   node ${r.toolchain.node}   next ${r.toolchain.next}`);
  const c = r.current.metrics;
  out.push("");
  out.push("current build (.next/static, raw bytes; source maps excluded):");
  out.push(`  JS      ${human(c.js.rawBytes).padStart(10)}  (${c.js.fileCount} files)   gzip ~${human(r.current.informational.gzip.jsBytes)}`);
  out.push(`  CSS     ${human(c.css.rawBytes).padStart(10)}  (${c.css.fileCount} files)   gzip ~${human(r.current.informational.gzip.cssBytes)}`);
  out.push(`  media   ${human(c.media.rawBytes).padStart(10)}  (${c.media.fileCount} files)`);
  out.push(`  ── static total ${human(c.static.rawBytes)}  (${c.static.fileCount} files)`);
  out.push(`  largest JS chunk ${human(c.largestJsBytes)}   largest CSS ${human(c.largestCssBytes)}`);
  out.push(`  routes ${c.routeCount}   (source: ${r.current.informational.routeInventorySource})`);
  out.push(`  per-route JS bytes: ${r.current.informational.perRouteJsBytes} — ${r.current.informational.perRouteJsReason}`);
  out.push(`  [informational] .next/server ${r.current.informational.serverBuildRawBytes == null ? "n/a" : human(r.current.informational.serverBuildRawBytes)} (not gated), source maps ${human(r.current.informational.sourceMapBytes)}`);

  out.push("");
  out.push("largest assets (content-hashed names — compare by size):");
  for (const a of r.current.informational.largestAssets) out.push(`  ${human(a.rawBytes).padStart(10)}  ${a.name}`);

  if (r.comparison) {
    out.push("");
    out.push(`vs baseline ${r.baseline.recordedFromCommit?.slice(0, 12)} (${r.baseline.recordedAt}):`);
    for (const d of r.comparison.diffs) {
      const arrow = d.deltaBytes === 0 ? "=" : d.deltaBytes > 0 ? "▲" : "▼";
      out.push(`  ${d.name.padEnd(18)} ${human(d.baseBytes).padStart(10)} → ${human(d.curBytes).padStart(10)}   ${arrow} ${human(d.deltaBytes)} (${d.deltaPct === Infinity ? "∞" : d.deltaPct.toFixed(2)}%)`);
    }
    if (r.comparison.routeAdditions.length) out.push(`  + routes: ${r.comparison.routeAdditions.join(", ")}`);
    if (r.comparison.routeRemovals.length) out.push(`  - routes: ${r.comparison.routeRemovals.join(", ")}`);
    if (!r.comparison.routeAdditions.length && !r.comparison.routeRemovals.length) out.push("  routes: unchanged");

    if (r.comparison.warnings.length) {
      out.push("");
      out.push("WARNINGS (do not fail the gate):");
      for (const w of r.comparison.warnings) out.push(`  ⚠ ${w.metric}  +${human(w.deltaBytes)} (+${w.deltaPct}%)  exceeds ${w.threshold}`);
    }
    if (r.comparison.hardFailures.length) {
      out.push("");
      out.push("HARD REGRESSION:");
      for (const h of r.comparison.hardFailures) out.push(`  ✗ ${h.metric}  +${human(h.deltaBytes)} (+${h.deltaPct}%)  exceeds ${h.threshold}`);
    }
  } else {
    out.push("");
    out.push(`no comparison — ${r.baseline.error ?? "no baseline"}. Run with a baseline present, or --write-baseline --confirm-central.`);
  }

  out.push("");
  out.push(`OVERALL: ${r.overall}   (exit ${r.exitCode})`);
  out.push(
    "Compare only against a build made with the canonical NEXT_PUBLIC_* values " +
      "(Next inlines them into the bundle). Raw bytes are canonical; gzip is Node " +
      "zlib only and is not the CDN transfer size. No network, no provider, no secret read.",
  );
  process.stdout.write(out.join("\n") + "\n");
}

function printHelp() {
  process.stdout.write(
    [
      "Doctor's Diary — offline build / route size regression baseline (CAE-05)",
      "",
      "  node tools/repo-health/build-size.mjs [--json] [--compare]",
      "  node tools/repo-health/build-size.mjs --self-test",
      "  node tools/repo-health/build-size.mjs --write-baseline --confirm-central",
      "",
      "  (default)         measure .next/static + route inventory; compare if a baseline exists",
      "  --compare         measure + compare + apply thresholds (needs a valid baseline)",
      "  --json            machine-readable, deterministic report",
      "  --self-test       offline synthetic proof (temp files only; real .next untouched)",
      "  --write-baseline  regenerate the baseline from the current build — REQUIRES",
      "                    --confirm-central; updating the accepted baseline is a CENTRAL decision",
      "  --help            this message",
      "",
      "Exit: 0 measured / no hard regression (warnings do NOT fail) · 1 tool / baseline /",
      "      build-output error (fail closed) · 2 hard size regression.",
      "",
      "Needs a prior successful `npm run build`. Reads only .next/** local filesystem",
      "metadata. No network, no provider, no database, no Vercel, no secret read.",
      "",
    ].join("\n"),
  );
}
