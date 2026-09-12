/**
 * O1-F-R2 contract verifier.
 *
 * Disposable Postgres only. The 0045 helper used by this repository intentionally
 * loads the byte-identical AAL2 primitive excerpt rather than claiming a full
 * protected-runtime reconstruction; see o1f-test-support.mjs.
 */
import postgres from "postgres";
import {
  applyFileIdempotent,
  readMigrationFile,
  createProfile,
} from "./o1f-test-support.mjs";

const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error("DIRECT_URL or DATABASE_URL must be set.");
  process.exit(1);
}

const FILES = [
  "drizzle/migrations/0000_parallel_mentor.sql",
  "drizzle/migrations/0019_open_whizzer.sql",
  "supabase/policies/0033_platform_owner_authority.sql",
  "supabase/policies/0045_prelaunch_sec01b_security_closure.sql",
  "supabase/policies/0047_o1_owner_analytics_authority.sql",
];

const FUNCTIONS = [
  ["assert_o1_owner_aal2()", false, false],
  ["enforce_pilot_participation_terminal()", false, false],
  ["prevent_pilot_consent_event_mutation()", false, false],
  ["pilot_consent_is_live(text,uuid,pilot_consent_scope,timestamptz)", false, false],
  ["pilot_consent_covers_day(text,uuid,pilot_consent_scope,date)", false, false],
  ["prevent_pilot_status_event_mutation()", false, false],
  ["ingest_activity_contribution(text,uuid,date,text,bigint,text,bigint)", false, true],
  ["mark_telemetry_day_coverage(date,uuid,telemetry_measurement_domain,boolean,bigint)", false, true],
  ["ingest_service_usage_daily(date,uuid,text,text,text,text,numeric,bigint,numeric,text)", false, true],
  ["rebuild_doctor_daily_activity_agg(date)", false, false],
  ["rebuild_pilot_status_daily_agg(date,text)", false, false],
  ["k_anon_suppress(bigint,bigint,integer)", false, false],
  ["participation_measurement_state(text,uuid,date,date,telemetry_measurement_domain)", false, false],
  ["owner_pilot_status(date,date)", true, false],
  ["owner_pilot_cohort_detail(text,date,date)", true, false],
  ["owner_doctor_activity(text,uuid,date,date)", true, false],
  ["owner_activity_summary(date,date)", true, false],
  ["owner_service_usage_summary(text,date,date)", true, false],
  ["pilot_participation_state(text)", true, false],
  ["admin_pilot_cohort_upsert(text,text,date,date)", true, false],
  ["admin_pilot_participation_set(text,uuid,pilot_participation_status)", true, false],
  ["admin_pilot_event_add(text,uuid,text,text,date)", true, false],
  ["admin_pilot_consent_set(text,uuid,pilot_consent_scope,text,pilot_consent_event_kind,timestamptz)", true, false],
];

const INTERNAL_TABLES = [
  "pilot_cohorts",
  "pilot_participations",
  "pilot_consent_events",
  "pilot_event_registry",
  "pilot_reason_registry",
  "pilot_status_events",
  "feature_registry",
  "activity_contributions",
  "telemetry_day_coverage",
  "service_usage_daily_agg",
  "doctor_daily_activity_agg",
  "pilot_status_daily_agg",
];

let failures = 0;
function check(ok, label, detail = "") {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

async function as(tx, user, aal, fn) {
  await tx`select set_config(
    'request.jwt.claims',
    ${JSON.stringify({ sub: user, role: "authenticated", aal })},
    true
  )`;
  await tx`select set_config('role', 'authenticated', true)`;
  try {
    return await fn();
  } finally {
    await tx`select set_config('role', null, true)`;
    await tx`select set_config('request.jwt.claims', null, true)`;
  }
}

async function refused(tx, label, expected, fn) {
  try {
    await tx.savepoint(async (sp) => {
      await fn(sp);
      throw new Error("__ALLOWED__");
    });
    check(false, label, "ALLOWED");
  } catch (e) {
    if (e.message === "__ALLOWED__") {
      check(false, label, "ALLOWED");
      return;
    }
    check(e.message.includes(expected), label, e.message.split("\n")[0]);
  }
}

async function makeDoctor(tx, ownerId, cohortCode, label) {
  const profile = await createProfile(tx, `QA ${label} @qa.invalid`);
  const [doctor] = await tx`
    insert into doctor_profiles(user_id)
    values (${profile})
    returning id
  `;
  const [p] = await tx`
    insert into pilot_participations(
      cohort_code, doctor_id, status, enrolled_on
    )
    values (
      ${cohortCode}, ${doctor.id}, 'ENROLLED', current_date - 10
    )
    returning participation_id
  `;
  await tx`
    insert into pilot_consent_events(
      participation_id, cohort_code, consent_scope,
      consent_version, event, effective_at, recorded_by
    )
    values (
      ${p.participation_id}, ${cohortCode}, 'PRODUCT_USAGE_ANALYTICS',
      'v1', 'CONSENT_GRANTED', now() - interval '10 days', ${ownerId}
    )
  `;
  return { doctorId: doctor.id, participationId: p.participation_id };
}

const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });

