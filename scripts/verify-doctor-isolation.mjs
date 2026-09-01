/**
 * Doctor isolation: one doctor's repository is not another's.
 *
 * The case that matters is the ordinary one — TWO DOCTORS AT THE SAME HOSPITAL.
 * Both are active members of the location, so any policy that authorises on
 * membership alone admits the wrong one. That is exactly what happened: Dr B
 * could read Dr A's patient, their allergies and their contacts.
 *
 * `patients.owner_doctor_id` is the ownership boundary. The same human seen by
 * two doctors is TWO records, and cross-doctor sharing must be explicit,
 * consented and audited — never ambient.
 *
 * Executed as the real `authenticated` role inside ONE transaction that is
 * ALWAYS rolled back.
 *
 *   node --env-file=.env.local scripts/verify-doctor-isolation.mjs
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
const uidB = crypto.randomUUID();
const uidR = crypto.randomUUID();
const uidM = crypto.randomUUID();

try {
  await sql.begin(async (tx) => {
    for (const [uid, name] of [
      [uidA, "Dr A"],
      [uidB, "Dr B"],
      [uidR, "Reception"],
      [uidM, "Admin"],
    ]) {
      await tx`insert into auth.users (id, email) values (${uid}, ${`${uid}@qa.invalid`})`;
      await tx`insert into public.profiles (id, full_name) values (${uid}, ${name})`;
    }

    const [docA] = await tx`
      insert into public.doctor_profiles (user_id, patient_number_prefix, bmdc_registration_no)
      values (${uidA}, 'IA', ${"QI" + crypto.randomBytes(3).toString("hex")}) returning id`;
    await tx`insert into public.doctor_profiles (user_id, patient_number_prefix,
                bmdc_registration_no)
             values (${uidB}, 'IB', ${"QJ" + crypto.randomBytes(3).toString("hex")})`;

    // ONE shared hospital. Both doctors practise here — the ordinary case.
    const [hosp] = await tx`
      insert into public.practice_locations (name, type, created_by)
      values ('QA Isolation Hospital', 'HOSPITAL', ${uidA}) returning id`;
    await tx`insert into public.practice_location_members
               (practice_location_id, user_id, role, status)
             values (${hosp.id}, ${uidA}, 'DOCTOR', 'ACTIVE'),
                    (${hosp.id}, ${uidB}, 'DOCTOR', 'ACTIVE'),
                    (${hosp.id}, ${uidR}, 'RECEPTIONIST', 'ACTIVE'),
                    (${hosp.id}, ${uidM}, 'LOCATION_ADMIN', 'ACTIVE')`;

    const [pat] = await tx`
      insert into public.patients (owner_doctor_id, patient_number, full_name,
                                   name_normalized, sex, created_by)
      values (${docA.id}, 'IA-000001', 'Private Patient', 'private patient', 'FEMALE', ${uidA})
      returning id`;
    await tx`insert into public.patient_location_links (patient_id, practice_location_id)
             values (${pat.id}, ${hosp.id})`;
    await tx`insert into public.patient_allergies (patient_id, substance, severity, recorded_by)
             values (${pat.id}, 'Penicillin', 'SEVERE', ${uidA})`;
    await tx`insert into public.patient_contacts (patient_id, type, name, phone)
             values (${pat.id}, 'EMERGENCY', 'Next of kin', '+8801700000000')`;

    let enc;
    await as(tx, uidA, async () => {
      const [row] = await tx`select public.open_encounter(${pat.id}, ${hosp.id}, null) as id`;
      enc = row.id;
    });

    const counts = async (uid) =>
      as(tx, uid, async () => ({
        patient: (await tx`select id from public.patients where id = ${pat.id}`).length,
        encounter: (await tx`select id from public.encounters where id = ${enc}`).length,
        allergies:
          (await tx`select id from public.patient_allergies where patient_id = ${pat.id}`).length,
        contacts:
          (await tx`select id from public.patient_contacts where patient_id = ${pat.id}`).length,
      }));

    // -----------------------------------------------------------------------
    console.log("\nThe owning doctor keeps their own record");
    // -----------------------------------------------------------------------
    const a = await counts(uidA);
    check(a.patient === 1, "Dr A reads their own patient");
    check(a.encounter === 1, "…their own encounter");
    check(a.allergies === 1, "…their own patient's allergies");
    check(a.contacts === 1, "…their own patient's contacts");

    // -----------------------------------------------------------------------
    console.log("\nA DIFFERENT doctor at the SAME hospital reads nothing");
    // -----------------------------------------------------------------------
    /**
     * Dr B is an ACTIVE member of this location, so every policy that
     * authorises on membership alone admits them. That was the leak.
     */
    const b = await counts(uidB);
    check(b.patient === 0, "Dr B cannot read Dr A's patient", `${b.patient} row(s)`);
    check(b.encounter === 0, "…nor the encounter", `${b.encounter} row(s)`);
    check(b.allergies === 0, "…nor the allergies", `${b.allergies} row(s)`);
    check(b.contacts === 0, "…nor the contacts", `${b.contacts} row(s)`);

    let wrote;
    await as(tx, uidB, async () => {
      try {
        const r = await tx`
          update public.patient_contacts set phone = '+880000'
          where patient_id = ${pat.id} returning id`;
        wrote = r.length;
      } catch {
        wrote = 0;
      }
    });
    check(wrote === 0, "…and cannot write to them either", `${wrote} row(s) updated`);

    // -----------------------------------------------------------------------
    console.log("\nOperational staff keep exactly what they had");
    // -----------------------------------------------------------------------
    /**
     * The fix must not be paid for by reception. They still see the patient and
     * the contact details they need to run a desk — and still see no clinical
     * record, which was never theirs.
     */
    for (const [uid, who] of [
      [uidR, "Reception"],
      [uidM, "Location admin"],
    ]) {
      const s = await counts(uid);
      check(s.patient === 1, `${who} still sees the patient at their location`);
      check(s.contacts === 1, `${who} still sees the contact details`);
      check(s.encounter === 0, `${who} still sees no clinical encounter`);
    }
    const rec = await counts(uidR);
    check(rec.allergies === 1, "Reception keeps the allergy list it already had");
    const adm = await counts(uidM);
    check(
      adm.allergies === 0,
      "…and the location admin gains none, because it never had any",
      `${adm.allergies} row(s)`,
    );

    // -----------------------------------------------------------------------
    console.log("\nNobody else gets in");
    // -----------------------------------------------------------------------
    for (const t of ["patients", "encounters", "patient_allergies"]) {
      let denied = false;
      try {
        await tx.savepoint(async (sp) => {
          await sp`select set_config('request.jwt.claims',
                     ${JSON.stringify({ role: "anon" })}, true)`;
          await sp`set local role anon`;
          await sp.unsafe(`select id from public.${t} limit 1`);
        });
      } catch {
        denied = true;
      }
      await tx`reset role`;
      check(denied, `anonymous cannot read ${t}`);
    }

    /**
     * A platform owner runs the business. That has never included reading a
     * patient, and this fix must not have quietly made it possible.
     */
    const uidO = crypto.randomUUID();
    await tx`insert into auth.users (id, email) values (${uidO}, ${`${uidO}@qa.invalid`})`;
    await tx`insert into public.profiles (id, full_name) values (${uidO}, 'Platform Owner')`;
    const ownerTable = await tx`
      select count(*)::int as n from information_schema.tables
      where table_schema = 'public' and table_name = 'platform_owners'`;
    if (ownerTable[0].n === 1) {
      await tx`insert into public.platform_owners (user_id) values (${uidO})
               on conflict do nothing`;
    }
    const o = await counts(uidO);
    check(
      o.patient === 0 && o.encounter === 0 && o.allergies === 0 && o.contacts === 0,
      "a platform owner reads no clinical row",
      `p${o.patient} e${o.encounter} a${o.allergies} c${o.contacts}`,
    );

    // -----------------------------------------------------------------------
    console.log("\nNo policy authorises on membership alone");
    // -----------------------------------------------------------------------
    /**
     * The shape that caused this: a location-membership branch with no ROLE
     * constraint. Held here so it cannot come back by another route.
     */
    const loose = await tx`
      select tablename, policyname from pg_policies
      where schemaname = 'public'
        and tablename in ('patients', 'patient_allergies', 'patient_contacts',
                          'patient_conditions', 'patient_medications', 'patient_alerts',
                          'patient_private_notes', 'encounters')
        and qual is not null
        and qual like '%practice_location_members%'
        and qual not like '%role%'`;
    check(
      loose.length === 0,
      "no clinical policy matches any active member regardless of role",
      loose.map((r) => `${r.tablename}.${r.policyname}`).join(", ") || "none",
    );

    const withDoctor = await tx`
      select tablename, policyname from pg_policies
      where schemaname = 'public'
        and tablename like 'patient%'
        and qual like '%can_access_patient_as%'
        and qual like '%DOCTOR%'`;
    check(
      withDoctor.length === 0,
      "no allowlist names DOCTOR — the owner is already admitted before it",
      withDoctor.map((r) => `${r.tablename}.${r.policyname}`).join(", ") || "none",
    );

    throw new Error("ROLLBACK");
  });
} catch (e) {
  if (e.message !== "ROLLBACK") {
    console.error(`\nverification aborted: ${e.message}`);
    failures.push("run aborted");
  }
}

const [left] = await sql`
  select count(*)::int as n from auth.users where id in (${uidA}, ${uidB}, ${uidR}, ${uidM})`;
check(left.n === 0, "every row rolled back — nothing left behind");

await sql.end();

if (failures.length) {
  console.error(`\n${failures.length} FAILED:`);
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}
console.log("\nDoctor isolation: all checks passed. Every row rolled back.\n");
