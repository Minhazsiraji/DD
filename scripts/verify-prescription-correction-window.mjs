import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import postgres from "postgres";

const adminUrl = process.env.DD_CORRECTION_WINDOW_LOCAL_URL;
if (!adminUrl) {
  throw new Error(
    "DD_CORRECTION_WINDOW_LOCAL_URL is required and must point to a loopback PostgreSQL admin database",
  );
}

const parsed = new URL(adminUrl);
const loopbackHosts = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
if (!loopbackHosts.has(parsed.hostname)) {
  throw new Error(
    `Refusing non-local correction-window proof host: ${parsed.hostname}`,
  );
}

const runtimeMigration = await readFile(
  "supabase/policies/0041_prescription_correction_window.sql",
  "utf8",
);
const v2Migration = await readFile(
  "db/p1/0014_p1_prescription_correction_window.sql",
  "utf8",
);

const admin = postgres(adminUrl, { max: 1 });
const suffix = `${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
const databaseName = `dd_correction_window_${suffix}`;
const createdRoles = [];
let databaseCreated = false;
let testDb;

function qident(value) {
  return `"${value.replaceAll('"', '""')}"`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ensureRole(role) {
  const [row] = await admin`
    select exists(select 1 from pg_roles where rolname = ${role}) as present
  `;
  if (!row.present) {
    await admin.unsafe(`create role ${qident(role)} nologin`);
    createdRoles.push(role);
  }
}

async function expectError(promise, token) {
  try {
    await promise;
    assert.fail(`expected ${token}`);
  } catch (error) {
    if (error?.code === "ERR_ASSERTION") throw error;
    assert.match(String(error?.message ?? error), new RegExp(token));
    return error;
  }
}

async function resetSchemas(sql) {
  await sql.unsafe(`
    drop schema if exists auth cascade;
    drop schema if exists public cascade;
    create schema public;
    create schema auth;
    grant usage on schema public to authenticated, anon, service_role;
    grant usage on schema auth to authenticated, anon, service_role;
  `);
}

async function setupRuntime(sql) {
  await resetSchemas(sql);
  await sql.unsafe(`
    create type public.prescription_status as enum ('DRAFT', 'FINALIZED');
    create type public.prescription_event_type as enum (
      'CREATED', 'FINALIZED', 'REPLACEMENT_STARTED'
    );

    create table public.prescriptions (
      id uuid primary key default gen_random_uuid(),
      encounter_id uuid not null,
      owner_doctor_id uuid not null,
      patient_id uuid not null,
      practice_location_id uuid not null,
      status public.prescription_status not null default 'DRAFT',
      finalized_at timestamptz,
      replaces_prescription_id uuid references public.prescriptions(id),
      replacement_reason text,
      created_by uuid
    );

    create unique index prescriptions_one_correction_successor_idx
      on public.prescriptions(replaces_prescription_id)
      where replaces_prescription_id is not null;
    create unique index prescriptions_one_draft_per_encounter_idx
      on public.prescriptions(encounter_id)
      where status = 'DRAFT';

    create table public.prescription_items (
      id bigint generated always as identity primary key,
      prescription_id uuid not null references public.prescriptions(id),
      display_name text not null
    );

    create table public.prescription_events (
      id bigint generated always as identity primary key,
      prescription_id uuid not null references public.prescriptions(id),
      event_type public.prescription_event_type not null,
      detail jsonb not null default '{}'::jsonb,
      actor_id uuid
    );

    create table public.test_prescription_audit (
      id bigint generated always as identity primary key,
      prescription_id uuid not null,
      practice_location_id uuid not null,
      action text not null,
      detail jsonb not null
    );

    create function auth.uid()
    returns uuid language sql stable as $$
      select nullif(current_setting('dd.test_actor', true), '')::uuid
    $$;

    create function public.current_doctor_id()
    returns uuid language sql stable as $$
      select nullif(current_setting('dd.test_doctor', true), '')::uuid
    $$;

    create function public.log_prescription_audit(
      prescription_key uuid,
      location_key uuid,
      action_code text,
      metadata jsonb
    ) returns void
    language plpgsql
    security definer
    set search_path = public, pg_temp
    as $$
    begin
      insert into public.test_prescription_audit(
        prescription_id, practice_location_id, action, detail
      ) values (prescription_key, location_key, action_code, metadata);
    end;
    $$;
  `);
  await sql.unsafe(runtimeMigration);
}

