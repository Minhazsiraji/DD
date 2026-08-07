/**
 * Applies every SQL file in supabase/policies in filename order.
 *
 * The policy files are written to be idempotent (drop policy if exists /
 * create or replace), so re-running is safe and is the intended workflow after
 * editing a policy.
 *
 * Uses DIRECT_URL (session pooler) — the transaction pooler cannot run DDL
 * reliably. Never used at request time.
 *
 *   node --env-file=.env.local scripts/apply-policies.mjs
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";

const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error("DIRECT_URL or DATABASE_URL must be set.");
  process.exit(1);
}

const dir = path.resolve("supabase/policies");
const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();

if (files.length === 0) {
  console.error(`No .sql files found in ${dir}`);
  process.exit(1);
}

const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
let failed = false;

for (const file of files) {
  const content = await readFile(path.join(dir, file), "utf8");
  try {
    await sql.unsafe(content);
    console.log(`  ✓ ${file}`);
  } catch (err) {
    failed = true;
    console.error(`  ✗ ${file}\n    ${err.message}`);
    break;
  }
}

await sql.end();
process.exit(failed ? 1 : 0);
