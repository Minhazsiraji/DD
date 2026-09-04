/**
 * DEPLOYMENT DETERMINISM — two fresh LOCAL SUPABASE substrates.
 *
 *   supabase db reset --local --no-seed   -> fresh platform substrate
 *   assert auth + storage exist, public is empty of P0
 *   manifest-only deploy                  -> canonical dump A
 *   supabase db reset --local --no-seed   -> fresh again
 *   assert substrate, assert P0 absent
 *   manifest-only deploy                  -> canonical dump B
 *   A == B == canonical db/golden-p0.sql, byte for byte
 *
 * WHY NOT `CREATE DATABASE`.
 *
 * The previous version of this harness created raw PostgreSQL databases. A raw
 * database is not a Doctor's Diary deployment target: the P0 manifest is
 * written against the Supabase platform substrate and references `auth` and
 * `storage`, so it failed with `schema "auth" does not exist`. That was a
 * defect in the harness, not in the manifest — the substrate has to be the one
 * the manifest is designed for, or the proof measures the wrong thing.
 *
 * WHY TWO REPLAYS.
 *
 * Comparing one dump against the golden file proves the CURRENT database
 * matches golden. It does not prove the manifest PRODUCES it — a hand-patched
 * target passes. Determinism is a property of repeated construction, so it is
 * measured by constructing twice from nothing.
 *
 * LOCAL ONLY, THREE WAYS.
 *
 *   1. the target passes `assertLocalP0DatabaseUrl` before anything runs;
 *   2. the reset is issued with an explicit `--local`, and this file never
 *      emits `--linked` or `--db-url` — `--linked` would reset the LINKED
 *      REMOTE project, which is the one command that could destroy Track B;
 *   3. the run refuses to start if the CLI is linked to any project at all.
 *
 *   node scripts/p0-run.mjs scripts/verify-deployment-determinism.mjs
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import postgres from "postgres";
import { requireLocalP0DatabaseUrl } from "./p0-target.mjs";

const exec = promisify(execFile);
const root = process.cwd();
const target = requireLocalP0DatabaseUrl(
  process.argv[2] ?? process.env.DD_V2_LOCAL_DATABASE_URL,
);

const line = (s) => console.log(s);

// ---------------------------------------------------------------------------
// 0. Refuse to run unless the local lifecycle is configured the way the proof
//    requires. Every one of these is asserted, never assumed.
// ---------------------------------------------------------------------------

const configPath = path.join(root, "supabase/config.toml");
let config;
try {
  config = await fs.readFile(configPath, "utf8");
} catch {
  throw new Error(
    "supabase/config.toml is missing. The determinism proof needs it to guarantee that " +
      "`supabase db reset` will NOT replay V1 migrations into the fresh substrate.",
  );
}

/**
 * `[db.migrations] enabled = false`.
 *
 * `supabase db reset` applies everything in `supabase/migrations` by default.
 * This repository still carries the V1 migration lane, so without this key the
 * "fresh" substrate would arrive carrying the V1 schema and the P0 manifest
 * would be deployed on top of it — which is not a fresh P0 deployment, and
 * would put unforced V1 tables in `public` for `verify-p0` to trip over.
 */