async function callRuntime(sql, fixture, reason = "dose corrected", timezone = null) {
  return sql.begin(async (tx) => {
    await tx`
      select
        set_config('dd.test_actor', ${fixture.actor}, true),
        set_config('dd.test_doctor', ${fixture.doctor}, true)
    `;
    if (timezone) {
      await tx.unsafe(`set local time zone ${qident(timezone)}`);
    }
    await tx.unsafe("set local role authenticated");
    const [row] = await tx`
      select public.start_prescription_correction(
        ${fixture.originalId}::uuid,
        ${fixture.location}::uuid,
        ${reason}
      ) as id
    `;
    return row.id;
  });
}

async function createRuntimeOriginal(sql, { ageSeconds = 3600, finalizedAtNull = false } = {}) {
  const fixture = {
    actor: randomUUID(),
    doctor: randomUUID(),
    patient: randomUUID(),
    location: randomUUID(),
    encounter: randomUUID(),
    originalId: randomUUID(),
  };

  if (finalizedAtNull) {
    await sql`
      insert into public.prescriptions(
        id, encounter_id, owner_doctor_id, patient_id, practice_location_id,
        status, finalized_at, created_by
      ) values (
        ${fixture.originalId}, ${fixture.encounter}, ${fixture.doctor},
        ${fixture.patient}, ${fixture.location}, 'FINALIZED', null, ${fixture.actor}
      )
    `;
  } else {
    await sql`
      insert into public.prescriptions(
        id, encounter_id, owner_doctor_id, patient_id, practice_location_id,
        status, finalized_at, created_by
      ) values (
        ${fixture.originalId}, ${fixture.encounter}, ${fixture.doctor},
        ${fixture.patient}, ${fixture.location}, 'FINALIZED',
        clock_timestamp() - (${ageSeconds} * interval '1 second'), ${fixture.actor}
      )
    `;
  }

  await sql`
    insert into public.prescription_items(prescription_id, display_name)
    values (${fixture.originalId}, 'Original medicine')
  `;
  return fixture;
}

