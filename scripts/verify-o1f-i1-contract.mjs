/**
 * O1-F-I1 integration storage + trusted day-close verifier.
 *
 * Disposable PostgreSQL only. As with every O1-F verifier, o1f-test-support
 * deliberately uses only the byte-identical AAL2 primitive excerpt from 0045;
 * this does NOT claim an exact reconstruction of the protected 0045 runtime
 * inventory.
 */
import postgres from "postgres";
import {
  applyFileIdempotent,
  createProfile,
  readMigrationFile,
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

async function asRole(tx, role, fn) {
  await tx`select set_config('role', ${role}, true)`;
  try {
    return await fn(tx);
  } finally {
    await tx`select set_config('role', null, true)`;
  }
}

async function asAuthenticated(tx, userId, aal, fn) {
  await tx`select set_config(
    'request.jwt.claims',
    ${JSON.stringify({ sub: userId, role: "authenticated", aal })},
    true
  )`;
  await tx`select set_config('role', 'authenticated', true)`;
  try {
    return await fn(tx);
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
  } catch (error) {
    if (error.message === "__ALLOWED__") {
      check(false, label, "ALLOWED");
      return;
    }
    check(
      String(error.message).includes(expected),
      label,
      String(error.message).split("\n")[0]
    );
  }
}

async function service(tx, fn) {
  return asRole(tx, "service_role", fn);
}

async function ingestEvent(tx, event) {
  const [row] = await service(tx, (sp) => sp`
    select public.ingest_ai_voice_telemetry_event(
      ${JSON.stringify(event)}::text::jsonb
    ) as inserted
  `);
  return row.inserted;
}

async function createEnrolledParticipant(tx, ownerId, cohortCode, targetDay, n) {
  const profileId = await createProfile(tx, `QA I1 Doctor ${n} @qa.invalid`);
  const [doctor] = await tx`
    insert into doctor_profiles(user_id)
    values (${profileId})
    returning id
  `;
  const [p] = await tx`
    insert into pilot_participations(
      cohort_code, doctor_id, status, enrolled_on
    ) values (
      ${cohortCode}, ${doctor.id}, 'INVITED', ${targetDay}::date
    )
    returning participation_id
  `;
  await tx`
    insert into pilot_status_events(
      participation_id, cohort_code, event_code, event_day, recorded_by
    ) values (
      ${p.participation_id}, ${cohortCode}, 'INVITED', ${targetDay}::date, ${ownerId}
    )
  `;
  await tx`
    update pilot_participations
    set status = 'ENROLLED'
    where participation_id = ${p.participation_id}
  `;
  await tx`
    insert into pilot_status_events(
      participation_id, cohort_code, event_code, event_day, recorded_by
    ) values (
      ${p.participation_id}, ${cohortCode}, 'ENROLLED', ${targetDay}::date, ${ownerId}
    )
  `;
  await tx`
    insert into pilot_consent_events(
      participation_id, cohort_code, consent_scope, consent_version,
      event, effective_at, recorded_by
    ) values (
      ${p.participation_id}, ${cohortCode}, 'PRODUCT_USAGE_ANALYTICS', 'v1',
      'CONSENT_GRANTED', ${targetDay}::date::timestamptz, ${ownerId}
    )
  `;
  return { profileId, doctorId: doctor.id, participationId: p.participation_id };
}

const sql = postgres(url, { max: 4, prepare: false, onnotice: () => {} });
let ownerId;
let minuteDoctorId;
let targetDay;
let doctors;

try {
  await sql.begin(async (tx) => {
    console.log("1. Fresh disposable setup");
    for (const file of FILES) {
      await applyFileIdempotent(tx, await readMigrationFile(file));
    }
    check(true, "0047 I1 candidate applied");

    ownerId = await createProfile(tx, "QA I1 Owner @qa.invalid");
    await tx`
      insert into platform_owners(user_id, is_active)
      values (${ownerId}, true)
    `;

    const minuteProfileId = await createProfile(tx, "QA I1 Minute Doctor @qa.invalid");
    const [minuteDoctor] = await tx`
      insert into doctor_profiles(user_id)
      values (${minuteProfileId})
      returning id
    `;
    minuteDoctorId = minuteDoctor.id;

    const [{ day }] = await tx`select (current_date - 1)::text as day`;
    targetDay = day;

    await tx`
      insert into pilot_cohorts(
        cohort_code, display_name, started_on, created_by
      ) values (
        'I1_ZERO', 'I1 Zero Event Cohort', ${targetDay}::date, ${ownerId}
      )
    `;

    doctors = [];
    for (let i = 1; i <= 5; i += 1) {
      doctors.push(await createEnrolledParticipant(tx, ownerId, "I1_ZERO", targetDay, i));
    }

    console.log("\n2. New table schemas are privacy-minimal and RLS-forced");
    const minuteCols = await tx`
      select column_name
      from information_schema.columns
      where table_schema = 'public' and table_name = 'engagement_minute_store'
      order by ordinal_position
    `;
    check(
      minuteCols.map((r) => r.column_name).join(",") ===
        "doctor_id,period_day,minute_bucket,surface",
      "A minute store has exactly four logical fields",
      minuteCols.map((r) => r.column_name).join(",")
    );

    const telemetryCols = await tx`
      select column_name
      from information_schema.columns
      where table_schema = 'public' and table_name = 'ai_voice_telemetry_l0'
      order by ordinal_position
    `;
    const forbidden = [
      "patient_id", "encounter_id", "prescription_id", "investigation_id",
      "prompt", "completion", "transcript", "raw_audio", "audio_payload",
      "provider_payload", "ip", "ip_address", "device", "device_id",
      "path", "url", "query", "clinical_content", "clinical_hash", "hmac",
      "payload", "metadata"
    ];
    const names = new Set(telemetryCols.map((r) => r.column_name));
    check(
      forbidden.every((name) => !names.has(name)),
      "E L0 has no forbidden/opaque persistence columns"
    );

    const rls = await tx`
      select relname, relrowsecurity, relforcerowsecurity
      from pg_class
      where relnamespace = 'public'::regnamespace
        and relname in ('engagement_minute_store','ai_voice_telemetry_l0')
      order by relname
    `;
    check(
      rls.length === 2 && rls.every((r) => r.relrowsecurity && r.relforcerowsecurity),
      "both I1 stores ENABLE + FORCE RLS"
    );

    console.log("\n3. ACL surface is narrow");
    const acl = await tx`
      select
        has_table_privilege('service_role', 'public.engagement_minute_store', 'SELECT') as svc_minute_select,
        has_table_privilege('service_role', 'public.ai_voice_telemetry_l0', 'SELECT') as svc_e_select,
        has_function_privilege('service_role', 'public.record_engagement_minute(uuid,date,text)', 'EXECUTE') as svc_record,
        has_function_privilege('service_role', 'public.snapshot_engagement_minutes(uuid,date)', 'EXECUTE') as svc_snapshot,
        has_function_privilege('service_role', 'public.ingest_ai_voice_telemetry_event(jsonb)', 'EXECUTE') as svc_ingest_e,
        has_function_privilege('service_role', 'public.read_ai_voice_telemetry_events(timestamptz,timestamptz,timestamptz,text,integer)', 'EXECUTE') as svc_read_e,
        has_function_privilege('service_role', 'public.finalize_activity_measurement_day(date,bigint,boolean)', 'EXECUTE') as svc_close_a,
        has_function_privilege('service_role', 'public.finalize_ai_voice_measurement_day(date,bigint,boolean)', 'EXECUTE') as svc_close_e,
        has_function_privilege('service_role', 'public.rebuild_doctor_daily_activity_agg(date)', 'EXECUTE') as svc_rebuild_a,
        has_function_privilege('service_role', 'public.rebuild_pilot_status_daily_agg(date,text)', 'EXECUTE') as svc_rebuild_p
    `;
    const a = acl[0];
    check(!a.svc_minute_select && !a.svc_e_select, "service_role has no direct I1 table SELECT");
    check(
      a.svc_record && a.svc_snapshot && a.svc_ingest_e && a.svc_read_e && a.svc_close_a && a.svc_close_e,
      "service_role has only required I1 RPC capabilities"
    );
    check(!a.svc_rebuild_a && !a.svc_rebuild_p, "service_role cannot invoke internal rollup rebuilds");

    const authAcl = await tx`
      select
        has_function_privilege('authenticated', 'public.record_engagement_minute(uuid,date,text)', 'EXECUTE') as record,
        has_function_privilege('authenticated', 'public.ingest_ai_voice_telemetry_event(jsonb)', 'EXECUTE') as ingest_e,
        has_function_privilege('authenticated', 'public.finalize_activity_measurement_day(date,bigint,boolean)', 'EXECUTE') as close_a,
        has_function_privilege('authenticated', 'public.finalize_ai_voice_measurement_day(date,bigint,boolean)', 'EXECUTE') as close_e
    `;
    check(
      !authAcl[0].record && !authAcl[0].ingest_e && !authAcl[0].close_a && !authAcl[0].close_e,
      "authenticated browser cannot call I1 producer/day-close RPCs"
    );

    await expectRefused(tx, "service_role direct minute SELECT denied", "permission denied", async (sp) => {
      await asRole(sp, "service_role", (r) => r`select * from public.engagement_minute_store limit 1`);
    });
    await expectRefused(tx, "service_role direct E L0 SELECT denied", "permission denied", async (sp) => {
      await asRole(sp, "service_role", (r) => r`select * from public.ai_voice_telemetry_l0 limit 1`);
    });
  });

  console.log("\n4. A minute idempotency + cross-request snapshot");
  const first = await sql.begin((tx) => service(tx, async (sp) => {
    const [row] = await sp`
      select public.record_engagement_minute(
        ${minuteDoctorId}, current_date, 'CONSULTATION'
      ) as inserted
    `;
    return row.inserted;
  }));
  const replay = await sql.begin((tx) => service(tx, async (sp) => {
    const [row] = await sp`
      select public.record_engagement_minute(
        ${minuteDoctorId}, current_date, 'CONSULTATION'
      ) as inserted
    `;
    return row.inserted;
  }));
  check(first === true && replay === false, "same doctor/minute/surface is idempotent");

  const snapshot = await sql.begin((tx) => service(tx, (sp) => sp`
    select minute_bucket, surface
    from public.snapshot_engagement_minutes(${minuteDoctorId}, current_date)
  `));
  check(snapshot.length === 1 && snapshot[0].surface === "CONSULTATION", "cross-request authoritative snapshot persists");

  await sql.begin(async (tx) => {
    await expectRefused(tx, "closed A surface vocabulary rejects unknown", "O1A_MINUTE_SURFACE_INVALID", async (sp) => {
      await service(sp, (r) => r`
        select public.record_engagement_minute(${minuteDoctorId}, current_date, 'UNKNOWN')
      `);
    });

    await tx`
      insert into public.engagement_minute_store(
        doctor_id, period_day, minute_bucket, surface
      ) values (
        ${minuteDoctorId}, current_date - 3,
        date_trunc('minute', clock_timestamp() - interval '49 hours'),
        'DASHBOARD'
      )
    `;
    const [purged] = await service(tx, (sp) => sp`
      select public.purge_expired_engagement_minutes() as n
    `);
    const [{ stale }] = await tx`
      select count(*)::int as stale
      from public.engagement_minute_store
      where doctor_id = ${minuteDoctorId}
        and minute_bucket < clock_timestamp() - interval '48 hours'
    `;
    check(Number(purged.n) >= 1 && stale === 0, "stale minute rows older than 48h are physically purged");
  });

  console.log("\n5. E event-key idempotency + privacy allowlist");
  const actorId = doctors[0].profileId;
  const doctorId = doctors[0].doctorId;
  const now = new Date().toISOString();
  const operationId = "ddop_11111111-1111-4111-8111-111111111111";
  const proposalId = "ddprop_22222222-2222-4222-8222-222222222222";
  const grantId = "ddgr_33333333-3333-4333-8333-333333333333";
  const voiceSessionId = "ddvs_44444444-4444-4444-8444-444444444444";

  const started = {
    event_type: "AI_OPERATION_STARTED",
    schema_version: 1,
    event_key: `op:${operationId}`,
    occurred_at: now,
    actor_user_id: actorId,
    doctor_profile_id: doctorId,
    operation_id: operationId,
    provider_id: "openai",
    model_id: "gpt-5.6",
    task_type: "CLINICAL_NOTE",
    source: "TEXT",
  };

  await sql.begin(async (tx) => {
    const inserted = await ingestEvent(tx, started);
    const duplicate = await ingestEvent(tx, started);
    check(inserted === true && duplicate === false, "event_key replay is idempotent");

    const [{ n }] = await tx`
      select count(*)::int as n from public.ai_voice_telemetry_l0
      where event_key = ${started.event_key}
    `;
    check(n === 1, "event_key persists exactly one row");

    await expectRefused(tx, "forbidden patient_id cannot enter L0", "O1E_EVENT_FIELDS_INVALID", async (sp) => {
      await service(sp, (r) => r`
        select public.ingest_ai_voice_telemetry_event(
          ${JSON.stringify({ ...started, patient_id: "forbidden" })}::text::jsonb
        )
      `);
    });
  });

  console.log("\n6. Voice and proposal cross-event storage sufficiency");
  const grant = {
    event_type: "VOICE_GRANT_ISSUED",
    schema_version: 1,
    event_key: `grant:${grantId}`,
    occurred_at: now,
    actor_user_id: actorId,
    doctor_profile_id: doctorId,
    grant_id: grantId,
    provider_id: "deepgram",
    model_id: "nova-3",
    denial_reason: null,
  };
  const voice = {
    event_type: "VOICE_SESSION_REPORTED",
    schema_version: 1,
    event_key: `voice:${voiceSessionId}`,
    occurred_at: now,
    actor_user_id: actorId,
    doctor_profile_id: doctorId,
    voice_session_id: voiceSessionId,
    grant_id: grantId,
    provider_id: "deepgram",
    model_id: "nova-3",
    streamed_audio_ms: null,
    measurement_quality: "UNKNOWN",
    connect_latency_ms: null,
    first_result_latency_ms: null,
    cost_state: "UNKNOWN_PENDING_RECONCILIATION",
    cost_source: null,
    cost_attribution_mode: null,
    pricing_snapshot_id: null,
    estimated_cost_usd_micros: null,
  };
  const produced = {
    event_type: "AI_PROPOSAL_PRODUCED",
    schema_version: 1,
    event_key: `prop:${proposalId}`,
    occurred_at: now,
    actor_user_id: actorId,
    doctor_profile_id: doctorId,
    operation_id: operationId,
    proposal_id: proposalId,
    provider_id: "openai",
    model_id: "gpt-5.6",
    task_type: "CLINICAL_NOTE",
    uncertainty_count: 0,
  };
  const accepted = {
    event_type: "AI_PROPOSAL_ACCEPTED",
    schema_version: 1,
    event_key: `dec:${proposalId}`,
    occurred_at: now,
    actor_user_id: actorId,
    doctor_profile_id: doctorId,
    proposal_id: proposalId,
    task_type: "CLINICAL_NOTE",
  };
  const expired = {
    event_type: "AI_PROPOSAL_EXPIRED",
    schema_version: 1,
    event_key: `exp:${proposalId}`,
    occurred_at: now,
    actor_user_id: actorId,
    doctor_profile_id: doctorId,
    proposal_id: proposalId,
    task_type: "CLINICAL_NOTE",
  };

  await sql.begin(async (tx) => {
    for (const event of [grant, voice, produced, accepted, expired]) {
      check(await ingestEvent(tx, event), `ingested ${event.event_type}`);
    }

    const from = new Date(Date.now() - 60_000).toISOString();
    const until = new Date(Date.now() + 60_000).toISOString();
    const rows = await service(tx, (sp) => sp`
      select event_type, event_key, actor_user_id, doctor_profile_id,
             grant_id, voice_session_id, proposal_id, provider_id, model_id
      from public.read_ai_voice_telemetry_events(
        ${from}::timestamptz, ${until}::timestamptz, null, null, 5000
      )
    `);
    const grantRow = rows.find((r) => r.event_key === grant.event_key);
    const voiceRow = rows.find((r) => r.event_key === voice.event_key);
    check(
      grantRow && voiceRow && grantRow.grant_id === voiceRow.grant_id &&
      grantRow.actor_user_id === voiceRow.actor_user_id,
      "Voice issued grant and usage report retain same-actor join authority"
    );
    const proposalRows = rows.filter((r) => r.proposal_id === proposalId);
    check(
      proposalRows.some((r) => r.event_type === "AI_PROPOSAL_PRODUCED" && r.provider_id === "openai") &&
      proposalRows.some((r) => r.event_type === "AI_PROPOSAL_ACCEPTED") &&
      proposalRows.some((r) => r.event_type === "AI_PROPOSAL_EXPIRED"),
      "proposal producer + terminal/expiry rows retain frozen precedence inputs"
    );

    await expectRefused(tx, "E retrieval rejects unbounded >48h window", "O1E_READ_WINDOW_INVALID", async (sp) => {
      await service(sp, (r) => r`
        select * from public.read_ai_voice_telemetry_events(
          clock_timestamp() - interval '3 days', clock_timestamp(), null, null, 10
        )
      `);
    });
  });

  console.log("\n7. Unknown/zero and positive sub-cent precision stay distinct");
  const unknownOp = "ddop_55555555-5555-4555-8555-555555555555";
  const zeroOp = "ddop_66666666-6666-4666-8666-666666666666";
  const tinyOp = "ddop_77777777-7777-4777-8777-777777777777";
  const timeout = {
    event_type: "AI_PROVIDER_TIMEOUT", schema_version: 1,
    event_key: `out:${unknownOp}:1`, occurred_at: now,
    actor_user_id: actorId, doctor_profile_id: doctorId,
    operation_id: unknownOp, attempt_no: 1, provider_id: "openai", model_id: "gpt-5.6",
    task_type: "CLINICAL_NOTE", latency_ms: 50, failure_code: "PROVIDER_TIMEOUT",
    provider_http_status: null, usage_state: "UNKNOWN_PENDING_RECONCILIATION",
    input_tokens: null, cached_input_tokens: null, output_tokens: null,
    reasoning_tokens: null, total_tokens: null,
    cost_state: "UNKNOWN_PENDING_RECONCILIATION", cost_source: null,
    cost_attribution_mode: null, pricing_snapshot_id: null,
    estimated_cost_usd_micros: null, input_cost_usd_micros: null,
    cached_input_cost_usd_micros: null, output_cost_usd_micros: null,
  };
  const zero = {
    event_type: "AI_PROVIDER_SUCCEEDED", schema_version: 1,
    event_key: `out:${zeroOp}:1`, occurred_at: now,
    actor_user_id: actorId, doctor_profile_id: doctorId,
    operation_id: zeroOp, attempt_no: 1, provider_id: "openai", model_id: "gpt-5.6",
    task_type: "CLINICAL_NOTE", latency_ms: 10, failure_code: null,
    provider_http_status: 200, usage_state: "REPORTED",
    input_tokens: 0, cached_input_tokens: 0, output_tokens: 0,
    reasoning_tokens: 0, total_tokens: 0,
    cost_state: "NOT_INCURRED", cost_source: null, cost_attribution_mode: null,
    pricing_snapshot_id: null, estimated_cost_usd_micros: "0.000000",
    input_cost_usd_micros: "0.000000", cached_input_cost_usd_micros: "0.000000",
    output_cost_usd_micros: "0.000000",
  };
  const tiny = {
    event_type: "AI_PROVIDER_SUCCEEDED", schema_version: 1,
    event_key: `out:${tinyOp}:1`, occurred_at: now,
    actor_user_id: actorId, doctor_profile_id: doctorId,
    operation_id: tinyOp, attempt_no: 1, provider_id: "openai", model_id: "gpt-5.6",
    task_type: "CLINICAL_NOTE", latency_ms: 10, failure_code: null,
    provider_http_status: 200, usage_state: "REPORTED",
    input_tokens: 1, cached_input_tokens: 0, output_tokens: 0,
    reasoning_tokens: 0, total_tokens: 1,
    cost_state: "ESTIMATED", cost_source: "PRICING_SNAPSHOT", cost_attribution_mode: "ALLOCATED",
    pricing_snapshot_id: "rate.1", estimated_cost_usd_micros: "0.000001",
    input_cost_usd_micros: "0.000001", cached_input_cost_usd_micros: "0.000000",
    output_cost_usd_micros: "0.000000",
  };

  await sql.begin(async (tx) => {
    for (const event of [timeout, zero, tiny]) check(await ingestEvent(tx, event), `ingested ${event.event_key}`);
    const stored = await tx`
      select event_key, input_tokens, estimated_cost_usd_micros::text as cost
      from public.ai_voice_telemetry_l0
      where event_key in (${timeout.event_key}, ${zero.event_key}, ${tiny.event_key})
      order by event_key
    `;
    const unknownRow = stored.find((r) => r.event_key === timeout.event_key);
    const zeroRow = stored.find((r) => r.event_key === zero.event_key);
    const tinyRow = stored.find((r) => r.event_key === tiny.event_key);
    check(unknownRow.input_tokens === null && unknownRow.cost === null, "unknown quantity/cost remains NULL");
    check(Number(zeroRow.input_tokens) === 0 && Number(zeroRow.cost) === 0, "authoritative zero remains numeric zero");
    check(tinyRow.cost === "0.000001", "positive sub-micro cost precision remains exact at L0");

    await service(tx, (sp) => sp`
      select public.ingest_service_usage_daily(
        current_date, ${minuteDoctorId}, 'openai', 'AI_PROPOSAL', 'gpt-5.6',
        'INPUT_TOKENS', 1, 1, 0.0000000001, 'USD'
      )
    `);
    const [aggTiny] = await tx`
      select estimated_cost_minor::text as cost
      from public.service_usage_daily_agg
      where period_day = current_date
        and principal_doctor_id = ${minuteDoctorId}
        and provider_id = 'openai'
    `;
    check(aggTiny.cost === "0.000000000100000000", "positive sub-cent Owner aggregate precision remains exact");
  });

  console.log("\n8. Exact frozen ten-column Owner aggregate remains unchanged");
  await sql.begin(async (tx) => {
    const cols = await tx`
      select column_name
      from information_schema.columns
      where table_schema = 'public' and table_name = 'service_usage_daily_agg'
      order by ordinal_position
    `;
    const expected = [
      "period_day","principal_doctor_id","provider_id","service_kind","model_id",
      "unit","quantity_total","event_count","estimated_cost_minor","currency_code"
    ];
    check(cols.length === 10, "service_usage_daily_agg still has exactly 10 columns", String(cols.length));
    check(cols.map((r) => r.column_name).join(",") === expected.join(","), "ten-column names/order unchanged");
  });

  console.log("\n9. Trusted day-close semantics + complete zero days");
  await sql.begin(async (tx) => {
    const [beforeA] = await tx`
      select public.participation_measurement_state(
        'I1_ZERO', ${doctors[0].participationId}, ${targetDay}::date, ${targetDay}::date, 'ACTIVITY'
      ) as state
    `;
    check(beforeA.state === "NOT_MEASURED", "Activity is Not measured before closeout");

    await expectRefused(tx, "false Activity attestation cannot close day", "O1F_ACTIVITY_CLOSE_ATTESTATION_REQUIRED", async (sp) => {
      await service(sp, (r) => r`
        select public.finalize_activity_measurement_day(${targetDay}::date, 1, false)
      `);
    });

    const [stillA] = await tx`
      select public.participation_measurement_state(
        'I1_ZERO', ${doctors[0].participationId}, ${targetDay}::date, ${targetDay}::date, 'ACTIVITY'
      ) as state
    `;
    check(stillA.state === "NOT_MEASURED", "failed Activity closeout leaves Not measured");

    await service(tx, (sp) => sp`
      select public.finalize_activity_measurement_day(${targetDay}::date, 1, true)
    `);
    await service(tx, (sp) => sp`
      select public.finalize_activity_measurement_day(${targetDay}::date, 1, true)
    `);

    const activityRows = await tx`
      select doctor_id, engaged_minutes, active_day, session_count, feature_touch_count
      from public.doctor_daily_activity_agg
      where period_day = ${targetDay}::date and cohort_code = 'I1_ZERO'
      order by doctor_id
    `;
    check(
      activityRows.length === 5 && activityRows.every((r) =>
        Number(r.engaged_minutes) === 0 && r.active_day === false &&
        Number(r.session_count) === 0 && Number(r.feature_touch_count) === 0
      ),
      "complete zero-activity day materializes five truthful zero rows"
    );
    const [{ coverageCount }] = await tx`
      select count(*)::int as "coverageCount"
      from public.telemetry_day_coverage
      where period_day = ${targetDay}::date
        and measurement_domain = 'ACTIVITY'
        and is_complete
    `;
    check(coverageCount === 5, "Activity closeout is idempotent (one coverage row per doctor)");

    const [statusAgg] = await tx`
      select enrolled_count, consented_count, active_doctor_count
      from public.pilot_status_daily_agg
      where period_day = ${targetDay}::date and cohort_code = 'I1_ZERO'
    `;
    check(
      Number(statusAgg.enrolled_count) === 5 && Number(statusAgg.consented_count) === 5 &&
      Number(statusAgg.active_doctor_count) === 0,
      "Activity closeout rebuilds required pilot-status aggregate"
    );

    const [beforeE] = await tx`
      select public.participation_measurement_state(
        'I1_ZERO', ${doctors[0].participationId}, ${targetDay}::date, ${targetDay}::date, 'AI_VOICE'
      ) as state
    `;
    check(beforeE.state === "NOT_MEASURED", "AI/Voice is Not measured before projector closeout");

    await expectRefused(tx, "false AI/Voice projector attestation cannot close day", "O1F_AI_VOICE_CLOSE_ATTESTATION_REQUIRED", async (sp) => {
      await service(sp, (r) => r`
        select public.finalize_ai_voice_measurement_day(${targetDay}::date, 1, false)
      `);
    });

    await service(tx, (sp) => sp`
      select public.finalize_ai_voice_measurement_day(${targetDay}::date, 1, true)
    `);
    await service(tx, (sp) => sp`
      select public.finalize_ai_voice_measurement_day(${targetDay}::date, 1, true)
    `);

    const [afterE] = await tx`
      select public.participation_measurement_state(
        'I1_ZERO', ${doctors[0].participationId}, ${targetDay}::date, ${targetDay}::date, 'AI_VOICE'
      ) as state
    `;
    check(afterE.state === "OK", "AI/Voice complete zero-event day becomes measured");

    const [{ aiCoverage }] = await tx`
      select count(*)::int as "aiCoverage"
      from public.telemetry_day_coverage
      where period_day = ${targetDay}::date
        and measurement_domain = 'AI_VOICE'
        and is_complete
    `;
    check(aiCoverage === 5, "AI/Voice closeout is idempotent");

    const zeroSummary = await asAuthenticated(tx, ownerId, "aal2", (sp) => sp`
      select * from public.owner_service_usage_summary(
        'I1_ZERO', ${targetDay}::date, ${targetDay}::date
      )
    `);
    check(
      zeroSummary.length === 1 && zeroSummary[0].status === "OK" &&
      Number(zeroSummary[0].quantity_total) === 0 &&
      Number(zeroSummary[0].event_count) === 0 &&
      Number(zeroSummary[0].estimated_cost_minor) === 0,
      "five-doctor complete zero-usage day returns truthful OK zeros"
    );

    const zeroActivity = await asAuthenticated(tx, ownerId, "aal2", (sp) => sp`
      select * from public.owner_activity_summary(${targetDay}::date, ${targetDay}::date)
    `);
    check(
      zeroActivity.length === 1 &&
      zeroActivity[0].active_doctor_count === "0" &&
      zeroActivity[0].total_sessions === "0" &&
      zeroActivity[0].total_engaged_minutes === "0",
      "five-doctor complete zero-activity day returns truthful zeros"
    );
  });

  console.log("\n10. Existing internal rollups remain isolated");
  await sql.begin(async (tx) => {
    await expectRefused(tx, "service_role cannot call doctor activity rebuild", "permission denied", async (sp) => {
      await service(sp, (r) => r`select public.rebuild_doctor_daily_activity_agg(${targetDay}::date)`);
    });
    await expectRefused(tx, "service_role cannot call pilot status rebuild", "permission denied", async (sp) => {
      await service(sp, (r) => r`select public.rebuild_pilot_status_daily_agg(${targetDay}::date, 'I1_ZERO')`);
    });
  });

  if (failures > 0) {
    console.error(`\nO1-F-I1 CONTRACT: FAIL (${failures} checks)`);
    process.exitCode = 1;
  } else {
    console.log("\nO1-F-I1 CONTRACT: PASS");
  }
} catch (error) {
  console.error("\nO1-F-I1 VERIFIER ABORTED");
  console.error(error);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 2 });
}
