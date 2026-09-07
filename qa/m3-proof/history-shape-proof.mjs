import assert from "node:assert/strict";
import {
  sql, createDoctorAt, createPatient, createFinalizedPrescription,
  asAuthenticated, closeSql,
} from "./lib.mjs";

let passed = 0;
const pass = (label) => { passed += 1; console.log(`PASS HISTORY SHAPE ${passed}: ${label}`); };

async function history(profileId, query) {
  return asAuthenticated(profileId, async (tx) => tx`
    select * from public.prescription_signed_medicine_history('RECENT', ${query}::text, 25::integer)
  `);
}

async function expectAbsent(profileId, terms, label) {
  for (const term of terms) {
    const rows = await history(profileId, term);
    assert.equal(rows.length, 0, `${label}: ${term} unexpectedly became signed-history authority`);
  }
  pass(label);
}

async function removeKey(rxId, index, key) {
  await sql`update public.prescriptions
    set review_bundle_snapshot = review_bundle_snapshot #- ARRAY['items', ${String(index)}, ${key}]::text[]
    where id=${rxId}`;
}

async function setJsonNull(rxId, index, key) {
  await sql`update public.prescriptions
    set review_bundle_snapshot = jsonb_set(
      review_bundle_snapshot,
      ARRAY['items', ${String(index)}, ${key}]::text[],
      'null'::jsonb,
      false
    )
    where id=${rxId}`;
}

async function setText(rxId, index, key, value) {
  await sql`update public.prescriptions
    set review_bundle_snapshot = jsonb_set(
      review_bundle_snapshot,
      ARRAY['items', ${String(index)}, ${key}]::text[],
      to_jsonb(${value}::text),
      false
    )
    where id=${rxId}`;
}

async function makeRx(doctor, patient, name, items = null) {
  return createFinalizedPrescription(doctor, patient, {
    finalizedAt: new Date(Date.now() - 60_000),
    items: items ?? [{
      displayName: name,
      brandName: `${name}Brand`,
      genericName: `${name}Generic`,
      strengthText: "100 mg",
      doseText: "1 tablet",
      dosageForm: "Tablet",
      route: "Oral",
      scheduleText: "OD",
      durationText: "5 days",
      quantityText: "5",
      foodRelation: "AFTER_FOOD",
      isPrn: false,
      instructions: "Canonical signed instruction",
      substitutionAllowed: true,
      position: 0,
    }],
  });
}

