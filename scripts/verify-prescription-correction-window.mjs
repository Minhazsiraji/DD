import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import postgres from "postgres";

const adminUrl = process.env.DD_CORRECTION_WINDOW_LOCAL_URL;
if (!adminUrl) throw new Error("DD_CORRECTION_WINDOW_LOCAL_URL is required");
const parsed = new URL(adminUrl);
if (!new Set(["localhost", "127.0.0.1", "::1", "[::1]"]).has(parsed.hostname)) {
  throw new Error(`Refusing non-local correction-window proof host: ${parsed.hostname}`);
}

const [runtimeMigration, v2Migration] = await Promise.all([
  readFile("supabase/policies/0041_prescription_correction_window.sql", "utf8"),
  readFile("db/p1/0014_p1_prescription_correction_window.sql", "utf8"),
]);

const admin = postgres(adminUrl, { max: 1 });
const databaseName = `dd_rx_window_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
const createdRoles = [];
let testDb;
let databaseCreated = false;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const qident = (value) => `"${value.replaceAll('"', '""')}"`;

async function ensureRole(role) {
  const [row] = await admin`select exists(select 1 from pg_roles where rolname=${role}) as present`;
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
    create type public.prescription_status as enum ('DRAFT','FINALIZED');
    create type public.prescription_event_type as enum ('CREATED','FINALIZED','REPLACEMENT_STARTED');
    create table public.prescriptions(
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
    create unique index rx_one_successor on public.prescriptions(replaces_prescription_id)
      where replaces_prescription_id is not null;
    create unique index rx_one_draft on public.prescriptions(encounter_id) where status='DRAFT';
    create table public.prescription_items(
      id bigint generated always as identity primary key,
      prescription_id uuid not null references public.prescriptions(id),
      display_name text not null
    );
    create table public.prescription_events(
      id bigint generated always as identity primary key,
      prescription_id uuid not null references public.prescriptions(id),
      event_type public.prescription_event_type not null,
      detail jsonb not null default '{}'::jsonb,
      actor_id uuid
    );
    create table public.test_prescription_audit(
      id bigint generated always as identity primary key,
      prescription_id uuid not null,
      practice_location_id uuid not null,
      action text not null,
      detail jsonb not null
    );
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('dd.test_actor',true),'')::uuid
    $$;
    create function public.current_doctor_id() returns uuid language sql stable as $$
      select nullif(current_setting('dd.test_doctor',true),'')::uuid
    $$;
    create function public.log_prescription_audit(uuid,uuid,text,jsonb) returns void
      language plpgsql security definer set search_path=public,pg_temp as $$
    begin
      insert into public.test_prescription_audit(prescription_id,practice_location_id,action,detail)
      values($1,$2,$3,$4);
    end $$;
  `);
  await sql.unsafe(runtimeMigration);
}

async function runtimeOriginal(sql, { ageSeconds = 3600, nullFinalized = false } = {}) {
  const f = {
    actor: randomUUID(), doctor: randomUUID(), patient: randomUUID(),
    location: randomUUID(), encounter: randomUUID(), originalId: randomUUID(),
  };
  if (nullFinalized) {
    await sql`insert into public.prescriptions(id,encounter_id,owner_doctor_id,patient_id,practice_location_id,status,finalized_at,created_by)
      values(${f.originalId},${f.encounter},${f.doctor},${f.patient},${f.location},'FINALIZED',null,${f.actor})`;
  } else {
    await sql`insert into public.prescriptions(id,encounter_id,owner_doctor_id,patient_id,practice_location_id,status,finalized_at,created_by)
      values(${f.originalId},${f.encounter},${f.doctor},${f.patient},${f.location},'FINALIZED',clock_timestamp()-(${ageSeconds}*interval '1 second'),${f.actor})`;
  }
  await sql`insert into public.prescription_items(prescription_id,display_name) values(${f.originalId},'Original medicine')`;
  return f;
}

async function callRuntime(sql, f, reason = "correction", timezone = null) {
  return sql.begin(async (tx) => {
    await tx`select set_config('dd.test_actor',${f.actor},true),set_config('dd.test_doctor',${f.doctor},true)`;
    if (timezone) await tx.unsafe(`set local time zone ${qident(timezone)}`);
    await tx.unsafe("set local role authenticated");
    const [row] = await tx`select public.start_prescription_correction(${f.originalId}::uuid,${f.location}::uuid,${reason}) as id`;
    return row.id;
  });
}

async function verifyRuntime(sql, dbUrl) {
  console.log("runtime: eligible/expired/invalid states");
  const allowed = await runtimeOriginal(sql, { ageSeconds: 172799 });
  assert.ok(await callRuntime(sql, allowed, "47:59:59 allowed"));

  const expired = await runtimeOriginal(sql, { ageSeconds: 172801 });
  await expectError(callRuntime(sql, expired, "direct authenticated expiry"), "CORRECTION_WINDOW_EXPIRED");
  let [count] = await sql`select count(*)::int count from public.prescriptions where replaces_prescription_id=${expired.originalId}`;
  assert.equal(count.count, 0, "expired RPC must create zero successors");

  const invalid = await runtimeOriginal(sql, { nullFinalized: true });
  await expectError(callRuntime(sql, invalid, "invalid state"), "PRESCRIPTION_FINALIZATION_STATE_INVALID");

  console.log("runtime: blank immutable successor with reason/lineage/event/audit");
  const normal = await runtimeOriginal(sql);
  const [before] = await sql`select * from public.prescriptions where id=${normal.originalId}`;
  const successor = await callRuntime(sql, normal, "wrong dose discovered");
  const [after] = await sql`select * from public.prescriptions where id=${normal.originalId}`;
  assert.deepEqual(after, before, "runtime predecessor changed");
  const [child] = await sql`select * from public.prescriptions where id=${successor}`;
  assert.equal(child.replaces_prescription_id, normal.originalId);
  assert.equal(child.replacement_reason, "wrong dose discovered");
  assert.equal(child.status, "DRAFT");
  [count] = await sql`select count(*)::int count from public.prescription_items where prescription_id=${successor}`;
  assert.equal(count.count, 0, "runtime successor must remain blank");
  [count] = await sql`select count(*)::int count from public.prescription_events where prescription_id=${successor} and event_type='REPLACEMENT_STARTED'`;
  assert.equal(count.count, 1);
  [count] = await sql`select count(*)::int count from public.test_prescription_audit where prescription_id=${successor} and action='prescription.replacement_started'`;
  assert.equal(count.count, 1);

  console.log("runtime: simultaneous correction stays linear/idempotent");
  const concurrent = await runtimeOriginal(sql);
  const [a, b] = await Promise.all([
    callRuntime(sql, concurrent, "same correction"),
    callRuntime(sql, concurrent, "same correction"),
  ]);
  assert.equal(a, b, "runtime second concurrent call must resolve to same successor");
  [count] = await sql`select count(*)::int count from public.prescriptions where replaces_prescription_id=${concurrent.originalId}`;
  assert.equal(count.count, 1, "runtime sibling branch created");

  console.log("runtime: waiting-across-expiry uses post-lock DB wall time");
  const waiting = await runtimeOriginal(sql, { ageSeconds: 172799 });
  const blocker = postgres(dbUrl, { max: 1 });
  let pending;
  try {
    await blocker.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended('rx:correct:'||${waiting.originalId}::text,0))`;
      pending = callRuntime(sql, waiting, "waited across expiry").then(
        (value) => ({ ok: true, value }), (error) => ({ ok: false, error }),
      );
      await sleep(1400);
    });
    const outcome = await pending;
    assert.equal(outcome.ok, false);
    assert.match(String(outcome.error?.message), /CORRECTION_WINDOW_EXPIRED/);
    [count] = await sql`select count(*)::int count from public.prescriptions where replaces_prescription_id=${waiting.originalId}`;
    assert.equal(count.count, 0, "post-wait expiry created a successor");
  } finally {
    await blocker.end({ timeout: 2 });
  }

  console.log("runtime: stale page and timezone manipulation cannot bypass DB authority");
  for (const zone of ["Asia/Dhaka", "UTC"]) {
    const stale = await runtimeOriginal(sql, { ageSeconds: 176400 });
    await expectError(callRuntime(sql, stale, `stale ${zone}`, zone), "CORRECTION_WINDOW_EXPIRED");
  }

  console.log("runtime: finalized successor receives its own correction window");
  const chain = await runtimeOriginal(sql);
  const first = await callRuntime(sql, chain, "first correction");
  await sql`update public.prescriptions set status='FINALIZED',finalized_at=clock_timestamp()-interval '1 hour' where id=${first}`;
  const second = await callRuntime(sql, { ...chain, originalId: first }, "second correction");
  assert.ok(second);
  [count] = await sql`select count(*)::int count from public.prescriptions where replaces_prescription_id=${first}`;
  assert.equal(count.count, 1);

  console.log("runtime: privacy, old signatures and execute ACL");
  const privateRx = await runtimeOriginal(sql, { ageSeconds: 176400 });
  await expectError(callRuntime(sql, { ...privateRx, doctor: randomUUID() }, "known uuid"), "prescription not found");
  const [acl] = await sql`select
    has_function_privilege('authenticated','public.start_prescription_correction(uuid,uuid,text)','EXECUTE') authenticated_can,
    has_function_privilege('anon','public.start_prescription_correction(uuid,uuid,text)','EXECUTE') anon_can,
    has_function_privilege('service_role','public.start_prescription_correction(uuid,uuid,text)','EXECUTE') service_can,
    to_regprocedure('public.start_prescription_correction(uuid,text)') is null old_start_closed,
    to_regprocedure('public.open_prescription(uuid,uuid,text)') is null old_open_closed`;
  assert.equal(acl.authenticated_can, true);
  assert.equal(acl.anon_can, false);
  assert.equal(acl.service_can, false);
  assert.equal(acl.old_start_closed, true);
  assert.equal(acl.old_open_closed, true);
  for (const role of ["anon", "service_role"]) {
    await expectError(sql.begin(async (tx) => {
      await tx.unsafe(`set local role ${role}`);
      return tx`select public.start_prescription_correction(${privateRx.originalId}::uuid,${privateRx.location}::uuid,'denied')`;
    }), "permission denied");
  }
}

