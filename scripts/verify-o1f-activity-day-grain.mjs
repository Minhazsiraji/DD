/**
 * O1-F ACTIVITY DAY-GRAIN + IDEMPOTENT INGESTION — proven against a real Postgres.
 * Hermetic, rolled back. NOT EXECUTED in this task (no local Postgres/Docker/
 * Supabase CLI available in this environment).
 */
import postgres from "postgres";
import { readFile } from "node:fs/promises";
import path from "node:path";

const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) { console.error("DIRECT_URL or DATABASE_URL must be set."); process.exit(1); }

const FILES = [
  "drizzle/migrations/0000_parallel_mentor.sql",
  "drizzle/migrations/0019_open_whizzer.sql",
  "supabase/policies/0033_platform_owner_authority.sql",
  "supabase/policies/0045_prelaunch_sec01b_security_closure.sql",
  "supabase/policies/0047_o1_owner_analytics_authority.sql",
];

let failures = 0;
function check(ok, label, detail = "") {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
try {
  await sql.begin(async (tx) => {
    for (const file of FILES) {
      const [{ exists }] = await tx`select exists(select 1 from information_schema.tables where table_schema='public' and table_name='profiles') as exists`;
      if (file.includes("0000_parallel_mentor") && exists) continue;
      const text = await readFile(path.resolve(file), "utf8");
      for (const stmt of text.split("--> statement-breakpoint")) if (stmt.trim()) await tx.unsafe(stmt);
    }

    const columns = await tx`select column_name, data_type from information_schema.columns where table_schema='public' and table_name='activity_contributions'`;
    check(!columns.some((c) => c.data_type === "timestamp with time zone"), "activity_contributions has no timestamptz column");

    const [profile] = await tx`insert into profiles(id, full_name) values (gen_random_uuid(), 'QA Doctor @qa.invalid') returning id`;
    const [doctor] = await tx`insert into doctor_profiles(user_id) values (${profile.id}) returning id`;

    await tx`select set_config('role', 'service_role', true)`;

    await tx`select ingest_activity_contribution('DOCTOR_ACTIVE_DAY', ${doctor.id}, current_date, '*', 1, 'O1A_INTERACTION_METER', 1)`;

    let blocked = false;
    try {
      await tx.savepoint(async (sp) => {
        await sp`select ingest_activity_contribution('DOCTOR_ACTIVE_DAY', ${doctor.id}, current_date, 'consultation_workspace', 1, 'O1A_INTERACTION_METER', 1)`;
      });
    } catch { blocked = true; }
    check(blocked, "a feature-partitioned row for DOCTOR_ACTIVE_DAY is rejected — no double-count path");

    // idempotent replay: same source_version, same value — must not error, must not duplicate
    await tx`select ingest_activity_contribution('DOCTOR_ACTIVE_DAY', ${doctor.id}, current_date, '*', 1, 'O1A_INTERACTION_METER', 1)`;
    const [{ n: rowCount }] = await tx`select count(*)::int as n from activity_contributions where doctor_id = ${doctor.id} and metric_code = 'DOCTOR_ACTIVE_DAY'`;
    check(rowCount === 1, "replay with the same source_version does not duplicate the row", `rows=${rowCount}`);

    // stale replay: LOWER source_version must not regress the stored value
    await tx`select ingest_activity_contribution('DOCTOR_ACTIVE_DAY', ${doctor.id}, current_date, '*', 0, 'O1A_INTERACTION_METER', 1)`;
    const [row] = await tx`select value, source_version from activity_contributions where doctor_id = ${doctor.id} and metric_code = 'DOCTOR_ACTIVE_DAY'`;
    check(row.value === 1 && row.source_version === "1", "a same-version replay does not overwrite (guard is strictly greater-than)");

    await tx`select ingest_activity_contribution('DOCTOR_ACTIVE_DAY', ${doctor.id}, current_date, '*', 5, 'O1A_INTERACTION_METER', 2)`;
    const [row2] = await tx`select value from activity_contributions where doctor_id = ${doctor.id} and metric_code = 'DOCTOR_ACTIVE_DAY'`;
    check(Number(row2.value) === 5, "a strictly greater source_version DOES update (last-authoritative-wins, monotonic)");

    await tx`select set_config('role', null, true)`;
    await tx`select set_config('role', 'authenticated', true)`;
    let clientBlocked = false;
    try {
      await tx.savepoint(async (sp) => { await sp`select * from activity_contributions limit 1`; });
    } catch { clientBlocked = true; }
    check(clientBlocked, "authenticated cannot SELECT activity_contributions directly (no scoped policy)");
    await tx`select set_config('role', null, true)`;

    throw new Error("__qa_rollback__");
  });
} catch (error) {
  if (error.message !== "__qa_rollback__") { console.error(error); failures += 1; }
} finally {
  await sql.end({ timeout: 1 });
}
console.log(`\n${failures === 0 ? "PASS" : `FAIL (${failures})`}`);
process.exit(failures === 0 ? 0 : 1);
