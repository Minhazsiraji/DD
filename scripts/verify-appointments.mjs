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

console.log("\nappointment_events is append-only");
for (const priv of ["UPDATE", "DELETE"]) {
  const [g] = await sql`
    select count(*)::int as n from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'appointment_events'
      and grantee = 'authenticated' and privilege_type = ${priv}`;
  check(g.n === 0, `no ${priv} grant on appointment_events`);
}

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
          ${when}::timestamptz, 15, 'NEW'::public.visit_type, 'Fever', null)`;
      check(Boolean(apptHospital), "doctor books at their hospital");

      [{ create_appointment: apptChamber }] = await tx`
        select public.create_appointment(${docA.id}, ${chamber.id}, ${patA.id},
          ${when}::timestamptz, 15, 'FOLLOW_UP'::public.visit_type, null, null)`;
      check(Boolean(apptChamber), "doctor books in their private chamber");

      const [ev] = await tx`
        select count(*)::int as n from public.appointment_events
        where appointment_id = ${apptHospital} and event_type = 'CREATED'`;
      check(ev.n === 1, "booking writes its CREATED event in the same transaction");

      const wrongPatient = await expectDenied(tx, async (t) => {
        await t`select public.create_appointment(${docA.id}, ${hospital.id}, ${patB.id},
          ${when}::timestamptz, 15, 'NEW'::public.visit_type, null, null)`;
      });
      check(wrongPatient, "cannot book another doctor's patient into your clinic");
    });

    await as(tx, uidR, async () => {
      const [{ create_appointment: byDesk }] = await tx`
        select public.create_appointment(${docA.id}, ${hospital.id}, ${patA.id},
          ${when}::timestamptz, 15, 'NEW'::public.visit_type, 'Desk booking', null)`;
      check(Boolean(byDesk), "reception books for a doctor at their hospital");

      const intoChamber = await expectDenied(tx, async (t) => {
        await t`select public.create_appointment(${docA.id}, ${chamber.id}, ${patA.id},
          ${when}::timestamptz, 15, 'NEW'::public.visit_type, null, null)`;
      });
      check(intoChamber, "reception CANNOT book into the doctor's private chamber");

      const foreignDoctor = await expectDenied(tx, async (t) => {
        await t`select public.create_appointment(${docB.id}, ${hospital.id}, ${patB.id},
          ${when}::timestamptz, 15, 'NEW'::public.visit_type, null, null)`;
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
          ${when}::timestamptz, 15, 'NEW'::public.visit_type, null, null)`;
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

    // ---- append-only ------------------------------------------------------
    console.log("\nAppend-only history");
    await as(tx, uidA, async () => {
      const blockedUpdate = await expectDenied(tx, async (t) => {
        await t`update public.appointment_events set note = 'tampered'`;
      });
      check(blockedUpdate, "appointment_events cannot be UPDATEd");

      const blockedDelete = await expectDenied(tx, async (t) => {
        await t`delete from public.appointment_events`;
      });
      check(blockedDelete, "appointment_events cannot be DELETEd");

      const blockedApptDelete = await expectDenied(tx, async (t) => {
        await t`delete from public.appointments where id = ${apptHospital}`;
      });
      check(blockedApptDelete, "appointments cannot be DELETEd");
    });

    // ---- reception registers a patient (ADR 0008) -------------------------
    console.log("\nReception registration");
    await as(tx, uidR, async () => {
      const [reg] = await tx`
        select * from public.register_patient_for_doctor(
          ${docA.id}, ${hospital.id}, 'Fatima Begum', 'fatima begum',
          null, 'AGE_ONLY'::public.dob_precision, 34, current_date,
          'FEMALE'::public.sex, '01712000000', '01712000000',
          null, null, 'Dhaka', null, null, null)`;
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
          ${docB.id}, ${hospital.id}, 'Nobody', 'nobody',
          null, 'AGE_ONLY'::public.dob_precision, 20, current_date,
          'UNKNOWN'::public.sex, null, null, null, null, null, null, null, null)`;
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

    // A doctor is not front-desk staff and must not use the reception path.
    await as(tx, uidC, async () => {
      const denied = await expectDenied(tx, async (t) => {
        await t`select * from public.register_patient_for_doctor(
          ${docC.id}, ${hospital.id}, 'Self Serve', 'self serve',
          null, 'AGE_ONLY'::public.dob_precision, 40, current_date,
          'MALE'::public.sex, null, null, null, null, null, null, null, null)`;
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

await sql.end();

console.log(
  failures.length === 0
    ? "\nAll appointment checks passed.\n"
    : `\n${failures.length} CHECK(S) FAILED:\n  - ${failures.join("\n  - ")}\n`,
);
process.exit(failures.length === 0 ? 0 : 1);
