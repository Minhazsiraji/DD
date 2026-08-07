/**
 * Marks the single baseline migration as ALREADY APPLIED without running it.
 *
 * Needed because the practice-location rename was applied by hand-written SQL
 * (drizzle-kit cannot generate renames without an interactive TTY), so the
 * database is already at the target schema. Re-pointing drizzle's ledger stops
 * `db:migrate` trying to CREATE tables that exist.
 *
 * Only meaningful while the project has exactly one baseline migration. Once
 * real incremental migrations exist this should not be used again.
 *
 *   node --env-file=.env.local scripts/stamp-baseline.mjs
 */
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import postgres from "postgres";

const dir = "drizzle/migrations";
const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();

if (files.length !== 1) {
  console.error(
    `Refusing: expected exactly one baseline migration, found ${files.length}.`,
  );
  process.exit(1);
}

const content = await readFile(path.join(dir, files[0]), "utf8");

// Guard: this file must never create Supabase's own auth.users table.
if (/^\s*CREATE TABLE\s+"auth"/im.test(content)) {
  console.error('Refusing: baseline contains CREATE TABLE "auth".…');
  process.exit(1);
}

const hash = crypto.createHash("sha256").update(content).digest("hex");
const sql = postgres(process.env.DIRECT_URL, {
  max: 1,
  prepare: false,
  onnotice: () => {},
});

await sql`delete from drizzle.__drizzle_migrations`;
await sql`
  insert into drizzle.__drizzle_migrations (hash, created_at)
  values (${hash}, ${Date.now()})`;

console.log(`stamped ${files[0]} (${hash.slice(0, 16)}…)`);
await sql.end();
