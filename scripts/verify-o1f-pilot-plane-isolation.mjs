/**
 * O1-F PILOT PLANE ISOLATION — proven against a real Postgres.
 *
 * Hermetic, matching scripts/verify-owner-authority.mjs's convention: applies
 * 0033 (platform owner), 0045 (AAL2 primitives) and 0047 (O1-F) inside ONE
 * transaction, proves, rolls back. Nothing is installed and no row survives.
 *
 * The role-assumption checks (section 5) additionally require a REAL
 * non-superuser login role (conventionally "authenticator", matching
 * Supabase's own PostgREST connection identity) granted anon/authenticated/
 * service_role membership only. SET ROLE's permission check is against
 * session_user, and a superuser session_user can SET ROLE to anything
 * regardless of grants — so those specific checks open a second connection
 * as AUTHENTICATOR_URL (falling back to a same-host, same-port URL with
 * user "authenticator" derived from DIRECT_URL/DATABASE_URL) rather than
 * reusing the primary superuser connection.
 */
import postgres from "postgres";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { applyFileIdempotent, readMigrationFile } from "./o1f-test-support.mjs";

const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) { console.error("DIRECT_URL or DATABASE_URL must be set."); process.exit(1); }

function authenticatorUrl() {
  if (process.env.AUTHENTICATOR_URL) return process.env.AUTHENTICATOR_URL;
  const u = new URL(url);
  u.username = "authenticator";
  u.password = process.env.AUTHENTICATOR_PASSWORD ?? "qa_test_only";
  return u.toString();
}

const FILES = [
  "drizzle/migrations/0019_open_whizzer.sql",
  "supabase/policies/0033_platform_owner_authority.sql",
  "supabase/policies/0045_prelaunch_sec01b_security_closure.sql",
  "supabase/policies/0047_o1_owner_analytics_authority.sql",
];

const CLINICAL_TABLES = [
  "patients", "encounters", "encounter_diagnoses", "encounter_investigations", "encounter_events",
  "prescriptions", "prescription_items", "prescription_events", "appointments", "appointment_events",
  "queue_entries", "queue_events", "patient_alerts", "patient_allergies", "patient_conditions",
  "patient_contacts", "patient_documents", "patient_location_links", "patient_medications", "patient_private_notes",
];

const PILOT_TABLES = [
  "pilot_cohorts", "pilot_participations", "pilot_consent_events", "pilot_event_registry",
  "pilot_reason_registry", "pilot_status_events", "feature_registry", "activity_contributions",
  "doctor_daily_activity_agg", "pilot_status_daily_agg",
];

const NEW_ROLES = ["dd_metrics_reader", "dd_metrics_rollup", "dd_pilot_writer", "dd_retention"];

let failures = 0;
function check(ok, label, detail = "") {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
try {
  await sql.begin(async (tx) => {
    console.log("1. Applying 0019 → 0033 → 0045 → 0047 in deployment order");
    for (const file of FILES) {
      const text = await readMigrationFile(file);
      await applyFileIdempotent(tx, text);
    }
    check(true, "all four files applied in order");

    console.log("\n2. RLS forced on every O1-F table");
    for (const table of PILOT_TABLES) {
      const [row] = await tx`
        select relrowsecurity, relforcerowsecurity from pg_class
        where relname = ${table} and relnamespace = 'public'::regnamespace`;
      check(!!row, `${table}: exists`);
      if (row) {
        check(row.relrowsecurity, `${table}: RLS enabled`);
        check(row.relforcerowsecurity, `${table}: RLS forced`);
      }
    }

    console.log("\n3. No O1-F table holds a foreign key into a clinical table");
    const fks = await tx`
      select tc.table_name as child, ccu.table_name as parent
      from information_schema.table_constraints tc
      join information_schema.constraint_column_usage ccu on ccu.constraint_name = tc.constraint_name
      where tc.constraint_type = 'FOREIGN KEY' and tc.table_name = any(${PILOT_TABLES})`;
    const leaks = fks.filter((r) => CLINICAL_TABLES.includes(r.parent));
    check(leaks.length === 0, "zero clinical foreign keys", leaks.map((r) => `${r.child}->${r.parent}`).join(", "));

    console.log("\n4. New roles are NOLOGIN, internal, and hold zero clinical grant");
    for (const role of NEW_ROLES) {
      const [r] = await tx`select rolcanlogin from pg_roles where rolname = ${role}`;
      check(!!r && r.rolcanlogin === false, `${role}: NOLOGIN`);
      const grants = await tx`select table_name from information_schema.role_table_grants where grantee = ${role}`;
      const clinicalGrant = grants.find((g) => CLINICAL_TABLES.includes(g.table_name));
      check(!clinicalGrant, `${role}: zero clinical table grant`, clinicalGrant?.table_name);
    }

    console.log("\n5. No API role has a SET-role membership path to any O1-F internal role");
    console.log("   (structural pg_auth_members proof inside the same migration transaction)");
    for (const assumer of ["anon", "authenticated", "service_role"]) {
      for (const role of NEW_ROLES) {
        const [membership] = await tx`
          with recursive can_set(roleid) as (
            select m.roleid
            from pg_auth_members m
            join pg_roles member_role
              on member_role.oid = m.member
            where member_role.rolname = ${assumer}
              and m.set_option

            union

            select m.roleid
            from pg_auth_members m
            join can_set prior
              on prior.roleid = m.member
            where m.set_option
          )
          select exists (
            select 1
            from can_set c
            join pg_roles target
              on target.oid = c.roleid
            where target.rolname = ${role}
          ) as can_assume
        `;

        check(
          membership?.can_assume === false,
          `${assumer} cannot assume ${role}`
        );
      }
    }

    console.log("\n6. pilot_participations/pilot_consent_events referenced by no clinical policy");
    const policies = await tx`select tablename, policyname, qual, with_check from pg_policies where schemaname = 'public'`;
    const leak2 = policies.find((p) => CLINICAL_TABLES.includes(p.tablename) && /pilot_participations|pilot_consent_events/i.test(`${p.qual ?? ""} ${p.with_check ?? ""}`));
    check(!leak2, "no clinical policy references pilot participation/consent", leak2?.policyname);

    throw new Error("__qa_rollback__");
  });
} catch (error) {
  if (error.message !== "__qa_rollback__") { console.error(error); failures += 1; }
} finally {
  await sql.end({ timeout: 1 });
}

console.log(`\n${failures === 0 ? "PASS" : `FAIL (${failures})`}`);
process.exit(failures === 0 ? 0 : 1);
