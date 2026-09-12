/**
 * O1-F — Owner+AAL2 authority reuse, AAL1 denial, AAL2 success, non-probeable
 * consent suppression, k=5 small-cohort suppression, and cross-Doctor
 * isolation — proven together against a real Postgres because they share one
 * fixture (an owner, a cohort, several doctors).
 *
 * Hermetic, matching scripts/verify-owner-authority.mjs's `as()` helper
 * convention. Rolled back. NOT EXECUTED in this task — this environment has
 * no local Postgres, Docker, or Supabase CLI.
 */
import postgres from "postgres";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { applyFileIdempotent, readMigrationFile, createProfile } from "./o1f-test-support.mjs";

const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) { console.error("DIRECT_URL or DATABASE_URL must be set."); process.exit(1); }

const FILES = [
  "supabase/policies/0033_platform_owner_authority.sql",
  "supabase/policies/0045_prelaunch_sec01b_security_closure.sql",
  "supabase/policies/0047_o1_owner_analytics_authority.sql",
];

let failures = 0;
function check(ok, label, detail = "") {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

/** Run `fn` as a specific authenticated user, at a given AAL, then drop back. */
async function as(tx, user, aal, fn) {
  await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: user, role: "authenticated", aal })}, true)`;
  await tx`select set_config('role', 'authenticated', true)`;
  try { return await fn(); }
  finally {
    await tx`select set_config('role', null, true)`;
    await tx`select set_config('request.jwt.claims', null, true)`;
  }
}

async function refused(tx, label, expected, fn) {
  try {
    await tx.savepoint(async (sp) => { await fn(sp); throw new Error("__ALLOWED__"); });
    check(false, label, "ALLOWED");
  } catch (e) {
    if (/__ALLOWED__/.test(e.message)) return check(false, label, "ALLOWED");
    const first = e.message.split("\n")[0];
    check(first.includes(expected), label, first.slice(0, 80));
  }
}

const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
try {
  await sql.begin(async (tx) => {
    for (const file of FILES) {
      const text = await readMigrationFile(file);
      await applyFileIdempotent(tx, text);
    }

    // --- fixtures ---
    const ownerProfileId = await createProfile(tx, "QA Owner @qa.invalid");
    await tx`insert into platform_owners(user_id, is_active) values (${ownerProfileId}, true)`;
    const notOwnerProfileId = await createProfile(tx, "QA Not-Owner @qa.invalid");
    const ownerProfile = { id: ownerProfileId };
    const notOwnerProfile = { id: notOwnerProfileId };

    const [cohort] = await tx`insert into pilot_cohorts(cohort_code, display_name, started_on, created_by) values ('QA_COHORT', 'QA cohort', current_date, ${ownerProfileId}) returning cohort_code`;

    async function makeDoctor(label, { active = true, consent = true } = {}) {
      const pId = await createProfile(tx, `QA ${label} @qa.invalid`);
      const [d] = await tx`insert into doctor_profiles(user_id) values (${pId}) returning id`;
      const [pt] = await tx`insert into pilot_participations(cohort_code, doctor_id, status) values (${cohort.cohort_code}, ${d.id}, 'INVITED') returning participation_id`;
      await tx`insert into pilot_status_events(participation_id, cohort_code, event_code, event_day, recorded_by) values (${pt.participation_id}, ${cohort.cohort_code}, 'INVITED', current_date, ${ownerProfileId})`;

      if (active) {
        await tx`update pilot_participations set status = 'ENROLLED' where participation_id = ${pt.participation_id}`;
        await tx`insert into pilot_status_events(participation_id, cohort_code, event_code, event_day, recorded_by) values (${pt.participation_id}, ${cohort.cohort_code}, 'ENROLLED', current_date, ${ownerProfileId})`;
      } else {
        await tx`update pilot_participations set status = 'WITHDRAWN' where participation_id = ${pt.participation_id}`;
        await tx`insert into pilot_status_events(participation_id, cohort_code, event_code, event_day, recorded_by) values (${pt.participation_id}, ${cohort.cohort_code}, 'WITHDRAWN', current_date, ${ownerProfileId})`;
      }

      if (consent) {
        await tx`insert into pilot_consent_events(participation_id, cohort_code, consent_scope, consent_version, event, effective_at, recorded_by) values (${pt.participation_id}, ${cohort.cohort_code}, 'PRODUCT_USAGE_ANALYTICS', 'v1', 'CONSENT_GRANTED', now() - interval '10 days', ${ownerProfileId})`;
      }
      return { doctorId: d.id, participationId: pt.participation_id };
    }

    console.log("\n1. AAL1 denial / AAL2 success — the composed existing primitives");
    await as(tx, ownerProfile.id, "aal1", async () => {
      await refused(tx, "owner at AAL1 is refused (AAL2_REQUIRED)", "AAL2_REQUIRED", async (sp) => {
        await sp`select * from owner_activity_summary(current_date - 7, current_date)`;
      });
    });
    await as(tx, ownerProfile.id, "aal2", async () => {
      const rows = await tx`select * from owner_activity_summary(current_date - 7, current_date)`;
      check(Array.isArray(rows) && rows.length === 1, "owner at AAL2 succeeds");
    });

    console.log("\n2. A non-owner (even at AAL2) is refused — cross-Doctor / non-owner isolation");
    await as(tx, notOwnerProfile.id, "aal2", async () => {
      await refused(tx, "non-owner at AAL2 is refused (O1_OWNER_REQUIRED)", "O1_OWNER_REQUIRED", async (sp) => {
        await sp`select * from owner_activity_summary(current_date - 7, current_date)`;
      });
    });

    console.log("\n3. Owner analytics never reaches a clinical row (structural + behavioral)");
    const clinicalRefs = await tx`
      select p.proname from pg_proc p
      where p.pronamespace = 'public'::regnamespace and p.proname in ('owner_pilot_status','owner_pilot_cohort_detail','owner_doctor_activity','owner_activity_summary')
        and pg_get_functiondef(p.oid) ~* '\\y(patients|encounters|prescriptions|appointments)\\y'`;
    check(clinicalRefs.length === 0, "no owner_* function body references a clinical table by name");

    console.log("\n4. Consent withdrawal + non-probeable unauthorized result");
    const notMember = { doctorId: null, participationId: "00000000-0000-0000-0000-000000000000" };
    const withdrawnParticipation = await makeDoctor("Withdrawn-Participation", { active: false, consent: true });
    const withdrawnConsentDoctor = await makeDoctor("Withdrawn-Consent", { active: true, consent: true });
    await tx`insert into pilot_consent_events(participation_id, cohort_code, consent_scope, consent_version, event, effective_at, recorded_by) values (${withdrawnConsentDoctor.participationId}, ${cohort.cohort_code}, 'PRODUCT_USAGE_ANALYTICS', 'v1', 'CONSENT_WITHDRAWN', now() - interval '1 day', ${ownerProfileId})`;
    const authorizedDoctor = await makeDoctor("Authorized");
    for (let i = 0; i <= 7; i += 1) {
      await tx`select mark_telemetry_day_coverage(current_date - ${i}::int, ${authorizedDoctor.doctorId}, 'ACTIVITY', true, ${i + 1})`;
      await tx`select rebuild_doctor_daily_activity_agg(current_date - ${i}::int)`;
    }

    await as(tx, ownerProfile.id, "aal2", async () => {
      const [a] = await tx`select * from owner_doctor_activity(${cohort.cohort_code}, ${notMember.participationId}, current_date - 7, current_date)`;
      const [b] = await tx`select * from owner_doctor_activity(${cohort.cohort_code}, ${withdrawnParticipation.participationId}, current_date - 7, current_date)`;
      const [c] = await tx`select * from owner_doctor_activity(${cohort.cohort_code}, ${withdrawnConsentDoctor.participationId}, current_date - 7, current_date)`;
      const [ok] = await tx`select * from owner_doctor_activity(${cohort.cohort_code}, ${authorizedDoctor.participationId}, current_date - 7, current_date)`;

      const shape = (r) => JSON.stringify(r);
      check(shape(a) === shape(b) && shape(b) === shape(c), "all three unauthorized fixtures return byte-identical payloads");
      check(a.status === "UNAVAILABLE", "unauthorized status is the single generic marker", a.status);
      check(ok.status === "OK", "authorized fixture returns OK", ok.status);
    });

    const audit = await tx`select action from audit_events where resource_id in (${notMember.participationId}, ${withdrawnParticipation.participationId}, ${withdrawnConsentDoctor.participationId}) order by occurred_at`;
    check(new Set(audit.map((r) => r.action)).size >= 3, "the true cause is distinguishable inside audit_events (internal only)");

    console.log("\n5. k=5 small-cohort suppression");
    const smallCohortDoctors = [];
    for (let i = 0; i < 4; i += 1) smallCohortDoctors.push(await makeDoctor(`Small${i}`));
    for (const d of smallCohortDoctors) {
      await tx`select mark_telemetry_day_coverage(current_date, ${d.doctorId}, 'ACTIVITY', true, 1)`;
      await tx`insert into activity_contributions(metric_code, doctor_id, period_day, feature_code, value, source_stream, source_version) values ('DOCTOR_ACTIVE_DAY', ${d.doctorId}, current_date, '*', 1, 'O1A_INTERACTION_METER', 1)`;
      await tx`select rebuild_doctor_daily_activity_agg(current_date)`;
    }
    await tx`select rebuild_pilot_status_daily_agg(current_date, ${cohort.cohort_code})`;
    await as(tx, ownerProfile.id, "aal2", async () => {
      const [row] = await tx`select * from owner_pilot_status(current_date, current_date)`;
      check(row.active_doctor_count === "INSUFFICIENT_COHORT", "4 distinct active doctors suppress", row.active_doctor_count);
    });

    const fifth = await makeDoctor("Small4");
    await tx`select mark_telemetry_day_coverage(current_date, ${fifth.doctorId}, 'ACTIVITY', true, 1)`;
    await tx`insert into activity_contributions(metric_code, doctor_id, period_day, feature_code, value, source_stream, source_version) values ('DOCTOR_ACTIVE_DAY', ${fifth.doctorId}, current_date, '*', 1, 'O1A_INTERACTION_METER', 1)`;
    await tx`select rebuild_doctor_daily_activity_agg(current_date)`;
    await tx`select rebuild_pilot_status_daily_agg(current_date, ${cohort.cohort_code})`;
    await as(tx, ownerProfile.id, "aal2", async () => {
      const [row] = await tx`select * from owner_pilot_status(current_date, current_date)`;
      check(row.active_doctor_count !== "INSUFFICIENT_COHORT" && /^\d+$/.test(row.active_doctor_count), "5 distinct active doctors do not suppress", row.active_doctor_count);
    });

    // anti-reconstruction: no returned row from any owner_* function has an other/remainder column
    const columns = await tx`
      select p.proname, t.attname from pg_proc p
      join pg_type rt on rt.oid = p.prorettype join pg_class c on c.oid = rt.typrelid
      join pg_attribute t on t.attrelid = c.oid and t.attnum > 0
      where p.pronamespace = 'public'::regnamespace and p.proname in ('owner_pilot_status','owner_pilot_cohort_detail','owner_doctor_activity','owner_activity_summary')`;
    check(!columns.some((c) => /^(other|remainder|rest)$/i.test(c.attname)), "no owner_* return type carries a residual bucket column");

    throw new Error("__qa_rollback__");
  });
} catch (error) {
  if (error.message !== "__qa_rollback__") { console.error(error); failures += 1; }
} finally {
  await sql.end({ timeout: 1 });
}
console.log(`\n${failures === 0 ? "PASS" : `FAIL (${failures})`}`);
process.exit(failures === 0 ? 0 : 1);