async function verifyRuntime(sql, dbUrl) {
  console.log("runtime: boundary, expiry, blank successor, lineage, audit");

  const nearBoundary = await createRuntimeOriginal(sql, { ageSeconds: 172799 });
  const nearSuccessor = await callRuntime(sql, nearBoundary, "47:59:59 allowed");
  assert.ok(nearSuccessor);

  const expired = await createRuntimeOriginal(sql, { ageSeconds: 172801 });
  await expectError(
    callRuntime(sql, expired, "expired direct RPC"),
    "CORRECTION_WINDOW_EXPIRED",
  );
  const [expiredCount] = await sql`
    select count(*)::int as count from public.prescriptions
    where replaces_prescription_id = ${expired.originalId}
  `;
  assert.equal(expiredCount.count, 0, "expiry must create zero successors");

  const invalid = await createRuntimeOriginal(sql, { finalizedAtNull: true });
  await expectError(
    callRuntime(sql, invalid, "invalid finalization"),
    "PRESCRIPTION_FINALIZATION_STATE_INVALID",
  );

  const normal = await createRuntimeOriginal(sql);
  const [originalBefore] = await sql`
    select * from public.prescriptions where id = ${normal.originalId}
  `;
  const successor = await callRuntime(sql, normal, "wrong dose discovered");
  const [originalAfter] = await sql`
    select * from public.prescriptions where id = ${normal.originalId}
  `;
  assert.deepEqual(originalAfter, originalBefore, "original must remain immutable");

  const [successorRow] = await sql`
    select * from public.prescriptions where id = ${successor}
  `;
  assert.equal(successorRow.replaces_prescription_id, normal.originalId);
  assert.equal(successorRow.replacement_reason, "wrong dose discovered");
  assert.equal(successorRow.status, "DRAFT");
  const [blank] = await sql`
    select count(*)::int as count from public.prescription_items
    where prescription_id = ${successor}
  `;
  assert.equal(blank.count, 0, "runtime correction successor must stay blank");
  const [event] = await sql`
    select count(*)::int as count from public.prescription_events
    where prescription_id = ${successor} and event_type = 'REPLACEMENT_STARTED'
  `;
  const [audit] = await sql`
    select count(*)::int as count from public.test_prescription_audit
    where prescription_id = ${successor} and action = 'prescription.replacement_started'
  `;
  assert.equal(event.count, 1);
  assert.equal(audit.count, 1);

  console.log("runtime: simultaneous attempts serialize to one successor");
  const concurrent = await createRuntimeOriginal(sql);
  const [a, b] = await Promise.all([
    callRuntime(sql, concurrent, "concurrent correction"),
    callRuntime(sql, concurrent, "concurrent correction"),
  ]);
  assert.equal(a, b, "runtime idempotency must return the same successor");
  const [siblingCount] = await sql`
    select count(*)::int as count from public.prescriptions
    where replaces_prescription_id = ${concurrent.originalId}
  `;
  assert.equal(siblingCount.count, 1, "no sibling correction branch");

  console.log("runtime: waiting request is judged after advisory serialization");
  const waiting = await createRuntimeOriginal(sql, { ageSeconds: 172799 });
  const blocker = postgres(dbUrl, { max: 1 });
  let waitingAttempt;
  try {
    await blocker.begin(async (tx) => {
      await tx`
        select pg_advisory_xact_lock(
          hashtextextended('rx:correct:' || ${waiting.originalId}::text, 0)
        )
      `;
      waitingAttempt = callRuntime(sql, waiting, "waited past boundary").then(
        (value) => ({ ok: true, value }),
        (error) => ({ ok: false, error }),
      );
      await sleep(1400);
    });
    const outcome = await waitingAttempt;
    assert.equal(outcome.ok, false, "post-wait attempt must not be authorized");
    assert.match(String(outcome.error?.message), /CORRECTION_WINDOW_EXPIRED/);
  } finally {
    await blocker.end({ timeout: 2 });
  }

  console.log("runtime: stale page/timezone/client clock cannot change DB decision");
  const stale = await createRuntimeOriginal(sql, { ageSeconds: 176400 });
  await expectError(
    callRuntime(sql, stale, "stale page", "Asia/Dhaka"),
    "CORRECTION_WINDOW_EXPIRED",
  );
  const staleUtc = await createRuntimeOriginal(sql, { ageSeconds: 176400 });
  await expectError(
    callRuntime(sql, staleUtc, "stale page", "UTC"),
    "CORRECTION_WINDOW_EXPIRED",
  );

  console.log("runtime: finalized successor receives its own independent window");
  const chain = await createRuntimeOriginal(sql);
  const first = await callRuntime(sql, chain, "first correction");
  await sql`
    update public.prescriptions
    set status = 'FINALIZED', finalized_at = clock_timestamp() - interval '1 hour'
    where id = ${first}
  `;
  const secondFixture = { ...chain, originalId: first };
  const second = await callRuntime(sql, secondFixture, "second correction");
  const [chainRows] = await sql`
    select count(*)::int as count
    from public.prescriptions
    where id in (${chain.originalId}, ${first}, ${second})
  `;
  assert.equal(chainRows.count, 3);
  const [firstChildren] = await sql`
    select count(*)::int as count from public.prescriptions
    where replaces_prescription_id = ${first}
  `;
  assert.equal(firstChildren.count, 1);

  console.log("runtime: ownership privacy and execute surface");
  const privateFixture = await createRuntimeOriginal(sql, { ageSeconds: 176400 });
  const wrongDoctor = { ...privateFixture, doctor: randomUUID() };
  await expectError(
    callRuntime(sql, wrongDoctor, "known uuid"),
    "prescription not found",
  );

  const [privileges] = await sql`
    select
      has_function_privilege(
        'authenticated',
        'public.start_prescription_correction(uuid,uuid,text)',
        'EXECUTE'
      ) as authenticated_can,
      has_function_privilege(
        'anon',
        'public.start_prescription_correction(uuid,uuid,text)',
        'EXECUTE'
      ) as anon_can,
      has_function_privilege(
        'service_role',
        'public.start_prescription_correction(uuid,uuid,text)',
        'EXECUTE'
      ) as service_can,
      to_regprocedure('public.start_prescription_correction(uuid,text)') is null as old_start_closed,
      to_regprocedure('public.open_prescription(uuid,uuid,text)') is null as old_open_closed
  `;
  assert.equal(privileges.authenticated_can, true);
  assert.equal(privileges.anon_can, false);
  assert.equal(privileges.service_can, false);
  assert.equal(privileges.old_start_closed, true);
  assert.equal(privileges.old_open_closed, true);

  await expectError(
    sql.begin(async (tx) => {
      await tx.unsafe("set local role anon");
      return tx`
        select public.start_prescription_correction(
          ${privateFixture.originalId}::uuid,
          ${privateFixture.location}::uuid,
          'anon attempt'
        )
      `;
    }),
    "permission denied",
  );
  await expectError(
    sql.begin(async (tx) => {
      await tx.unsafe("set local role service_role");
      return tx`
        select public.start_prescription_correction(
          ${privateFixture.originalId}::uuid,
          ${privateFixture.location}::uuid,
          'service attempt'
        )
      `;
    }),
    "permission denied",
  );
}

