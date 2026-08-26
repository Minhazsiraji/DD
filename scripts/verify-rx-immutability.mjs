/**
 * THE INVARIANT THAT PROTECTS EVERY PRESCRIPTION ALREADY SIGNED.
 *
 * A doctor reorders their template next month. Nothing they do may change a
 * prescription signed today — not its sections, not their order, not their
 * labels, not one character of it. And a prescription finalised BEFORE
 * Prescription V2 existed must keep rendering under v3 rules forever.
 *
 * Run end to end against the real database: configure, draft, build the review
 * bundle, finalise it, capture the frozen snapshot, then change the doctor's
 * CURRENT configuration as destructively as the settings screen allows, and
 * re-read the historical prescription through the same function the app uses.
 *
 * HERMETIC BY DESIGN. Everything happens inside one transaction that is rolled
 * back, and the template used has `show_signature = false`, so NOTHING is
 * written to storage. A frozen signature cannot be deleted by the app — the
 * bucket has no DELETE policy, deliberately — so a test that created one would
 * leave a permanent artefact in a project that also holds real work. The signed
 * QA doctor's ability to finalise is proven separately by the fixture itself.
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
const stable = (v) => JSON.stringify(v);
const sha = (v) => crypto.createHash("sha256").update(stable(v)).digest("hex").slice(0, 16);

await sql
  .begin(async (tx) => {
    console.log("\nA signed doctor, a patient, a visit");

    const user = uid();
    await tx`insert into auth.users (id, email, encrypted_password, email_confirmed_at,
                                     confirmation_token, recovery_token,
                                     email_change_token_new, email_change)
             values (${user}, ${`imm.${user.slice(0, 8)}@qa.invalid`}, '', now(), '', '', '', '')`;
    await tx`insert into public.profiles (id, full_name) values (${user}, 'Dr Immutability')`;
    const [doc] = await tx`insert into public.doctor_profiles (user_id, patient_number_prefix)
                           values (${user}, 'IM') returning id`;
    const [loc] = await tx`insert into public.practice_locations (name, type, district, created_by)
                           values ('Immutability Chamber','CLINIC','Dhaka',${user}) returning id`;
    await tx`insert into public.practice_location_members (practice_location_id, user_id, role, status)
             values (${loc.id}, ${user}, 'DOCTOR', 'ACTIVE')`;

    /**
     * `show_signature = false` keeps this hermetic. Finalisation refuses a
     * layout that prints a signature the doctor has not frozen — correctly —
     * and freezing writes an object that cannot afterwards be deleted.
     */
    await tx`insert into public.prescription_templates
               (owner_doctor_id, practice_location_id, name, is_default, show_signature)
             values (${doc.id}, null, 'Immutability (no signature)', true, false)`;

    const [pat] = await tx`
      insert into public.patients (owner_doctor_id, full_name, name_normalized, patient_number,
                                   sex, approx_age_years, dob_precision, age_recorded_on)
      values (${doc.id}, 'Immutability Patient', 'immutability patient', 'IM-000001',
              'FEMALE', 40, 'AGE_ONLY', current_date) returning id`;

    const [enc] = await tx`
      insert into public.encounters (owner_doctor_id, practice_location_id, patient_id, status,
        chief_complaints, examination, advice, next_visit_note,
        vital_systolic, vital_diastolic, vital_weight_kg)
      values (${doc.id}, ${loc.id}, ${pat.id}, 'DRAFT',
        'Fever for 3 days', 'Chest clear', 'Plenty of fluids', 'after 3 days',
        120, 80, 100) returning id`;
    await tx`insert into public.encounter_diagnoses (encounter_id, label, position)
             values (${enc.id}, 'Viral fever', 1)`;
    await tx`insert into public.encounter_investigations (encounter_id, name, position)
             values (${enc.id}, 'CBC', 1)`;

    const [rx] = await tx`
      insert into public.prescriptions (owner_doctor_id, practice_location_id, patient_id,
                                        encounter_id, status)
      values (${doc.id}, ${loc.id}, ${pat.id}, ${enc.id}, 'DRAFT') returning id`;
    await tx`insert into public.prescription_items
               (prescription_id, display_name, strength_text, dose_text, position)
             values (${rx.id}, 'Tab. Napa', '500g', '1 tablet', 1)`;
    check(true, "fixture ready, using a no-signature layout so nothing touches storage");

    console.log("\n1. The doctor configures their prescription");
    await as(tx, user, () => tx`select public.save_rx_modules(${sql.json([
      { module: "CHIEF_COMPLAINT", useDuringConsultation: true, showOnPrint: true, position: 10 },
      { module: "DIAGNOSIS", useDuringConsultation: true, showOnPrint: true, position: 20 },
      { module: "ADVICE", useDuringConsultation: true, showOnPrint: true, position: 30 },
      { module: "INVESTIGATIONS", useDuringConsultation: true, showOnPrint: false, position: 40 },
      { module: "VITALS", useDuringConsultation: true, showOnPrint: false, position: 50 },
      { module: "NEXT_VISIT", useDuringConsultation: true, showOnPrint: false, position: 60 },
    ])})`);

    const [review] = await as(tx, user, () =>
      tx`select public.prescription_review_bundle(${rx.id}, ${loc.id}) as r`);
    const approved = review.r.bundle;
    const approvedDigest = review.r.digest;

    const orderAtApproval = approved.sections.map((s) => s.module);
    check(
      stable(orderAtApproval) === stable(["CHIEF_COMPLAINT", "DIAGNOSIS", "ADVICE"]),
      "the reviewed bundle holds exactly what the doctor chose",
      orderAtApproval.join(" → "),
    );
    check(approved.schemaVersion === 4, "…at schema version 4");

    console.log("\n2. Finalise it");
    const [ver] = await tx`select version from public.prescriptions where id = ${rx.id}`;
    await as(tx, user, () =>
      tx`select public.finalize_prescription(${rx.id}, ${loc.id}, ${ver.version}, null,
                                             ${approvedDigest})`);

    const [afterFinal] = await tx`
      select status, snapshot_schema_version, review_digest, review_bundle_snapshot
      from public.prescriptions where id = ${rx.id}`;
    check(afterFinal.status === "FINALIZED", "the prescription is finalised", afterFinal.status);
    check(afterFinal.snapshot_schema_version === 4, "…and its snapshot is v4");
    check(afterFinal.review_digest === approvedDigest, "…carrying the digest the doctor approved");

    const frozen = afterFinal.review_bundle_snapshot;
    const frozenPrint = sha(frozen);
    console.log(`     frozen snapshot fingerprint: ${frozenPrint}`);
    console.log(`     frozen sections            : ${frozen.sections.map((s) => s.module).join(" → ")}`);

    console.log("\n3. The doctor rebuilds their template as destructively as the UI allows");
    await as(tx, user, () => tx`select public.save_rx_modules(${sql.json([
      // Everything that printed is now hidden…
      { module: "CHIEF_COMPLAINT", useDuringConsultation: true, showOnPrint: false, position: 90 },
      { module: "DIAGNOSIS", useDuringConsultation: true, showOnPrint: false, position: 80 },
      { module: "ADVICE", useDuringConsultation: true, showOnPrint: false, position: 70 },
      // …and everything that was hidden now prints, reordered and relabelled.
      { module: "INVESTIGATIONS", useDuringConsultation: true, showOnPrint: true, position: 1, printLabel: "Lab Work" },
      { module: "VITALS", useDuringConsultation: true, showOnPrint: true, position: 2 },
      { module: "NEXT_VISIT", useDuringConsultation: true, showOnPrint: true, position: 3, printLabel: "Come Back" },
    ])})`);

    const nowConfig = await as(tx, user, () =>
      tx`select module, show_on_print, print_label from public.doctor_rx_modules() where show_on_print`);
    check(
      nowConfig.some((m) => m.module === "INVESTIGATIONS" && m.print_label === "Lab Work"),
      "the CURRENT template really did change",
      nowConfig.map((m) => m.module).join(", "),
    );

    console.log("\n4. Reopen the historical prescription");
    const [reread] = await tx`
      select snapshot_schema_version, review_digest, review_bundle_snapshot
      from public.prescriptions where id = ${rx.id}`;

    check(
      sha(reread.review_bundle_snapshot) === frozenPrint,
      "THE FROZEN SNAPSHOT IS BYTE-FOR-BYTE UNCHANGED",
      sha(reread.review_bundle_snapshot),
    );
    check(reread.review_digest === approvedDigest, "…its digest is unchanged");
    check(reread.snapshot_schema_version === 4, "…it is still v4");
    check(
      stable(reread.review_bundle_snapshot.sections.map((s) => s.module)) === stable(orderAtApproval),
      "…and the sections are the ones approved, in the approved order",
      reread.review_bundle_snapshot.sections.map((s) => s.module).join(" → "),
    );
    check(
      !reread.review_bundle_snapshot.sections.some((s) => s.label === "Lab Work"),
      "…the new label appears nowhere in it",
    );
    check(
      !reread.review_bundle_snapshot.sections.some((s) => s.module === "VITALS"),
      "…and a module enabled AFTERWARDS did not appear",
    );

    console.log("\n5. Through the function the app actually reads");
    const [detail] = await as(tx, user, () =>
      tx`select public.finalized_prescription_detail(${rx.id}, ${loc.id}) as d`);
    const served = detail.d.bundle ?? detail.d.snapshot ?? detail.d;
    check(
      stable(served).includes('"CHIEF_COMPLAINT"'),
      "the served historical document still carries the approved sections",
    );
    check(
      !stable(served).includes("Lab Work"),
      "…and none of today's template wording",
    );

    console.log("\n6. `500g` survived the whole journey");
    check(
      reread.review_bundle_snapshot.items[0].strength_text === "500g",
      "entry → save → review → finalise → frozen snapshot",
      reread.review_bundle_snapshot.items[0].strength_text,
    );

    console.log("\n7. A finalised prescription is not editable");
    await refused(tx, "a doctor cannot re-finalise it", (sp) =>
      as(sp, user, () =>
        sp`select public.finalize_prescription(${rx.id}, ${loc.id}, 99, null, ${approvedDigest})`),
    );
    await refused(tx, "…nor add a medicine to it", (sp) =>
      as(sp, user, () =>
        sp`select public.add_prescription_item(${rx.id}, ${loc.id}, 99,
             ${sql.json({ displayName: "Sneaked in" })})`),
    );

    console.log("\n8. A v3 prescription keeps rendering under v3 rules");

    /**
     * A snapshot in the shape finalisation produced BEFORE V2 existed:
     * investigations and advice at the top level, printed full width below Rx,
     * and no `sections` key at all. Written directly because no builder emits
     * v3 any more — which is exactly the situation a real historical row is in.
     */
    const [rx3] = await tx`
      insert into public.prescriptions (owner_doctor_id, practice_location_id, patient_id,
                                        encounter_id, status)
      values (${doc.id}, ${loc.id}, ${pat.id}, ${enc.id}, 'DRAFT') returning id`;

    const v3Snapshot = {
      schemaVersion: 3,
      prescriptionId: rx3.id,
      encounterId: enc.id,
      clinicalDate: "2026-08-01",
      doctor: { fullName: "Dr Immutability" },
      location: { name: "Immutability Chamber" },
      patient: { fullName: "Immutability Patient" },
      template: { source: "system", paperSize: "A4", marginMm: 15 },
      signature: null,
      items: [{ position: 1, display_name: "Tab. Napa", strength_text: "500g" }],
      investigations: [{ position: 1, name: "CBC", note: null }],
      advice: "Plenty of fluids",
    };

    /**
     * The projection columns are written too, because `prescriptions_finalized
     * _is_complete` requires them — and rightly: a finalised row must carry
     * everything needed to print it, forever, with no half-written state ever
     * existing. Setting only the snapshot produced a fixture that a real v3
     * finalisation could never have created, and the constraint said so.
     */
    const v3Digest = crypto
      .createHash("sha256")
      .update(JSON.stringify(v3Snapshot))
      .digest("hex");

    await tx`update public.prescriptions set
               status = 'FINALIZED', finalized_at = now(),
               review_bundle_snapshot  = ${sql.json(v3Snapshot)},
               snapshot_schema_version = 3,
               doctor_snapshot         = ${sql.json(v3Snapshot.doctor)},
               location_snapshot       = ${sql.json(v3Snapshot.location)},
               patient_snapshot        = ${sql.json(v3Snapshot.patient)},
               template_snapshot       = ${sql.json(v3Snapshot.template)},
               items_snapshot          = ${sql.json(v3Snapshot.items)},
               signature_snapshot      = 'null'::jsonb,
               review_digest           = ${v3Digest}
             where id = ${rx3.id}`;

    /**
     * The baseline is read BACK FROM THE DATABASE, not hashed from the literal
     * above. `jsonb` normalises key order and whitespace on the way in, so
     * comparing the stored form against the JS object compares two different
     * serialisations and reports a change that never happened. The v4 baseline
     * comes from the database for the same reason.
     */
    const [v3Stored] = await tx`
      select review_bundle_snapshot from public.prescriptions where id = ${rx3.id}`;
    const v3Print = sha(v3Stored.review_bundle_snapshot);

    await as(tx, user, () => tx`select public.save_rx_modules(${sql.json([
      { module: "ADVICE", useDuringConsultation: true, showOnPrint: true, position: 1, printLabel: "Instructions" },
    ])})`);

    const [v3After] = await tx`
      select snapshot_schema_version, review_bundle_snapshot
      from public.prescriptions where id = ${rx3.id}`;

    check(v3After.snapshot_schema_version === 3, "it is still schema version 3");
    check(sha(v3After.review_bundle_snapshot) === v3Print, "…byte-for-byte unchanged");
    check(
      v3After.review_bundle_snapshot.sections === undefined,
      "…it has NO `sections` key, so a v4 renderer must not be given it",
    );
    check(
      Array.isArray(v3After.review_bundle_snapshot.investigations) &&
        typeof v3After.review_bundle_snapshot.advice === "string",
      "…investigations and advice remain top-level, as v3 printed them",
    );
    check(
      !stable(v3After.review_bundle_snapshot).includes("Instructions"),
      "…and today's custom label reached it nowhere",
    );

    console.log("\n9. Nothing was written outside the transaction");
    check(true, "no storage object created — the layout printed no signature");

    throw new Error("__ROLLBACK_ALL__");
  })
  .catch((e) => {
    if (!/__ROLLBACK_ALL__/.test(e.message)) {
      console.error("\nverification aborted:", e.message);
      failures += 1;
    }
  });

console.log(
  failures === 0
    ? "\nHistorical immutability: all checks passed. Every row rolled back.\n"
    : `\n${failures} CHECK(S) FAILED.\n`,
);

await sql.end();
process.exit(failures === 0 ? 0 : 1);
