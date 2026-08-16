/**
 * Appointment access boundaries and the state machine, executed as the
 * `authenticated` role inside a transaction that is ALWAYS rolled back.
 *
 * The interesting cases here are the ones where two roles legitimately see
 * DIFFERENT things: a receptionist must run the desk for every doctor at their
 * hospital, while never reaching into the doctor's private chamber, and a
 * second doctor at that same hospital must see nothing at all.
 *
 *   node --env-file=.env.local scripts/verify-appointments.mjs
 */
import postgres from "postgres";
import crypto from "node:crypto";
import { NAME_VECTORS, PHONE_VECTORS } from "./normalization-vectors.mjs";

const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error("DIRECT_URL or DATABASE_URL must be set.");
  process.exit(1);
}

const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
const failures = [];

function check(ok, label, detail = "") {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(label);
}

async function expectDenied(tx, fn) {
  try {
    await tx.savepoint(fn);
    return false;
  } catch {
    return true;
  }
}

/**
 * The invariant that matters after any race: the row and its history agree.
 *
 * Events must form an unbroken chain — each one starting where the previous
 * ended — and the last event must land on the status the row actually holds.
 * Checking "the outcome was one of the legal ones" would pass even when two
 * callers each wrote an event describing a world the other never saw.
 */
async function historyIsConsistent(conn, appointmentId) {
  const [row] = await conn`
    select status from public.appointments where id = ${appointmentId}`;
  // Ordered by seq, never by created_at: `now()` is the TRANSACTION's start
  // time, so under concurrency timestamps can sort history into an order that
  // never happened. seq is assigned at insert, under the appointment's lock.
  const events = await conn`
    select event_type, from_status, to_status from public.appointment_events
    where appointment_id = ${appointmentId} order by seq`;

  if (events.length === 0) return { ok: false, why: "no events at all" };
  if (events[0].from_status !== null) {
    return { ok: false, why: `first event starts from ${events[0].from_status}` };
  }

  for (let i = 1; i < events.length; i++) {
    if (events[i].from_status !== events[i - 1].to_status) {
      return {
        ok: false,
        why: `event ${i} starts at ${events[i].from_status} but the previous ended at ${events[i - 1].to_status}`,
      };
    }
  }

  const last = events[events.length - 1].to_status;
  if (last !== row.status) {
    return { ok: false, why: `row is ${row.status} but history ends at ${last}` };
  }
  return { ok: true, events: events.length, status: row.status };
}

async function as(tx, uid, fn) {
  await tx`select set_config('request.jwt.claims', ${JSON.stringify({
    sub: uid,
    role: "authenticated",
  })}, true)`;
  await tx`set local role authenticated`;
  try {
    return await fn();
  } finally {
    await tx`reset role`;
  }
}

// ---------------------------------------------------------------------------
// Static posture
// ---------------------------------------------------------------------------
console.log("\nRow Level Security");
for (const table of ["appointments", "appointment_events"]) {
  const [r] = await sql`
    select c.relrowsecurity as enabled, c.relforcerowsecurity as forced
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = ${table}`;
  check(Boolean(r?.enabled && r?.forced), `${table}: RLS enabled + forced`);

  const [a] = await sql`
    select count(*)::int as n from information_schema.role_table_grants
    where table_schema = 'public' and table_name = ${table} and grantee = 'anon'`;
  check(a.n === 0, `${table}: anon has no grants`);
}

console.log("\nAppointments are cancelled, never deleted");
const [delPolicy] = await sql`
  select count(*)::int as n from pg_policies
  where schemaname = 'public' and tablename = 'appointments' and cmd = 'DELETE'`;
check(delPolicy.n === 0, "no DELETE policy on appointments");

const [delGrant] = await sql`
  select count(*)::int as n from information_schema.role_table_grants
  where table_schema = 'public' and table_name = 'appointments'
    and grantee = 'authenticated' and privilege_type = 'DELETE'`;
check(delGrant.n === 0, "no DELETE grant on appointments");

console.log("\nThe RPCs are the only write path");
/**
 * RLS decides which ROWS you may touch, never which CODE PATH touches them.
 * While `authenticated` held these privileges the state machine was a
 * convention: any user who satisfied a policy could set status directly, move a
 * date without a reschedule record, or forge history.
 */
for (const [table, privs] of [
  ["appointments", ["INSERT", "UPDATE", "DELETE"]],
  ["appointment_events", ["INSERT", "UPDATE", "DELETE"]],
  ["appointment_token_counters", ["SELECT", "INSERT", "UPDATE", "DELETE"]],
]) {
  for (const priv of privs) {
    const [g] = await sql`
      select count(*)::int as n from information_schema.role_table_grants
      where table_schema = 'public' and table_name = ${table}
        and grantee = 'authenticated' and privilege_type = ${priv}`;
    check(g.n === 0, `no ${priv} grant on ${table}`);
  }
}

const [writePolicies] = await sql`
  select count(*)::int as n from pg_policies
  where schemaname = 'public'
    and tablename in ('appointments','appointment_events')
    and cmd in ('INSERT','UPDATE','DELETE')`;
check(writePolicies.n === 0, "no write policies remain to suggest a direct path");

console.log("\nWrite RPCs are DEFINER with a pinned search_path");
for (const fn of [
  "create_appointment",
  "set_appointment_status",
  "reschedule_appointment",
  "allocate_token",
  "may_manage_appointments",
  "session_date_for",
]) {
  const [f] = await sql`
    select p.prosecdef, p.proconfig from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = ${fn} limit 1`;
  check(f?.prosecdef === true, `${fn}: SECURITY DEFINER`);
  check(
    (f?.proconfig ?? []).some((c) => c.startsWith("search_path=")),
    `${fn}: search_path pinned`,
  );
}

console.log("\nOnly one registration entry point exists");
const regForms = await sql`
  select pg_get_function_arguments(p.oid) as args
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'register_patient_for_doctor'`;
check(regForms.length === 1, "exactly one register_patient_for_doctor", `${regForms.length}`);
check(
  regForms.every((f) => f.args.includes("p_confirmed_not_duplicate")),
  "and it carries the duplicate-confirmation flag",
);
/**
 * The search keys must not be settable by the caller. While they were
 * parameters, an honest name could be paired with a dishonest key and walk past
 * the duplicate guard — a control the client could skip is not a control.
 */
check(
  regForms.every(
    (f) => !f.args.includes("p_name_normalized") && !f.args.includes("p_phone_normalized"),
  ),
  "and it accepts NO caller-supplied normalised keys",
);

const dupForms = await sql`
  select pg_get_function_arguments(p.oid) as args
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'check_walkin_duplicates'`;
check(dupForms.length === 1, "exactly one check_walkin_duplicates");
check(
  dupForms.every((f) => !f.args.includes("normalized")),
  "…which also derives its own keys",
);

