/** O1-F-I2 runtime closure verifier. Disposable PostgreSQL only. */
import postgres from "postgres";
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import {
  applyFileIdempotent,
  createProfile,
  readMigrationFile,
} from "./o1f-test-support.mjs";

const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error("DIRECT_URL or DATABASE_URL must be set");
const FILES = [
  "drizzle/migrations/0000_parallel_mentor.sql",
  "drizzle/migrations/0019_open_whizzer.sql",
  "supabase/policies/0033_platform_owner_authority.sql",
  "supabase/policies/0045_prelaunch_sec01b_security_closure.sql",
  "supabase/policies/0047_o1_owner_analytics_authority.sql",
];
let failures = 0;
const check = (ok, label, detail = "") => {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};
async function asRole(tx, role, fn) {
  await tx`select set_config('role', ${role}, true)`;
  try { return await fn(tx); }
  finally { await tx`select set_config('role', null, true)`; }
}
const service = (tx, fn) => asRole(tx, "service_role", fn);
async function expectRefused(tx, label, expected, fn) {
  try {
    await tx.savepoint(async (sp) => { await fn(sp); throw new Error("__ALLOWED__"); });
    check(false, label, "ALLOWED");
  } catch (error) {
    if (error.message === "__ALLOWED__") return check(false, label, "ALLOWED");
    check(String(error.message).includes(expected), label, String(error.message).split("\n")[0]);
  }
}
async function participant(tx, ownerId, cohort, day, n) {
  const profileId = await createProfile(tx, `QA I2 Doctor ${n} @qa.invalid`);
  const [doctor] = await tx`insert into doctor_profiles(user_id) values (${profileId}) returning id`;
  const [p] = await tx`
    insert into pilot_participations(cohort_code, doctor_id, status, enrolled_on)
    values (${cohort}, ${doctor.id}, 'INVITED', ${day}::date)
    returning participation_id
  `;
  await tx`insert into pilot_status_events(participation_id,cohort_code,event_code,event_day,recorded_by)
           values (${p.participation_id},${cohort},'INVITED',${day}::date,${ownerId})`;
  await tx`update pilot_participations set status='ENROLLED' where participation_id=${p.participation_id}`;
  await tx`insert into pilot_status_events(participation_id,cohort_code,event_code,event_day,recorded_by)
           values (${p.participation_id},${cohort},'ENROLLED',${day}::date,${ownerId})`;
  await tx`insert into pilot_consent_events(participation_id,cohort_code,consent_scope,consent_version,event,effective_at,recorded_by)
           values (${p.participation_id},${cohort},'PRODUCT_USAGE_ANALYTICS','v1','CONSENT_GRANTED',${day}::date::timestamptz,${ownerId})`;
  return { profileId, doctorId: doctor.id, participationId: p.participation_id };
}

