import assert from "node:assert/strict";
import {
  sql, createDoctorAt, createPatient, createFinalizedPrescription,
  asAuthenticated, closeSql,
} from "./lib.mjs";

let passed = 0;
const pass = (label) => { passed += 1; console.log(`PASS HISTORY SHAPE ${passed}: ${label}`); };

async function history(profileId, query = null, limit = 25) {
  return asAuthenticated(profileId, async (tx) => tx`select * from public.prescription_signed_medicine_history(
    'RECENT'::text,${query}::text,${limit}::integer
  )`);
}

async function snapshotFor(prescriptionId) {
  const [row] = await sql`select review_bundle_snapshot from public.prescriptions where id=${prescriptionId}`;
  return row.review_bundle_snapshot;
}

async function setSnapshot(prescriptionId, snapshot) {
  await sql`update public.prescriptions set review_bundle_snapshot=${sql.json(snapshot)} where id=${prescriptionId}`;
}

async function liveCount(prescriptionId) {
  const [row] = await sql`select count(*)::integer as count from public.prescription_items where prescription_id=${prescriptionId}`;
  return row.count;
}

async function malformedFixture(doctor, patient, label, mutate) {
  const rx = await createFinalizedPrescription(doctor, patient, {
    items: [{
      displayName: label,
      brandName: `${label}Brand`,
      genericName: `${label}Generic`,
      strengthText: "500 mg",
      doseText: "1 tablet",
      dosageForm: "Tablet",
      route: "Oral",
      scheduleText: "1+0+1",
      durationText: "5 days",
      quantityText: "10",
      foodRelation: "AFTER_FOOD",
      isPrn: false,
      instructions: `${label} instructions`,
      substitutionAllowed: true,
      position: 1,
    }],
  });
  const snapshot = structuredClone(await snapshotFor(rx.id));
  mutate(snapshot.items[0], snapshot);
  await setSnapshot(rx.id, snapshot);
  assert.equal(await liveCount(rx.id), 1, `${label}: live row must still exist`);
  return rx;
}

async function assertMalformedExcluded(doctor, patient, label, mutate) {
  const rx = await malformedFixture(doctor, patient, label, mutate);
  const rows = await history(doctor.profileId, label, 25);
  assert.equal(rows.length, 0, `${label}: malformed snapshot must be excluded despite live row`);
  return rx;
}