try {
  const doctor = await createDoctorAt("history-shape");
  const patient = await createPatient(doctor, "History Shape Patient", [doctor.locationId]);

  // 1. Missing nullable text key: key presence itself is canonical.
  const missingNullable = await makeRx(doctor, patient, "ShapeMissingBrand");
  await removeKey(missingNullable.id, 0, "brand_name");
  await expectAbsent(doctor.profileId, ["ShapeMissingBrand", "ShapeMissingBrandBrand"], "missing nullable text key excludes whole prescription");

  // 2. strength_text missing.
  const missingStrength = await makeRx(doctor, patient, "ShapeMissingStrength");
  await removeKey(missingStrength.id, 0, "strength_text");
  await expectAbsent(doctor.profileId, ["ShapeMissingStrength"], "missing strength_text excludes whole prescription");

  // 3. schedule_text missing.
  const missingSchedule = await makeRx(doctor, patient, "ShapeMissingSchedule");
  await removeKey(missingSchedule.id, 0, "schedule_text");
  await expectAbsent(doctor.profileId, ["ShapeMissingSchedule"], "missing schedule_text excludes whole prescription");

  // 4. is_prn missing.
  const missingPrn = await makeRx(doctor, patient, "ShapeMissingPrn");
  await removeKey(missingPrn.id, 0, "is_prn");
  await expectAbsent(doctor.profileId, ["ShapeMissingPrn"], "missing is_prn excludes whole prescription");

  // 5. is_prn JSON null.
  const nullPrn = await makeRx(doctor, patient, "ShapeNullPrn");
  await setJsonNull(nullPrn.id, 0, "is_prn");
  await expectAbsent(doctor.profileId, ["ShapeNullPrn"], "null is_prn excludes whole prescription");

  // 6. substitution_allowed missing.
  const missingSub = await makeRx(doctor, patient, "ShapeMissingSubstitution");
  await removeKey(missingSub.id, 0, "substitution_allowed");
  await expectAbsent(doctor.profileId, ["ShapeMissingSubstitution"], "missing substitution_allowed excludes whole prescription");

  // 7. substitution_allowed JSON null.
  const nullSub = await makeRx(doctor, patient, "ShapeNullSubstitution");
  await setJsonNull(nullSub.id, 0, "substitution_allowed");
  await expectAbsent(doctor.profileId, ["ShapeNullSubstitution"], "null substitution_allowed excludes whole prescription");

  // 8. position missing.
  const missingPosition = await makeRx(doctor, patient, "ShapeMissingPosition");
  await removeKey(missingPosition.id, 0, "position");
  await expectAbsent(doctor.profileId, ["ShapeMissingPosition"], "missing position excludes whole prescription");

  // 9. position is JSON number but non-integer.
  const fractionalPosition = await makeRx(doctor, patient, "ShapeFractionalPosition");
  await sql`update public.prescriptions
    set review_bundle_snapshot = jsonb_set(
      review_bundle_snapshot, ARRAY['items','0','position']::text[], '1.5'::jsonb, false
    ) where id=${fractionalPosition.id}`;
  await expectAbsent(doctor.profileId, ["ShapeFractionalPosition"], "non-integer numeric position excludes whole prescription");

  // 10. display_name missing and blank are both invalid authority.
  const missingDisplay = await makeRx(doctor, patient, "ShapeMissingDisplay");
  await removeKey(missingDisplay.id, 0, "display_name");
  await expectAbsent(doctor.profileId, ["ShapeMissingDisplayBrand", "ShapeMissingDisplayGeneric"], "missing display_name excludes whole prescription");

  const blankDisplay = await makeRx(doctor, patient, "ShapeBlankDisplay");
  await setText(blankDisplay.id, 0, "display_name", "   ");
  await expectAbsent(doctor.profileId, ["ShapeBlankDisplayBrand", "ShapeBlankDisplayGeneric"], "blank display_name excludes whole prescription");

  // 11. One malformed item invalidates the entire finalized Rx, including a valid sibling.
  const mixed = await makeRx(doctor, patient, "unused", [
    {
      displayName: "ShapeValidSibling", brandName: "ShapeValidSiblingBrand", genericName: "ShapeValidSiblingGeneric",
      strengthText: "100 mg", doseText: "1", dosageForm: "Tablet", route: "Oral", scheduleText: "OD",
      durationText: "5 days", quantityText: "5", foodRelation: null, isPrn: false, instructions: null,
      substitutionAllowed: true, position: 0,
    },
    {
      displayName: "ShapeMalformedSibling", brandName: "ShapeMalformedSiblingBrand", genericName: "ShapeMalformedSiblingGeneric",
      strengthText: "200 mg", doseText: "2", dosageForm: "Tablet", route: "Oral", scheduleText: "BD",
      durationText: "7 days", quantityText: "14", foodRelation: null, isPrn: false, instructions: null,
      substitutionAllowed: true, position: 1,
    },
  ]);
  await removeKey(mixed.id, 1, "strength_text");
  await expectAbsent(
    doctor.profileId,
    ["ShapeValidSibling", "ShapeMalformedSibling", "ShapeValidSiblingBrand", "ShapeMalformedSiblingGeneric"],
    "one malformed item excludes the entire finalized prescription rather than partially consuming valid siblings",
  );

  // 12. Malformed snapshot never falls back to live prescription_items.
  const noFallback = await makeRx(doctor, patient, "ShapeNoFallbackSigned");
  await removeKey(noFallback.id, 0, "strength_text");
  await sql`update public.prescription_items set
    display_name='ShapeLiveFallbackOnly',
    brand_name='ShapeLiveFallbackBrand',
    generic_name='ShapeLiveFallbackGeneric'
    where prescription_id=${noFallback.id}`;
  await expectAbsent(
    doctor.profileId,
    ["ShapeNoFallbackSigned", "ShapeLiveFallbackOnly", "ShapeLiveFallbackBrand", "ShapeLiveFallbackGeneric"],
    "malformed signed snapshot never falls back to live medicine rows",
  );

  // Additional canonical-type guard: nullable text must be string or JSON null, never another JSON type.
  const wrongNullableType = await makeRx(doctor, patient, "ShapeWrongNullableType");
  await sql`update public.prescriptions
    set review_bundle_snapshot = jsonb_set(
      review_bundle_snapshot, ARRAY['items','0','strength_text']::text[], '123'::jsonb, false
    ) where id=${wrongNullableType.id}`;
  await expectAbsent(doctor.profileId, ["ShapeWrongNullableType"], "nullable text with non-string/non-null JSON type is excluded");

  console.log(`M3_HISTORY_CANONICAL_SHAPE_PASS count=${passed}`);
  assert.equal(passed, 14);
} finally {
  await closeSql();
}
