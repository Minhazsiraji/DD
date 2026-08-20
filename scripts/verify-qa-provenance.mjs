/**
 * GATE D — provenance must outlive the resource it identifies.
 *
 * The defect this exists for: `qa:destroy` skipped storage cleanup when no
 * service-role key was present, and then forgot the QA identities anyway. The
 * files survived with no remaining proof of what they were, and every later run
 * correctly refused to touch them — so the cheap failure (files left behind,
 * still identifiable) had been converted into the expensive one (files left
 * behind, permanently unidentifiable). Four such objects exist today.
 *
 * This drives `qa-fixture.mjs` as a subprocess, with and without the key, and
 * asserts what survives each time.
 *
 *   node --env-file=.env.local scripts/verify-qa-provenance.mjs
 *
 * Destructive to QA fixtures only. Run with no QA accounts present.
 */
import postgres from "postgres";
import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";

const DB = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!DB || !URL_ || !KEY) {
  console.error("DIRECT_URL, NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  process.exit(1);
}

const sql = postgres(DB, { max: 1, prepare: false, onnotice: () => {} });
const storage = createClient(URL_, KEY, { auth: { persistSession: false } }).storage;
const failures = [];

function check(ok, label, detail = "") {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(label);
}

const FIXTURE = path.resolve("scripts/qa-fixture.mjs");
const MANIFEST = path.resolve(".qa-fixture-uids.json");

/** Run the fixture, optionally with the service-role key withheld. */
function runFixture(mode, { withKey }) {
  const env = { ...process.env };
  if (!withKey) delete env.SUPABASE_SERVICE_ROLE_KEY;
  return execFileSync(process.execPath, [FIXTURE, mode], { env, encoding: "utf8" });
}

async function manifest() {
  try {
    return JSON.parse(await readFile(MANIFEST, "utf8"));
  } catch {
    return [];
  }
}

async function objectsUnder(uid) {
  const rows = await sql`
    select name from storage.objects
    where bucket_id in ('doctor-assets', 'prescription-assets')
      and name like ${uid + "/%"}`;
  return rows.map((r) => r.name);
}

console.log("\nGate D — QA storage provenance ordering");

try {
  // ---- 1. create QA accounts and plant a frozen asset --------------------
  runFixture("create", { withKey: true });
  const [{ uid }] = await sql`select id as uid from auth.users where email = 'qa.doctor@qa.invalid'`;
  check(Boolean(uid), "QA fixture created", uid);
  check((await manifest()).includes(uid), "…and the manifest records its provenance");

  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  const rxId = crypto.randomUUID();
  await storage
    .from("prescription-assets")
    .upload(`${uid}/${rxId}/signature`, png, { contentType: "image/png", upsert: true });
  await storage
    .from("doctor-assets")
    .upload(`${uid}/signature.png`, png, { contentType: "image/png", upsert: true });

  check((await objectsUnder(uid)).length === 2, "two QA storage objects planted",
    `${(await objectsUnder(uid)).length}`);

  // ---- 2, 3, 4, 5. destroy with the key WITHHELD -------------------------
  console.log("\n2–5. Destroy with no service-role key");
  const out = runFixture("destroy", { withKey: false });
  check(/STORAGE CLEANUP SKIPPED/.test(out), "it says the cleanup was skipped");

  const survivors = await objectsUnder(uid);
  check(survivors.length === 2, "the QA assets survive, as expected", `${survivors.length}`);

  /**
   * THE ASSERTION THIS GATE EXISTS FOR. Before the fix this was false: the
   * manifest was cleared, and the surviving files became unidentifiable.
   */
  check(
    (await manifest()).includes(uid),
    "PROVENANCE SURVIVES the skipped cleanup",
    "the manifest still names the uid whose files remain",
  );
  check(/PROVENANCE KEPT/.test(out), "…and it says so out loud");

  const [users] = await sql`
    select count(*)::int as n from auth.users where email like '%@qa.invalid'`;
  check(users.n === 0, "the accounts themselves are gone", `${users.n}`);

  // ---- 6, 7, 8. restore the key and destroy again ------------------------
  console.log("\n6–8. Destroy again, with the key");
  // A folder that is NOT ours, to prove the sweep stays narrow.
  const strangerUid = crypto.randomUUID();
  await storage
    .from("prescription-assets")
    .upload(`${strangerUid}/${crypto.randomUUID()}/signature`, png, {
      contentType: "image/png",
      upsert: true,
    });

  const out2 = runFixture("destroy", { withKey: true });
  const after = await objectsUnder(uid);
  check(after.length === 0, "the QA assets are now removed", after.join(", ") || "none");
  check(/removed \d+ QA storage object/.test(out2), "…and it reports what it removed");

  // ---- 9. the stranger's folder is untouched -----------------------------
  const strangerLeft = await objectsUnder(strangerUid);
  check(strangerLeft.length === 1, "a folder it cannot prove is QA is LEFT ALONE",
    `${strangerLeft.length}`);
  check(/LEFT ALONE/.test(out2), "…and reported rather than swept");

  // ---- 10. only now is the provenance forgotten --------------------------
  check(
    !(await manifest()).includes(uid),
    "provenance is forgotten only AFTER the files are confirmed gone",
  );

  // Remove the stranger folder we planted — its provenance is certain.
  await storage.from("prescription-assets").remove(strangerLeft);
} catch (e) {
  console.error("\ngate aborted:", e.message);
  failures.push(`aborted: ${e.message}`);
}

console.log(
  failures.length === 0
    ? "\nGate D: provenance outlives the resource.\n"
    : `\n${failures.length} FAILED:\n  ${failures.join("\n  ")}\n`,
);
await sql.end();
process.exit(failures.length === 0 ? 0 : 1);