const sql = postgres(url, { max: 8, prepare: false, onnotice: () => {} });
const raceWriter = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
const raceCloser = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
const raceLocker = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
try {
  await sql.begin(async (tx) => {
    console.log("1. Fresh disposable setup");
    for (const file of FILES) await applyFileIdempotent(tx, await readMigrationFile(file));
  });

  console.log("\n2. Static scope, old signature removal, exact E contract");
  await sql.begin(async (tx) => {
    const [shape] = await tx`
      select
        to_regprocedure('public.record_engagement_minute(uuid,date,text)') is null as old_gone,
        to_regprocedure('public.record_engagement_minute(uuid,timestamptz,text,text)') is not null as new_present,
        to_regprocedure('public.record_engagement_minute(uuid,date,timestamptz,text,text)') is null as transient_gone,
        has_function_privilege('service_role','public.record_engagement_minute(uuid,timestamptz,text,text)','EXECUTE') as svc_new,
        has_function_privilege('authenticated','public.record_engagement_minute(uuid,timestamptz,text,text)','EXECUTE') as auth_new,
        has_table_privilege('service_role','public.engagement_minute_store','SELECT') as svc_table,
        has_table_privilege('service_role','public.activity_reconciliation_state','SELECT') as svc_state
    `;
    check(shape.old_gone && shape.transient_gone && shape.new_present && shape.svc_new, "new minute signature replaces old executable signature");
    check(!shape.auth_new && !shape.svc_table && !shape.svc_state, "browser/service direct-table paths remain denied");

    const cols = await tx`
      select column_name from information_schema.columns
      where table_schema='public' and table_name='service_usage_daily_agg'
      order by ordinal_position
    `;
    const expected = ["period_day","principal_doctor_id","provider_id","service_kind","model_id","unit","quantity_total","event_count","estimated_cost_minor","currency_code"];
    check(cols.length === 10 && cols.map(r=>r.column_name).join(',') === expected.join(','), "frozen E ten-column aggregate is exact");
  });

  const ownerId = await sql.begin((tx) => createProfile(tx, "QA I2 Owner @qa.invalid"));
  await sql`insert into platform_owners(user_id,is_active) values (${ownerId},true)`;
  const [{ zeroDay, today }] = await sql`
    select (current_date - 2)::text as "zeroDay", current_date::text as today
  `;
  await sql`
    insert into pilot_cohorts(cohort_code,display_name,started_on,created_by)
    values ('I2_ZERO','I2 Zero',${zeroDay}::date,${ownerId})
  `;
  const doctors = [];
  for (let i=1;i<=5;i+=1) doctors.push(await sql.begin(tx=>participant(tx,ownerId,'I2_ZERO',zeroDay,i)));

  console.log("\n3. Actor -> Doctor resolver is deterministic and fail-closed");
  await sql.begin(async (tx) => {
    const [hit] = await service(tx, sp=>sp`select public.resolve_doctor_profile_id_for_actor(${doctors[0].profileId}) as id`);
    const stranger = await createProfile(tx, "QA I2 NonDoctor @qa.invalid");
    const [miss] = await service(tx, sp=>sp`select public.resolve_doctor_profile_id_for_actor(${stranger}) as id`);
    check(hit.id === doctors[0].doctorId, "canonical user_id ownership resolves exact Doctor UUID");
    check(miss.id === null, "non-Doctor actor resolves NULL/fail-closed");
    const resolverCols = await tx`
      select pg_get_function_result('public.resolve_doctor_profile_id_for_actor(uuid)'::regprocedure) as result
    `;
    check(resolverCols[0].result === 'uuid', "resolver returns only UUID");
  });

  console.log("\n4. Trusted minute, timezone replay, midnight boundary and conflict");
  const [{ bucket, utcDay }] = await sql`
    select date_trunc('minute',clock_timestamp())::text as bucket,
           ((date_trunc('minute',clock_timestamp()) at time zone 'UTC')::date)::text as "utcDay"
  `;
  const [boundary] = await sql`
    select name, (( ${bucket}::timestamptz at time zone name)::date)::text as local_day
    from pg_catalog.pg_timezone_names
    where (( ${bucket}::timestamptz at time zone name)::date) <> ${utcDay}::date
    order by name
    limit 1
  `;
  check(Boolean(boundary?.name), "found IANA timezone crossing UTC clinic-day boundary");
  check(zeroDay !== boundary.local_day, "zero fixture day is isolated from boundary local day", `zero=${zeroDay}, boundary=${boundary.local_day}`);
  const boundaryDoctor = doctors[0];
  const inserted = await sql.begin(tx=>service(tx, async sp => {
    const [r] = await sp`
      select public.record_engagement_minute(
        ${boundaryDoctor.doctorId}, ${bucket}::timestamptz, 'CONSULTATION', ${boundary.name}
      ) as inserted
    `; return r.inserted;
  }));
  const replay = await sql.begin(tx=>service(tx, async sp => {
    const [r] = await sp`
      select public.record_engagement_minute(
        ${boundaryDoctor.doctorId}, ${bucket}::timestamptz, 'CONSULTATION', ${boundary.name}
      ) as inserted
    `; return r.inserted;
  }));
  check(inserted === true && replay === false, "trusted server minute is idempotent");
  await sql.begin(async tx => {
    const [ctx] = await service(tx, sp=>sp`select * from public.get_activity_reconciliation_context(${boundaryDoctor.doctorId},${boundary.local_day}::date)`);
    check(Number(ctx.evidence_generation) === 1 && ctx.clinic_timezone === boundary.name && Number(ctx.retained_minute_count) === 1,
      "Doctor/day state preserves authoritative timezone + generation");
    const page = await service(tx, sp=>sp`
      select * from public.read_activity_reconciliation_minutes(
        ${boundaryDoctor.doctorId},${boundary.local_day}::date,${ctx.evidence_generation},null,null,1
      )
    `);
    check(page.length === 1 && page[0].surface === 'CONSULTATION', "worker replays exact trusted minute through bounded reader");

    await service(tx, r=>r`select public.record_engagement_minute(${doctors[1].doctorId},${bucket}::timestamptz,'DASHBOARD',${boundary.name})`);
    const [derivedCtx] = await service(tx, r=>r`select * from public.get_activity_reconciliation_context(${doctors[1].doctorId},${boundary.local_day}::date)`);
    check(Number(derivedCtx.evidence_generation) === 1 && derivedCtx.clinic_timezone === boundary.name, "clinic day is derived from bucket + authoritative timezone");
    const [sameDayZone] = await tx`
      select name from pg_catalog.pg_timezone_names
      where name <> ${boundary.name}
        and ((${bucket}::timestamptz at time zone name)::date) = ${boundary.local_day}::date
      order by name limit 1
    `;
    await expectRefused(tx,"Doctor/day timezone conflict fails closed","O1F_ACTIVITY_TIMEZONE_CONFLICT",sp=>service(sp,r=>r`
      select public.record_engagement_minute(${boundaryDoctor.doctorId},${bucket}::timestamptz,'DASHBOARD',${sameDayZone.name})
    `));
    await expectRefused(tx,"stale server minute rejected","O1A_MINUTE_STALE",sp=>service(sp,r=>r`
      select public.record_engagement_minute(${doctors[2].doctorId},${bucket}::timestamptz - interval '10 min','DASHBOARD','UTC')
    `));
    await expectRefused(tx,"future-skewed server minute rejected","O1A_MINUTE_FUTURE_SKEW",sp=>service(sp,r=>r`
      select public.record_engagement_minute(${doctors[2].doctorId},${bucket}::timestamptz + interval '2 min','DASHBOARD','UTC')
    `));
  });

  console.log("\n5. Exhaustive keyset discovery and truthful zero reconciliation");
  let cursor = null;
  const seen = [];
  for (;;) {
    const rows = await sql.begin(tx=>service(tx, sp=>sp`
      select * from public.list_activity_reconciliation_doctors(${zeroDay}::date,${cursor}::uuid,2)
    `));
    if (!rows.length) break;
    seen.push(...rows);
    cursor = rows.at(-1).doctor_id;
  }
  check(seen.length === 5 && new Set(seen.map(r=>r.doctor_id)).size === 5, "bounded keyset pages exhaust complete eligible Doctor set");
  check(seen.every(r=>r.clinic_timezone === null && r.has_evidence === false), "zero-evidence Doctors carry no guessed timezone");
  for (const d of doctors) {
    for (const [metric,value] of [['DOCTOR_ENGAGED_MINUTES_DAILY',0],['DOCTOR_ACTIVE_DAY',0],['DOCTOR_SESSION_COUNT_DAILY',0]]) {
      await sql.begin(tx=>service(tx,sp=>sp`select public.ingest_activity_contribution(${metric},${d.doctorId},${zeroDay}::date,'*',${value},'O1A_INTERACTION_METER',0)`));
    }
    await sql.begin(tx=>service(tx,sp=>sp`select public.acknowledge_activity_reconciliation(${d.doctorId},${zeroDay}::date,0)`));
  }
  const [zeroWm] = await sql.begin(tx=>service(tx,sp=>sp`select * from public.get_activity_reconciliation_day_watermark(${zeroDay}::date)`));
  await sql.begin(tx=>service(tx,sp=>sp`
    select public.acknowledge_activity_reconciliation_day(${zeroDay}::date,${zeroWm.evidence_generation},${zeroWm.eligible_doctor_count})
  `));
  await sql.begin(tx=>service(tx,sp=>sp`select public.finalize_activity_measurement_day(${zeroDay}::date,1,true)`));
  const zeroRows = await sql`
    select engaged_minutes,active_day,session_count,feature_touch_count
    from doctor_daily_activity_agg where period_day=${zeroDay}::date and cohort_code='I2_ZERO'
  `;
  check(zeroRows.length === 5 && zeroRows.every(r=>Number(r.engaged_minutes)===0 && r.active_day===false && Number(r.session_count)===0 && Number(r.feature_touch_count)===0),
    "complete reconciliation with no evidence materializes authoritative zero");

  console.log("\n6. Today reconciliation, generation acknowledgement and late-write invalidation");
  // Existing participants remain eligible today. Acknowledge zero state for all but doctor 0.
  const todayZone = 'UTC';
  const [{ todayBucket, todayDay }] = await sql`
    select date_trunc('minute',clock_timestamp())::text as "todayBucket",
           ((date_trunc('minute',clock_timestamp()) at time zone 'UTC')::date)::text as "todayDay"
  `;
  check(todayDay === today, "test clock is internally consistent");
  await sql.begin(tx=>service(tx,sp=>sp`
    select public.record_engagement_minute(${doctors[0].doctorId},${todayBucket}::timestamptz,'CONSULTATION',${todayZone})
  `));
  let [ctx] = await sql.begin(tx=>service(tx,sp=>sp`select * from public.get_activity_reconciliation_context(${doctors[0].doctorId},${todayDay}::date)`));
  check(Number(ctx.evidence_generation) === 1 && ctx.clinic_timezone === 'UTC', "first unique minute advances Doctor generation");
  await sql.begin(tx=>service(tx,sp=>sp`
    select public.ingest_activity_contribution('DOCTOR_ENGAGED_MINUTES_DAILY',${doctors[0].doctorId},${todayDay}::date,'*',1,'O1A_INTERACTION_METER',1)
  `));
  await sql.begin(tx=>service(tx,sp=>sp`
    select public.ingest_activity_contribution('DOCTOR_ACTIVE_DAY',${doctors[0].doctorId},${todayDay}::date,'*',1,'O1A_INTERACTION_METER',1)
  `));
  await sql.begin(tx=>service(tx,sp=>sp`
    select public.ingest_activity_contribution('DOCTOR_SESSION_COUNT_DAILY',${doctors[0].doctorId},${todayDay}::date,'*',1,'O1A_INTERACTION_METER',1)
  `));
  await sql.begin(tx=>service(tx,sp=>sp`select public.acknowledge_activity_reconciliation(${doctors[0].doctorId},${todayDay}::date,1)`));
  for (const d of doctors.slice(1)) {
    for (const [metric,value] of [['DOCTOR_ENGAGED_MINUTES_DAILY',0],['DOCTOR_ACTIVE_DAY',0],['DOCTOR_SESSION_COUNT_DAILY',0]]) {
      await sql.begin(tx=>service(tx,sp=>sp`select public.ingest_activity_contribution(${metric},${d.doctorId},${todayDay}::date,'*',${value},'O1A_INTERACTION_METER',0)`));
    }
    await sql.begin(tx=>service(tx,sp=>sp`select public.acknowledge_activity_reconciliation(${d.doctorId},${todayDay}::date,0)`));
  }
  let [todayWm] = await sql.begin(tx=>service(tx,sp=>sp`select * from public.get_activity_reconciliation_day_watermark(${todayDay}::date)`));
  await sql.begin(tx=>service(tx,sp=>sp`
    select public.acknowledge_activity_reconciliation_day(${todayDay}::date,${todayWm.evidence_generation},${todayWm.eligible_doctor_count})
  `));
  await sql.begin(tx=>service(tx,sp=>sp`select public.finalize_activity_measurement_day(${todayDay}::date,1,true)`));
  let [coverage] = await sql`select is_complete from telemetry_day_coverage where period_day=${todayDay}::date and principal_doctor_id=${doctors[0].doctorId} and measurement_domain='ACTIVITY'`;
  check(coverage.is_complete === true, "reconciled generation can close ACTIVITY day");

  await sql.begin(tx=>service(tx,sp=>sp`
    select public.record_engagement_minute(${doctors[0].doctorId},${todayBucket}::timestamptz,'DASHBOARD','UTC')
  `));
  [ctx] = await sql.begin(tx=>service(tx,sp=>sp`select * from public.get_activity_reconciliation_context(${doctors[0].doctorId},${todayDay}::date)`));
  [coverage] = await sql`select is_complete from telemetry_day_coverage where period_day=${todayDay}::date and principal_doctor_id=${doctors[0].doctorId} and measurement_domain='ACTIVITY'`;
  check(Number(ctx.evidence_generation) === 2 && Number(ctx.reconciled_generation) === 1 && coverage.is_complete === false,
    "legitimate late unique minute invalidates stale completeness");
  await sql.begin(async tx=>{
    await expectRefused(tx,"finalizer rejects unreconciled late generation","O1F_ACTIVITY_DAY_UNRECONCILED",sp=>service(sp,r=>r`
      select public.finalize_activity_measurement_day(${todayDay}::date,2,true)
    `));
  });

  await sql.begin(tx=>service(tx,sp=>sp`
    select public.ingest_activity_contribution('DOCTOR_ENGAGED_MINUTES_DAILY',${doctors[0].doctorId},${todayDay}::date,'*',2,'O1A_INTERACTION_METER',2)
  `));
  await sql.begin(tx=>service(tx,sp=>sp`
    select public.ingest_activity_contribution('DOCTOR_ACTIVE_DAY',${doctors[0].doctorId},${todayDay}::date,'*',1,'O1A_INTERACTION_METER',2)
  `));
  await sql.begin(tx=>service(tx,sp=>sp`
    select public.ingest_activity_contribution('DOCTOR_SESSION_COUNT_DAILY',${doctors[0].doctorId},${todayDay}::date,'*',1,'O1A_INTERACTION_METER',2)
  `));
  await sql.begin(tx=>service(tx,sp=>sp`select public.acknowledge_activity_reconciliation(${doctors[0].doctorId},${todayDay}::date,2)`));
  [todayWm] = await sql.begin(tx=>service(tx,sp=>sp`select * from public.get_activity_reconciliation_day_watermark(${todayDay}::date)`));
  await sql.begin(tx=>service(tx,sp=>sp`
    select public.acknowledge_activity_reconciliation_day(${todayDay}::date,${todayWm.evidence_generation},${todayWm.eligible_doctor_count})
  `));
  await sql.begin(tx=>service(tx,sp=>sp`select public.finalize_activity_measurement_day(${todayDay}::date,2,true)`));

  console.log("\n7. Concurrent close/write race cannot leave stale completeness");
  let unlock;
  let lockedResolve;
  const locked = new Promise(r=>{lockedResolve=r;});
  const release = new Promise(r=>{unlock=r;});
  const hold = raceLocker.begin(async tx=>{
    await tx`select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('O1F_ACTIVITY_DAY:' || ${todayDay}::text,0))`;
    lockedResolve();
    await release;
  });
  await locked;
  let writerDone = false;
  let closerDone = false;
  const writerP = raceWriter.begin(tx=>service(tx,sp=>sp`
    select public.record_engagement_minute(${doctors[0].doctorId},${todayBucket}::timestamptz,'PATIENTS','UTC')
  `)).then(v=>{writerDone=true; return {ok:true,v};},e=>{writerDone=true; return {ok:false,e};});
  const closerP = raceCloser.begin(tx=>service(tx,sp=>sp`
    select public.finalize_activity_measurement_day(${todayDay}::date,3,true)
  `)).then(v=>{closerDone=true; return {ok:true,v};},e=>{closerDone=true; return {ok:false,e};});
  await new Promise(r=>setTimeout(r,150));
  check(!writerDone && !closerDone, "writer and closeout both serialize on same day-scoped lock");
  unlock();
  await hold;
  const [writerResult, closerResult] = await Promise.all([writerP, closerP]);
  check(writerResult.ok, "racing unique minute is eventually accepted");
  [coverage] = await sql`select is_complete from telemetry_day_coverage where period_day=${todayDay}::date and principal_doctor_id=${doctors[0].doctorId} and measurement_domain='ACTIVITY'`;
  check(coverage.is_complete === false, "race cannot escape detection or leave stale complete coverage",
    closerResult.ok ? 'close won then write invalidated' : String(closerResult.e?.message).split('\n')[0]);

  console.log("\n8. Missing/expired evidence cannot become false zero");
  [ctx] = await sql.begin(tx=>service(tx,sp=>sp`select * from public.get_activity_reconciliation_context(${doctors[0].doctorId},${todayDay}::date)`));
  await sql`delete from engagement_minute_store where doctor_id=${doctors[0].doctorId} and period_day=${todayDay}::date`;
  await sql.begin(async tx=>{
    await expectRefused(tx,"expired evidence blocks reconciliation","O1F_ACTIVITY_EVIDENCE_EXPIRED",sp=>service(sp,r=>r`
      select public.acknowledge_activity_reconciliation(${doctors[0].doctorId},${todayDay}::date,${ctx.evidence_generation})
    `));
  });

  console.log("\n9. ACL matrix and privacy-minimal timezone capability");
  await sql.begin(async tx=>{
    const [a] = await tx`
      select
        has_function_privilege('service_role','public.resolve_doctor_profile_id_for_actor(uuid)','EXECUTE') as resolver,
        has_function_privilege('service_role','public.get_activity_reconciliation_day_watermark(date)','EXECUTE') as watermark,
        has_function_privilege('service_role','public.list_activity_reconciliation_doctors(date,uuid,integer)','EXECUTE') as doctors,
        has_function_privilege('service_role','public.get_activity_reconciliation_context(uuid,date)','EXECUTE') as context,
        has_function_privilege('service_role','public.read_activity_reconciliation_minutes(uuid,date,bigint,timestamptz,text,integer)','EXECUTE') as minutes,
        has_function_privilege('service_role','public.acknowledge_activity_reconciliation(uuid,date,bigint)','EXECUTE') as ack,
        has_function_privilege('service_role','public.acknowledge_activity_reconciliation_day(date,bigint,bigint)','EXECUTE') as day_ack,
        has_function_privilege('authenticated','public.resolve_doctor_profile_id_for_actor(uuid)','EXECUTE') as auth_resolver,
        has_function_privilege('authenticated','public.list_activity_reconciliation_doctors(date,uuid,integer)','EXECUTE') as auth_doctors,
        has_function_privilege('authenticated','public.read_activity_reconciliation_minutes(uuid,date,bigint,timestamptz,text,integer)','EXECUTE') as auth_minutes
    `;
    check(a.resolver&&a.watermark&&a.doctors&&a.context&&a.minutes&&a.ack&&a.day_ack,"service_role has only required reconciliation RPC authorities");
    check(!a.auth_resolver&&!a.auth_doctors&&!a.auth_minutes,"authenticated browser has no I2 reconciliation authority");
    await expectRefused(tx,"service_role direct reconciliation state SELECT denied","permission denied",sp=>asRole(sp,'service_role',r=>r`select * from activity_reconciliation_state limit 1`));
  });
  const migration = readFileSync('supabase/policies/0047_o1_owner_analytics_authority.sql','utf8');
  const i2 = migration.slice(migration.indexOf('-- O1-F-I2'));
  check(!i2.includes('Asia/Dhaka'), "I2 contains no default timezone guess");
  check(!i2.includes('practice_location_id') && !i2.includes('patient_id') && !i2.includes('encounter_id'), "I2 timezone state carries no location/clinical identifiers");

  console.log("\n10. Migration preservation / no 0048");
  const changedPolicies = execFileSync('git',['diff','--name-only','9f75403c948ccf26b9bc644f3f476683d74bb522..HEAD','--','supabase/policies'],{encoding:'utf8'}).trim().split(/\n/).filter(Boolean);
  check(changedPolicies.length === 1 && changedPolicies[0] === 'supabase/policies/0047_o1_owner_analytics_authority.sql', "0041-0046 are byte-preserved; only 0047 changed");
  check(!existsSync('supabase/policies/0048_o1_owner_analytics_authority.sql') && !changedPolicies.some(p=>p.includes('/0048_')), "no 0048 exists");

  if (failures) {
    console.error(`\nO1-F-I2 CONTRACT: FAIL (${failures} checks)`);
    process.exitCode = 1;
  } else console.log("\nO1-F-I2 CONTRACT: PASS");
} catch (error) {
  console.error("\nO1-F-I2 VERIFIER ABORTED");
  console.error(error);
  process.exitCode = 1;
} finally {
  await Promise.all([
    sql.end({timeout:2}), raceWriter.end({timeout:2}),
    raceCloser.end({timeout:2}), raceLocker.end({timeout:2}),
  ]);
}