async function setupV2(sql) {
  await resetSchemas(sql);
  await sql.unsafe(`
    create type public.capability as enum ('DOCTOR');
    create table public.prescriptions(
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
    create unique index v2_one_successor on public.prescriptions(replaces_prescription_id)
      where replaces_prescription_id is not null;
    create table public.prescription_items(
      id bigint generated always as identity primary key,
      prescription_id uuid not null references public.prescriptions(id),
      display_name text, brand_name text, generic_name text, strength_text text,
      dose_text text, dosage_form text, route text, schedule_text text, duration_text text,
      quantity_text text, food_relation text, is_prn boolean, instructions text,
      substitution_allowed boolean, position integer not null
    );
    create table public.prescription_events(
      id bigint generated always as identity primary key,
      prescription_id uuid not null references public.prescriptions(id),
      event text not null, actor_kind text not null, actor_id uuid
    );
    create table public.audit_events(
      id uuid primary key,
      action text not null, resource_type text not null, resource_id uuid not null, actor_id uuid
    );
    create function public.current_profile_id() returns uuid language sql stable as $$
      select nullif(current_setting('dd.test_actor',true),'')::uuid
    $$;
    create function public.current_doctor_id() returns uuid language sql stable as $$
      select nullif(current_setting('dd.test_doctor',true),'')::uuid
    $$;
    create function public.has_capability(uuid,public.capability) returns boolean language sql stable as $$
      select $1 is not null and $2='DOCTOR'
    $$;
    create function public.emit_audit_event(text,text,uuid,uuid default null) returns uuid
      language plpgsql security definer set search_path=public,pg_temp as $$
    declare result uuid:=gen_random_uuid();
    begin
      insert into public.audit_events(id,action,resource_type,resource_id,actor_id)
      values(result,$1,$2,$3,public.current_profile_id());
      return result;
    end $$;
  `);
  await sql.unsafe(v2Migration);
}