async function setupV2(sql) {
  await resetSchemas(sql);
  await sql.unsafe(`
    create type public.capability as enum ('DOCTOR');

    create table public.prescriptions (
      id uuid primary key default gen_random_uuid(),
      encounter_id uuid not null,
      owner_doctor_id uuid not null,
      clinical_patient_id uuid not null,
      practice_location_id uuid not null,
      status text not null default 'DRAFT',
      finalized_at timestamptz,
      replaces_prescription_id uuid references public.prescriptions(id),
      replacement_reason text
    );
    create unique index prescriptions_v2_one_successor_idx
      on public.prescriptions(replaces_prescription_id)
      where replaces_prescription_id is not null;

    create table public.prescription_items (
      id bigint generated always as identity primary key,
      prescription_id uuid not null references public.prescriptions(id),
      display_name text,
      brand_name text,
      generic_name text,
      strength_text text,
      dose_text text,
      dosage_form text,
      route text,
      schedule_text text,
      duration_text text,
      quantity_text text,
      food_relation text,
      is_prn boolean,
      instructions text,
      substitution_allowed boolean,
      position integer not null
    );

    create table public.prescription_events (
      id bigint generated always as identity primary key,
      prescription_id uuid not null references public.prescriptions(id),
      event text not null,
      actor_kind text not null,
      actor_id uuid
    );

    create table public.audit_events (
      id bigint generated always as identity primary key,
      action text not null,
      resource_type text not null,
      resource_id uuid not null,
      actor_id uuid
    );

    create function public.current_profile_id()
    returns uuid language sql stable as $$
      select nullif(current_setting('dd.test_actor', true), '')::uuid
    $$;

    create function public.current_doctor_id()
    returns uuid language sql stable as $$
      select nullif(current_setting('dd.test_doctor', true), '')::uuid
    $$;

    create function public.has_capability(subject_profile_id uuid, requested public.capability)
    returns boolean language sql stable as $$
      select subject_profile_id is not null and requested = 'DOCTOR'
    $$;

    create function public.emit_audit_event(
      action_code text,
      resource_kind text,
      resource_key uuid,
      correlation_key uuid default null
    ) returns uuid
    language plpgsql
    security definer
    set search_path = public, pg_temp
    as $$
    declare result uuid := gen_random_uuid();
    begin
      insert into public.audit_events(id, action, resource_type, resource_id, actor_id)
      values(result, action_code, resource_kind, resource_key, public.current_profile_id());
      return result;
    end;
    $$;
  `);
  await sql.unsafe(v2Migration);
}