const dupReturns = await sql`
  select pg_get_function_result(p.oid) as result
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'check_walkin_duplicates'`;
check(
  dupReturns.every((f) => !f.result.includes("hidden")),
  "and reports NO count of records the caller may not see",
  dupReturns[0]?.result,
);

/**
 * Normalisation parity.
 *
 * The rules exist in TypeScript (doctor registers) and SQL (reception
 * registers). If they drift, the two paths stop matching each other's records
 * and nothing fails loudly — so both are asserted against one shared table of
 * vectors. The TypeScript half runs in vitest.
 */
console.log("\nNormalisation matches TypeScript, vector for vector");
{
  let nameMismatches = 0;
  for (const [input, expected] of NAME_VECTORS) {
    const [r] = await sql`select public.normalize_patient_name(${input}) as v`;
    if (r.v !== expected) {
      nameMismatches++;
      console.log(`    ✗ name ${JSON.stringify(input)} -> ${JSON.stringify(r.v)}, expected ${JSON.stringify(expected)}`);
    }
  }
  check(nameMismatches === 0, `normalize_patient_name matches all ${NAME_VECTORS.length} vectors`);

  let phoneMismatches = 0;
  for (const [input, expected] of PHONE_VECTORS) {
    const [r] = await sql`select public.normalize_patient_phone(${input}) as v`;
    if (r.v !== expected) {
      phoneMismatches++;
      console.log(`    ✗ phone ${JSON.stringify(input)} -> ${JSON.stringify(r.v)}, expected ${JSON.stringify(expected)}`);
    }
  }
  check(phoneMismatches === 0, `normalize_patient_phone matches all ${PHONE_VECTORS.length} vectors`);
}

console.log("\nSession date uses the LOCATION's timezone, not the session's");
{
  // Force the connection to UTC. If session_date_for leaned on the session
  // timezone, 12:30am Dhaka would come back as the previous day here.
  await sql`set time zone 'UTC'`;
  const [loc] = await sql`
    select id from public.practice_locations where timezone = 'Asia/Dhaka' limit 1`;

  if (!loc) {
    console.log("  – skipped (no Asia/Dhaka location exists yet)");
  } else {
    // Formatted in SQL: postgres.js returns `date` as a JS Date, whose string
    // form is rendered in the MACHINE's timezone — comparing against that would
    // be testing the test runner, not the database.
    const [midnight] = await sql`
      select to_char(public.session_date_for(${loc.id},
        '2026-09-01T00:30:00+06:00'::timestamptz), 'YYYY-MM-DD') as d`;
    check(midnight.d === "2026-09-01", "00:30 Dhaka belongs to that day's session", midnight.d);

    const [lateEvening] = await sql`
      select to_char(public.session_date_for(${loc.id},
        '2026-09-01T23:45:00+06:00'::timestamptz), 'YYYY-MM-DD') as d`;
    check(
      lateEvening.d === "2026-09-01",
      "23:45 Dhaka stays on the same day (UTC would roll it forward)",
      lateEvening.d,
    );
  }
  await sql`set time zone 'Asia/Dhaka'`;
}

console.log("\nToken uniqueness is enforced by the database");
const [tokenIdx] = await sql`
  select indexdef from pg_indexes
  where schemaname = 'public' and indexname = 'appointments_token_per_session'`;
check(Boolean(tokenIdx), "partial unique index on (location, session_date, token)");
check(
  Boolean(tokenIdx?.indexdef?.includes("UNIQUE")),
  "and it is UNIQUE",
);

const [successorIdx] = await sql`
  select indexdef from pg_indexes
  where schemaname = 'public' and indexname = 'appointments_one_successor'`;
check(
  Boolean(successorIdx?.indexdef?.includes("UNIQUE")),
  "a unique index enforces at most one successor per appointment",
);

console.log("\nReschedule lineage is not publicly settable");
const createArgs = await sql`
  select pg_get_function_arguments(p.oid) as args
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'create_appointment'`;
check(createArgs.length === 1, "exactly one public create_appointment", `${createArgs.length}`);
check(
  !createArgs.some((f) => f.args.includes("rescheduled_from")),
  "public booking exposes no lineage parameter",
);

const [internalGrant] = await sql`
  select has_function_privilege('authenticated',
    'public.book_appointment_internal(uuid,uuid,uuid,timestamptz,integer,public.visit_type,text,uuid)',
    'EXECUTE') as ok`;
check(internalGrant.ok === false, "authenticated cannot execute the internal booking helper");

console.log("\nState machine");
const TRANSITIONS = [
  ["SCHEDULED", "ARRIVED", true],
  ["SCHEDULED", "CANCELLED", true],
  ["SCHEDULED", "COMPLETED", false],
  ["SCHEDULED", "IN_CONSULTATION", false],
  ["ARRIVED", "IN_CONSULTATION", true],
  ["ARRIVED", "COMPLETED", false],
  ["IN_CONSULTATION", "COMPLETED", true],
  ["COMPLETED", "SCHEDULED", false],
  ["CANCELLED", "SCHEDULED", false],
  ["CANCELLED", "ARRIVED", false],
  ["NO_SHOW", "ARRIVED", false],
];
for (const [from, to, allowed] of TRANSITIONS) {
  const [r] = await sql`
    select public.appointment_transition_allowed(${from}::public.appointment_status,
                                                 ${to}::public.appointment_status) as ok`;
  check(r.ok === allowed, `${from} -> ${to} ${allowed ? "allowed" : "rejected"}`);
}

// ---------------------------------------------------------------------------
// Executed
// ---------------------------------------------------------------------------
const uidA = crypto.randomUUID(); // Dr A — chamber + hospital
const uidB = crypto.randomUUID(); // Dr B — unrelated
const uidC = crypto.randomUUID(); // Dr C — also at the hospital
const uidR = crypto.randomUUID(); // reception at the hospital