try {
  const doctor = await createDoctorAt("history-shape");
  const patient = await createPatient(doctor, "History Shape Patient", [doctor.locationId]);
  const malformedNames = [];

  malformedNames.push("ShapeMissingNullable");
  await assertMalformedExcluded(doctor, patient, "ShapeMissingNullable", (item) => { delete item.brand_name; });
  pass("missing nullable text key excludes the whole signed prescription");

  malformedNames.push("ShapeMissingStrength");
  await assertMalformedExcluded(doctor, patient, "ShapeMissingStrength", (item) => { delete item.strength_text; });
  pass("missing strength_text excludes signed-history authority");

  malformedNames.push("ShapeMissingSchedule");
  await assertMalformedExcluded(doctor, patient, "ShapeMissingSchedule", (item) => { delete item.schedule_text; });
  pass("missing schedule_text excludes signed-history authority");

  malformedNames.push("ShapeMissingPrn");
  await assertMalformedExcluded(doctor, patient, "ShapeMissingPrn", (item) => { delete item.is_prn; });
  pass("missing is_prn excludes signed-history authority");

  malformedNames.push("ShapeNullPrn");
  await assertMalformedExcluded(doctor, patient, "ShapeNullPrn", (item) => { item.is_prn = null; });
  pass("null is_prn excludes signed-history authority");

  malformedNames.push("ShapeMissingSubstitution");
  await assertMalformedExcluded(doctor, patient, "ShapeMissingSubstitution", (item) => { delete item.substitution_allowed; });
  pass("missing substitution_allowed excludes signed-history authority");

  malformedNames.push("ShapeNullSubstitution");
  await assertMalformedExcluded(doctor, patient, "ShapeNullSubstitution", (item) => { item.substitution_allowed = null; });
  pass("null substitution_allowed excludes signed-history authority");

  malformedNames.push("ShapeMissingPosition");
  await assertMalformedExcluded(doctor, patient, "ShapeMissingPosition", (item) => { delete item.position; });
  pass("missing position excludes signed-history authority");

  malformedNames.push("ShapeFractionalPosition");
  await assertMalformedExcluded(doctor, patient, "ShapeFractionalPosition", (item) => { item.position = 1.5; });
  pass("non-integer JSON-number position excludes signed-history authority");

  malformedNames.push("ShapeMissingDisplay");
  await assertMalformedExcluded(doctor, patient, "ShapeMissingDisplay", (item) => { delete item.display_name; });
  pass("missing display_name excludes signed-history authority");

  malformedNames.push("ShapeBlankDisplay");
  await assertMalformedExcluded(doctor, patient, "ShapeBlankDisplay", (item) => { item.display_name = "   "; });
  pass("blank display_name excludes signed-history authority");

  const mixed = await createFinalizedPrescription(doctor, patient, {
    items: [
      {
        displayName: "ShapeMixedValid", brandName: "MixedValidBrand", genericName: "MixedValidGeneric",
        strengthText: "100 mg", doseText: "1", dosageForm: "Tablet", route: "Oral",
        scheduleText: "OD", durationText: "3 days", quantityText: "3", foodRelation: null,
        isPrn: false, instructions: null, substitutionAllowed: true, position: 1,
      },
      {
        displayName: "ShapeMixedMalformed", brandName: "MixedBadBrand", genericName: "MixedBadGeneric",
        strengthText: "200 mg", doseText: "1", dosageForm: "Tablet", route: "Oral",
        scheduleText: "BD", durationText: "4 days", quantityText: "8", foodRelation: null,
        isPrn: false, instructions: null, substitutionAllowed: true, position: 2,
      },
    ],
  });
  const mixedSnapshot = structuredClone(await snapshotFor(mixed.id));
  delete mixedSnapshot.items[1].strength_text;
  await setSnapshot(mixed.id, mixedSnapshot);
  assert.equal(await liveCount(mixed.id), 2);
  assert.equal((await history(doctor.profileId, "ShapeMixedValid", 25)).length, 0);
  assert.equal((await history(doctor.profileId, "ShapeMixedMalformed", 25)).length, 0);
  malformedNames.push("ShapeMixedValid", "ShapeMixedMalformed");
  pass("one malformed item excludes the entire prescription, including otherwise-valid sibling items");

  malformedNames.push("ShapeWrongNullableType");
  await assertMalformedExcluded(doctor, patient, "ShapeWrongNullableType", (item) => { item.instructions = false; });
  pass("nullable text key with non-string/non-null JSON type excludes signed-history authority");

  const negativePosition = await createFinalizedPrescription(doctor, patient, {
    items: [{
      displayName: "ShapeNegativePositionAccepted", brandName: null, genericName: null,
      strengthText: null, doseText: null, dosageForm: null, route: null,
      scheduleText: null, durationText: null, quantityText: null, foodRelation: null,
      isPrn: false, instructions: null, substitutionAllowed: true, position: -1,
    }],
  });
  assert.ok(negativePosition.id);
  const negativeRows = await history(doctor.profileId, "ShapeNegativePositionAccepted", 25);
  assert.equal(negativeRows.length, 1);
  assert.equal(negativeRows[0].display_name, "ShapeNegativePositionAccepted");
  pass("existing integer position contract is preserved without inventing a positivity rule");

  for (const name of malformedNames) {
    assert.equal((await history(doctor.profileId, name, 25)).length, 0, `${name}: malformed live row must never become fallback authority`);
  }
  pass("all malformed snapshot cases retain zero live prescription_items fallback authority");

  console.log(`M3_HISTORY_SHAPE_MATRIX_PASS count=${passed}`);
  assert.equal(passed, 15);
} finally {
  await closeSql();
}