async function v2Original(sql, { ageSeconds = 3600, nullFinalized = false } = {}) {
  const f = {
    actor: randomUUID(), doctor: randomUUID(), patient: randomUUID(),
    location: randomUUID(), encounter: randomUUID(), originalId: randomUUID(),
  };
  if (nullFinalized) {
    await sql`insert into public.prescriptions(id,encounter_id,owner_doctor_id,clinical_patient_id,practice_location_id,status,finalized_at)
      values(${f.originalId},${f.encounter},${f.doctor},${f.patient},${f.location},'FINALIZED',null)`;
  } else {
    await sql`insert into public.prescriptions(id,encounter_id,owner_doctor_id,clinical_patient_id,practice_location_id,status,finalized_at)
      values(${f.originalId},${f.encounter},${f.doctor},${f.patient},${f.location},'FINALIZED',clock_timestamp()-(${ageSeconds}*interval '1 second'))`;
  }
  await sql`insert into public.prescription_items(prescription_id,display_name,dose_text,position,substitution_allowed,is_prn)
    values(${f.originalId},'V2 original medicine','1 tablet',1,true,false)`;
  return f;
}

async function callV2(sql, f, reason = "V2 correction") {
  return sql.begin(async (tx) => {
    await tx`select set_config('dd.test_actor',${f.actor},true),set_config('dd.test_doctor',${f.doctor},true)`;
    await tx.unsafe("set local role authenticated");
    const [row] = await tx`select public.create_prescription_correction(${f.originalId}::uuid,${reason}) as id`;
    return row.id;
  });
}

