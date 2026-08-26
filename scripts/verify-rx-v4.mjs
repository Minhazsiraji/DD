/**
 * Prescription V2 — module configuration, saved phrases, and the v4 bundle.
 *
 * Executed against the real database and rolled back. The questions are the
 * ones that decide whether a doctor can trust the paper: can another doctor
 * read or rewrite my layout, does my configuration actually change what prints,
 * does a value I recorded survive to the page unchanged, and does a module I
 * chose NOT to print stay out of the snapshot entirely.
 */
import postgres from "postgres";
import crypto from "node:crypto";

const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error("DIRECT_URL or DATABASE_URL must be set.");
  process.exit(1);
}

const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });

let failures = 0;
function check(ok, label, detail = "") {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

async function as(tx, uid, fn) {
  await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: uid, role: "authenticated" })}, true)`;
  await tx`select set_config('role', 'authenticated', true)`;
  try {
    return await fn();
  } finally {
    await tx`select set_config('role', null, true)`;
    await tx`select set_config('request.jwt.claims', null, true)`;
  }
}

async function refused(tx, label, fn) {
  try {
    await tx.savepoint(async (sp) => {
      await fn(sp);
      throw new Error("__ALLOWED__");
    });
    check(false, label, "allowed");
  } catch (e) {
    check(!/__ALLOWED__/.test(e.message), label, /__ALLOWED__/.test(e.message) ? "allowed" : "refused");
  }
}

const uid = () => crypto.randomUUID();

/** A doctor with one chamber, one patient, one encounter and one prescription. */
async function seedDoctor(tx, tag) {
  const user = uid();
  await tx`insert into auth.users (id, email, encrypted_password, email_confirmed_at,
                                   confirmation_token, recovery_token,
                                   email_change_token_new, email_change)
           values (${user}, ${`v4.${user.slice(0, 8)}@qa.invalid`}, '', now(), '', '', '', '')`;
  await tx`insert into public.profiles (id, full_name) values (${user}, ${`Dr ${tag}`})`;
  const [doc] = await tx`insert into public.doctor_profiles (user_id, patient_number_prefix)
                         values (${user}, ${tag.slice(0, 2).toUpperCase()}) returning id`;
  const [loc] = await tx`insert into public.practice_locations (name, type, district, created_by)
                         values (${`${tag} Chamber`}, 'CLINIC', 'Dhaka', ${user}) returning id`;
  await tx`insert into public.practice_location_members (practice_location_id, user_id, role, status)
           values (${loc.id}, ${user}, 'DOCTOR', 'ACTIVE')`;
  return { user, doctor: doc.id, location: loc.id };
}

await sql
  .begin(async (tx) => {
    console.log("\nFixture");
    const A = await seedDoctor(tx, "Alpha");
    const B = await seedDoctor(tx, "Bravo");

    const reception = uid();
    await tx`insert into auth.users (id, email, encrypted_password, email_confirmed_at,
                                     confirmation_token, recovery_token,
                                     email_change_token_new, email_change)
             values (${reception}, ${`v4.desk.${reception.slice(0, 6)}@qa.invalid`}, '', now(), '', '', '', '')`;
    await tx`insert into public.profiles (id, full_name) values (${reception}, 'Reception V4')`;
    await tx`insert into public.practice_location_members (practice_location_id, user_id, role, status)
             values (${A.location}, ${reception}, 'RECEPTIONIST', 'ACTIVE')`;
    check(true, "two doctors and a receptionist");

    console.log("\nDefaults reproduce today's output until the doctor changes something");
    const defaults = await as(tx, A.user, () => tx`select * from public.doctor_rx_modules()`);
    check(defaults.length === 12, "every module is resolved, even untouched ones", `${defaults.length}`);
    const printed = defaults.filter((m) => m.show_on_print).map((m) => m.module);
    check(
      printed.includes("DIAGNOSIS") && printed.includes("INVESTIGATIONS") && printed.includes("ADVICE"),
      "diagnosis, investigations and advice print by default",
    );
    check(
      !printed.includes("ALLERGY") && !printed.includes("LONG_TERM_MEDICINES"),
      "patient-level facts are OFF by default",
    );
    check(
      !printed.includes("HISTORY") && !printed.includes("EXAMINATION"),
      "narrative sections are recorded but not printed by default",
    );

    console.log("\nOwnership");
    await as(tx, A.user, () =>
      tx`select public.save_rx_modules(${sql.json([
        { module: "DIAGNOSIS", useDuringConsultation: true, showOnPrint: true, position: 1, printLabel: "Dx" },
      ])})`);

    await as(tx, B.user, async () => {
      const rows = await tx`select * from public.doctor_prescription_modules`;
      check(rows.length === 0, "doctor B cannot read doctor A's module rows", `${rows.length} rows`);
    });

    const bMods = await as(tx, B.user, () => tx`select * from public.doctor_rx_modules()`);
    check(
      bMods.find((m) => m.module === "DIAGNOSIS").print_label === null,
      "…and B's own resolved config is untouched by A's label",
    );

    await refused(tx, "reception has no prescription layout to save", (sp) =>
      as(sp, reception, () => sp`select public.save_rx_modules(${sql.json([
        { module: "DIAGNOSIS", showOnPrint: false },
      ])})`),
    );

    await refused(tx, "a doctor cannot INSERT a module row directly", (sp) =>
      as(sp, A.user, () =>
        sp`insert into public.doctor_prescription_modules (doctor_profile_id, module)
           values (${A.doctor}, 'ADVICE')`),
    );
    await refused(tx, "…nor UPDATE one", (sp) =>
      as(sp, A.user, () => sp`update public.doctor_prescription_modules set show_on_print = true`),
    );

    console.log("\nA print label is a heading on a clinical document");
    await refused(tx, "markup in a label is refused, not escaped", (sp) =>
      as(sp, A.user, () => sp`select public.save_rx_modules(${sql.json([
        { module: "ADVICE", showOnPrint: true, printLabel: "<b>Advice</b>" },
      ])})`),
    );
    await refused(tx, "…and an over-long label is refused", (sp) =>
      as(sp, A.user, () => sp`select public.save_rx_modules(${sql.json([
        { module: "ADVICE", showOnPrint: true, printLabel: "x".repeat(41) },
      ])})`),
    );

    console.log("\nSaved phrases");
    await as(tx, A.user, () => tx`select public.save_rx_phrase('ADVICE', 'Bed rest')`);
    await as(tx, A.user, () => tx`select public.save_rx_phrase('ADVICE', 'Bed  rest')`);
    const phrases = await as(tx, A.user, () => tx`select * from public.doctor_phrases`);
    check(phrases.length === 1, "spacing does not create a duplicate phrase", `${phrases.length} row(s)`);
    check(phrases[0].usage_count === 2, "…the existing one is counted instead", `count ${phrases[0].usage_count}`);
    check(phrases[0].text === "Bed rest", "…and the text is stored exactly as first typed", phrases[0].text);

    await as(tx, B.user, async () => {
      const rows = await tx`select * from public.doctor_phrases`;
      check(rows.length === 0, "doctor B cannot see doctor A's phrases", `${rows.length} rows`);
    });

    await refused(tx, "reception keeps no phrases", (sp) =>
      as(sp, reception, () => sp`select public.save_rx_phrase('ADVICE', 'Nope')`),
    );

    console.log("\nThe v4 bundle");

    const [pat] = await tx`
      insert into public.patients (owner_doctor_id, full_name, name_normalized, patient_number,
                                   sex, approx_age_years, dob_precision, age_recorded_on)
      values (${A.doctor}, 'V4 Patient', 'v4 patient', 'V4-000001', 'FEMALE', 42, 'AGE_ONLY',
              current_date) returning id`;

    const [enc] = await tx`
      insert into public.encounters (owner_doctor_id, practice_location_id, patient_id, status,
        chief_complaints, symptoms, examination, advice, next_visit_note, next_visit_on,
        vital_systolic, vital_diastolic, vital_temperature_c, vital_weight_kg, vital_height_cm)
      values (${A.doctor}, ${A.location}, ${pat.id}, 'DRAFT',
        'Fever for 4 days', 'Dry cough', 'Chest clear', 'Plenty of fluids',
        'with reports', current_date + 3,
        120, 80, 38.4, 100, 160)
      returning id`;

    await tx`insert into public.encounter_investigations (encounter_id, name, position)
             values (${enc.id}, 'CBC', 1)`;
    await tx`insert into public.patient_allergies (patient_id, substance, reaction)
             values (${pat.id}, 'Penicillin', 'Rash')`;

    const [rx] = await tx`
      insert into public.prescriptions (owner_doctor_id, practice_location_id, patient_id,
                                        encounter_id, status)
      values (${A.doctor}, ${A.location}, ${pat.id}, ${enc.id}, 'DRAFT') returning id`;
    await tx`insert into public.prescription_items
               (prescription_id, display_name, strength_text, position)
             values (${rx.id}, 'Tab. Napa', '500g', 1)`;

    await as(tx, A.user, () => tx`select public.save_rx_modules(${sql.json([
      { module: "CHIEF_COMPLAINT", useDuringConsultation: true, showOnPrint: true, position: 10 },
      { module: "VITALS", useDuringConsultation: true, showOnPrint: true, position: 20 },
      { module: "EXAMINATION", useDuringConsultation: true, showOnPrint: false, position: 30 },
      { module: "INVESTIGATIONS", useDuringConsultation: true, showOnPrint: true, position: 40, printLabel: "Tests" },
      { module: "ALLERGY", useDuringConsultation: true, showOnPrint: true, position: 5 },
    ])})`);

    const [built] = await as(tx, A.user, () =>
      tx`select public.prescription_review_bundle(${rx.id}, ${A.location}) as r`);
    const bundle = built.r.bundle;
    const sections = bundle.sections;
    const byModule = Object.fromEntries(sections.map((s) => [s.module, s]));

    check(bundle.schemaVersion === 4, "is schema version 4", String(bundle.schemaVersion));
    check(bundle.layout === "two-column", "…and declares its layout", bundle.layout);

    check(
      sections[0].module === "ALLERGY",
      "sections follow the DOCTOR's order, not a built-in one",
      sections.map((s) => s.module).join(" → "),
    );
    check(byModule.INVESTIGATIONS?.label === "Tests", "a custom label is frozen with the section");

    /**
     * The whole point of two independent switches: recorded, not printed, and
     * therefore ABSENT from the object reception sees at handover.
     */
    check(!byModule.EXAMINATION, "a module with print OFF is absent from the bundle entirely");
    check(!byModule.ASSESSMENT, "…and so is one the doctor never filled in");

    const vitals = byModule.VITALS?.pairs ?? [];
    const asText = vitals.map((p) => `${p.label} ${p.value}`).join(" · ");
    check(vitals.length > 0, "vitals are compact label/value pairs", asText);
    check(
      vitals.some((p) => p.label === "Wt" && p.value === "100 kg"),
      "…and 100 kg prints as 100 kg",
      vitals.find((p) => p.label === "Wt")?.value ?? "(absent)",
    );
    check(
      vitals.some((p) => p.label === "Ht" && p.value === "160 cm"),
      "…and 160 cm prints as 160 cm",
      vitals.find((p) => p.label === "Ht")?.value ?? "(absent)",
    );
    check(
      vitals.some((p) => p.label === "T" && p.value === "38.4°C"),
      "…and a real decimal is not truncated",
      vitals.find((p) => p.label === "T")?.value ?? "(absent)",
    );
    check(!vitals.some((p) => p.label === "P"), "…an unrecorded vital is omitted, not placeholdered");
    check(!vitals.some((p) => p.label === "BMI"), "…and no BMI is invented at print time");

    check(
      byModule.ALLERGY?.items?.[0]?.text === "Penicillin",
      "a printed patient-level fact is FROZEN into the bundle by value",
    );

    check(bundle.items[0].strength_text === "500g", "`500g` reaches the bundle as `500g`");

    console.log("\nHistorical rendering does not depend on today's template");
    const digestBefore = built.r.digest;
    await as(tx, A.user, () => tx`select public.save_rx_modules(${sql.json([
      { module: "CHIEF_COMPLAINT", useDuringConsultation: true, showOnPrint: false, position: 10 },
    ])})`);
    const [rebuilt] = await as(tx, A.user, () =>
      tx`select public.prescription_review_bundle(${rx.id}, ${A.location}) as r`);

    /**
     * A DRAFT legitimately follows the current template — it has not been
     * approved yet. What must not move is a FINALISED snapshot, and that is
     * guaranteed by `review_bundle_snapshot` storing this whole object rather
     * than by anything re-resolving later.
     */
    check(
      rebuilt.r.digest !== digestBefore,
      "a draft re-resolves against the current template, as it should",
    );
    check(
      !rebuilt.r.bundle.sections.some((s) => s.module === "CHIEF_COMPLAINT"),
      "…the newly hidden module drops out of the draft",
    );

    throw new Error("__ROLLBACK_ALL__");
  })
  .catch((e) => {
    if (!/__ROLLBACK_ALL__/.test(e.message)) {
      console.error("\nverification aborted:", e.message);
      failures += 1;
    }
  });

console.log(
  failures === 0 ? "\nPrescription V2: all checks passed.\n" : `\n${failures} CHECK(S) FAILED.\n`,
);

await sql.end();
process.exit(failures === 0 ? 0 : 1);
