/**
 * C-001: finishing a consultation must end the VISIT, not just the notes.
 *
 * The live queue is built from `appointments`, not from encounters, and
 * IN_CONSULTATION sorts first — so an appointment left open by a finished
 * consultation pins that patient to the top of the queue forever and the next
 * patient can never be reached. A chamber day stops after one patient.
 *
 * Executed as the real `authenticated` role inside ONE transaction that is
 * ALWAYS rolled back. Writes no storage object, leaves nothing behind.
 *
 *   node --env-file=.env.local scripts/verify-finish-consultation.mjs
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

const uidA = crypto.randomUUID();
const SESSION = "2026-09-10";

try {
  await sql.begin(async (tx) => {
    await tx`insert into auth.users (id, email) values (${uidA}, ${`${uidA}@qa.invalid`})`;
    await tx`insert into public.profiles (id, full_name) values (${uidA}, 'Dr Finish')`;

    const [doc] = await tx`
      insert into public.doctor_profiles (user_id, patient_number_prefix, bmdc_registration_no)
      values (${uidA}, 'FN', ${"QF" + crypto.randomBytes(3).toString("hex")}) returning id`;

    const [loc] = await tx`
      insert into public.practice_locations (name, type, created_by)
      values ('QA Finish Chamber', 'PERSONAL_CHAMBER', ${uidA}) returning id`;
    await tx`insert into public.practice_location_members
               (practice_location_id, user_id, role, status)
             values (${loc.id}, ${uidA}, 'DOCTOR', 'ACTIVE')`;

    /** Two patients, so "the next one can start" is a real question. */
    const pats = [];
    for (const [n, name] of [
      ["FN-000001", "First Patient"],
      ["FN-000002", "Second Patient"],
    ]) {
      const [p] = await tx`
        insert into public.patients (owner_doctor_id, patient_number, full_name,
                                     name_normalized, sex, created_by)
        values (${doc.id}, ${n}, ${name}, ${name.toLowerCase()}, 'FEMALE', ${uidA})
        returning id`;
      await tx`insert into public.patient_location_links (patient_id, practice_location_id)
               values (${p.id}, ${loc.id})`;
      pats.push(p.id);
    }

    const appts = [];
    for (const [i, pid] of pats.entries()) {
      const [a] = await tx`
        insert into public.appointments (owner_doctor_id, practice_location_id, patient_id,
                                         scheduled_for, session_date, status, created_by)
        values (${doc.id}, ${loc.id}, ${pid},
                ${`${SESSION}T1${i}:00:00+06:00`}::timestamptz, ${SESSION}, 'SCHEDULED', ${uidA})
        returning id`;
      appts.push(a.id);
    }

    // Both arrive; the first goes in to see the doctor.
    await as(tx, uidA, async () => {
      for (const id of appts) await tx`select public.set_appointment_status(${id}, 'ARRIVED')`;
      await tx`select public.set_appointment_status(${appts[0]}, 'IN_CONSULTATION')`;
    });

    let enc;
    await as(tx, uidA, async () => {
      const [row] = await tx`
        select public.open_encounter(${pats[0]}, ${loc.id}, ${appts[0]}) as id`;
      enc = row.id;
    });

    // -----------------------------------------------------------------------
    console.log("\nBefore finishing: one in consultation, one waiting");
    // -----------------------------------------------------------------------
    const before = await as(tx, uidA, () =>
      tx`select * from public.get_queue(${loc.id}, ${SESSION})`);
    check(before.length === 2, "both patients are in the queue", `${before.length}`);
    check(
      before[0].status === "IN_CONSULTATION",
      "the one being seen sorts first",
      before[0].status,
    );

    // -----------------------------------------------------------------------
    console.log("\nFinishing the consultation ends the visit");
    // -----------------------------------------------------------------------
    let result;
    await as(tx, uidA, async () => {
      const [r] = await tx`
        select public.finish_consultation(${enc}, ${loc.id},
          (select version from public.encounters where id = ${enc})) as out`;
      result = r.out;
    });

    check(result.encounterStatus === "COMPLETED", "the encounter is COMPLETED");
    check(result.appointmentStatus === "COMPLETED", "…and so is the appointment");
    check(result.appointmentId === appts[0], "…the one this encounter was opened for");

    const [encRow] = await tx`
      select status, completed_at from public.encounters where id = ${enc}`;
    check(encRow.status === "COMPLETED", "the encounter row says COMPLETED");
    check(encRow.completed_at !== null, "…and carries the time it closed");

    const [apptRow] = await tx`
      select status, completed_at from public.appointments where id = ${appts[0]}`;
    check(apptRow.status === "COMPLETED", "the appointment row says COMPLETED");
    check(apptRow.completed_at !== null, "…and carries the time it closed");

    // -----------------------------------------------------------------------
    console.log("\nThe queue moves on");
    // -----------------------------------------------------------------------
    const after = await as(tx, uidA, () =>
      tx`select * from public.get_queue(${loc.id}, ${SESSION})`);
    check(after.length === 1, "the finished patient has left the queue", `${after.length} left`);
    check(
      after[0]?.patient_id === pats[1],
      "…and the next waiting patient is now at the top",
    );
    check(after[0]?.status === "ARRIVED", "…still waiting, not silently started", after[0]?.status);

    // And the next consultation can actually begin.
    await as(tx, uidA, async () => {
      await tx`select public.set_appointment_status(${appts[1]}, 'IN_CONSULTATION')`;
      await tx`select public.open_encounter(${pats[1]}, ${loc.id}, ${appts[1]})`;
    });
    const [second] = await tx`
      select status from public.appointments where id = ${appts[1]}`;
    check(second.status === "IN_CONSULTATION", "the next patient's visit starts normally");

    // -----------------------------------------------------------------------
    console.log("\nBoth lifecycles stay separate");
    // -----------------------------------------------------------------------
    /**
     * `close_encounter` must NOT have learned about appointments. If a clinical
     * closure silently rewrote operational state, the two could never diverge
     * again — and they must: a cancelled appointment still has notes to close.
     */
    const [closeSrc] = await tx`
      select pg_get_functiondef(p.oid) as src from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'close_encounter'`;
    check(
      !/appointments/i.test(closeSrc.src),
      "close_encounter still knows nothing about appointments",
    );

    const [finishSrc] = await tx`
      select pg_get_functiondef(p.oid) as src, pg_get_function_identity_arguments(p.oid) as args
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'finish_consultation'`;
    check(
      /public\.close_encounter\(/.test(finishSrc.src) &&
        /public\.set_appointment_status\(/.test(finishSrc.src),
      "finish_consultation delegates to both owners rather than writing its own",
    );
    check(
      !/appointment/i.test(finishSrc.args),
      "…and takes no appointment id from the caller",
      finishSrc.args,
    );
    check(/security definer/i.test(finishSrc.src), "finish_consultation is SECURITY DEFINER");
    check(/search_path/i.test(finishSrc.src), "…with a pinned search_path");

    const [grants] = await tx`
      select count(*)::int as n from information_schema.role_routine_grants
      where routine_schema = 'public' and routine_name = 'finish_consultation'
        and grantee = 'anon'`;
    check(grants.n === 0, "anon cannot execute it");

    // -----------------------------------------------------------------------
    console.log("\nA walk-in has no appointment, and finishes anyway");
    // -----------------------------------------------------------------------
    let walkIn;
    await as(tx, uidA, async () => {
      const [row] = await tx`select public.open_encounter(${pats[0]}, ${loc.id}, null) as id`;
      walkIn = row.id;
      const [r] = await tx`
        select public.finish_consultation(${walkIn}, ${loc.id},
          (select version from public.encounters where id = ${walkIn})) as out`;
      check(r.out.encounterStatus === "COMPLETED", "the walk-in's notes close");
      check(r.out.appointmentId === null, "…and there was no appointment to complete");
    });

    // -----------------------------------------------------------------------
    console.log("\nA cancelled appointment never blocks closing the notes");
    // -----------------------------------------------------------------------
    /**
     * The desk cancels while the doctor is still typing. Calling
     * `set_appointment_status` blindly would raise — CANCELLED is terminal —
     * and take the clinical closure down with it, leaving a doctor unable to
     * finish a visit they have already given.
     */
    const [pat3] = await tx`
      insert into public.patients (owner_doctor_id, patient_number, full_name,
                                   name_normalized, sex, created_by)
      values (${doc.id}, 'FN-000003', 'Third Patient', 'third patient', 'MALE', ${uidA})
      returning id`;
    await tx`insert into public.patient_location_links (patient_id, practice_location_id)
             values (${pat3.id}, ${loc.id})`;
    const [appt3] = await tx`
      insert into public.appointments (owner_doctor_id, practice_location_id, patient_id,
                                       scheduled_for, session_date, status, created_by)
      values (${doc.id}, ${loc.id}, ${pat3.id},
              ${`${SESSION}T15:00:00+06:00`}::timestamptz, ${SESSION}, 'SCHEDULED', ${uidA})
      returning id`;

    await as(tx, uidA, async () => {
      await tx`select public.set_appointment_status(${appt3.id}, 'ARRIVED')`;
      await tx`select public.set_appointment_status(${appt3.id}, 'IN_CONSULTATION')`;
      const [row] = await tx`
        select public.open_encounter(${pat3.id}, ${loc.id}, ${appt3.id}) as id`;
      // The desk cancels mid-consultation.
      await tx`select public.set_appointment_status(${appt3.id}, 'CANCELLED', 'PATIENT_REQUEST')`;

      const [r] = await tx`
        select public.finish_consultation(${row.id}, ${loc.id},
          (select version from public.encounters where id = ${row.id})) as out`;
      check(r.out.encounterStatus === "COMPLETED", "the notes still close");
      check(
        r.out.appointmentStatus === "CANCELLED",
        "…and the desk's cancellation is left exactly as it was",
        r.out.appointmentStatus,
      );
    });

    throw new Error("ROLLBACK");
  });
} catch (e) {
  if (e.message !== "ROLLBACK") {
    console.error(`\nverification aborted: ${e.message}`);
    failures.push("run aborted");
  }
}

const [left] = await sql`select count(*)::int as n from auth.users where id = ${uidA}`;
check(left.n === 0, "every row rolled back — nothing left behind");

await sql.end();

if (failures.length) {
  console.error(`\n${failures.length} FAILED:`);
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}
console.log("\nFinish consultation (C-001): all checks passed. Every row rolled back.\n");