async function callV2(sql, fixture, reason = "V2 correction") {
  return sql.begin(async (tx) => {
    await tx`
      select
        set_config('dd.test_actor', ${fixture.actor}, true),
        set_config('dd.test_doctor', ${fixture.doctor}, true)
    `;
    await tx.unsafe("set local role authenticated");
    const [row] = await tx`
      select public.create_prescription_correction(
        ${fixture.originalId}::uuid,
        ${reason}
      ) as id
    `;
    return row.id;
  });
}

async function createV2Original(sql, { ageSeconds = 3600, finalizedAtNull = false } = {}) {
  const fixture = {
    actor: randomUUID(),
    doctor: randomUUID(),
    patient: randomUUID(),
    location: randomUUID(),
    encounter: randomUUID(),
    originalId: randomUUID(),
  };
  if (finalizedAtNull) {
    await sql`
      insert into public.prescriptions(
        id, encounter_id, owner_doctor_id, clinical_patient_id,
        practice_location_id, status, finalized_at
      ) values (
        ${fixture.originalId}, ${fixture.encounter}, ${fixture.doctor},
        ${fixture.patient}, ${fixture.location}, 'FINALIZED', null
      )
    `;
  } else {
    await sql`
      insert into public.prescriptions(
        id, encounter_id, owner_doctor_id, clinical_patient_id,
        practice_location_id, status, finalized_at
      ) values (
        ${fixture.originalId}, ${fixture.encounter}, ${fixture.doctor},
        ${fixture.patient}, ${fixture.location}, 'FINALIZED',
        clock_timestamp() - (${ageSeconds} * interval '1 second')
      )
    `;
  }
  await sql`
    insert into public.prescription_items(
      prescription_id, display_name, dose_text, position, substitution_allowed, is_prn
    ) values (${fixture.originalId}, 'V2 original medicine', '1 tablet', 1, true, false)
  `;
  return fixture;
}