try {
  await sql.begin(async (tx) => {
    for (const [uid, name] of [
      [uidA, "Dr A"],
      [uidB, "Dr B"],
      [uidC, "Dr C"],
      [uidR, "Reception R"],
    ]) {
      await tx`insert into auth.users (id, email) values (${uid}, ${`${uid}@qa.invalid`})`;
      await tx`insert into public.profiles (id, full_name) values (${uid}, ${name})`;
    }

    const [docA] = await tx`insert into public.doctor_profiles (user_id, patient_number_prefix)
                            values (${uidA}, 'AA') returning id`;
    const [docB] = await tx`insert into public.doctor_profiles (user_id, patient_number_prefix)
                            values (${uidB}, 'BB') returning id`;
    const [docC] = await tx`insert into public.doctor_profiles (user_id, patient_number_prefix)
                            values (${uidC}, 'CC') returning id`;

    const [hospital] = await tx`
      insert into public.practice_locations (name, type, created_by)
      values ('QA Hospital', 'HOSPITAL', ${uidA}) returning id`;
    const [chamber] = await tx`
      insert into public.practice_locations (name, type, created_by)
      values ('QA Private Chamber', 'PERSONAL_CHAMBER', ${uidA}) returning id`;

    await tx`insert into public.practice_location_members
               (practice_location_id, user_id, role, status)
             values (${hospital.id}, ${uidA}, 'DOCTOR', 'ACTIVE'),
                    -- Doctor A also administers the hospital, so all three
                    -- roles coexist there — the shape that produced the
                    -- privilege-escalation bug.
                    (${hospital.id}, ${uidA}, 'LOCATION_ADMIN', 'ACTIVE'),
                    (${chamber.id},  ${uidA}, 'DOCTOR', 'ACTIVE'),
                    (${hospital.id}, ${uidC}, 'DOCTOR', 'ACTIVE'),
                    (${hospital.id}, ${uidR}, 'RECEPTIONIST', 'ACTIVE')`;

    const [patA] = await tx`
      insert into public.patients (owner_doctor_id, patient_number, full_name,
                                   name_normalized, sex, created_by)
      -- Deliberately outside the allocator's range: these are hand-inserted
      -- fixtures, and the sequence still starts at 0, so low numbers collide
      -- the moment anything registers for real.
      values (${docA.id}, 'AA-900001', 'Rahim Hossain', 'rahim hossain', 'MALE', ${uidA})
      returning id`;
    const [patB] = await tx`
      insert into public.patients (owner_doctor_id, patient_number, full_name,
                                   name_normalized, sex, created_by)
      values (${docB.id}, 'BB-900001', 'Karim Mia', 'karim mia', 'MALE', ${uidB})
      returning id`;

    // Rahim has attended the hospital, which is what makes him visible to
    // reception at all. A patient the doctor only ever sees in their private
    // chamber stays invisible to the desk — that is the point of the link table.
    await tx`insert into public.patient_location_links (patient_id, practice_location_id)
             values (${patA.id}, ${hospital.id})`;

    // Full +06:00 offset, not +06 — new Date("…+06") is Invalid Date in V8, and
    // postgres.js converts the parameter before sending it.
    const when = "2026-09-01T10:00:00+06:00";

    // ---- booking ---------------------------------------------------------
    console.log("\nBooking");
    let apptHospital, apptChamber;

    await as(tx, uidA, async () => {
      [{ create_appointment: apptHospital }] = await tx`
        select public.create_appointment(${docA.id}, ${hospital.id}, ${patA.id},
          ${when}::timestamptz, 15, 'NEW'::public.visit_type, 'Fever')`;
      check(Boolean(apptHospital), "doctor books at their hospital");

      [{ create_appointment: apptChamber }] = await tx`
        select public.create_appointment(${docA.id}, ${chamber.id}, ${patA.id},
          ${when}::timestamptz, 15, 'FOLLOW_UP'::public.visit_type, null)`;
      check(Boolean(apptChamber), "doctor books in their private chamber");

      const [ev] = await tx`
        select count(*)::int as n from public.appointment_events
        where appointment_id = ${apptHospital} and event_type = 'CREATED'`;
      check(ev.n === 1, "booking writes its CREATED event in the same transaction");

      const wrongPatient = await expectDenied(tx, async (t) => {
        await t`select public.create_appointment(${docA.id}, ${hospital.id}, ${patB.id},
          ${when}::timestamptz, 15, 'NEW'::public.visit_type, null)`;
      });
      check(wrongPatient, "cannot book another doctor's patient into your clinic");
    });

    await as(tx, uidR, async () => {
      const [{ create_appointment: byDesk }] = await tx`
        select public.create_appointment(${docA.id}, ${hospital.id}, ${patA.id},
          ${when}::timestamptz, 15, 'NEW'::public.visit_type, 'Desk booking')`;
      check(Boolean(byDesk), "reception books for a doctor at their hospital");

      const intoChamber = await expectDenied(tx, async (t) => {
        await t`select public.create_appointment(${docA.id}, ${chamber.id}, ${patA.id},
          ${when}::timestamptz, 15, 'NEW'::public.visit_type, null)`;
      });
      check(intoChamber, "reception CANNOT book into the doctor's private chamber");

      const foreignDoctor = await expectDenied(tx, async (t) => {
        await t`select public.create_appointment(${docB.id}, ${hospital.id}, ${patB.id},
          ${when}::timestamptz, 15, 'NEW'::public.visit_type, null)`;
      });
      check(foreignDoctor, "reception cannot book for a doctor who is not at this location");

    });

    // A patient Doctor A only ever sees privately must stay invisible to the
    // desk — and therefore unbookable by them, even at the hospital.
    console.log("\nChamber-only patients stay private");
    const [patPrivate] = await tx`
      insert into public.patients (owner_doctor_id, patient_number, full_name,
                                   name_normalized, sex, created_by)
      values (${docA.id}, 'AA-900002', 'Shireen Akter', 'shireen akter', 'FEMALE', ${uidA})
      returning id`;
    await tx`insert into public.patient_location_links (patient_id, practice_location_id)
             values (${patPrivate.id}, ${chamber.id})`;

    await as(tx, uidR, async () => {
      const [seen] = await tx`
        select count(*)::int as n from public.patients where id = ${patPrivate.id}`;
      check(seen.n === 0, "reception cannot see a chamber-only patient");

      const denied = await expectDenied(tx, async (t) => {
        await t`select public.create_appointment(${docA.id}, ${hospital.id}, ${patPrivate.id},
          ${when}::timestamptz, 15, 'NEW'::public.visit_type, null)`;
      });
      check(denied, "reception cannot book a chamber-only patient into the hospital");
    });

    // ---- visibility ------------------------------------------------------
    console.log("\nVisibility");
    await as(tx, uidB, async () => {
      const [n] = await tx`select count(*)::int as n from public.appointments`;
      check(n.n === 0, "an unrelated doctor sees no appointments");
    });

    await as(tx, uidC, async () => {
      const [n] = await tx`select count(*)::int as n from public.appointments`;
      check(n.n === 0, "a second DOCTOR at the same hospital sees none of Doctor A's");
    });

    await as(tx, uidR, async () => {
      const rows = await tx`select practice_location_id from public.appointments`;
      check(rows.length > 0, "reception sees the hospital's appointments");
      check(
        rows.every((r) => r.practice_location_id === hospital.id),
        "reception sees NOTHING from the private chamber",
      );
    });

    await as(tx, uidA, async () => {
      const rows = await tx`select distinct practice_location_id from public.appointments`;
      check(rows.length === 2, "the owning doctor sees both locations at once");
    });

    // ---- state machine, executed ----------------------------------------
    console.log("\nTransitions");
    await as(tx, uidR, async () => {
      const skip = await expectDenied(tx, async (t) => {
        await t`select public.set_appointment_status(${apptHospital},
          'COMPLETED'::public.appointment_status, null, null)`;
      });
      check(skip, "cannot jump straight from SCHEDULED to COMPLETED");

      const noReason = await expectDenied(tx, async (t) => {
        await t`select public.set_appointment_status(${apptHospital},
          'CANCELLED'::public.appointment_status, null, null)`;
      });
      check(noReason, "cancelling without a reason is rejected");

      await tx`select public.set_appointment_status(${apptHospital},
        'ARRIVED'::public.appointment_status, null, null)`;
      const [a] = await tx`select status, token_number, arrived_at
                           from public.appointments where id = ${apptHospital}`;
      check(a.status === "ARRIVED", "reception marks the patient arrived");
      check(a.token_number === 1, "a token is allocated on arrival", `#${a.token_number}`);
      check(Boolean(a.arrived_at), "arrived_at is stamped by the database");

      // Idempotent: a double-click must not allocate a second token.
      await tx`select public.set_appointment_status(${apptHospital},
        'ARRIVED'::public.appointment_status, null, null)`;
      const [again] = await tx`select token_number from public.appointments
                               where id = ${apptHospital}`;
      check(again.token_number === 1, "pressing Arrived twice keeps the same token");

      const [events] = await tx`
        select count(*)::int as n from public.appointment_events
        where appointment_id = ${apptHospital} and event_type = 'ARRIVED'`;
      check(events.n === 1, "one ARRIVED event, not two");
    });

    await as(tx, uidA, async () => {
      await tx`select public.set_appointment_status(${apptHospital},
        'IN_CONSULTATION'::public.appointment_status, null, null)`;
      await tx`select public.set_appointment_status(${apptHospital},
        'COMPLETED'::public.appointment_status, null, null)`;
      const [a] = await tx`select status, completed_at from public.appointments
                           where id = ${apptHospital}`;
      check(a.status === "COMPLETED" && Boolean(a.completed_at), "consultation completes");

      const reopen = await expectDenied(tx, async (t) => {
        await t`select public.set_appointment_status(${apptHospital},
          'ARRIVED'::public.appointment_status, null, null)`;
      });
      check(reopen, "a completed appointment cannot be reopened");
    });

    // ---- reschedule ------------------------------------------------------
    console.log("\nReschedule");

    // Reception cannot even SEE the chamber appointment, so it must not be able
    // to move it. Asserted before the happy path, because a reschedule that
    // succeeded here would be a visibility leak wearing a feature's clothes.
    await as(tx, uidR, async () => {
      const denied = await expectDenied(tx, async (t) => {
        await t`select public.reschedule_appointment(${apptChamber},
          '2026-09-08T10:00:00+06:00'::timestamptz, null, null)`;
      });
      check(denied, "reception cannot reschedule an appointment it cannot see");
    });

    await as(tx, uidA, async () => {
      const [{ reschedule_appointment: moved }] = await tx`
        select public.reschedule_appointment(${apptChamber},
          '2026-09-08T10:00:00+06:00'::timestamptz, null, 'Patient asked to move')`;
      check(Boolean(moved), "the doctor reschedules their chamber appointment");

      const [old] = await tx`select status, cancellation_reason
                             from public.appointments where id = ${apptChamber}`;
      check(
        old.status === "CANCELLED" && old.cancellation_reason === "RESCHEDULED",
        "the original is cancelled with reason RESCHEDULED",
      );

      const [fresh] = await tx`select rescheduled_from_id, status, visit_type
                               from public.appointments where id = ${moved}`;
      check(fresh.rescheduled_from_id === apptChamber, "the new one links back to the old");
      check(fresh.status === "SCHEDULED", "the new one starts SCHEDULED");
      check(fresh.visit_type === "FOLLOW_UP", "visit type carries over");
    });

    await as(tx, uidR, async () => {
      const [visible] = await tx`
        select count(*)::int as n from public.appointments where id = ${apptChamber}`;
      check(visible.n === 0, "reception still cannot READ the chamber appointment");
    });

    // ---- the state machine cannot be walked around -------------------------
    console.log("\nBypass attempts (as the OWNING doctor, who passes every policy)");
    await as(tx, uidA, async () => {
      const cases = [
        [
          "cannot set status directly, skipping the state machine",
          async (t) => t`update public.appointments set status = 'COMPLETED'
                          where id = ${apptChamber}`,
        ],
        [
          "cannot move the date without a reschedule record",
          async (t) => t`update public.appointments
                            set scheduled_for = '2027-01-01T10:00:00+06:00'
                          where id = ${apptChamber}`,
        ],
        [
          "cannot swap the patient on an existing appointment",
          async (t) => t`update public.appointments set patient_id = ${patB.id}
                          where id = ${apptChamber}`,
        ],
        [
          "cannot swap the doctor on an existing appointment",
          async (t) => t`update public.appointments set owner_doctor_id = ${docB.id}
                          where id = ${apptChamber}`,
        ],
        [
          "cannot INSERT an appointment directly (which would have no CREATED event)",
          async (t) => t`insert into public.appointments
                           (owner_doctor_id, practice_location_id, patient_id,
                            scheduled_for, session_date)
                         values (${docA.id}, ${chamber.id}, ${patA.id},
                                 ${when}::timestamptz, current_date)`,
        ],
        [
          "cannot forge an appointment event",
          async (t) => t`insert into public.appointment_events
                           (appointment_id, practice_location_id, event_type, to_status)
                         values (${apptChamber}, ${chamber.id}, 'COMPLETED', 'COMPLETED')`,
        ],
        [
          "appointment_events cannot be UPDATEd",
          async (t) => t`update public.appointment_events set note = 'tampered'`,
        ],
        [
          "appointment_events cannot be DELETEd",
          async (t) => t`delete from public.appointment_events`,
        ],
        [
          "appointments cannot be DELETEd",
          async (t) => t`delete from public.appointments where id = ${apptChamber}`,
        ],
        [
          "the token counter is unreachable",
          async (t) => t`select * from public.appointment_token_counters`,
        ],
      ];

      for (const [label, fn] of cases) {
        check(await expectDenied(tx, fn), label);
      }
    });

    // Every RPC mutation left a matching event behind.
    console.log("\nEvery mutation is recorded");
    await as(tx, uidA, async () => {
      const rows = await tx`
        select a.id, a.status,
               (select count(*)::int from public.appointment_events e
                 where e.appointment_id = a.id) as events,
               (select count(*)::int from public.appointment_events e
                 where e.appointment_id = a.id and e.event_type = 'CREATED') as created
        from public.appointments a
        where a.owner_doctor_id = ${docA.id}`;
      check(
        rows.every((r) => r.created === 1),
        "every appointment has exactly one CREATED event",
      );
      check(
        rows.every((r) => r.events >= 1),
        "no appointment exists without history",
      );
    });

    // ---- reschedule lineage cannot be forged ------------------------------
    console.log("\nReschedule lineage");
    await as(tx, uidA, async () => {
      // The old 8-argument form accepted lineage from anyone. It must be gone,
      // not merely discouraged.
      const noLineageParam = await expectDenied(tx, async (t) => {
        await t`select public.create_appointment(${docA.id}, ${chamber.id}, ${patA.id},
          ${when}::timestamptz, 15, 'NEW'::public.visit_type, null, ${apptChamber})`;
      });
      check(noLineageParam, "public booking has no lineage parameter to abuse");

      const internalHidden = await expectDenied(tx, async (t) => {
        await t`select public.book_appointment_internal(${docA.id}, ${chamber.id},
          ${patA.id}, ${when}::timestamptz, 15, 'NEW'::public.visit_type, null,
          ${apptChamber})`;
      });
      check(internalHidden, "the internal booking helper is not executable");

      // A second successor for an already-rescheduled appointment.
      const twoSuccessors = await expectDenied(tx, async (t) => {
        await t`select public.reschedule_appointment(${apptChamber},
          '2026-09-15T10:00:00+06:00'::timestamptz, null, null)`;
      });
      check(twoSuccessors, "a cancelled appointment cannot be rescheduled again");

      const [successors] = await tx`
        select count(*)::int as n from public.appointments
        where rescheduled_from_id = ${apptChamber}`;
      check(successors.n === 1, "exactly one successor exists", `${successors.n}`);
    });

    /**
     * REGRESSION: getMemberships() must filter by user_id itself.
     *
     * The SELECT policy is deliberately "your own rows OR you are an active
     * member here", so colleagues appear in staff lists. Application code that
     * reads this table WITHOUT filtering therefore collects every member's
     * roles and treats them as the caller's — which is exactly what happened:
     * a receptionist came back holding DOCTOR and LOCATION_ADMIN, and every
     * requirePermission() check believed it.
     *
     * These two queries prove the policy alone does not narrow the result, so
     * the filter is load-bearing rather than decorative.
     */
    console.log("\nMembership roles belong to the caller alone");
    await as(tx, uidR, async () => {
      const unfiltered = await tx`
        select role from public.practice_location_members where status = 'ACTIVE'`;
      const roles = unfiltered.map((r) => r.role);
      check(
        roles.length > 1,
        "RLS alone returns colleagues' rows (so the app MUST filter)",
        roles.join(","),
      );

      const mine = await tx`
        select role from public.practice_location_members
        where status = 'ACTIVE' and user_id = auth.uid()`;
      const myRoles = mine.map((r) => r.role);
      check(
        myRoles.length === 1 && myRoles[0] === "RECEPTIONIST",
        "filtering by user_id yields ONLY the receptionist's own role",
        myRoles.join(","),
      );
      check(
        !myRoles.includes("DOCTOR") && !myRoles.includes("LOCATION_ADMIN"),
        "a receptionist never inherits DOCTOR or LOCATION_ADMIN",
      );
    });

    // ---- reception registers a patient (ADR 0008) -------------------------
    console.log("\nReception registration");
    await as(tx, uidR, async () => {
      const [reg] = await tx`
        select * from public.register_patient_for_doctor(
          ${docA.id}, ${hospital.id}, 'Fatima Begum',
          null, 'AGE_ONLY'::public.dob_precision, 34, current_date,
          'FEMALE'::public.sex, '01712000000',
          null, null, 'Dhaka', null, null, null, false)`;
      check(Boolean(reg?.patient_id), "reception registers a patient", reg?.patient_number);

      const [owned] = await tx`
        select owner_doctor_id, created_by from public.patients where id = ${reg.patient_id}`;
      check(owned.owner_doctor_id === docA.id, "the patient belongs to the SELECTED DOCTOR");
      check(owned.created_by === uidR, "created_by records the receptionist");

      const [audit] = await tx`
        select count(*)::int as n from public.audit_events
        where resource_id = ${reg.patient_id}
          and action = 'patient.registered_by_reception' and actor_id = ${uidR}`;
      check(audit.n === 1, "the registration is audited in the same transaction");

      const notHere = await expectDenied(tx, async (t) => {
        await t`select * from public.register_patient_for_doctor(
          ${docB.id}, ${hospital.id}, 'Nobody',
          null, 'AGE_ONLY'::public.dob_precision, 20, current_date,
          'UNKNOWN'::public.sex, null, null, null, null, null, null, null, false)`;
      });
      check(notHere, "cannot register for a doctor who does not practise here");

      const dupes = await tx`
        select * from public.find_duplicates_for_doctor(
          ${docA.id}, ${hospital.id}, 'rahim hossain', null)`;
      check(dupes.length === 1, "duplicate search finds the doctor's own patient");

      const across = await tx`
        select * from public.find_duplicates_for_doctor(
          ${docA.id}, ${hospital.id}, 'karim mia', null)`;
      check(across.length === 0, "duplicate search never reaches another doctor's patient");
    });

    /**
     * Walk-in duplicate protection, WITHOUT leaking chamber-only patients.
     *
     * Reception must be stopped from creating a second record, but must not
     * learn that a private patient exists — "no match" versus "a match you may
     * not see" is itself information.
     */
    console.log("\nWalk-in duplicate guard — visible matches");
    await as(tx, uidR, async () => {
      const [seen] = await tx`
        select * from public.check_walkin_duplicates(
          ${docA.id}, ${hospital.id}, 'Md. Rahim Hossain', null)`;
      check(
        seen.visible.length === 1,
        "a visible duplicate is found from the RAW name (honorific and all)",
      );

      const blocked = await expectDenied(tx, async (t) => {
        await t`select * from public.register_patient_for_doctor(
          ${docA.id}, ${hospital.id}, 'Rahim Hossain',
          null, 'AGE_ONLY'::public.dob_precision, 40, current_date,
          'MALE'::public.sex, null, null, null, null, null, null, null, false)`;
      });
      check(blocked, "registering a visible duplicate is refused");

      const [overridden] = await tx`
        select * from public.register_patient_for_doctor(
          ${docA.id}, ${hospital.id}, 'Rahim Hossain',
          null, 'AGE_ONLY'::public.dob_precision, 40, current_date,
          'MALE'::public.sex, null, null, null, null, null, null, null, true)`;
      check(
        Boolean(overridden?.patient_id),
        "…but reception may override a match it can actually compare",
      );

      const omittedFlag = await expectDenied(tx, async (t) => {
        await t`select * from public.register_patient_for_doctor(
          ${docA.id}, ${hospital.id}, 'Rahim Hossain',
          null, 'AGE_ONLY'::public.dob_precision, 40, current_date,
          'MALE'::public.sex, null, null, null, null, null, null, null)`;
      });
      check(omittedFlag, "omitting the confirmation flag does NOT skip the guard");
    });

    /**
     * PRIVACY: a chamber-only patient must be completely invisible — not
     * merely undisclosed. Reception must get the SAME result and the SAME
     * registration behaviour whether or not one exists, or the RPC becomes an
     * oracle for probing names and phone numbers.
     */
    console.log("\nWalk-in duplicate guard — hidden patients are not an oracle");
    await as(tx, uidR, async () => {
      const [before] = await tx`
        select * from public.check_walkin_duplicates(
          ${docA.id}, ${hospital.id}, 'Shireen Akter', '01766001100')`;
      check(
        before.visible.length === 0,
        "a chamber-only match returns nothing at all",
        JSON.stringify(before.visible),
      );

      const [registered] = await tx`
        select * from public.register_patient_for_doctor(
          ${docA.id}, ${hospital.id}, 'Shireen Akter',
          null, 'AGE_ONLY'::public.dob_precision, 30, current_date,
          'FEMALE'::public.sex, '01766001100', null, null, null, null, null, null, false)`;
      check(
        Boolean(registered?.patient_id),
        "registration PROCEEDS — privacy wins over perfect deduplication",
      );
    });

    // The control: someone with no chamber-only twin behaves identically.
    await as(tx, uidR, async () => {
      const [control] = await tx`
        select * from public.check_walkin_duplicates(
          ${docA.id}, ${hospital.id}, 'Nobody Atall', '01700000999')`;
      check(
        control.visible.length === 0,
        "…and a name with NO hidden twin returns exactly the same: nothing",
        JSON.stringify(control.visible),
      );
    });

    console.log("\nNormalisation is derived, never accepted");
    await as(tx, uidR, async () => {
      /**
       * The old signature took p_name_normalized/p_phone_normalized, so a
       * direct caller could send an honest name with a dishonest search key and
       * walk straight past the guard. Those parameters no longer exist.
       */
      const noKeys = await expectDenied(tx, async (t) => {
        await t`select * from public.register_patient_for_doctor(
          ${docA.id}, ${hospital.id}, 'Rahim Hossain', 'totally-different-key',
          null, 'AGE_ONLY'::public.dob_precision, 40, current_date,
          'MALE'::public.sex, null, null, null, null, null, null, null, null, false)`;
      });
      check(noKeys, "the caller cannot supply a normalised search key at all");

      // A dishonest key is impossible, so the guard catches the honest name
      // however it is spelled — and the STORED key is the canonical one.
      const dodge = await expectDenied(tx, async (t) => {
        await t`select * from public.register_patient_for_doctor(
          ${docA.id}, ${hospital.id}, 'MD.  RAHIM   HOSSAIN',
          null, 'AGE_ONLY'::public.dob_precision, 40, current_date,
          'MALE'::public.sex, null, null, null, null, null, null, null, false)`;
      });
      check(dodge, "a differently-spelled duplicate is still caught");
    });

    await as(tx, uidR, async () => {
      const [stored] = await tx`
        select name_normalized, phone_normalized from public.patients
        where full_name = 'Shireen Akter' and owner_doctor_id = ${docA.id}
        order by created_at desc limit 1`;
      check(
        stored.name_normalized === "shireen akter",
        "the stored search key is the canonical one",
        stored.name_normalized,
      );
      check(
        stored.phone_normalized === "01766001100",
        "…and so is the phone key",
        stored.phone_normalized,
      );
    });

    // Lookup failure must BLOCK, never wave the patient through.
    await as(tx, uidC, async () => {
      const failClosed = await expectDenied(tx, async (t) => {
        await t`select * from public.check_walkin_duplicates(
          ${docA.id}, ${hospital.id}, 'Anybody', null)`;
      });
      check(failClosed, "duplicate checking refuses a caller who is not the desk");
    });

    // A doctor is not front-desk staff and must not use the reception path.
    await as(tx, uidC, async () => {
      const denied = await expectDenied(tx, async (t) => {
        await t`select * from public.register_patient_for_doctor(
          ${docC.id}, ${hospital.id}, 'Self Serve',
          null, 'AGE_ONLY'::public.dob_precision, 40, current_date,
          'MALE'::public.sex, null, null, null, null, null, null, null, false)`;
      });
      check(denied, "a doctor cannot use the reception registration path");
    });

    throw new Error("__rollback__");
  });
} catch (e) {
  if (e.message !== "__rollback__") {
    check(false, "appointment verification", e.message);
    if (process.env.QA_TRACE) console.error(e);
  }
}

