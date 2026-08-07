/**
 * Applies a one-off SQL file (hand-written migrations that drizzle-kit cannot
 * generate without an interactive TTY — table and enum renames, mainly).
 *
 *   node --env-file=.env.local scripts/apply-sql.mjs supabase/migrations/0002_x.sql
 *
 * Uses DIRECT_URL (session pooler). Never used at request time.
 */
import { readFile } from "node:fs/promises";
import postgres from "postgres";

const file = process.argv[2];
if (!file) {
  console.error("usage: apply-sql.mjs <path-to.sql>");
  process.exit(1);
}

const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error("DIRECT_URL or DATABASE_URL must be set.");
  process.exit(1);
}

const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });

try {
  await sql.unsafe(await readFile(file, "utf8"));
  console.log(`  ✓ ${file}`);
} catch (err) {
  console.error(`  ✗ ${file}\n    ${err.message}`);
  await sql.end();
  process.exit(1);
}

await sql.end();