async function verifyV2(sql, dbUrl) {
  console.log("v2: boundary, expiry, item-copy parity, lineage, audit");
  const nearBoundary = await createV2Original(sql, { ageSeconds: 172799 });
  const nearSuccessor = await callV2(sql, nearBoundary, "47:59:59 allowed");
  const [copied] = await sql`
    select count(*)::int as count from public.prescription_items
    where prescription_id = ${nearSuccessor}
  `;
  assert.equal(copied.count, 1, "accepted V2 item-copy contract must remain intact");

  const expired = await createV2Original(sql, { ageSeconds: 172801 });
  await expectError(callV2(sql, expired, "expired V2"), "CORRECTION_WINDOW_EXPIRED");
  const [expiredCount] = await sql`
    select count(*)::int as count from public.prescriptions
    where replaces_prescription_id = ${expired.originalId}
  `;
  assert.equal(expiredCount.count, 0);

  const invalid = await createV2Original(sql, { finalizedAtNull: true });
  await expectError(
    callV2(sql, invalid, "invalid V2"),
    "PRESCRIPTION_FINALIZATION_STATE_INVALID",
  );

  const preserved = await createV2Original(sql);
  const [before] = await sql`select * from public.prescriptions where id = ${preserved.originalId}`;
  const successor = await callV2(sql, preserved, "V2 reason preserved");
  const [after] = await sql`select * from public.prescriptions where id = ${preserved.originalId}`;
  assert.deepEqual(after, before);
  const [successorRow] = await sql`select * from public.prescriptions where id = ${successor}`;
  assert.equal(successorRow.replaces_prescription_id, preserved.originalId);
  assert.equal(successorRow.replacement_reason, "V2 reason preserved");
  const [events] = await sql`
    select count(*)::int as count from public.prescription_events
    where prescription_id = ${successor} and event = 'CORRECTION_STARTED'
  `;
  const [audits] = await sql`
    select count(*)::int as count from public.audit_events
    where resource_id = ${successor} and action = 'PRESCRIPTION_CORRECTION_STARTED'
  `;
  assert.equal(events.count, 1);
  assert.equal(audits.count, 1);

  console.log("v2: simultaneous attempts create one linear successor");
  const concurrent = await createV2Original(sql);
  const outcomes = await Promise.allSettled([
    callV2(sql, concurrent, "concurrent V2"),
    callV2(sql, concurrent, "concurrent V2"),
  ]);
  assert.equal(outcomes.filter((x) => x.status === "fulfilled").length, 1);
  assert.equal(outcomes.filter((x) => x.status === "rejected").length, 1);
  const rejection = outcomes.find((x) => x.status === "rejected");
  assert.match(String(rejection.reason?.message), /PRESCRIPTION_ALREADY_CORRECTED/);
  const [siblings] = await sql`
    select count(*)::int as count from public.prescriptions
    where replaces_prescription_id = ${concurrent.originalId}
  `;
  assert.equal(siblings.count, 1);

  console.log("v2: waiting request expires after serialization");
  const waiting = await createV2Original(sql, { ageSeconds: 172799 });
  const blocker = postgres(dbUrl, { max: 1 });
  let waitingAttempt;
  try {
    await blocker.begin(async (tx) => {
      await tx`
        select pg_advisory_xact_lock(
          hashtextextended('rx:correct:' || ${waiting.originalId}::text, 0)
        )
      `;
      waitingAttempt = callV2(sql, waiting, "waited V2").then(
        (value) => ({ ok: true, value }),
        (error) => ({ ok: false, error }),
      );
      await sleep(1400);
    });
    const outcome = await waitingAttempt;
    assert.equal(outcome.ok, false);
    assert.match(String(outcome.error?.message), /CORRECTION_WINDOW_EXPIRED/);
  } finally {
    await blocker.end({ timeout: 2 });
  }

  console.log("v2: finalized successor gets its own window");
  const chain = await createV2Original(sql);
  const first = await callV2(sql, chain, "first V2 correction");
  await sql`
    update public.prescriptions
    set status = 'FINALIZED', finalized_at = clock_timestamp() - interval '1 hour'
    where id = ${first}
  `;
  const second = await callV2(sql, { ...chain, originalId: first }, "second V2 correction");
  const [children] = await sql`
    select count(*)::int as count from public.prescriptions
    where replaces_prescription_id = ${first}
  `;
  assert.equal(children.count, 1);
  assert.ok(second);

  const [privileges] = await sql`
    select
      has_function_privilege(
        'authenticated',
        'public.create_prescription_correction(uuid,text)',
        'EXECUTE'
      ) as authenticated_can,
      has_function_privilege(
        'anon',
        'public.create_prescription_correction(uuid,text)',
        'EXECUTE'
      ) as anon_can,
      has_function_privilege(
        'service_role',
        'public.create_prescription_correction(uuid,text)',
        'EXECUTE'
      ) as service_can
  `;
  assert.equal(privileges.authenticated_can, true);
  assert.equal(privileges.anon_can, false);
  assert.equal(privileges.service_can, false);
}

try {
  for (const role of ["authenticated", "anon", "service_role"]) {
    await ensureRole(role);
  }

  await admin.unsafe(`create database ${qident(databaseName)}`);
  databaseCreated = true;

  const dbUrl = new URL(adminUrl);
  dbUrl.pathname = `/${databaseName}`;
  const dbUrlText = dbUrl.toString();
  testDb = postgres(dbUrlText, { max: 12 });

  await setupRuntime(testDb);
  await verifyRuntime(testDb, dbUrlText);

  await setupV2(testDb);
  await verifyV2(testDb, dbUrlText);

  console.log("PASS prescription correction window local PostgreSQL proof");
} finally {
  if (testDb) {
    await testDb.end({ timeout: 2 }).catch(() => {});
  }
  if (databaseCreated) {
    await admin`
      select pg_terminate_backend(pid)
      from pg_stat_activity
      where datname = ${databaseName} and pid <> pg_backend_pid()
    `.catch(() => {});
    await admin.unsafe(`drop database if exists ${qident(databaseName)}`).catch(() => {});
  }
  for (const role of createdRoles.reverse()) {
    await admin.unsafe(`drop role if exists ${qident(role)}`).catch(() => {});
  }
  await admin.end({ timeout: 2 }).catch(() => {});
}