const migrationsBlock = config.match(/\[db\.migrations\][\s\S]*?(?=\n\[|$)/);
if (!migrationsBlock || !/^\s*enabled\s*=\s*false\s*$/m.test(migrationsBlock[0])) {
  throw new Error(
    "supabase/config.toml must set [db.migrations] enabled = false. " +
      "Otherwise `supabase db reset` replays the V1 migration lane into the substrate " +
      "and the replay is no longer manifest-only.",
  );
}

/** A linked CLI is one mistyped flag away from resetting the remote project. */
for (const marker of ["supabase/.temp/project-ref", "supabase/.temp/pooler-url"]) {
  try {
    await fs.access(path.join(root, marker));
    throw new Error(
      `${marker} exists: the CLI is linked to a project. Unlink before running the ` +
        "determinism proof — Track A must have no remote project link.",
    );
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

const { stdout: cliVersion } = await exec("supabase", ["--version"]).catch(() => {
  throw new Error("supabase CLI not found on PATH. The determinism proof runs on the Codespace host.");
});
line(`supabase CLI: ${cliVersion.trim()}`);

// ---------------------------------------------------------------------------
// 1. Manifest integrity — order, hashes, and no executable SQL outside it.
// ---------------------------------------------------------------------------

const manifestText = await fs.readFile(path.join(root, "db/manifest.toml"), "utf8");
const steps = [];
let entry;
for (const l of manifestText.split(/\r?\n/)) {
  if (l === "[[step]]") { entry = {}; steps.push(entry); continue; }
  const match = l.match(/^(id|kind|file|sha256)\s*=\s*"([^"]*)"$/);
  if (match && entry) entry[match[1]] = match[2];
}

const KINDS = "schema,functions,policies,grants,storage,seed";
if (steps.length !== 6 || steps.map((s) => s.kind).join(",") !== KINDS) {
  throw new Error(`manifest ordering is not canonical (expected ${KINDS})`);
}

for (const step of steps) {
  if (step.sha256 === "PENDING") throw new Error(`manifest hash pending: ${step.file}`);
  const body = await fs.readFile(path.join(root, step.file));
  const hash = crypto.createHash("sha256").update(body).digest("hex");
  if (hash !== step.sha256) {
    throw new Error(
      `manifest hash mismatch: ${step.file}\n  pinned: ${step.sha256}\n  actual: ${hash}\n` +
        "  (if this differs only on Windows, check .gitattributes — the pins are the LF bytes)",
    );
  }
}

/**
 * Every executable SQL file under the deployment directories must be listed.
 * An unlisted file is SQL somebody can run that no hash covers. `golden-p0.sql`
 * is evidence, not a step, and lives outside those directories.
 */
const onDisk = (await fs.readdir(path.join(root, "db"), { recursive: true }))
  .map((item) => item.split(path.sep).join("/"))
  .filter((item) => item.endsWith(".sql") && /^(schema|functions|policies|grants|storage|seed)\//.test(item))
  .map((item) => path.posix.join("db", item))
  .sort();
const listed = steps.map((s) => s.file).sort();
if (onDisk.join("\n") !== listed.join("\n")) {
  throw new Error(
    `executable db SQL exists outside the manifest:\n  on disk: ${onDisk.join(", ")}\n  listed : ${listed.join(", ")}`,
  );
}
line(`manifest: PASS (${steps.length} steps, ${onDisk.length} SQL files, all hashes pinned)`);

// ---------------------------------------------------------------------------
// 2. Two fresh substrates.
// ---------------------------------------------------------------------------

/** The 39 P0 tables. Their absence is what "fresh" has to mean. */
const P0_TABLES = (await fs.readFile(path.join(root, "db/schema/0001_p0_baseline.sql"), "utf8"))
  .split("\n")
  .map((l) => l.match(/^create table (?:public\.)?([a-z_]+)/)?.[1])
  .filter(Boolean);

/**
 * Only the PostgreSQL 17 `\restrict` / `\unrestrict` guard tokens are
 * canonicalised — they carry a random value in every dump. Nothing else is
 * touched, so a real difference cannot hide behind the normalisation.
 */
const canonicalize = (dump) =>
  dump.replace(/^\\(restrict|unrestrict) .*$/gm, "\\$1 DD_P0_GOLDEN");

async function freshSubstrate(round) {
  line(`\n── round ${round} ──`);

  // `--local` is explicit and `--linked` is never emitted. `--no-seed` keeps
  // supabase/seed.sql out of the substrate: a seed row is not part of the
  // manifest and would make the dump depend on something unhashed.
  line("supabase db reset --local --no-seed");
  await exec("supabase", ["db", "reset", "--local", "--no-seed"], {
    cwd: root,
    maxBuffer: 64 * 1024 * 1024,
  });

  const sql = postgres(target, { max: 1, prepare: false, onnotice: () => {} });
  try {
    // The substrate the manifest is written against must actually be there.
    const schemas = await sql`
      select nspname from pg_namespace where nspname in ('auth', 'storage') order by nspname`;
    const names = schemas.map((s) => s.nspname);
    if (!names.includes("auth") || !names.includes("storage")) {
      throw new Error(
        `platform substrate incomplete after reset: found [${names.join(", ")}], need auth and storage. ` +
          "The P0 manifest references both; deploying without them is what produced " +
          '`schema "auth" does not exist`.',
      );
    }
    line(`  substrate: auth + storage present`);

    // And it must be free of P0 — otherwise this is not a fresh deployment.
    const existing = await sql`
      select c.relname from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r','p') and c.relname = any(${P0_TABLES})
      order by c.relname`;
    if (existing.length) {
      throw new Error(
        `substrate is not clean: ${existing.length} P0 table(s) already in public ` +
          `(${existing.map((r) => r.relname).join(", ")}). ` +
          "Check that [db.migrations] enabled = false actually took effect.",
      );
    }

    const anyPublic = await sql`
      select count(*)::int as n from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r','p')`;
    line(`  public schema: ${anyPublic[0].n} table(s) before deploy`);
    if (anyPublic[0].n > 0) {
      // Not fatal on its own — the substrate may legitimately ship something —
      // but it is exactly what makes forced-RLS fail later, so it is named now.
      const strays = await sql`
        select c.relname from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind in ('r','p') order by c.relname`;
      line(`  ⚠ non-P0 tables present in public: ${strays.map((r) => r.relname).join(", ")}`);
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/**
 * Deploy through the REAL deployment script, as a child process.
 *
 * Not a reimplementation of the manifest loop: if this harness deployed by its
 * own code path, it would prove that path deterministic and say nothing about
 * the one that actually ships.
 */
async function deployManifest() {
  line("node scripts/deploy-fresh.mjs --database-url <local>");
  const { stdout, stderr } = await exec(
    process.execPath,
    ["scripts/deploy-fresh.mjs", "--database-url", target],
    { cwd: root, maxBuffer: 64 * 1024 * 1024 },
  );
  if (stdout.trim()) line(`  ${stdout.trim()}`);
  if (stderr.trim()) line(`  ${stderr.trim()}`);
}

/** `pg_dump` from PATH, else the client inside the local Supabase container. */
async function dumpSchema() {
  const args = ["--schema-only", "--no-owner", "--no-privileges"];
  try {
    const { stdout } = await exec("pg_dump", [...args, target], { maxBuffer: 64 * 1024 * 1024 });
    return stdout;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    const parsed = new URL(target);
    const { stdout } = await exec(
      "docker",
      [
        "exec", "supabase_db_DD", "pg_dump",
        "-U", decodeURIComponent(parsed.username),
        "-d", parsed.pathname.slice(1) || "postgres",
        ...args,
      ],
      { maxBuffer: 64 * 1024 * 1024 },
    );
    return stdout;
  }
}

const dumps = [];
for (const round of [1, 2]) {
  await freshSubstrate(round);
  await deployManifest();
  dumps.push(canonicalize(await dumpSchema()));
  line(`  dump ${round === 1 ? "A" : "B"}: captured (${dumps.at(-1).length} bytes canonical)`);
}

// ---------------------------------------------------------------------------
// 3. The two comparisons.
// ---------------------------------------------------------------------------

const firstDifference = (left, right) => {
  const a = left.split("\n");
  const b = right.split("\n");
  const at = a.findIndex((l, i) => l !== b[i]);
  return { at: at + 1, left: a[at], right: b[at] };
};

const [dumpA, dumpB] = dumps;
if (dumpA !== dumpB) {
  const d = firstDifference(dumpA, dumpB);
  throw new Error(
    `NON-DETERMINISTIC: two fresh replays differ at line ${d.at}\n  A: ${d.left}\n  B: ${d.right}`,
  );
}
line("\nreplay A == replay B: PASS (byte-for-byte)");

const golden = canonicalize(await fs.readFile(path.join(root, "db/golden-p0.sql"), "utf8"));
if (golden !== dumpA) {
  const d = firstDifference(golden, dumpA);
  throw new Error(
    `golden mismatch: db/golden-p0.sql differs from a fresh replay at line ${d.at}\n` +
      `  golden: ${d.left}\n  replay: ${d.right}`,
  );
}

line(
  `deployment determinism: PASS (${steps.length} manifest steps, ${onDisk.length} SQL files, ` +
    `2 fresh Supabase substrates, A == B == golden, sha256 ${crypto.createHash("sha256").update(golden).digest("hex")})`,
);
