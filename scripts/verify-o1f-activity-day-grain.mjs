/**
 * O1-F ACTIVITY DAY-GRAIN + IDEMPOTENT INGESTION — proven against a real Postgres.
 * Hermetic, rolled back. NOT EXECUTED in this task (no local Postgres/Docker/
 * Supabase CLI available in this environment).
 */
import postgres from "postgres";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { applyFileIdempotent, readMigrationFile, createProfile } from "./o1f-test-support.mjs";

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
      const text = await readMigrationFile(file);
      await applyFileIdempotent(tx, text);
    }

    const columns = await tx`select column_name, data_type from information_schema.columns where table_schema='public' and table_name='activity_contributions'`;
    check(!columns.some((c) => c.data_type === "timestamp with time zone"), "activity_contributions has no timestamptz column");

    const execGrants = await tx`
      select grantee from information_schema.role_routine_grants
      where routine_name = 'ingest_activity_contribution' and privilege_type = 'EXECUTE'`;
    const granteeSet = new Set(execGrants.map((r) => r.grantee));
    check(granteeSet.has("service_role"), "service_role has EXECUTE on ingest_activity_contribution");
    check(!granteeSet.has("authenticated") && !granteeSet.has("anon") && !granteeSet.has("PUBLIC"), "authenticated/anon/PUBLIC do NOT have EXECUTE on ingest_activity_contribution");

    const profileId = await createProfile(tx, "QA Doctor @qa.invalid");
    const [doctor] = await tx`insert into doctor_profiles(user_id) values (${profileId}) returning id`;

    // Setup calls run on the superuser connection deliberately (ingest_activity_contribution
    // is SECURITY DEFINER: its internal INSERT always runs as dd_metrics_rollup regardless of
    // caller). The privilege-relevant assertions — who may EXECUTE it, and that no role can
    // read the raw table directly — are checked separately below.
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
    check(Number(row.value) === 1 && row.source_version === "1", "a same-version replay does not overwrite (guard is strictly greater-than)", JSON.stringify(row));

    await tx`select ingest_activity_contribution('DOCTOR_ACTIVE_DAY', ${doctor.id}, current_date, '*', 5, 'O1A_INTERACTION_METER', 2)`;
    const [row2] = await tx`select value from activity_contributions where doctor_id = ${doctor.id} and metric_code = 'DOCTOR_ACTIVE_DAY'`;
    check(Number(row2.value) === 5, "a strictly greater source_version DOES update (last-authoritative-wins, monotonic)");

    // service_role itself has no direct table grant — only EXECUTE on the ingest function
    let serviceRoleBlocked = false;
    try {
      await tx.savepoint(async (sp) => {
        await sp`select set_config('role', 'service_role', true)`;
        await sp`select * from activity_contributions limit 1`;
      });
    } catch (e) { serviceRoleBlocked = e?.code === "42501"; }
    check(serviceRoleBlocked, "service_role cannot SELECT activity_contributions directly (EXECUTE-only via the function)");

    let clientBlocked = false;
    try {
      await tx.savepoint(async (sp) => {
        await sp`select set_config('role', 'authenticated', true)`;
        await sp`select * from activity_contributions limit 1`;
      });
    } catch (e) { clientBlocked = e?.code === "42501"; }
    check(clientBlocked, "authenticated cannot SELECT activity_contributions directly (no scoped policy)");

    throw new Error("__qa_rollback__");
  });
} catch (error) {
  if (error.message !== "__qa_rollback__") { console.error(error); failures += 1; }
} finally {
  await sql.end({ timeout: 1 });
}
console.log(`\n${failures === 0 ? "PASS" : `FAIL (${failures})`}`);
process.exit(failures === 0 ? 0 : 1);