async function verifyV2(sql, dbUrl) {
  console.log("v2: eligible/expired/invalid and accepted item-copy parity");
  const allowed = await v2Original(sql, { ageSeconds: 172799 });
  const allowedChild = await callV2(sql, allowed, "47:59:59 allowed");
  let [count] = await sql`select count(*)::int count from public.prescription_items where prescription_id=${allowedChild}`;
  assert.equal(count.count, 1, "V2 copy contract changed");

  const expired = await v2Original(sql, { ageSeconds: 172801 });
  await expectError(callV2(sql, expired, "expired V2"), "CORRECTION_WINDOW_EXPIRED");
  [count] = await sql`select count(*)::int count from public.prescriptions where replaces_prescription_id=${expired.originalId}`;
  assert.equal(count.count, 0);

  const invalid = await v2Original(sql, { nullFinalized: true });
  await expectError(callV2(sql, invalid, "invalid V2"), "PRESCRIPTION_FINALIZATION_STATE_INVALID");

  console.log("v2: immutable predecessor, reason/lineage/item-copy/event/audit");
  const normal = await v2Original(sql);
  const [before] = await sql`select * from public.prescriptions where id=${normal.originalId}`;
  const successor = await callV2(sql, normal, "V2 reason preserved");
  const [after] = await sql`select * from public.prescriptions where id=${normal.originalId}`;
  assert.deepEqual(after, before, "V2 predecessor changed");
  const [child] = await sql`select * from public.prescriptions where id=${successor}`;
  assert.equal(child.replaces_prescription_id, normal.originalId);
  assert.equal(child.replacement_reason, "V2 reason preserved");
  [count] = await sql`select count(*)::int count from public.prescription_items where prescription_id=${successor}`;
  assert.equal(count.count, 1);
  [count] = await sql`select count(*)::int count from public.prescription_events where prescription_id=${successor} and event='CORRECTION_STARTED'`;
  assert.equal(count.count, 1);
  [count] = await sql`select count(*)::int count from public.audit_events where resource_id=${successor} and action='PRESCRIPTION_CORRECTION_STARTED'`;
  assert.equal(count.count, 1);

  console.log("v2: simultaneous attempts create one child and preserve duplicate error semantics");
  const concurrent = await v2Original(sql);
  const outcomes = await Promise.allSettled([
    callV2(sql, concurrent, "concurrent V2"),
    callV2(sql, concurrent, "concurrent V2"),
  ]);
  assert.equal(outcomes.filter((o) => o.status === "fulfilled").length, 1);
  assert.equal(outcomes.filter((o) => o.status === "rejected").length, 1);
  const rejected = outcomes.find((o) => o.status === "rejected");
  assert.match(String(rejected.reason?.message), /PRESCRIPTION_ALREADY_CORRECTED/);
  [count] = await sql`select count(*)::int count from public.prescriptions where replaces_prescription_id=${concurrent.originalId}`;
  assert.equal(count.count, 1, "V2 sibling branch created");

  console.log("v2: waiting-across-expiry is rejected after serialization");
  const waiting = await v2Original(sql, { ageSeconds: 172799 });
  const blocker = postgres(dbUrl, { max: 1 });
  let pending;
  try {
    await blocker.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended('rx:correct:'||${waiting.originalId}::text,0))`;
      pending = callV2(sql, waiting, "waited V2").then(
        (value) => ({ ok: true, value }), (error) => ({ ok: false, error }),
      );
      await sleep(1400);
    });
    const outcome = await pending;
    assert.equal(outcome.ok, false);
    assert.match(String(outcome.error?.message), /CORRECTION_WINDOW_EXPIRED/);
    [count] = await sql`select count(*)::int count from public.prescriptions where replaces_prescription_id=${waiting.originalId}`;
    assert.equal(count.count, 0, "V2 post-wait expiry created a successor");
  } finally {
    await blocker.end({ timeout: 2 });
  }

  console.log("v2: finalized successor receives its own window");
  const chain = await v2Original(sql);
  const first = await callV2(sql, chain, "first V2 correction");
  await sql`update public.prescriptions set status='FINALIZED',finalized_at=clock_timestamp()-interval '1 hour' where id=${first}`;
  const second = await callV2(sql, { ...chain, originalId: first }, "second V2 correction");
  assert.ok(second);
  [count] = await sql`select count(*)::int count from public.prescriptions where replaces_prescription_id=${first}`;
  assert.equal(count.count, 1);

  const [acl] = await sql`select
    has_function_privilege('authenticated','public.create_prescription_correction(uuid,text)','EXECUTE') authenticated_can,
    has_function_privilege('anon','public.create_prescription_correction(uuid,text)','EXECUTE') anon_can,
    has_function_privilege('service_role','public.create_prescription_correction(uuid,text)','EXECUTE') service_can`;
  assert.equal(acl.authenticated_can, true);
  assert.equal(acl.anon_can, false);
  assert.equal(acl.service_can, false);
}

try {
  for (const role of ["authenticated", "anon", "service_role"]) await ensureRole(role);
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
  console.log("PASS prescription correction window local PostgreSQL dynamic proof");
} finally {
  if (testDb) await testDb.end({ timeout: 2 }).catch(() => {});
  if (databaseCreated) {
    await admin`select pg_terminate_backend(pid) from pg_stat_activity where datname=${databaseName} and pid<>pg_backend_pid()`;
    await admin.unsafe(`drop database if exists ${qident(databaseName)}`).catch(() => {});
  }
  for (const role of createdRoles.reverse()) {
    await admin.unsafe(`drop role if exists ${qident(role)}`).catch(() => {});
  }
  await admin.end({ timeout: 2 }).catch(() => {});
}
