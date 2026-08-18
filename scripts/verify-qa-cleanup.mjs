/**
 * `qa:destroy` must never delete an asset it cannot prove it created.
 *
 *   node --env-file=.env.local scripts/verify-qa-cleanup.mjs
 *
 * This exists because of a real defect. An earlier version swept storage
 * folders whose uid was absent from `auth.users`, reasoning that they were
 * abandoned QA junk. That is not a safe rule anywhere, and in
 * `prescription-assets` it is a dangerous one: a doctor's auth account may be
 * closed years after their prescriptions were signed, and the frozen signature
 * on a signed prescription has to outlive the account, because the
 * prescription does.
 *
 * So the property under test is not "cleanup works". It is:
 *
 *   an object whose provenance is UNKNOWN survives a destroy, every time.
 *
 * The fixture plants exactly that — a frozen prescription signature under a
 * uid that is not in `auth.users` and not in the QA manifest — runs the real
 * `qa:destroy` entry point, and checks the bytes are still there afterwards.
 */
import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dbUrl = process.env.DIRECT_URL ?? process.env.DATABASE_URL;

if (!url || !dbUrl) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and DIRECT_URL must be set.");
  process.exit(1);
}
if (!serviceKey) {
  console.error(
    "\nSUPABASE_SERVICE_ROLE_KEY is not set, so the cleanup cannot be exercised.\n" +
      "Add it to .env.local (it is gitignored).\n",
  );
  process.exit(1);
}

const service = createClient(url, serviceKey, { auth: { persistSession: false } });
const sql = postgres(dbUrl, { max: 1, prepare: false, onnotice: () => {} });

const failures = [];
function check(ok, label, detail = "") {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(label);
}

const sha256 = (b) => crypto.createHash("sha256").update(b).digest("hex");

/** A retained clinical asset belonging to a doctor whose account is gone. */
const RETIRED_UID = crypto.randomUUID();
const RETIRED_RX = crypto.randomUUID();
const RETIRED_PATH = `${RETIRED_UID}/${RETIRED_RX}/signature`;
const RETIRED_BYTES = new Uint8Array(Buffer.from("a real signed prescription's signature"));

const planted = [];

async function put(bucket, path, bytes) {
  const { error } = await service.storage
    .from(bucket)
    .upload(path, bytes, { contentType: "image/png", upsert: false });
  if (!error) planted.push([bucket, path]);
  return error;
}

try {
  console.log("\nFixture");
  {
    const error = await put("prescription-assets", RETIRED_PATH, RETIRED_BYTES);
    check(!error, "a frozen signature exists for a doctor whose account is gone", error?.message ?? "");

    const [row] = await sql`select count(*)::int as n from auth.users where id = ${RETIRED_UID}`;
    check(row.n === 0, "…and that uid really is absent from auth.users");

    const manifest = await readFile(new URL("../.qa-fixture-uids.json", import.meta.url), "utf8")
      .then((raw) => JSON.parse(raw))
      .catch(() => []);
    check(!manifest.includes(RETIRED_UID), "…and is not in the QA manifest either");
  }

  console.log("\nQA fixtures are created and destroyed");
  {
    const create = spawnSync(process.execPath, ["--env-file=.env.local", "scripts/qa-fixture.mjs", "create"], {
      encoding: "utf8",
    });
    check(create.status === 0, "qa:create succeeds", create.stderr.trim().slice(0, 120));

    const qaUsers = await sql`select id::text as id from auth.users where email like '%@qa.invalid'`;
    check(qaUsers.length > 0, "…and QA accounts exist", `${qaUsers.length}`);

    // Give one of them a file, so there is something for destroy to remove.
    const qaUid = qaUsers[0].id;
    const qaPath = `${qaUid}/signature-qa-cleanup.png`;
    const error = await put("doctor-assets", qaPath, new Uint8Array(Buffer.from("qa signature")));
    check(!error, "…and a QA storage object to clean up", error?.message ?? "");

    const destroy = spawnSync(process.execPath, ["--env-file=.env.local", "scripts/qa-fixture.mjs", "destroy"], {
      encoding: "utf8",
    });
    check(destroy.status === 0, "qa:destroy succeeds", destroy.stderr.trim().slice(0, 120));

    const { data: qaGone } = await service.storage.from("doctor-assets").download(qaPath);
    check(qaGone === null, "…and the QA object is gone");

    // The key must never appear in what the script prints.
    const output = `${destroy.stdout}${destroy.stderr}${create.stdout}${create.stderr}`;
    check(
      !output.includes(serviceKey) && !output.includes("SUPABASE_SERVICE_ROLE_KEY="),
      "…without printing the service-role key",
    );
    check(
      /LEFT ALONE/.test(destroy.stdout),
      "…and it reports what it refused to touch",
      destroy.stdout.split("\n").find((l) => /LEFT ALONE/.test(l))?.trim() ?? "no report",
    );
  }

  console.log("\nThe retained clinical asset");
  {
    /**
     * Asserted from the BYTES. A storage delete blocked by RLS removes nothing
     * and raises nothing, and a delete that succeeded would leave no error
     * either — only the object can answer this.
     */
    const { data } = await service.storage.from("prescription-assets").download(RETIRED_PATH);
    const bytes = data ? new Uint8Array(await data.arrayBuffer()) : null;

    check(bytes !== null, "survives qa:destroy");
    check(
      bytes !== null && sha256(bytes) === sha256(RETIRED_BYTES),
      "…byte-for-byte unchanged",
      bytes ? sha256(bytes).slice(0, 12) : "GONE",
    );
  }

  console.log("\nThe production controls it relies on");
  {
    const policies = await sql`
      select cmd from pg_policies
      where schemaname = 'storage' and tablename = 'objects'
        and policyname like 'prescription_assets%'`;
    const cmds = policies.map((p) => p.cmd);
    check(!cmds.includes("DELETE"), "the clinical bucket has no DELETE policy", cmds.join(", "));
    check(!cmds.includes("INSERT"), "…and no INSERT policy", cmds.join(", "));
  }
} catch (e) {
  check(false, "qa cleanup verification", e.message);
  if (process.env.QA_TRACE) console.error(e);
} finally {
  // Remove the planted fixture ourselves — qa:destroy must not have.
  for (const [bucket, path] of planted) {
    await service.storage.from(bucket).remove([path]).catch(() => {});
  }
  spawnSync(process.execPath, ["--env-file=.env.local", "scripts/qa-fixture.mjs", "destroy"], {
    encoding: "utf8",
  });
  await sql.end();
}

console.log(
  failures.length === 0
    ? "\nAll QA cleanup safety checks passed.\n"
    : `\n${failures.length} CHECK(S) FAILED:\n  - ${failures.join("\n  - ")}\n`,
);
process.exit(failures.length === 0 ? 0 : 1);
