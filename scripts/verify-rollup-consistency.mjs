import crypto from "node:crypto";
import {
  assert,
  openLocalAdminDatabase,
  qaEmail,
} from "./p0-b2-lib.mjs";

const sql = openLocalAdminDatabase();
const userId = crypto.randomUUID();
const failedUserId = crypto.randomUUID();
const day = new Date().toISOString().slice(0, 10);

async function authUser(id, label) {
  await sql`
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data,
      confirmation_token, recovery_token, email_change,
      email_change_token_new, email_change_token_current,
      phone_change, phone_change_token, reauthentication_token
    ) values (
      '00000000-0000-0000-0000-000000000000', ${id},
      'authenticated', 'authenticated', ${qaEmail(label)}, '', now(), now(), now(),
      '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
      '', '', '', '', '', '', '', ''
    )
  `;
}

try {
  const triggerRows = await sql`
    select c.relname as table_name, t.tgname as trigger_name
    from pg_trigger t
    join pg_class c on c.oid=t.tgrelid
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and not t.tgisinternal
      and t.tgname = any(${[
        "p0_metric_professional_profile",
        "p0_metric_professional_credential",
        "p0_metric_appointment",
        "p0_metric_encounter",
        "p0_metric_prescription",
        "metric_contributions_refresh_rollups",
      ]})
    order by t.tgname
  `;
  assert(triggerRows.length === 6, `P0 metric trigger inventory incomplete: ${JSON.stringify(triggerRows)}`);

  const emitters = await sql`
    select p.proname, pg_get_functiondef(p.oid) as definition
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname = any(${[
      "emit_p0_profile_metric","emit_p0_credential_metric","emit_p0_appointment_metric",
      "emit_p0_encounter_metric","emit_p0_prescription_metric",
    ]})
    order by p.proname
  `;
  const emitter = { definition: emitters.map((row) => row.definition).join("\n") };
  assert(emitters.length === 5, `dedicated P0 metric emitter inventory drifted: ${emitters.length}`);
  const requiredMetrics = [
    "DOCTORS_REGISTERED", "DOCTORS_VERIFIED", "APPOINTMENTS_BOOKED",
    "APPOINTMENTS_RESCHEDULED", "APPOINTMENTS_CANCELLED", "APPOINTMENTS_NO_SHOW",
    "APPOINTMENTS_COMPLETED", "CONSULTATIONS_COMPLETED", "CONSULTATIONS_ABANDONED",
    "PRESCRIPTIONS_FINALIZED", "PRESCRIPTIONS_CORRECTED",
  ];
  for (const metric of requiredMetrics) {
    assert(String(emitter?.definition ?? "").includes(`'${metric}'`), `emitter missing ${metric}`);
  }
  assert(!/update\s+public\.metric_rollups/i.test(emitter.definition), "clinical trigger must not blind-update rollups");
  assert(/record_p0_metric_contribution/i.test(emitter.definition), "clinical trigger must write contribution ledger");

  await sql.unsafe("begin");
  await authUser(userId, `rollup-${userId.slice(0, 8)}`);
  await sql`insert into public.profiles(id, full_name) values (${userId}, 'QA Rollup Doctor')`;
  const [doctor] = await sql`
    insert into public.professional_profiles(profile_id, profession, display_name)
    values (${userId}, 'DOCTOR', 'QA Rollup Doctor')
    returning id
  `;

  const registered = await sql`
    select mc.metric_code, mc.delta, mc.source_event_key
    from public.metric_contributions mc
    where mc.metric_code='DOCTORS_REGISTERED' and mc.doctor_id=${doctor.id}
  `;
  assert(registered.length === 1 && Number(registered[0].delta) === 1, "doctor registration contribution missing");

  const uniqueSource = crypto.randomUUID();
  await sql`
    select public.record_p0_metric_contribution(
      'APPOINTMENTS_BOOKED', 'APPOINTMENT', ${uniqueSource}, 'BOOKED', 0,
      ${day}::date, ${doctor.id}, null, 1, 'STANDARD'
    )
  `;
  await sql`
    select public.record_p0_metric_contribution(
      'APPOINTMENTS_BOOKED', 'APPOINTMENT', ${uniqueSource}, 'BOOKED', 0,
      ${day}::date, ${doctor.id}, null, 1, 'STANDARD'
    )
  `;

  const duplicates = await sql`
    select count(*)::int as n
    from public.metric_contributions
    where metric_code='APPOINTMENTS_BOOKED'
      and doctor_id=${doctor.id}
      and source_event_key=(
        select source_ref from public.metric_source_refs
        where object_kind='APPOINTMENT' and object_id=${uniqueSource}
          and transition='BOOKED' and transition_seq=0
      )
  `;
  assert(duplicates[0].n === 1, "replayed contribution double-counted");

  const expected = await sql`
    select metric_code, period_day, doctor_id, practice_location_id,
           sum(delta)::bigint as expected_count
    from public.metric_contributions
    where doctor_id=${doctor.id} and period_day=${day}::date
    group by metric_code, period_day, doctor_id, practice_location_id
    order by metric_code
  `;
  const actual = await sql`
    select metric_code, period_start, doctor_id, practice_location_id,
           count_value
    from public.metric_rollups
    where doctor_id=${doctor.id} and period_kind='DAY' and period_start=${day}::date
    order by metric_code
  `;
  assert(actual.length === expected.length, `rollup group count mismatch: expected ${expected.length}, got ${actual.length}`);
  for (let i = 0; i < expected.length; i += 1) {
    assert(actual[i].metric_code === expected[i].metric_code, "rollup metric identity mismatch");
    assert(String(actual[i].count_value) === String(expected[i].expected_count), `rollup sum mismatch for ${expected[i].metric_code}`);
  }

  await sql`select public.rebuild_metric_rollups(${day}::date)`;
  const once = await sql`
    select metric_code, period_kind, period_start, doctor_id, practice_location_id, count_value
    from public.metric_rollups
    where doctor_id=${doctor.id} and period_start in (${day}::date, date_trunc('month', ${day}::date)::date)
    order by period_kind, metric_code
  `;
  await sql`select public.rebuild_metric_rollups(${day}::date)`;
  const twice = await sql`
    select metric_code, period_kind, period_start, doctor_id, practice_location_id, count_value
    from public.metric_rollups
    where doctor_id=${doctor.id} and period_start in (${day}::date, date_trunc('month', ${day}::date)::date)
    order by period_kind, metric_code
  `;
  assert(JSON.stringify(once) === JSON.stringify(twice), "rollup rebuild is not idempotent");

  await sql.unsafe("savepoint failed_source");
  await authUser(failedUserId, `rollup-fail-${failedUserId.slice(0, 8)}`);
  await sql`insert into public.profiles(id, full_name) values (${failedUserId}, 'QA Rolled Back Doctor')`;
  const [failedDoctor] = await sql`
    insert into public.professional_profiles(profile_id, profession, display_name)
    values (${failedUserId}, 'DOCTOR', 'QA Rolled Back Doctor') returning id
  `;
  await sql.unsafe("rollback to savepoint failed_source");
  await sql.unsafe("release savepoint failed_source");

  const rolledBack = await sql`
    select count(*)::int as n from public.metric_contributions where doctor_id=${failedDoctor.id}
  `;
  assert(rolledBack[0].n === 0, "rolled-back source left metric contribution");
  const rolledBackRefs = await sql`
    select count(*)::int as n from public.metric_source_refs where object_id=${failedDoctor.id}
  `;
  assert(rolledBackRefs[0].n === 0, "rolled-back source left metric source ref");
  const rolledBackRollups = await sql`
    select count(*)::int as n from public.metric_rollups where doctor_id=${failedDoctor.id}
  `;
  assert(rolledBackRollups[0].n === 0, "rolled-back source left metric rollup");

  console.log(`verify-rollup-consistency: PASS (${requiredMetrics.length} metric semantics wired; exactly-once; SUM(delta); rebuild idempotent; rollback atomic)`);
  await sql.unsafe("rollback");
} catch (error) {
  try { await sql.unsafe("rollback"); } catch {}
  throw error;
} finally {
  await sql.end({ timeout: 5 });
}
