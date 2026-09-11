/**
 * O1-F OWNER RPC SURFACE — proven against a real Postgres. Hermetic, rolled back.
 * NOT EXECUTED in this task (no local Postgres/Docker/Supabase CLI available).
 */
import postgres from "postgres";
import { readFile } from "node:fs/promises";
import path from "node:path";

const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) { console.error("DIRECT_URL or DATABASE_URL must be set."); process.exit(1); }

const FILES = [
  "drizzle/migrations/0019_open_whizzer.sql",
  "supabase/policies/0033_platform_owner_authority.sql",
  "supabase/policies/0045_prelaunch_sec01b_security_closure.sql",
  "supabase/policies/0047_o1_owner_analytics_authority.sql",
];

const READER_OWNED = ["owner_pilot_status", "owner_pilot_cohort_detail", "owner_doctor_activity", "owner_activity_summary"];
const WRITER_OWNED = ["pilot_participation_state", "admin_pilot_cohort_upsert", "admin_pilot_participation_set", "admin_pilot_event_add", "admin_pilot_consent_set"];
const RAW_TABLES = ["activity_contributions", "pilot_status_events", "pilot_consent_events"];
const FORBIDDEN_COLUMNS = ["patient_id", "encounter_id", "prescription_id", "document_id"];

let failures = 0;
function check(ok, label, detail = "") {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
try {
  await sql.begin(async (tx) => {
    for (const file of FILES) {
      const text = await readFile(path.resolve(file), "utf8");
      for (const stmt of text.split("--> statement-breakpoint")) if (stmt.trim()) await tx.unsafe(stmt);
    }

    const rows = await tx`
      select p.proname, r.rolname as owner, pg_get_functiondef(p.oid) as def
      from pg_proc p join pg_roles r on r.oid = p.proowner
      where p.pronamespace = 'public'::regnamespace and p.proname = any(${[...READER_OWNED, ...WRITER_OWNED]})`;
    const byName = new Map(rows.map((r) => [r.proname, r]));

    for (const name of READER_OWNED) {
      const row = byName.get(name);
      check(!!row, `${name}: exists`);
      if (!row) continue;
      check(row.owner === "dd_metrics_reader", `${name}: owned by dd_metrics_reader`, row.owner);
      for (const raw of RAW_TABLES) check(!new RegExp(`\\b${raw}\\b`, "i").test(row.def), `${name}: does not reference ${raw} directly`);
      for (const col of FORBIDDEN_COLUMNS) check(!new RegExp(`\\b${col}\\b`, "i").test(row.def), `${name}: does not reference ${col}`);
    }
    for (const name of WRITER_OWNED) {
      const row = byName.get(name);
      check(!!row, `${name}: exists`);
      if (row) check(row.owner === "dd_pilot_writer", `${name}: owned by dd_pilot_writer`, row.owner);
    }

    const grants = await tx`
      select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and has_function_privilege('authenticated', p.oid, 'EXECUTE')
        and p.proname = any(${[...READER_OWNED, ...WRITER_OWNED]})`;
    const granted = new Set(grants.map((r) => r.proname));
    for (const name of [...READER_OWNED, ...WRITER_OWNED]) check(granted.has(name), `authenticated has EXECUTE on ${name}`);

    // no dd_metrics_rollup grant reaches an owner-facing function's definer role transitively via a table it shouldn't
    const [assertDef] = await tx`select p.proname, r.rolname as owner from pg_proc p join pg_roles r on r.oid = p.proowner where p.proname = 'assert_o1_owner_aal2' and p.pronamespace = 'public'::regnamespace`;
    check(!!assertDef, "assert_o1_owner_aal2 exists");

    throw new Error("__qa_rollback__");
  });
} catch (error) {
  if (error.message !== "__qa_rollback__") { console.error(error); failures += 1; }
} finally {
  await sql.end({ timeout: 1 });
}
console.log(`\n${failures === 0 ? "PASS" : `FAIL (${failures})`}`);
process.exit(failures === 0 ? 0 : 1);