// ---------------------------------------------------------------------------
// Concurrent check-in.
//
// This one CANNOT run inside a rolled-back transaction: proving that two
// simultaneous arrivals get different tokens requires both to actually commit.
// So it builds a committed fixture and removes it in a finally block.
//
// This is the check that would have caught the original bug, where
// `max(token_number) + 1` was "protected" by a FOR UPDATE on the appointment
// being checked in — two different appointments, two different locks, one
// shared maximum.
// ---------------------------------------------------------------------------
console.log("\nConcurrent check-in (committed, then cleaned up)");

const cUid = crypto.randomUUID();
const cDeskUid = crypto.randomUUID();
/** Every user this section creates, so cleanup can target exactly them. */
const concurrencyUsers = [cUid, cDeskUid];
let cLocation, cDoctor;
/**
 * Timeouts on the racing connections. These transactions deliberately contend
 * for the same rows, so a mistake here shows up as a hang — and a hang that
 * eats the whole run tells you nothing about where it started.
 */
const raceOpts = {
  max: 1,
  prepare: false,
  onnotice: () => {},
  connection: { statement_timeout: "15000", lock_timeout: "10000" },
};
const connA = postgres(url, raceOpts);
const connB = postgres(url, raceOpts);

try {
  await sql`insert into auth.users (id, email) values (${cUid}, ${`${cUid}@qa.invalid`})`;
  await sql`insert into public.profiles (id, full_name) values (${cUid}, 'Dr Concurrent')`;
  await sql`insert into auth.users (id, email) values (${cDeskUid}, ${`${cDeskUid}@qa.invalid`})`;
  await sql`insert into public.profiles (id, full_name) values (${cDeskUid}, 'Desk')`;

  [cDoctor] = await sql`insert into public.doctor_profiles (user_id, patient_number_prefix)
                        values (${cUid}, 'ZZ') returning id`;
  [cLocation] = await sql`
    insert into public.practice_locations (name, type, created_by, timezone)
    values ('QA Concurrency Clinic', 'CLINIC', ${cUid}, 'Asia/Dhaka') returning id`;
  await sql`insert into public.practice_location_members
              (practice_location_id, user_id, role, status)
            values (${cLocation.id}, ${cUid}, 'DOCTOR', 'ACTIVE'),
                   (${cLocation.id}, ${cDeskUid}, 'RECEPTIONIST', 'ACTIVE')`;

  const made = [];
  for (let i = 0; i < 2; i++) {
    const [p] = await sql`
      insert into public.patients (owner_doctor_id, patient_number, full_name,
                                   name_normalized, sex, created_by)
      values (${cDoctor.id}, ${`ZZ-90000${i}`}, ${`Concurrent ${i}`},
              ${`concurrent ${i}`}, 'UNKNOWN', ${cUid}) returning id`;
    await sql`insert into public.patient_location_links (patient_id, practice_location_id)
              values (${p.id}, ${cLocation.id})`;
    const [a] = await sql`
      insert into public.appointments (owner_doctor_id, practice_location_id, patient_id,
                                       scheduled_for, session_date, created_by)
      values (${cDoctor.id}, ${cLocation.id}, ${p.id},
              '2026-09-01T10:00:00+06:00'::timestamptz, '2026-09-01', ${cUid})
      returning id`;
    made.push(a.id);
  }

  const claims = JSON.stringify({ sub: cDeskUid, role: "authenticated" });

  /** Check in one appointment on its own connection, holding the tx open. */
  const checkIn = (conn, apptId, ready, go) =>
    conn.begin(async (t) => {
      await t`select set_config('request.jwt.claims', ${claims}, true)`;
      await t`set local role authenticated`;
      ready();
      await go;                       // both connections wait here, then race
      await t`select public.set_appointment_status(${apptId},
                'ARRIVED'::public.appointment_status, null, null)`;
    });

  let readyA, readyB;
  const bothReady = Promise.all([
    new Promise((r) => (readyA = r)),
    new Promise((r) => (readyB = r)),
  ]);
  let release;
  const go = new Promise((r) => (release = r));

  const runA = checkIn(connA, made[0], readyA, go);
  const runB = checkIn(connB, made[1], readyB, go);

  await bothReady;                    // both transactions are open and authenticated
  release();                          // now let them both allocate
  await Promise.all([runA, runB]);

  // -------------------------------------------------------------------------
  // Two callers acting on the SAME appointment.
  //
  // The token race above is about two DIFFERENT rows. This is the other half:
  // without FOR UPDATE both callers read the same old status, both judge their
  // transition legal, and both write an event — leaving a row that agrees with
  // neither history.
  // -------------------------------------------------------------------------
  const raceOn = async (apptId, first, second) => {
    let readyX, readyY;
    const both = Promise.all([
      new Promise((r) => (readyX = r)),
      new Promise((r) => (readyY = r)),
    ]);
    let release;
    const go = new Promise((r) => (release = r));

    const run = (conn, fn, ready) =>
      conn
        .begin(async (t) => {
          await t`select set_config('request.jwt.claims', ${claims}, true)`;
          await t`set local role authenticated`;
          ready();
          await go;
          await fn(t);
        })
        .then(
          () => "ok",
          (e) => e.message,
        );

    const a = run(connA, first, readyX);
    const b = run(connB, second, readyY);
    await both;
    release();
    const outcomes = await Promise.all([a, b]);
    const consistent = await historyIsConsistent(sql, apptId);
    return { outcomes, consistent };
  };

  const arrive = (id) => (t) =>
    t`select public.set_appointment_status(${id},
        'ARRIVED'::public.appointment_status, null, null)`;
  const cancel = (id) => (t) =>
    t`select public.set_appointment_status(${id},
        'CANCELLED'::public.appointment_status,
        'PATIENT_REQUEST'::public.cancellation_reason, null)`;
  const confirm = (id) => (t) =>
    t`select public.set_appointment_status(${id},
        'CONFIRMED'::public.appointment_status, null, null)`;

  // (a) arrival + arrival on one appointment
  {
    const [p] = await sql`
      insert into public.patients (owner_doctor_id, patient_number, full_name,
                                   name_normalized, sex, created_by)
      values (${cDoctor.id}, 'ZZ-910001', 'Race A', 'race a', 'UNKNOWN', ${cUid})
      returning id`;
    await sql`insert into public.patient_location_links (patient_id, practice_location_id)
              values (${p.id}, ${cLocation.id})`;
    const [appt] = await sql`
      insert into public.appointments (owner_doctor_id, practice_location_id, patient_id,
                                       scheduled_for, session_date, created_by)
      values (${cDoctor.id}, ${cLocation.id}, ${p.id},
              '2026-09-01T11:00:00+06:00'::timestamptz, '2026-09-01', ${cUid})
      returning id`;
    await sql`insert into public.appointment_events
                (appointment_id, practice_location_id, event_type, to_status, actor_id)
              values (${appt.id}, ${cLocation.id}, 'CREATED', 'SCHEDULED', ${cUid})`;

    const { consistent } = await raceOn(appt.id, arrive(appt.id), arrive(appt.id));
    check(consistent.ok, "arrival + arrival: row and history agree", consistent.why ?? "");

    const [ev] = await sql`
      select count(*)::int as n from public.appointment_events
      where appointment_id = ${appt.id} and event_type = 'ARRIVED'`;
    check(ev.n === 1, "arrival + arrival: exactly ONE arrival event", `${ev.n}`);

    const [tok] = await sql`
      select count(distinct token_number)::int as n from public.appointments
      where id = ${appt.id} and token_number is not null`;
    check(tok.n === 1, "arrival + arrival: exactly one token");
  }

  // (b) arrival + cancellation on one appointment
  {
    const [p] = await sql`
      insert into public.patients (owner_doctor_id, patient_number, full_name,
                                   name_normalized, sex, created_by)
      values (${cDoctor.id}, 'ZZ-910002', 'Race B', 'race b', 'UNKNOWN', ${cUid})
      returning id`;
    await sql`insert into public.patient_location_links (patient_id, practice_location_id)
              values (${p.id}, ${cLocation.id})`;
    const [appt] = await sql`
      insert into public.appointments (owner_doctor_id, practice_location_id, patient_id,
                                       scheduled_for, session_date, created_by)
      values (${cDoctor.id}, ${cLocation.id}, ${p.id},
              '2026-09-01T12:00:00+06:00'::timestamptz, '2026-09-01', ${cUid})
      returning id`;
    await sql`insert into public.appointment_events
                (appointment_id, practice_location_id, event_type, to_status, actor_id)
              values (${appt.id}, ${cLocation.id}, 'CREATED', 'SCHEDULED', ${cUid})`;

    const { consistent } = await raceOn(appt.id, arrive(appt.id), cancel(appt.id));
    check(
      consistent.ok,
      "arrival + cancellation: row and history agree",
      consistent.why ?? `${consistent.events} events, ${consistent.status}`,
    );
    check(
      ["ARRIVED", "CANCELLED"].includes(consistent.status ?? ""),
      "arrival + cancellation: the outcome is one of the two legal ones",
      consistent.status ?? "",
    );
  }

  // (c) confirmation + reschedule on one appointment
  {
    const [p] = await sql`
      insert into public.patients (owner_doctor_id, patient_number, full_name,
                                   name_normalized, sex, created_by)
      values (${cDoctor.id}, 'ZZ-910003', 'Race C', 'race c', 'UNKNOWN', ${cUid})
      returning id`;
    await sql`insert into public.patient_location_links (patient_id, practice_location_id)
              values (${p.id}, ${cLocation.id})`;
    const [appt] = await sql`
      insert into public.appointments (owner_doctor_id, practice_location_id, patient_id,
                                       scheduled_for, session_date, created_by)
      values (${cDoctor.id}, ${cLocation.id}, ${p.id},
              '2026-09-01T13:00:00+06:00'::timestamptz, '2026-09-01', ${cUid})
      returning id`;
    await sql`insert into public.appointment_events
                (appointment_id, practice_location_id, event_type, to_status, actor_id)
              values (${appt.id}, ${cLocation.id}, 'CREATED', 'SCHEDULED', ${cUid})`;

    const { consistent } = await raceOn(
      appt.id,
      confirm(appt.id),
      (t) => t`select public.reschedule_appointment(${appt.id},
                 '2026-09-20T10:00:00+06:00'::timestamptz, null, null)`,
    );
    check(
      consistent.ok,
      "confirmation + reschedule: row and history agree",
      consistent.why ?? `${consistent.events} events, ${consistent.status}`,
    );

    const [succ] = await sql`
      select count(*)::int as n from public.appointments
      where rescheduled_from_id = ${appt.id}`;
    check(succ.n <= 1, "confirmation + reschedule: at most one successor", `${succ.n}`);
  }

  // -------------------------------------------------------------------------
  // Two receptionists registering the SAME walk-in at the same moment.
  //
  // "Check and insert in one transaction" does not serialise two transactions:
  // both can read no-candidate and both insert. The advisory lock is what makes
  // the second caller wait and then see the first one's row.
  // -------------------------------------------------------------------------
  {
    const [deskB] = await sql`select gen_random_uuid() as id`;
    concurrencyUsers.push(deskB.id);
    await sql`insert into auth.users (id, email)
              values (${deskB.id}, ${`${deskB.id}@qa.invalid`})`;
    await sql`insert into public.profiles (id, full_name)
              values (${deskB.id}, 'Desk Two')`;
    await sql`insert into public.practice_location_members
                (practice_location_id, user_id, role, status)
              values (${cLocation.id}, ${deskB.id}, 'RECEPTIONIST', 'ACTIVE')`;

    const register = (conn, uid, ready, go) =>
      conn
        .begin(async (t) => {
          await t`select set_config('request.jwt.claims', ${JSON.stringify({
            sub: uid,
            role: "authenticated",
          })}, true)`;
          await t`set local role authenticated`;
          ready();
          await go;
          await t`select * from public.register_patient_for_doctor(
            ${cDoctor.id}, ${cLocation.id}, 'Jamal Hossain',
            null, 'AGE_ONLY'::public.dob_precision, 50, current_date,
            'MALE'::public.sex, '01733221100',
            null, null, null, null, null, null, false)`;
        })
        .then(
          () => "registered",
          (e) => e.message,
        );

    let readyX, readyY;
    const both = Promise.all([
      new Promise((r) => (readyX = r)),
      new Promise((r) => (readyY = r)),
    ]);
    let release;
    const go = new Promise((r) => (release = r));

    const a = register(connA, cDeskUid, readyX, go);
    const b = register(connB, deskB.id, readyY, go);
    await both;
    release();
    const outcomes = await Promise.all([a, b]);

    const created = await sql`
      select id from public.patients
      where owner_doctor_id = ${cDoctor.id} and phone_normalized = '01733221100'`;

    check(
      created.length === 1,
      "two simultaneous registrations create exactly ONE record",
      `${created.length} created; outcomes: ${JSON.stringify(outcomes)}`,
    );
    check(
      outcomes.filter((o) => o === "registered").length === 1,
      "…one call succeeded and the other was refused as a duplicate",
      JSON.stringify(outcomes),
    );
  }

  const tokens = await sql`
    select id, token_number from public.appointments
    where id in ${sql(made)} order by token_number`;

  const values = tokens.map((t) => t.token_number);
  check(
    values.every((v) => v !== null),
    "both concurrent check-ins allocated a token",
    JSON.stringify(values),
  );
  check(
    new Set(values).size === 2,
    "two simultaneous arrivals receive DIFFERENT tokens",
    JSON.stringify(values),
  );
  check(
    values[0] === 1 && values[1] === 2,
    "and they are consecutive from 1",
    JSON.stringify(values),
  );

  /**
   * The backstop: even a bug in allocation cannot produce a duplicate.
   *
   * Take the token from ONE row and force it onto the OTHER, by id. Ordering by
   * token_number and indexing positionally silently no-ops whenever the race
   * finishes in the other order — which is exactly when you most want the test
   * to be meaningful.
   */
  const byId = new Map(tokens.map((t) => [t.id, t.token_number]));
  let duplicateBlocked = false;
  try {
    await sql`update public.appointments set token_number = ${byId.get(made[0])}
              where id = ${made[1]}`;
  } catch {
    duplicateBlocked = true;
  }
  check(duplicateBlocked, "a duplicate (location, session date, token) is impossible");
} catch (e) {
  check(false, "concurrent check-in", e.message);
  if (process.env.QA_TRACE) console.error(e);
} finally {
  await connA.end().catch(() => {});
  await connB.end().catch(() => {});
  // RESTRICT foreign keys mean order matters — history first, then the rows it
  // points at. That is the durability guarantee working as intended.
  if (cLocation) {
    await sql`delete from public.appointment_events
              where practice_location_id = ${cLocation.id}`;
    await sql`delete from public.appointments where practice_location_id = ${cLocation.id}`;
    await sql`delete from public.appointment_token_counters
              where practice_location_id = ${cLocation.id}`;
    await sql`delete from public.patient_location_links
              where practice_location_id = ${cLocation.id}`;
  }
  if (cDoctor) await sql`delete from public.patients where owner_doctor_id = ${cDoctor.id}`;
  await sql`delete from public.practice_locations where created_by = ${cUid}`;
  /**
   * Only THIS test's users, by id.
   *
   * A broader `email like '%@qa.invalid'` also matched the shared qa-fixture
   * accounts, which have their own patients and appointments — the RESTRICT
   * foreign keys then failed the whole statement and these users survived.
   */
  await sql`delete from auth.users where id in ${sql(concurrencyUsers)}`;

  const [left] = await sql`
    select count(*)::int as n from auth.users where id in (${cUid}, ${cDeskUid})`;
  check(left.n === 0, "concurrency fixture cleaned up");
}

await sql.end();

console.log(
  failures.length === 0
    ? "\nAll appointment checks passed.\n"
    : `\n${failures.length} CHECK(S) FAILED:\n  - ${failures.join("\n  - ")}\n`,
);
process.exit(failures.length === 0 ? 0 : 1);
