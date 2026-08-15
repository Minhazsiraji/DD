/**
 * Patient ownership and isolation, executed as the `authenticated` role against
 * the real database, inside a transaction that is ALWAYS rolled back.
 *
 * Static policy inspection cannot prove isolation — only running two different
 * doctors against the same rows can. This is the check that would catch a
 * policy change accidentally exposing one doctor's repository to another.
 *
 *   node --env-file=.env.local scripts/verify-patients.mjs
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

/**
 * Run something expected to FAIL, and report whether it did.
 *
 * Must use a SAVEPOINT: in Postgres an error aborts the whole transaction, so
 * a plain try/catch leaves every later statement failing with "current
 * transaction is aborted" — which looks like a cascade of unrelated bugs.
 */
async function expectDenied(tx, fn) {
  try {
    await tx.savepoint(fn);
    return false;
  } catch {
    return true;
  }
}

/** Run `fn` with the session acting as `uid`, then restore superuser rights. */
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
const uidB = crypto.randomUUID();
const uidR = crypto.randomUUID(); // receptionist at Doctor A's hospital
const uidM = crypto.randomUUID(); // location admin at Doctor A's hospital

try {
  await sql.begin(async (tx) => {
    // ---- fixtures (as superuser; rolled back at the end) --------------------
    for (const [uid, name] of [
      [uidA, "Dr A"],
      [uidB, "Dr B"],
      [uidR, "Reception R"],
      [uidM, "Admin M"],
    ]) {
      await tx`insert into auth.users (id, email) values (${uid}, ${`${uid}@qa.invalid`})`;
      await tx`insert into public.profiles (id, full_name) values (${uid}, ${name})`;
    }

    const [docA] = await tx`
      insert into public.doctor_profiles (user_id, patient_number_prefix)
      values (${uidA}, 'AA') returning id`;
    const [docB] = await tx`
      insert into public.doctor_profiles (user_id, patient_number_prefix)
      values (${uidB}, 'BB') returning id`;

    // Doctor A works at a hospital (shared with reception) and a private chamber.
    const [hospital] = await tx`
      insert into public.practice_locations (name, type, created_by)
      values ('QA Hospital', 'HOSPITAL', ${uidA}) returning id`;
    const [chamber] = await tx`
      insert into public.practice_locations (name, type, created_by)
      values ('QA Private Chamber', 'PERSONAL_CHAMBER', ${uidA}) returning id`;

    await tx`insert into public.practice_location_members (practice_location_id, user_id, role, status)
             values (${hospital.id}, ${uidA}, 'DOCTOR', 'ACTIVE'),
                    (${chamber.id},  ${uidA}, 'DOCTOR', 'ACTIVE'),
                    (${hospital.id}, ${uidR}, 'RECEPTIONIST', 'ACTIVE'),
                    (${hospital.id}, ${uidM}, 'LOCATION_ADMIN', 'ACTIVE')`;

    // ---- 1. Doctor A creates a patient -------------------------------------
    console.log("\nOwnership");
    let patientA;
    await as(tx, uidA, async () => {
      const [num] = await tx`select public.next_patient_number(${docA.id}) as n`;
      check(/^AA-\d{6}$/.test(num.n), "patient number allocated", num.n);

      [patientA] = await tx`
        insert into public.patients
          (owner_doctor_id, patient_number, full_name, name_normalized,
           phone, phone_normalized, sex, created_by)
        values (${docA.id}, ${num.n}, 'Rahim Hossain', 'rahim hossain',
                '01711000124', '01711000124', 'MALE', ${uidA})
        returning id`;
      check(Boolean(patientA?.id), "Doctor A creates a patient in own repository");

      const rows = await tx`select count(*)::int n from public.patients where id = ${patientA.id}`;
      check(rows[0].n === 1, "Doctor A can read their own patient");

      // Sensitive rows used by the reception-scoping checks below.
      await tx`insert into public.patient_allergies (patient_id, substance)
               values (${patientA.id}, 'Penicillin')`;
      await tx`insert into public.patient_conditions (patient_id, condition)
               values (${patientA.id}, 'HIV')`;
      await tx`insert into public.patient_medications (patient_id, name)
               values (${patientA.id}, 'Antiretroviral')`;
      await tx`insert into public.patient_alerts (patient_id, message)
               values (${patientA.id}, 'Confidential')`;
      await tx`insert into public.patient_private_notes (patient_id, body)
               values (${patientA.id}, 'Suspected malignancy — free clinical text')`;

      const own = await tx`
        select count(*)::int n from public.patient_private_notes where patient_id = ${patientA.id}`;
      check(own[0].n === 1, "the owning doctor CAN read their private notes");
    });

    // ---- Atomic creation ----------------------------------------------------
    console.log("\nTransactional patient creation");
    await as(tx, uidA, async () => {
      const before = await tx`select count(*)::int n from public.patients`;

      // A bad enum value fails midway through create_patient(). Nothing from
      // that call — patient, link, allergy — may survive.
      const rolledBack = await expectDenied(
        tx,
        (sp) => sp`select public.create_patient(
          null, 'Atomic Test', 'atomic test', null, 'AGE_ONLY', 40, current_date,
          'NOT_A_VALID_SEX'::public.sex, null, null, null, null, null,
          'UNKNOWN'::public.blood_group, null, null, null,
          array['Penicillin'], '{}', '{}', '{}', null, null, null)`,
      );
      check(rolledBack, "an invalid value aborts creation");

      const after = await tx`select count(*)::int n from public.patients`;
      check(
        before[0].n === after[0].n,
        "a failed creation leaves NO partial patient behind",
        `${before[0].n} -> ${after[0].n}`,
      );

      /**
       * Exercise the whole function, not just its failure path. Moving `notes`
       * out of `patients` silently broke create_patient() — the body still
       * referenced a dropped column, and nothing caught it until this ran.
       */
      const [ok] = await tx`select * from public.create_patient(
        ${hospital.id}, 'Full Path', 'full path', null, 'AGE_ONLY', 33, current_date,
        'FEMALE'::public.sex, '01822000001', '01822000001', null, null, null,
        'O_POS'::public.blood_group, 55, 160, 'A private clinical note',
        array['Sulfa'], array['Asthma'], array['Salbutamol'], array['Care needed'],
        'Next of kin', '01822000002', 'Sister')`;
      check(Boolean(ok?.patient_id), "create_patient() completes the full path");

      const kids = await tx`
        select
          (select count(*)::int from public.patient_allergies      where patient_id = ${ok.patient_id}) a,
          (select count(*)::int from public.patient_conditions     where patient_id = ${ok.patient_id}) c,
          (select count(*)::int from public.patient_medications    where patient_id = ${ok.patient_id}) m,
          (select count(*)::int from public.patient_alerts         where patient_id = ${ok.patient_id}) al,
          (select count(*)::int from public.patient_contacts       where patient_id = ${ok.patient_id}) ct,
          (select count(*)::int from public.patient_private_notes  where patient_id = ${ok.patient_id}) n,
          (select count(*)::int from public.patient_location_links where patient_id = ${ok.patient_id}) l`;
      const k = kids[0];
      check(
        k.a === 1 && k.c === 1 && k.m === 1 && k.al === 1 && k.ct === 1 && k.n === 1 && k.l === 1,
        "every child row lands in the same transaction",
        `allergy ${k.a} cond ${k.c} med ${k.m} alert ${k.al} contact ${k.ct} note ${k.n} link ${k.l}`,
      );

      /**
       * Safety-item deletion must match the item AND the patient. Matching on
       * the item alone would let a forged request remove an entry from a
       * DIFFERENT patient of the same doctor, while the audit event recorded
       * the submitted (wrong) patient.
       */
      const [victim] = await tx`
        select id from public.patient_allergies where patient_id = ${ok.patient_id} limit 1`;
      const wrongPatient = await tx`
        delete from public.patient_allergies
        where id = ${victim.id} and patient_id = ${patientA.id}
        returning id`;
      check(
        wrongPatient.length === 0,
        "deleting an item under the WRONG patient id removes nothing",
      );

      const rightPatient = await tx`
        delete from public.patient_allergies
        where id = ${victim.id} and patient_id = ${ok.patient_id}
        returning id`;
      check(rightPatient.length === 1, "deleting with the correct patient id works");
    });

    // ---- 2. Doctor B is fully isolated -------------------------------------
    console.log("\nCross-doctor isolation");
    await as(tx, uidB, async () => {
      const rows = await tx`select count(*)::int n from public.patients where id = ${patientA.id}`;
      check(rows[0].n === 0, "Doctor B cannot read Doctor A's patient");

      const all = await tx`select count(*)::int n from public.patients`;
      check(all[0].n === 0, "Doctor B's patient list excludes Doctor A entirely");

      // Attempting to claim ownership must be rejected by WITH CHECK.
      const blocked = await expectDenied(
        tx,
        (sp) => sp`insert into public.patients
                     (owner_doctor_id, patient_number, full_name, name_normalized)
                   values (${docA.id}, 'AA-999999', 'Stolen', 'stolen')`,
      );
      check(blocked, "Doctor B cannot insert into Doctor A's repository");

      const upd = await tx`update public.patients set full_name = 'Tampered'
                           where id = ${patientA.id} returning id`;
      check(upd.length === 0, "Doctor B cannot update Doctor A's patient");
    });

    // ---- 3. Same human, two doctors, two records ---------------------------
    console.log("\nSame human under two doctors");
    let patientB;
    await as(tx, uidB, async () => {
      const [num] = await tx`select public.next_patient_number(${docB.id}) as n`;
      [patientB] = await tx`
        insert into public.patients
          (owner_doctor_id, patient_number, full_name, name_normalized,
           phone, phone_normalized, sex, created_by)
        values (${docB.id}, ${num.n}, 'Rahim Hossain', 'rahim hossain',
                '01711000124', '01711000124', 'MALE', ${uidB})
        returning id`;
      check(
        Boolean(patientB?.id) && patientB.id !== patientA.id,
        "same person under Doctor B is a separate record",
      );

      // Duplicate detection must not see Doctor A's identical patient.
      const dupes = await tx`
        select count(*)::int n from public.patients
        where phone_normalized = '01711000124'`;
      check(dupes[0].n === 1, "duplicate detection never crosses doctors", `saw ${dupes[0].n}`);
    });

    // ---- 4. patient_account_id must not grant anything ---------------------
    console.log("\npatient_account_id is not an authorization boundary");
    const sharedAccount = crypto.randomUUID();
    await tx`update public.patients set patient_account_id = ${sharedAccount}
             where id in (${patientA.id}, ${patientB.id})`;
    await as(tx, uidB, async () => {
      const rows = await tx`
        select count(*)::int n from public.patients
        where patient_account_id = ${sharedAccount}`;
      check(
        rows[0].n === 1,
        "a shared account link does not expose the other doctor's record",
        `saw ${rows[0].n}`,
      );
    });

    // ---- 5. Location-scoped staff access -----------------------------------
    console.log("\nStaff access is location-scoped");
    // Doctor A links the patient to the hospital only, not the private chamber.
    await as(tx, uidA, async () => {
      await tx`insert into public.patient_location_links (patient_id, practice_location_id)
               values (${patientA.id}, ${hospital.id})`;
    });

    let chamberOnlyPatient;
    await as(tx, uidA, async () => {
      const [num] = await tx`select public.next_patient_number(${docA.id}) as n`;
      [chamberOnlyPatient] = await tx`
        insert into public.patients
          (owner_doctor_id, patient_number, full_name, name_normalized, created_by)
        values (${docA.id}, ${num.n}, 'Private Patient', 'private patient', ${uidA})
        returning id`;
      await tx`insert into public.patient_location_links (patient_id, practice_location_id)
               values (${chamberOnlyPatient.id}, ${chamber.id})`;
    });

    await as(tx, uidR, async () => {
      const seen = await tx`select count(*)::int n from public.patients where id = ${patientA.id}`;
      check(seen[0].n === 1, "reception sees a patient linked to their own location");

      const hidden = await tx`
        select count(*)::int n from public.patients where id = ${chamberOnlyPatient.id}`;
      check(
        hidden[0].n === 0,
        "reception CANNOT see the doctor's private-chamber patient",
        `saw ${hidden[0].n}`,
      );

      // Reception may read a safety flag but never author clinical content.
      const allergyBlocked = await expectDenied(
        tx,
        (sp) => sp`insert into public.patient_allergies (patient_id, substance)
                   values (${patientA.id}, 'Penicillin')`,
      );
      check(allergyBlocked, "reception cannot author clinical content (allergies)");

      /**
       * Reception once had read access to EVERY patient child table, which
       * meant an antiretroviral in the medication list disclosed the patient's
       * HIV status to whoever was on the front desk. These four assertions
       * exist so that cannot silently come back.
       */
      const conditions = await tx`
        select count(*)::int n from public.patient_conditions where patient_id = ${patientA.id}`;
      check(conditions[0].n === 0, "reception CANNOT read conditions (a diagnosis)");

      const meds = await tx`
        select count(*)::int n from public.patient_medications where patient_id = ${patientA.id}`;
      check(meds[0].n === 0, "reception CANNOT read medications (reveals diagnosis)");

      const alerts = await tx`
        select count(*)::int n from public.patient_alerts where patient_id = ${patientA.id}`;
      check(alerts[0].n === 0, "reception CANNOT read alerts (free clinical text)");

      const allergies = await tx`
        select count(*)::int n from public.patient_allergies where patient_id = ${patientA.id}`;
      check(allergies[0].n === 1, "reception CAN still read the drug-allergy safety flag");

      /**
       * RLS filters rows, not columns — so free-text clinical notes on the
       * patients row were readable by anyone allowed to see the row at all.
       * They now live in their own doctor-only table.
       */
      const notes = await tx`
        select count(*)::int n from public.patient_private_notes where patient_id = ${patientA.id}`;
      check(notes[0].n === 0, "reception CANNOT read private clinical notes");
    });

    // A LOCATION_ADMIN is operational and gets nothing clinical — matching the
    // permission matrix, which the earlier policy did not.
    console.log("\nLocation admin is operational, not clinical");
    await as(tx, uidM, async () => {
      const seen = await tx`select count(*)::int n from public.patients where id = ${patientA.id}`;
      check(seen[0].n === 1, "admin can see the patient exists (operational)");

      const allergies = await tx`
        select count(*)::int n from public.patient_allergies where patient_id = ${patientA.id}`;
      check(allergies[0].n === 0, "admin CANNOT read allergies");

      const notes = await tx`
        select count(*)::int n from public.patient_private_notes where patient_id = ${patientA.id}`;
      check(notes[0].n === 0, "admin CANNOT read private clinical notes");

      const meds = await tx`
        select count(*)::int n from public.patient_medications where patient_id = ${patientA.id}`;
      check(meds[0].n === 0, "admin CANNOT read medications");
    });

    // ---- 6. Patient number allocation is concurrency-safe ------------------
    console.log("\nPatient number allocation");
    await as(tx, uidA, async () => {
      const [a] = await tx`select public.next_patient_number(${docA.id}) as n`;
      const [b] = await tx`select public.next_patient_number(${docA.id}) as n`;
      check(a.n !== b.n, "consecutive allocations never collide", `${a.n} vs ${b.n}`);
    });

    await as(tx, uidB, async () => {
      const blocked = await expectDenied(
        tx,
        (sp) => sp`select public.next_patient_number(${docA.id})`,
      );
      check(blocked, "a doctor cannot allocate numbers for another doctor");
    });

    // ---- 7. anon reaches nothing -------------------------------------------
    console.log("\nAnonymous access");
    const anonBlocked = await expectDenied(tx, async (sp) => {
      await sp`set local role anon`;
      await sp`select count(*) from public.patients`;
    });
    check(anonBlocked, "anon cannot read patients at all");

    throw new Error("__rollback__");
  });
} catch (e) {
  if (e.message !== "__rollback__") {
    check(false, "verification run", e.message);
  }
}

await sql.end();

console.log(
  failures.length === 0
    ? "\nAll patient isolation checks passed.\n"
    : `\n${failures.length} CHECK(S) FAILED:\n  - ${failures.join("\n  - ")}\n`,
);
process.exit(failures.length === 0 ? 0 : 1);
