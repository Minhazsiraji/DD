/**
 * Consultation adoption: Symptoms, Next Visit, and the doctor's own configuration.
 *
 * Three questions, and the middle one is the dangerous one:
 *
 *   1. Do the two modules that could only ever print empty now have a way in?
 *   2. Does a follow-up DATE survive as the day the doctor chose — under any
 *      session timezone, from either side of the world?
 *   3. Is a doctor's section configuration theirs alone?
 *
 * Executed as the real `authenticated` role inside ONE transaction that is
 * ALWAYS rolled back. It writes no storage object and leaves nothing behind.
 *
 *   node --env-file=.env.local scripts/verify-consultation-adoption.mjs
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

async function refused(tx, fn) {
  try {
    await tx.savepoint(fn);
    return null;
  } catch (e) {
    return e.message ?? "refused";
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

const uidA = crypto.randomUUID();
const uidB = crypto.randomUUID();

/** The exact strings under test. Nothing here may be normalised on the way in. */
const SYMPTOMS = "জ্বর ৩ দিন, গলা ব্যথা — 500g sugar/week";
const NOTE = "With reports · if the fever returns";
const DATE = "2026-09-02";

try {
  await sql.begin(async (tx) => {
    for (const [uid, name] of [
      [uidA, "Dr Adopt A"],
      [uidB, "Dr Adopt B"],
    ]) {
      await tx`insert into auth.users (id, email) values (${uid}, ${`${uid}@qa.invalid`})`;
      await tx`insert into public.profiles (id, full_name) values (${uid}, ${name})`;
    }

    const [docA] = await tx`insert into public.doctor_profiles (user_id, patient_number_prefix)
                            values (${uidA}, 'CA') returning id`;
    const [docB] = await tx`insert into public.doctor_profiles (user_id, patient_number_prefix)
                            values (${uidB}, 'CB') returning id`;

    const [loc] = await tx`
      insert into public.practice_locations (name, type, created_by)
      values ('QA Adoption Chamber', 'PERSONAL_CHAMBER', ${uidA}) returning id`;
    await tx`insert into public.practice_location_members
               (practice_location_id, user_id, role, status)
             values (${loc.id}, ${uidA}, 'DOCTOR', 'ACTIVE'),
                    (${loc.id}, ${uidB}, 'DOCTOR', 'ACTIVE')`;

    const [pat] = await tx`
      insert into public.patients (owner_doctor_id, patient_number, full_name,
                                   name_normalized, sex, created_by)
      values (${docA.id}, 'CA-900001', 'Adoption Patient', 'adoption patient', 'FEMALE', ${uidA})
      returning id`;
    await tx`insert into public.patient_location_links (patient_id, practice_location_id)
             values (${pat.id}, ${loc.id})`;

    let enc;
    await as(tx, uidA, async () => {
      const [row] = await tx`select public.open_encounter(${pat.id}, ${loc.id}, null) as id`;
      enc = row.id;
    });

    // -----------------------------------------------------------------------
    console.log("\nSymptoms and Next Visit finally have a way in");
    // -----------------------------------------------------------------------
    await as(tx, uidA, async () => {
      const [v] = await tx`
        select public.save_encounter_sections(${enc}, ${loc.id}, 1, ${tx.json({
          symptoms: SYMPTOMS,
          nextVisitNote: NOTE,
          nextVisitOn: DATE,
        })}) as version`;
      check(v.version === 2, "the draft accepted all three and advanced one version", `v${v.version}`);
    });

    const [saved] = await tx`
      select symptoms, next_visit_note, next_visit_on::text as next_visit_on
      from public.encounters where id = ${enc}`;
    check(saved.symptoms === SYMPTOMS, "symptoms stored byte-for-byte, Bangla and 500g included");
    check(saved.next_visit_note === NOTE, "the follow-up note stored exactly");
    check(saved.next_visit_on === DATE, "the follow-up date stored exactly", saved.next_visit_on);

    // -----------------------------------------------------------------------
    console.log("\nThe follow-up date is a day, not an instant");
    // -----------------------------------------------------------------------
    /**
     * THE TEST THIS SCRIPT EXISTS FOR.
     *
     * `'2026-09-02T00:00:00Z'::date` resolves through the SESSION timezone. A
     * doctor in Dhaka (UTC+6) choosing the 2nd could have the 1st stored, and
     * nothing would look wrong anywhere. So the same write is replayed from
     * both ends of the world and must produce the identical day.
     */
    for (const zone of ["Asia/Dhaka", "Pacific/Kiritimati", "Pacific/Midway", "UTC"]) {
      await tx`select set_config('TimeZone', ${zone}, true)`;
      let version;
      await as(tx, uidA, async () => {
        const [v] = await tx`
          select public.save_encounter_sections(${enc}, ${loc.id},
            (select version from public.encounters where id = ${enc}),
            ${tx.json({ nextVisitOn: DATE })}) as version`;
        version = v.version;
      });
      const [r] = await tx`
        select next_visit_on::text as d from public.encounters where id = ${enc}`;
      check(r.d === DATE, `stored as ${DATE} with the session in ${zone}`, `${r.d} (v${version})`);
    }
    await tx`select set_config('TimeZone', 'UTC', true)`;

    for (const bad of [
      "2026-09-02T00:00:00Z",
      "2026-09-02T18:30:00+06:00",
      "2026-09-02 00:00:00",
      "02/09/2026",
      "2026-9-2",
      "2026-02-31",
    ]) {
      let msg;
      await as(tx, uidA, async () => {
        msg = await refused(tx, (t) =>
          t`select public.save_encounter_sections(${enc}, ${loc.id},
              (select version from public.encounters where id = ${enc}),
              ${tx.json({ nextVisitOn: bad })})`,
        );
      });
      check(msg !== null, `refused rather than coerced: ${bad}`);
    }

    // Clearing is still possible — a follow-up can be withdrawn.
    await as(tx, uidA, async () => {
      await tx`select public.save_encounter_sections(${enc}, ${loc.id},
                 (select version from public.encounters where id = ${enc}),
                 ${tx.json({ nextVisitOn: "" })})`;
    });
    const [cleared] = await tx`select next_visit_on from public.encounters where id = ${enc}`;
    check(cleared.next_visit_on === null, "an emptied date clears the follow-up");

    // And a note may stand without a date, which is a real consultation.
    check(
      (await tx`select next_visit_note from public.encounters where id = ${enc}`)[0]
        .next_visit_note === NOTE,
      "…and the note survives on its own, with no date beside it",
    );

    // -----------------------------------------------------------------------
    console.log("\nNo shadow storage: the columns that already existed are the ones written");
    // -----------------------------------------------------------------------
    const [cols] = await tx`
      select count(*)::int as n from information_schema.columns
      where table_schema = 'public' and table_name = 'encounters'
        and column_name in ('symptoms', 'next_visit_note', 'next_visit_on')`;
    check(cols.n === 3, "all three live on `encounters`, where the bundle already reads them");

    const [dupes] = await tx`
      select count(*)::int as n from information_schema.tables
      where table_schema = 'public'
        and table_name in ('encounter_symptoms', 'encounter_next_visit', 'followups')`;
    check(dupes.n === 0, "no second table was invented for either of them");

    // -----------------------------------------------------------------------
    console.log("\nA section configuration belongs to one doctor");
    // -----------------------------------------------------------------------
    await as(tx, uidA, async () => {
      await tx`select public.save_rx_modules(${tx.json([
        { module: "EXAMINATION", useDuringConsultation: false, showOnPrint: false, position: 10 },
        { module: "SYMPTOMS", useDuringConsultation: true, showOnPrint: true, position: 20 },
      ])})`;
    });

    const rowsA = await as(tx, uidA, () => tx`select * from public.doctor_rx_modules()`);
    const rowsB = await as(tx, uidB, () => tx`select * from public.doctor_rx_modules()`);

    const exA = rowsA.find((r) => r.module === "EXAMINATION");
    const exB = rowsB.find((r) => r.module === "EXAMINATION");
    check(exA.use_during_consultation === false, "Dr A's Examination is off, as Dr A set it");
    check(exB.use_during_consultation === true, "…and Dr B still has the default, untouched");

    const syA = rowsA.find((r) => r.module === "SYMPTOMS");
    const syB = rowsB.find((r) => r.module === "SYMPTOMS");
    check(syA.use_during_consultation === true, "Dr A turned Symptoms on");
    check(syB.use_during_consultation === false, "…and Dr B's Symptoms is still off by default");
    check(rowsA.length === 12 && rowsB.length === 12, "both doctors see all twelve modules");

    const [mine] = await tx`
      select count(*)::int as n from public.doctor_prescription_modules
      where doctor_profile_id = ${docB.id}`;
    check(mine.n === 0, "Dr A's save wrote nothing against Dr B");

    // A doctor cannot write another's configuration: there is no id to pass.
    const [args] = await tx`
      select pg_get_function_identity_arguments(p.oid) as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'save_rx_modules'`;
    /**
     * Asserted on the SIGNATURE rather than on behaviour: a defaulted parameter
     * is still a parameter a caller may supply, so the only way to be sure one
     * doctor cannot address another's configuration is for there to be no
     * argument that could name one.
     */
    check(
      !/uuid|doctor/i.test(args.sig),
      "save_rx_modules has no argument that could name a doctor",
      args.sig,
    );

    // -----------------------------------------------------------------------
    console.log("\nConsultation visibility is not print visibility");
    // -----------------------------------------------------------------------
    /**
     * Examination is OFF for the consultation and its text is already saved.
     * The screen must still show it — that is the client rule, tested in
     * `module-visibility.test.ts` — and the PRINT path must be untouched by the
     * consultation flag either way.
     */
    await as(tx, uidA, async () => {
      await tx`select public.save_encounter_sections(${enc}, ${loc.id},
                 (select version from public.encounters where id = ${enc}),
                 ${tx.json({ examination: "Chest clear." })})`;
    });
    const [stillThere] = await tx`select examination from public.encounters where id = ${enc}`;
    check(
      stillThere.examination === "Chest clear.",
      "turning a section off does not remove what it already holds",
    );

    const [builder] = await tx`
      select pg_get_functiondef(p.oid) as src
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'prescription_review_bundle'`;
    check(
      /where show_on_print/.test(builder.src) && !/use_during_consultation/.test(builder.src),
      "the review bundle filters on show_on_print alone, and never reads the other flag",
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
  select count(*)::int as n from auth.users where id in (${uidA}, ${uidB})`;
check(left.n === 0, "every row rolled back — nothing left behind");

await sql.end();

if (failures.length) {
  console.error(`\n${failures.length} FAILED:`);
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}
console.log("\nConsultation adoption: all checks passed. Every row rolled back.");
