/**
 * DEPLOYMENT DETERMINISM — the full proof, not a single dump.
 *
 *   fresh Track-A DB          -> manifest-only deploy -> canonical dump A
 *   destroy and recreate      -> manifest-only deploy -> canonical dump B
 *   A == B byte-for-byte
 *   canonical golden == A == B
 *   manifest hashes validated
 *   no executable V2 SQL outside the manifest
 *
 * WHY TWO REPLAYS AND NOT ONE.
 *
 * The retired Loop-H version dumped whatever database it was pointed at and
 * compared that to `db/golden-p0.sql`. That proves the CURRENT database matches
 * the golden file. It does not prove the manifest PRODUCES that database — a
 * hand-patched target passes it, and so does a target built by a replay plus an
 * ad-hoc fix. Determinism is a property of repeated construction, so it has to
 * be measured by constructing twice.
 *
 * The two replays go into two throwaway databases created on the same local
 * server, and both are dropped in `finally`. Neither is the target database
 * itself: destroying the caller's database would be a destructive act on a
 * target they did not offer for destruction.
 *
 *   node scripts/p0-run.mjs scripts/verify-deployment-determinism.mjs
 *
 * LOCAL ONLY. The target passes `assertLocalP0DatabaseUrl` before anything is
 * created, so this can never run against the shared project.
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

// ---------------------------------------------------------------------------
// 1. Manifest integrity — order, hashes, and no SQL outside it.
// ---------------------------------------------------------------------------

const manifestText = await fs.readFile(path.join(root, "db/manifest.toml"), "utf8");
const steps = [];
let entry;
for (const line of manifestText.split(/\r?\n/)) {
  if (line === "[[step]]") { entry = {}; steps.push(entry); continue; }
  const match = line.match(/^(id|kind|file|sha256)\s*=\s*"([^"]*)"$/);
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
  if (hash !== step.sha256) throw new Error(`manifest hash mismatch: ${step.file}`);
}

/**
 * Every executable SQL file under the deployment directories must be listed.
 * An unlisted file is SQL somebody can run that no hash covers, which defeats
 * the manifest entirely. `db/golden-p0.sql` is evidence, not a deployment
 * step, so it lives outside these directories and is not counted.
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
console.log(`manifest: PASS (${steps.length} steps, ${onDisk.length} SQL files, all hashes pinned)`);

// ---------------------------------------------------------------------------
// 2. Two independent fresh replays.
// ---------------------------------------------------------------------------

const bodies = [];
for (const step of steps) {
  bodies.push(await fs.readFile(path.join(root, step.file), "utf8"));
}

/**
 * PostgreSQL 17 emits a random guard token on `\restrict` / `\unrestrict`
 * lines in every dump. Those two line kinds are canonicalised and NOTHING
 * else: the schema body is compared exactly as emitted, so a real difference
 * cannot hide behind the normalisation.
 */
const canonicalize = (dump) =>
  dump.replace(/^\\(restrict|unrestrict) .*$/gm, "\\$1 DD_P0_GOLDEN");

const adminUrl = new URL(target);
const adminDb = adminUrl.pathname.slice(1) || "postgres";
const admin = postgres(target, { max: 1, prepare: false, onnotice: () => {} });

/** Unique per run: two runs on one server must not collide. */
const suffix = crypto.randomBytes(4).toString("hex");
const replicas = [`dd_p0_determinism_a_${suffix}`, `dd_p0_determinism_b_${suffix}`];

async function dropAll() {
  for (const name of replicas) {
    await admin.unsafe(`drop database if exists ${name} with (force)`).catch(() => {});
  }
}

const dumps = [];

try {
  await dropAll();

  for (const name of replicas) {
    await admin.unsafe(`create database ${name}`);

    const replicaUrl = new URL(target);
    replicaUrl.pathname = `/${name}`;
    // Re-validate: the replica URL is derived, but a derived target is still a
    // target, and the guard is cheap.
    const replicaTarget = requireLocalP0DatabaseUrl(replicaUrl.toString());

    const sql = postgres(replicaTarget, { max: 1, prepare: false, onnotice: () => {} });
    try {
      // MANIFEST ONLY. No drizzle migration, no supabase/policies replay, no
      // ad-hoc fix-up — if the manifest cannot build it, it is not built.
      for (const body of bodies) await sql.unsafe(body);
    } finally {
      await sql.end({ timeout: 5 });
    }

    dumps.push(canonicalize(await dumpSchema(replicaTarget, name)));
    console.log(`replay ${name}: deployed and dumped`);
  }
} finally {
  await dropAll();
  await admin.end({ timeout: 5 });
}

/**
 * `pg_dump` if it is on PATH, otherwise the client inside the local Supabase
 * Docker container. Both paths are local by construction — the target already
 * passed the guard.
 */
async function dumpSchema(url, database) {
  const args = ["--schema-only", "--no-owner", "--no-privileges"];
  try {
    const { stdout } = await exec("pg_dump", [...args, url]);
    return stdout;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    const parsed = new URL(url);
    const { stdout } = await exec("docker", [
      "exec", "supabase_db_DD", "pg_dump",
      "-U", decodeURIComponent(parsed.username),
      "-d", database,
      ...args,
    ]);
    return stdout;
  }
}

// ---------------------------------------------------------------------------
// 3. The three comparisons.
// ---------------------------------------------------------------------------

const [dumpA, dumpB] = dumps;

if (dumpA !== dumpB) {
  // Report WHERE, so a real non-determinism is diagnosable rather than merely
  // reported. A random OID or a timestamp shows up as one differing line.
  const a = dumpA.split("\n");
  const b = dumpB.split("\n");
  const at = a.findIndex((line, i) => line !== b[i]);
  throw new Error(
    `NON-DETERMINISTIC: two fresh replays differ at line ${at + 1}\n  A: ${a[at]}\n  B: ${b[at]}`,
  );
}
console.log("replay A == replay B: PASS (byte-for-byte)");

const golden = canonicalize(await fs.readFile(path.join(root, "db/golden-p0.sql"), "utf8"));
if (golden !== dumpA) {
  const g = golden.split("\n");
  const a = dumpA.split("\n");
  const at = g.findIndex((line, i) => line !== a[i]);
  throw new Error(
    `golden mismatch: db/golden-p0.sql differs from a fresh replay at line ${at + 1}\n  golden: ${g[at]}\n  replay: ${a[at]}`,
  );
}

console.log(
  `deployment determinism: PASS (${steps.length} steps, ${onDisk.length} SQL files, ` +
    `2 fresh replays identical, golden matches, sha256 ${crypto.createHash("sha256").update(golden).digest("hex")})`,
);
console.log(`server database used for replica creation: ${adminDb}`);