try {
  await sql.begin(async (tx) => {
    console.log("1. Apply disposable setup");
    for (const file of FILES) {
      await applyFileIdempotent(tx, await readMigrationFile(file));
    }
    check(true, "0047 applied");

    console.log("\n2. Complete 0047 function ACL matrix");
    for (const [sig, authExpected, serviceExpected] of FUNCTIONS) {
      const [row] = await tx`
        select to_regprocedure(${`public.${sig}`})::oid as oid
      `;
      check(!!row?.oid, `${sig}: exists`);
      if (!row?.oid) continue;

      const [acl] = await tx`
        select
          exists (
            select 1
            from aclexplode(
              coalesce(
                (select proacl from pg_proc where oid = ${row.oid}),
                acldefault(
                  'f',
                  (select proowner from pg_proc where oid = ${row.oid})
                )
              )
            ) x
            where x.grantee = 0 and x.privilege_type = 'EXECUTE'
          ) as public_exec,
          has_function_privilege('anon', ${row.oid}, 'EXECUTE') as anon_exec,
          has_function_privilege('authenticated', ${row.oid}, 'EXECUTE') as auth_exec,
          has_function_privilege('service_role', ${row.oid}, 'EXECUTE') as service_exec
      `;
      check(!acl.public_exec, `${sig}: PUBLIC denied`);
      check(!acl.anon_exec, `${sig}: anon denied`);
      check(acl.auth_exec === authExpected, `${sig}: authenticated=${authExpected}`);
      check(acl.service_exec === serviceExpected, `${sig}: service_role=${serviceExpected}`);
    }

    console.log("\n3. Frozen participation lifecycle + WITHDRAWN terminal");
    const lifecycle = await tx`
      select enumlabel
      from pg_enum
      where enumtypid = 'pilot_participation_status'::regtype
      order by enumsortorder
    `;
    check(
      lifecycle.map((r) => r.enumlabel).join(",") ===
        "INVITED,ENROLLED,COMPLETED,WITHDRAWN",
      "lifecycle is exact",
      lifecycle.map((r) => r.enumlabel).join(",")
    );

    const ownerId = await createProfile(tx, "QA R2 Owner @qa.invalid");
    await tx`
      insert into platform_owners(user_id, is_active)
      values (${ownerId}, true)
    `;
    const nonOwnerId = await createProfile(tx, "QA R2 NonOwner @qa.invalid");

    await tx`
      insert into pilot_cohorts(cohort_code, display_name, started_on, created_by)
      values
        ('R2_A', 'R2 A', current_date - 20, ${ownerId}),
        ('R2_B', 'R2 B', current_date - 20, ${ownerId}),
        ('R2_SMALL', 'R2 Small', current_date - 20, ${ownerId}),
        ('R2_SVC', 'R2 Service', current_date - 20, ${ownerId})
    `;

    const terminalDoctor = await makeDoctor(tx, ownerId, "R2_A", "Terminal");
    await tx`
      update pilot_participations
      set status = 'WITHDRAWN'
      where participation_id = ${terminalDoctor.participationId}
    `;
    let terminalBlocked = false;
    try {
      await tx.savepoint(async (sp) => {
        await sp`
          update pilot_participations
          set status = 'ENROLLED'
          where participation_id = ${terminalDoctor.participationId}
        `;
      });
    } catch (e) {
      terminalBlocked = e.message.includes("PILOT_PARTICIPATION_WITHDRAWN_TERMINAL");
    }
    check(terminalBlocked, "WITHDRAWN is terminal");

    console.log("\n4. Owner AAL gates");
    await as(tx, ownerId, "aal1", async () => {
      await refused(tx, "Owner AAL1 denied", "AAL2_REQUIRED", async (sp) => {
        await sp`select * from owner_activity_summary(current_date, current_date)`;
      });
    });
    await as(tx, nonOwnerId, "aal2", async () => {
      await refused(tx, "non-Owner denied", "O1_OWNER_REQUIRED", async (sp) => {
        await sp`select * from owner_activity_summary(current_date, current_date)`;
      });
    });

    console.log("\n5. Same Doctor / two cohorts / consent isolation");
    const sharedProfile = await createProfile(tx, "QA Shared Doctor @qa.invalid");
    const [sharedDoctor] = await tx`
      insert into doctor_profiles(user_id)
      values (${sharedProfile})
      returning id
    `;
    const [pa] = await tx`
      insert into pilot_participations(cohort_code, doctor_id, status)
      values ('R2_A', ${sharedDoctor.id}, 'ENROLLED')
      returning participation_id
    `;
    const [pb] = await tx`
      insert into pilot_participations(cohort_code, doctor_id, status)
      values ('R2_B', ${sharedDoctor.id}, 'ENROLLED')
      returning participation_id
    `;
    await tx`
      insert into pilot_consent_events(
        participation_id, cohort_code, consent_scope,
        consent_version, event, effective_at, recorded_by
      )
      values
        (${pa.participation_id}, 'R2_A', 'PRODUCT_USAGE_ANALYTICS', 'v1',
         'CONSENT_GRANTED', now() - interval '5 days', ${ownerId}),
        (${pb.participation_id}, 'R2_B', 'PRODUCT_USAGE_ANALYTICS', 'v1',
         'CONSENT_GRANTED', now() - interval '5 days', ${ownerId}),
        (${pb.participation_id}, 'R2_B', 'PRODUCT_USAGE_ANALYTICS', 'v1',
         'CONSENT_WITHDRAWN', now(), ${ownerId})
    `;
    await tx`
      select mark_telemetry_day_coverage(
        current_date, ${sharedDoctor.id}, 'ACTIVITY', true, 1
      )
    `;
    await tx`
      select ingest_activity_contribution(
        'DOCTOR_ENGAGED_MINUTES_DAILY',
        ${sharedDoctor.id},
        current_date,
        '*',
        11,
        'O1A_INTERACTION_METER',
        1
      )
    `;
    await tx`select rebuild_doctor_daily_activity_agg(current_date)`;

    const scoped = await tx`
      select cohort_code, participation_id
      from doctor_daily_activity_agg
      where doctor_id = ${sharedDoctor.id}
        and period_day = current_date
    `;
    check(
      scoped.length === 1 &&
        scoped[0].cohort_code === "R2_A" &&
        scoped[0].participation_id === pa.participation_id,
      "named aggregate is participation/cohort scoped"
    );

    await as(tx, ownerId, "aal2", async () => {
      const [a] = await tx`
        select * from owner_doctor_activity(
          'R2_A', ${pa.participation_id}, current_date, current_date
        )
      `;
      const [b] = await tx`
        select * from owner_doctor_activity(
          'R2_B', ${pb.participation_id}, current_date, current_date
        )
      `;
      check(a.status === "OK" && Number(a.engaged_minutes) === 11,
        "Cohort A live consent can read A");
      check(b.status === "UNAVAILABLE" && b.engaged_minutes === null,
        "Cohort B withdrawal is immediately unavailable");
    });

    console.log("\n6. Activity ingestion idempotency + unknown-vs-zero");
    await tx`
      select ingest_activity_contribution(
        'DOCTOR_SESSION_COUNT_DAILY',
        ${sharedDoctor.id}, current_date, '*', 2,
        'O1A_INTERACTION_METER', 2
      )
    `;
    await tx`
      select ingest_activity_contribution(
        'DOCTOR_SESSION_COUNT_DAILY',
        ${sharedDoctor.id}, current_date, '*', 2,
        'O1A_INTERACTION_METER', 2
      )
    `;
    const [{ n: activityRows }] = await tx`
      select count(*)::int as n
      from activity_contributions
      where doctor_id = ${sharedDoctor.id}
        and period_day = current_date
        and metric_code = 'DOCTOR_SESSION_COUNT_DAILY'
    `;
    check(activityRows === 1, "activity ingestion replay is idempotent");

    const zeroDoctor = await makeDoctor(tx, ownerId, "R2_A", "Zero");
    await tx`
      select mark_telemetry_day_coverage(
        current_date - 1, ${zeroDoctor.doctorId}, 'ACTIVITY', true, 1
      )
    `;
    await tx`select rebuild_doctor_daily_activity_agg(current_date - 1)`;

    const noMeasureDoctor = await makeDoctor(
      tx,
      ownerId,
      "R2_A",
      "NoMeasure"
    );

    await as(tx, ownerId, "aal2", async () => {
      const [z] = await tx`
        select * from owner_doctor_activity(
          'R2_A', ${zeroDoctor.participationId},
          current_date - 1, current_date - 1
        )
      `;
      check(
        z.status === "OK" &&
        Number(z.engaged_minutes) === 0 &&
        Number(z.session_count) === 0,
        "complete window + authoritative zero stays 0"
      );

      const [missing] = await tx`
        select * from owner_doctor_activity(
          'R2_A', ${zeroDoctor.participationId},
          current_date - 2, current_date - 1
        )
      `;
      check(missing.status === "NOT_MEASURED",
        "one missing day is NOT_MEASURED");

      const [none] = await tx`
        select * from owner_doctor_activity(
          'R2_A', ${noMeasureDoctor.participationId},
          current_date, current_date
        )
      `;
      check(none.status === "NOT_MEASURED",
        "no measurements are NOT_MEASURED");
    });

    console.log("\n7. k=5 suppression");
    const small = [];
    for (let i = 0; i < 4; i += 1) {
      const d = await makeDoctor(tx, ownerId, "R2_SMALL", `Small${i}`);
      small.push(d);
      await tx`
        select mark_telemetry_day_coverage(
          current_date, ${d.doctorId}, 'ACTIVITY', true, 1
        )
      `;
      await tx`
        select ingest_activity_contribution(
          'DOCTOR_ACTIVE_DAY', ${d.doctorId}, current_date, '*', 1,
          'O1A_INTERACTION_METER', 1
        )
      `;
    }
    await tx`select rebuild_doctor_daily_activity_agg(current_date)`;
    await tx`select rebuild_pilot_status_daily_agg(current_date, 'R2_SMALL')`;
    await as(tx, ownerId, "aal2", async () => {
      const rows = await tx`
        select * from owner_pilot_status(current_date, current_date)
        where cohort_code = 'R2_SMALL'
      `;
      check(
        rows[0]?.active_doctor_count === "INSUFFICIENT_COHORT",
        "k<5 is INSUFFICIENT_COHORT"
      );
    });

    console.log("\n8. Exact E->F ten-column contract");
    const cols = await tx`
      select column_name
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'service_usage_daily_agg'
      order by ordinal_position
    `;
    const exact = [
      "period_day",
      "principal_doctor_id",
      "provider_id",
      "service_kind",
      "model_id",
      "unit",
      "quantity_total",
      "event_count",
      "estimated_cost_minor",
      "currency_code",
    ];
    check(
      cols.map((r) => r.column_name).join(",") === exact.join(","),
      "E->F table has exactly ten frozen columns",
      cols.map((r) => r.column_name).join(",")
    );

    console.log("\n9. AI/Voice precision, unknown cost, complete/partial coverage");
    const svcDoctors = [];
    for (let i = 0; i < 5; i += 1) {
      const d = await makeDoctor(tx, ownerId, "R2_SVC", `Svc${i}`);
      svcDoctors.push(d);
      await tx`
        select mark_telemetry_day_coverage(
          current_date, ${d.doctorId}, 'AI_VOICE', true, 1
        )
      `;
      await tx`
        select ingest_service_usage_daily(
          current_date,
          ${d.doctorId},
          'openai',
          'AI',
          'gpt-test',
          'token',
          1,
          1,
          ${i === 4 ? null : (i === 0 ? "0.0000000001" : "0")},
          'USD'
        )
      `;
      await tx`
        select ingest_service_usage_daily(
          current_date,
          ${d.doctorId},
          'voice',
          'VOICE',
          'voice-test',
          'second',
          0,
          0,
          0,
          'USD'
        )
      `;
    }

    const [tiny] = await tx`
      select estimated_cost_minor
      from service_usage_daily_agg
      where principal_doctor_id = ${svcDoctors[0].doctorId}
        and service_kind = 'AI'
    `;
    check(
      Number(tiny.estimated_cost_minor) > 0,
      "positive sub-cent cost remains positive",
      tiny.estimated_cost_minor
    );

    await tx`
      select ingest_service_usage_daily(
        current_date,
        ${svcDoctors[0].doctorId},
        'openai', 'AI', 'gpt-test', 'token', 1, 1,
        0.0000000001, 'USD'
      )
    `;
    const [{ n: svcCount }] = await tx`
      select count(*)::int as n
      from service_usage_daily_agg
      where principal_doctor_id = ${svcDoctors[0].doctorId}
        and service_kind = 'AI'
    `;
    check(svcCount === 1, "AI/Voice ingestion replay is idempotent");

    await as(tx, ownerId, "aal2", async () => {
      const rows = await tx`
        select * from owner_service_usage_summary(
          'R2_SVC', current_date, current_date
        )
      `;
      const ai = rows.find((r) => r.status === "OK" && r.service_kind === "AI");
      const voice = rows.find((r) => r.status === "OK" && r.service_kind === "VOICE");
      check(ai && ai.estimated_cost_minor === null,
        "partial known AI cost propagates NULL, never partial total");
      check(voice && Number(voice.estimated_cost_minor) === 0,
        "known exact zero cost remains 0");

      const partial = await tx`
        select * from owner_service_usage_summary(
          'R2_SVC', current_date - 1, current_date
        )
      `;
      check(
        partial.length === 1 && partial[0].status === "NOT_MEASURED",
        "partial AI/Voice window is NOT_MEASURED"
      );
    });

    console.log("\n10. No arbitrary Doctor selector / anti-reconstruction");
    const ownerDefs = await tx`
      select
        p.proname,
        pg_get_function_arguments(p.oid) as args,
        pg_get_function_result(p.oid) as result
      from pg_proc p
      where p.pronamespace = 'public'::regnamespace
        and p.proname like 'owner_%'
    `;
    check(
      !ownerDefs.some((r) => /\bdoctor_id\b/i.test(r.args)),
      "owner analytics has no doctor_id selector"
    );
    check(
      !ownerDefs.some((r) => /\b(other|remainder|rest)\b/i.test(r.result)),
      "owner analytics exposes no residual bucket"
    );

    console.log("\n11. No clinical reads");
    const forbidden = /\b(patients?|encounters?|prescriptions?|appointments?|investigations?|patient_[a-z0-9_]*|encounter_[a-z0-9_]*|prescription_[a-z0-9_]*)\b/i;
    const defs = await tx`
      select p.proname, pg_get_functiondef(p.oid) as def
      from pg_proc p
      where p.pronamespace = 'public'::regnamespace
        and (
          p.proname like 'owner_%'
          or p.proname like 'admin_pilot_%'
          or p.proname in (
            'rebuild_doctor_daily_activity_agg',
            'rebuild_pilot_status_daily_agg',
            'participation_measurement_state'
          )
        )
    `;
    check(
      !defs.some((r) => forbidden.test(r.def)),
      "O1-F authority functions read no clinical table"
    );

    console.log("\n12. No direct API access to internal O1 tables");
    for (const table of INTERNAL_TABLES) {
      for (const role of ["anon", "authenticated", "service_role"]) {
        const [g] = await tx`
          select
            has_table_privilege(${role}, ${`public.${table}`}, 'SELECT') as s,
            has_table_privilege(${role}, ${`public.${table}`}, 'INSERT') as i,
            has_table_privilege(${role}, ${`public.${table}`}, 'UPDATE') as u,
            has_table_privilege(${role}, ${`public.${table}`}, 'DELETE') as d
        `;
        check(!g.s && !g.i && !g.u && !g.d,
          `${role}: no direct ${table} table access`);
      }
    }

    console.log("\n13. audit_events narrow insertion authority");
    const auditGrants = await tx`
      select privilege_type
      from information_schema.role_table_grants
      where grantee = 'dd_metrics_reader'
        and table_schema = 'public'
        and table_name = 'audit_events'
      order by privilege_type
    `;
    check(
      auditGrants.map((r) => r.privilege_type).join(",") === "INSERT",
      "dd_metrics_reader has INSERT only on audit_events",
      auditGrants.map((r) => r.privilege_type).join(",")
    );
    const [auditRls] = await tx`
      select relrowsecurity, relforcerowsecurity
      from pg_class
      where oid = 'public.audit_events'::regclass
    `;
    check(auditRls.relrowsecurity && auditRls.relforcerowsecurity,
      "audit_events remains FORCE RLS");

    throw new Error("__qa_rollback__");
  });
} catch (error) {
  if (error.message !== "__qa_rollback__") {
    console.error(error);
    failures += 1;
  }
} finally {
  await sql.end({ timeout: 1 });
}

console.log(`\n${failures === 0 ? "PASS" : `FAIL (${failures})`}`);
process.exit(failures === 0 ? 0 : 1);

