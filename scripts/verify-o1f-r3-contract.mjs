/**
 * O1-F-R3 final narrow contract closure verifier.
 *
 * Disposable Postgres only. The repository harness intentionally loads only the
 * byte-identical AAL2 primitive excerpt from 0045; this does NOT claim a full
 * protected-runtime reconstruction.
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

async function expectRefused(tx, label, expected, fn) {
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
    check(
      e.message.includes(expected),
      label,
      e.message.split("\n")[0]
    );
  }
}

async function createDoctor(tx, label) {
  const profileId = await createProfile(tx, `QA R3 ${label} @qa.invalid`);
  const [doctor] = await tx`
    insert into doctor_profiles(user_id)
    values (${profileId})
    returning id
  `;
  return { profileId, doctorId: doctor.id };
}

async function createInvited(tx, ownerId, cohortCode, label, enrolledOn = null) {
  const doctor = await createDoctor(tx, label);
  const [p] = await tx`
    insert into pilot_participations(
      cohort_code,
      doctor_id,
      status,
      enrolled_on
    )
    values (
      ${cohortCode},
      ${doctor.doctorId},
      'INVITED',
      coalesce(${enrolledOn}::date, current_date - 10)
    )
    returning participation_id
  `;

  await tx`
    insert into pilot_status_events(
      participation_id,
      cohort_code,
      event_code,
      event_day,
      recorded_by
    )
    values (
      ${p.participation_id},
      ${cohortCode},
      'INVITED',
      coalesce(${enrolledOn}::date, current_date - 10),
      ${ownerId}
    )
  `;

  return {
    ...doctor,
    participationId: p.participation_id,
  };
}

async function enroll(tx, ownerId, cohortCode, participationId, eventDay = null) {
  await tx`
    update pilot_participations
    set status = 'ENROLLED'
    where participation_id = ${participationId}
  `;
  await tx`
    insert into pilot_status_events(
      participation_id,
      cohort_code,
      event_code,
      event_day,
      recorded_by
    )
    values (
      ${participationId},
      ${cohortCode},
      'ENROLLED',
      coalesce(${eventDay}::date, current_date - 10),
      ${ownerId}
    )
  `;
}

async function complete(tx, ownerId, cohortCode, participationId, eventDay = null) {
  await tx`
    update pilot_participations
    set status = 'COMPLETED'
    where participation_id = ${participationId}
  `;
  await tx`
    insert into pilot_status_events(
      participation_id,
      cohort_code,
      event_code,
      event_day,
      recorded_by
    )
    values (
      ${participationId},
      ${cohortCode},
      'COMPLETED',
      coalesce(${eventDay}::date, current_date - 5),
      ${ownerId}
    )
  `;
}

async function withdraw(tx, ownerId, cohortCode, participationId, eventDay = null) {
  await tx`
    update pilot_participations
    set status = 'WITHDRAWN'
    where participation_id = ${participationId}
  `;
  await tx`
    insert into pilot_status_events(
      participation_id,
      cohort_code,
      event_code,
      event_day,
      recorded_by
    )
    values (
      ${participationId},
      ${cohortCode},
      'WITHDRAWN',
      coalesce(${eventDay}::date, current_date),
      ${ownerId}
    )
  `;
}

async function grantConsent(tx, ownerId, cohortCode, participationId, day = null) {
  await tx`
    insert into pilot_consent_events(
      participation_id,
      cohort_code,
      consent_scope,
      consent_version,
      event,
      effective_at,
      recorded_by
    )
    values (
      ${participationId},
      ${cohortCode},
      'PRODUCT_USAGE_ANALYTICS',
      'v1',
      'CONSENT_GRANTED',
      coalesce(${day}::date, current_date - 10)::timestamptz,
      ${ownerId}
    )
  `;
}

async function makeEnrolledDoctor(tx, ownerId, cohortCode, label) {
  const d = await createInvited(
    tx,
    ownerId,
    cohortCode,
    label,
    null
  );
  await enroll(
    tx,
    ownerId,
    cohortCode,
    d.participationId,
    null
  );
  await grantConsent(
    tx,
    ownerId,
    cohortCode,
    d.participationId,
    null
  );
  return d;
}

async function seedSourceState(tx, ownerId, cohortCode, source, label) {
  const d = await createInvited(tx, ownerId, cohortCode, label, null);
  if (source === "ENROLLED") {
    await enroll(tx, ownerId, cohortCode, d.participationId, null);
  } else if (source === "COMPLETED") {
    await enroll(tx, ownerId, cohortCode, d.participationId, null);
    await complete(tx, ownerId, cohortCode, d.participationId, null);
  } else if (source === "WITHDRAWN") {
    await withdraw(tx, ownerId, cohortCode, d.participationId, null);
  }
  return d;
}

const sql = postgres(url, {
  max: 1,
  prepare: false,
  onnotice: () => {},
});

try {
  await sql.begin(async (tx) => {
    console.log("1. Apply disposable setup");
    for (const file of FILES) {
      await applyFileIdempotent(tx, await readMigrationFile(file));
    }
    check(true, "0047 applied");

    const ownerId = await createProfile(tx, "QA R3 Owner @qa.invalid");
    await tx`
      insert into platform_owners(user_id, is_active)
      values (${ownerId}, true)
    `;

    await tx`
      insert into pilot_cohorts(
        cohort_code,
        display_name,
        started_on,
        created_by
      )
      values
        ('R3_STATE', 'R3 State', current_date - 30, ${ownerId}),
        ('R3_QTY', 'R3 Quantity', current_date - 30, ${ownerId}),
        ('R3_PM', 'R3 Provider Model', current_date - 30, ${ownerId}),
        ('R3_HIST', 'R3 History', current_date - 30, ${ownerId})
    `;

    console.log("\n2. Exact E->F schema metadata");
    const cols = await tx`
      select
        column_name,
        data_type,
        udt_name,
        is_nullable,
        numeric_precision,
        numeric_scale
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'service_usage_daily_agg'
      order by ordinal_position
    `;

    const expectedNames = [
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

    check(cols.length === 10, "exact ten-column count", String(cols.length));
    check(
      cols.map((r) => r.column_name).join(",") === expectedNames.join(","),
      "exact frozen column order/names",
      cols.map((r) => r.column_name).join(",")
    );

    const byName = new Map(cols.map((r) => [r.column_name, r]));

    check(
      byName.get("quantity_total")?.data_type === "numeric" &&
      byName.get("quantity_total")?.is_nullable === "YES" &&
      Number(byName.get("quantity_total")?.numeric_precision) === 38 &&
      Number(byName.get("quantity_total")?.numeric_scale) === 18,
      "quantity_total = numeric(38,18) NULL"
    );

    check(
      byName.get("estimated_cost_minor")?.data_type === "numeric" &&
      byName.get("estimated_cost_minor")?.is_nullable === "YES" &&
      Number(byName.get("estimated_cost_minor")?.numeric_precision) === 38 &&
      Number(byName.get("estimated_cost_minor")?.numeric_scale) === 18,
      "estimated_cost_minor = numeric(38,18) NULL"
    );

    check(
      byName.get("event_count")?.data_type === "bigint" &&
      byName.get("event_count")?.is_nullable === "NO",
      "event_count = bigint NOT NULL"
    );

    for (const name of [
      "period_day",
      "principal_doctor_id",
      "provider_id",
      "service_kind",
      "model_id",
      "unit",
      "currency_code",
    ]) {
      check(
        byName.get(name)?.is_nullable === "NO",
        `${name}: NOT NULL`
      );
    }

    console.log("\n3. A<->F feature registry contract");

    const featureRows = await tx`
      select code
      from feature_registry
      order by code
    `;

    const exactFeatureRegistry = [
      "*",
      "appointments",
      "consultation",
      "dashboard",
      "patients",
      "prescription",
      "queue",
      "settings",
    ];

    check(
      featureRows.map((r) => r.code).join(",") ===
        exactFeatureRegistry.join(","),
      "feature_registry is exactly sentinel + seven A feature codes",
      featureRows.map((r) => r.code).join(",")
    );

    check(
      !featureRows.some((r) => r.code === "owner"),
      "owner is not present in feature_registry"
    );

    const [featureFk] = await tx`
      select
        c.contype,
        c.confrelid::regclass::text as referenced_table,
        pg_get_constraintdef(c.oid) as definition
      from pg_constraint c
      where c.conrelid = 'public.activity_contributions'::regclass
        and c.confrelid = 'public.feature_registry'::regclass
        and c.contype = 'f'
        and pg_get_constraintdef(c.oid)
          like 'FOREIGN KEY (feature_code)%'
      limit 1
    `;

    check(
      featureFk?.contype === "f" &&
      /feature_registry\(code\)/.test(featureFk?.definition ?? ""),
      "activity_contributions.feature_code FK remains enforced",
      featureFk?.definition ?? "missing"
    );

    const featureProfile = await createProfile(
      tx,
      "QA R3 Feature Registry @qa.invalid"
    );

    const [featureDoctor] = await tx`
      insert into doctor_profiles(user_id)
      values (${featureProfile})
      returning id
    `;

    const acceptedAFeatures = [
      "dashboard",
      "patients",
      "consultation",
      "prescription",
      "appointments",
      "queue",
      "settings",
    ];

    for (const featureCode of acceptedAFeatures) {
      await tx`
        select ingest_activity_contribution(
          'DOCTOR_FEATURE_TOUCH_DAILY',
          ${featureDoctor.id},
          current_date,
          ${featureCode},
          1,
          'APP_FEATURE',
          1
        )
      `;

      const [{ n }] = await tx`
        select count(*)::int as n
        from activity_contributions
        where doctor_id = ${featureDoctor.id}
          and period_day = current_date
          and metric_code = 'DOCTOR_FEATURE_TOUCH_DAILY'
          and feature_code = ${featureCode}
      `;

      check(
        n === 1,
        `accepted A feature code: ${featureCode}`
      );
    }

    const acceptedRows = await tx`
      select feature_code
      from activity_contributions
      where doctor_id = ${featureDoctor.id}
        and period_day = current_date
        and metric_code = 'DOCTOR_FEATURE_TOUCH_DAILY'
      order by feature_code
    `;

    check(
      acceptedRows.map((r) => r.feature_code).join(",") ===
        [...acceptedAFeatures].sort().join(","),
      "exactly the seven A feature codes were accepted"
    );

    let unknownRejected = false;

    try {
      await tx.savepoint(async (sp) => {
        await sp`
          select ingest_activity_contribution(
            'DOCTOR_FEATURE_TOUCH_DAILY',
            ${featureDoctor.id},
            current_date,
            'unknown_feature',
            1,
            'APP_FEATURE',
            1
          )
        `;
      });
    } catch (e) {
      unknownRejected = e?.code === "23503";
    }

    check(
      unknownRejected,
      "unknown feature code is rejected by feature_registry FK"
    );

    let sentinelFeatureTouchRejected = false;

    try {
      await tx.savepoint(async (sp) => {
        await sp`
          select ingest_activity_contribution(
            'DOCTOR_FEATURE_TOUCH_DAILY',
            ${featureDoctor.id},
            current_date,
            '*',
            1,
            'APP_FEATURE',
            1
          )
        `;
      });
    } catch (e) {
      sentinelFeatureTouchRejected = e?.code === "23514";
    }

    check(
      sentinelFeatureTouchRejected,
      "* remains sentinel-only and is rejected for feature-touch metric"
    );

    console.log("\n4. Frozen participation transition matrix");

    for (const initial of ["ENROLLED", "COMPLETED", "WITHDRAWN"]) {
      const d = await createDoctor(tx, `Initial-${initial}`);
      await expectRefused(
        tx,
        `new participation cannot start ${initial}`,
        "PILOT_PARTICIPATION_INITIAL_STATE_INVALID",
        async (sp) => {
          await sp`
            insert into pilot_participations(
              cohort_code,
              doctor_id,
              status
            )
            values (
              'R3_STATE',
              ${d.doctorId},
              ${initial}::pilot_participation_status
            )
          `;
        }
      );
    }

    const allowed = {
      INVITED: new Set(["INVITED", "ENROLLED", "WITHDRAWN"]),
      ENROLLED: new Set(["ENROLLED", "COMPLETED", "WITHDRAWN"]),
      COMPLETED: new Set(["COMPLETED"]),
      WITHDRAWN: new Set(["WITHDRAWN"]),
    };

    const states = ["INVITED", "ENROLLED", "COMPLETED", "WITHDRAWN"];

    for (const source of states) {
      for (const target of states) {
        const d = await seedSourceState(
          tx,
          ownerId,
          "R3_STATE",
          source,
          `${source}-${target}`
        );
        const shouldAllow = allowed[source].has(target);

        try {
          await tx.savepoint(async (sp) => {
            await sp`
              update pilot_participations
              set status = ${target}::pilot_participation_status
              where participation_id = ${d.participationId}
            `;
          });
          check(
            shouldAllow,
            `${source} -> ${target} ${shouldAllow ? "allowed" : "rejected"}`,
            shouldAllow ? "" : "ILLEGAL TRANSITION ALLOWED"
          );
        } catch (e) {
          check(
            !shouldAllow &&
            e.message.includes("PILOT_PARTICIPATION_TRANSITION_INVALID"),
            `${source} -> ${target} rejected`,
            e.message.split("\n")[0]
          );
        }
      }
    }

    for (const initial of ["ENROLLED", "COMPLETED", "WITHDRAWN"]) {
      const d = await createDoctor(tx, `Admin-Initial-${initial}`);
      await as(tx, ownerId, "aal2", async () => {
        await expectRefused(
          tx,
          `admin writer rejects initial ${initial}`,
          "PILOT_PARTICIPATION_INITIAL_STATE_INVALID",
          async (sp) => {
            await sp`
              select admin_pilot_participation_set(
                'R3_STATE',
                ${d.doctorId},
                ${initial}::pilot_participation_status
              )
            `;
          }
        );
      });
    }

    console.log("\n5. One lifecycle mutation authority");
    const generic = await createInvited(
      tx,
      ownerId,
      "R3_STATE",
      "GenericGuard",
      null
    );

    await as(tx, ownerId, "aal2", async () => {
      await expectRefused(
        tx,
        "generic event writer cannot inject ENROLLED lifecycle event",
        "PILOT_LIFECYCLE_EVENT_WRITER_REQUIRED",
        async (sp) => {
          await sp`
            select admin_pilot_event_add(
              'R3_STATE',
              ${generic.participationId},
              'ENROLLED',
              null,
              current_date
            )
          `;
        }
      );
    });

    console.log("\n6. Quantity unknown/zero/positive truth");
    const qtyDoctors = [];

    for (let i = 0; i < 5; i += 1) {
      const d = await makeEnrolledDoctor(
        tx,
        ownerId,
        "R3_QTY",
        `Qty${i}`
      );
      qtyDoctors.push(d);

      await tx`
        select mark_telemetry_day_coverage(
          current_date,
          ${d.doctorId},
          'AI_VOICE',
          true,
          1
        )
      `;
    }

    const cases = [
      {
        model: "qty-known",
        q: [2, 2, 2, 2, 2],
        c: [1, 1, 1, 1, 1],
      },
      {
        model: "qty-zero",
        q: [0, 0, 0, 0, 0],
        c: [0, 0, 0, 0, 0],
      },
      {
        model: "qty-one-unknown",
        q: [null, 1, 1, 1, 1],
        c: [1, 1, 1, 1, 1],
      },
      {
        model: "qty-all-unknown",
        q: [null, null, null, null, null],
        c: [1, 1, 1, 1, 1],
      },
      {
        model: "qty-unknown-cost-known",
        q: [null, null, null, null, null],
        c: [2, 2, 2, 2, 2],
      },
      {
        model: "qty-known-cost-unknown",
        q: [1, 1, 1, 1, 1],
        c: [null, 1, 1, 1, 1],
      },
    ];

    for (const tc of cases) {
      for (let i = 0; i < qtyDoctors.length; i += 1) {
        await tx`
          select ingest_service_usage_daily(
            current_date,
            ${qtyDoctors[i].doctorId},
            'openai',
            'AI',
            ${tc.model},
            'token',
            ${tc.q[i]},
            1,
            ${tc.c[i]},
            'USD'
          )
        `;
      }
    }

    await as(tx, ownerId, "aal2", async () => {
      const rows = await tx`
        select *
        from owner_service_usage_summary(
          'R3_QTY',
          current_date,
          current_date
        )
      `;

      const byModel = new Map(
        rows
          .filter((r) => r.status === "OK")
          .map((r) => [r.model_id, r])
      );

      check(
        Number(byModel.get("qty-known")?.quantity_total) === 10,
        "all quantities known -> exact positive sum"
      );
      check(
        Number(byModel.get("qty-zero")?.quantity_total) === 0,
        "authoritative zero quantity -> 0"
      );
      check(
        byModel.get("qty-one-unknown")?.quantity_total === null,
        "one unknown among known -> NULL"
      );
      check(
        byModel.get("qty-all-unknown")?.quantity_total === null,
        "all unknown quantity -> NULL"
      );
      check(
        byModel.get("qty-unknown-cost-known")?.quantity_total === null &&
        Number(
          byModel.get("qty-unknown-cost-known")?.estimated_cost_minor
        ) === 10,
        "unknown quantity + known cost remain independent"
      );
      check(
        Number(
          byModel.get("qty-known-cost-unknown")?.quantity_total
        ) === 5 &&
        byModel.get("qty-known-cost-unknown")?.estimated_cost_minor === null,
        "known quantity + unknown cost remain independent"
      );
    });

    console.log("\n7. Provider/model Owner read + dimension-level k=5");
    const pmDoctors = [];

    for (let i = 0; i < 5; i += 1) {
      const d = await makeEnrolledDoctor(
        tx,
        ownerId,
        "R3_PM",
        `PM${i}`
      );
      pmDoctors.push(d);

      await tx`
        select mark_telemetry_day_coverage(
          current_date,
          ${d.doctorId},
          'AI_VOICE',
          true,
          1
        )
      `;

      await tx`
        select ingest_service_usage_daily(
          current_date,
          ${d.doctorId},
          'provider-five',
          'AI',
          'model-five',
          'token',
          1,
          1,
          0,
          'USD'
        )
      `;

      if (i < 4) {
        await tx`
          select ingest_service_usage_daily(
            current_date,
            ${d.doctorId},
            'provider-four',
            'AI',
            'model-four',
            'token',
            1,
            1,
            0,
            'USD'
          )
        `;
      }
    }

    await as(tx, ownerId, "aal2", async () => {
      const rows = await tx`
        select *
        from owner_service_usage_summary(
          'R3_PM',
          current_date,
          current_date
        )
      `;

      const visible = rows.find(
        (r) =>
          r.status === "OK" &&
          r.provider_id === "provider-five" &&
          r.model_id === "model-five"
      );

      const leakedFour = rows.find(
        (r) =>
          r.provider_id === "provider-four" ||
          r.model_id === "model-four"
      );

      const suppressed = rows.find(
        (r) => r.status === "INSUFFICIENT_COHORT"
      );

      check(
        !!visible,
        "provider/model bucket with 5 Doctors is visible"
      );
      check(
        !leakedFour,
        "provider/model bucket with 4 Doctors is suppressed"
      );
      check(
        !!suppressed &&
        suppressed.provider_id === null &&
        suppressed.model_id === null &&
        suppressed.quantity_total === null &&
        suppressed.event_count === null,
        "suppressed bucket exposes no identifiers or residual totals"
      );
    });

    console.log("\n8. Historical lifecycle is authoritative as-of target day");

    const histDoctor = await createDoctor(tx, "History");
    const [hist] = await tx`
      insert into pilot_participations(
        cohort_code,
        doctor_id,
        status,
        enrolled_on
      )
      values (
        'R3_HIST',
        ${histDoctor.doctorId},
        'INVITED',
        current_date - 9
      )
      returning participation_id
    `;

    await tx`
      insert into pilot_status_events(
        participation_id,
        cohort_code,
        event_code,
        event_day,
        recorded_by
      )
      values (
        ${hist.participation_id},
        'R3_HIST',
        'INVITED',
        current_date - 10,
        ${ownerId}
      )
    `;

    await tx`
      update pilot_participations
      set status = 'ENROLLED'
      where participation_id = ${hist.participation_id}
    `;

    await tx`
      insert into pilot_status_events(
        participation_id,
        cohort_code,
        event_code,
        event_day,
        recorded_by
      )
      values (
        ${hist.participation_id},
        'R3_HIST',
        'ENROLLED',
        current_date - 9,
        ${ownerId}
      )
    `;

    await tx`
      update pilot_participations
      set status = 'COMPLETED'
      where participation_id = ${hist.participation_id}
    `;

    await tx`
      insert into pilot_status_events(
        participation_id,
        cohort_code,
        event_code,
        event_day,
        recorded_by
      )
      values (
        ${hist.participation_id},
        'R3_HIST',
        'COMPLETED',
        current_date - 6,
        ${ownerId}
      )
    `;

    for (const offset of [10, 8, 6]) {
      await tx`
        select rebuild_pilot_status_daily_agg(
          current_date - ${offset}::int,
          'R3_HIST'
        )
      `;
    }

    const [d1] = await tx`
      select
        invited_count,
        enrolled_count,
        completed_count,
        withdrawn_count
      from pilot_status_daily_agg
      where cohort_code = 'R3_HIST'
        and period_day = current_date - 10
    `;

    const [d3] = await tx`
      select
        invited_count,
        enrolled_count,
        completed_count,
        withdrawn_count
      from pilot_status_daily_agg
      where cohort_code = 'R3_HIST'
        and period_day = current_date - 8
    `;

    const [d5] = await tx`
      select
        invited_count,
        enrolled_count,
        completed_count,
        withdrawn_count
      from pilot_status_daily_agg
      where cohort_code = 'R3_HIST'
        and period_day = current_date - 6
    `;

    check(
      Number(d1?.invited_count) === 1 &&
      Number(d1?.enrolled_count) === 0 &&
      Number(d1?.completed_count) === 0,
      "rebuild D1 after D5 -> INVITED"
    );

    check(
      Number(d3?.invited_count) === 0 &&
      Number(d3?.enrolled_count) === 1 &&
      Number(d3?.completed_count) === 0,
      "rebuild D3 after D5 -> ENROLLED"
    );

    check(
      Number(d5?.invited_count) === 0 &&
      Number(d5?.enrolled_count) === 0 &&
      Number(d5?.completed_count) === 1,
      "rebuild D5 -> COMPLETED"
    );

    const d1Snapshot = JSON.stringify(d1);

    await tx`
      select rebuild_pilot_status_daily_agg(
        current_date - 10,
        'R3_HIST'
      )
    `;

    const [d1Again] = await tx`
      select
        invited_count,
        enrolled_count,
        completed_count,
        withdrawn_count
      from pilot_status_daily_agg
      where cohort_code = 'R3_HIST'
        and period_day = current_date - 10
    `;

    check(
      JSON.stringify(d1Again) === d1Snapshot,
      "historical D1 output does not drift"
    );

    console.log("\n9. Accepted security/privacy boundaries remain intact");

    const [ownerUsage] = await tx`
      select
        pg_get_function_arguments(
          'public.owner_service_usage_summary(text,date,date)'::regprocedure
        ) as args,
        pg_get_function_result(
          'public.owner_service_usage_summary(text,date,date)'::regprocedure
        ) as result
    `;

    check(
      !/\bdoctor_id\b/i.test(ownerUsage.args),
      "Owner usage RPC has no arbitrary Doctor selector"
    );

    check(
      /\bprovider_id\b/i.test(ownerUsage.result) &&
      /\bmodel_id\b/i.test(ownerUsage.result),
      "Owner usage RPC preserves provider_id + model_id"
    );

    const [direct] = await tx`
      select
        has_table_privilege(
          'authenticated',
          'public.service_usage_daily_agg',
          'SELECT'
        ) as auth_select,
        has_table_privilege(
          'service_role',
          'public.service_usage_daily_agg',
          'SELECT'
        ) as service_select
    `;

    check(
      !direct.auth_select && !direct.service_select,
      "direct API table reads remain denied"
    );

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
