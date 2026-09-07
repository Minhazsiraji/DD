import assert from "node:assert/strict";
import {
  sql, createDoctorAt, createPatient, createFinalizedPrescription,
  createDraftPrescription, asAuthenticated, asAuthenticatedWithoutUser,
  createProfile, expectError, closeSql,
} from "./lib.mjs";

let passed = 0;
const pass = (label) => { passed += 1; console.log(`PASS HISTORY ${passed}: ${label}`); };

async function history(profileId, order = "RECENT", query = null, limit = 25) {
  return asAuthenticated(profileId, async (tx) => tx`select * from public.prescription_signed_medicine_history(
    ${order}::text,${query}::text,${limit}::integer
  )`);
}

function findByName(rows, name) {
  return rows.find((r) => r.display_name === name);
}

try {
  const doctor = await createDoctorAt("history-main");
  const patient = await createPatient(doctor, "History Patient", [doctor.locationId]);
  const now = Date.now();

  const nonDoctor = await createProfile("history-nondoctor", "QA Non Doctor");
  await expectError(asAuthenticatedWithoutUser(async (tx) => tx`select * from public.prescription_signed_medicine_history('RECENT',null,8)`), /not a doctor/, "unauthenticated history");
  await expectError(history(nonDoctor.id), /not a doctor/, "non-Doctor history");
  pass("unauthenticated/non-Doctor rejected");

  await createDraftPrescription(doctor, patient, {
    items: [{ displayName: "DraftExcluded", brandName: "DraftBrand", genericName: "DraftGeneric", position: 1 }],
  });

  const otherDoctor = await createDoctorAt("history-other");
  const otherPatient = await createPatient(otherDoctor, "Other History Patient", [otherDoctor.locationId]);
  await createFinalizedPrescription(otherDoctor, otherPatient, {
    finalizedAt: new Date(now - 1_000),
    items: [{ displayName: "OtherDoctorOnly", position: 1 }],
  });

  await createFinalizedPrescription(doctor, patient, {
    finalizedAt: new Date(now - 500_000),
    items: [
      { displayName: "Amoxicillin", brandName: "Moxacil", genericName: "historic-generic-key", strengthText: "250 mg", position: 1 },
      { displayName: "Amoxicillin", brandName: "Moxacil Duplicate", genericName: "historic-generic-key", strengthText: "250 mg", position: 2 },
    ],
  });
  await createFinalizedPrescription(doctor, patient, {
    finalizedAt: new Date(now - 400_000),
    items: [{ displayName: "Amoxicillin", brandName: "MiddleBrand", genericName: "amoxicillin-middle", strengthText: "500 mg", position: 1 }],
  });
  const amoxLatest = await createFinalizedPrescription(doctor, patient, {
    finalizedAt: new Date(now - 300_000),
    items: [{ displayName: "Amoxicillin", brandName: "LatestBrand", genericName: "amoxicillin-latest", strengthText: "625 mg latest", position: 1 }],
  });

  for (let i = 0; i < 4; i += 1) {
    await createFinalizedPrescription(doctor, patient, {
      finalizedAt: new Date(now - 900_000 + i * 10_000),
      items: [{ displayName: "FrequentDrug", brandName: `FreqBrand${i}`, genericName: "frequent-generic", position: 1 }],
    });
  }
  await createFinalizedPrescription(doctor, patient, {
    finalizedAt: new Date(now - 10_000),
    items: [{ displayName: "RecentDrug", brandName: "RecentBrand", genericName: "recent-generic", position: 1 }],
  });

  const tieAt = new Date(now - 200_000);
  await createFinalizedPrescription(doctor, patient, {
    finalizedAt: tieAt,
    items: [{ displayName: "AlphaTie", position: 1 }],
  });
  await createFinalizedPrescription(doctor, patient, {
    finalizedAt: tieAt,
    items: [{ displayName: "BetaTie", position: 1 }],
  });

  const allRecent = await history(doctor.profileId, "RECENT", null, 25);
  assert.equal(findByName(allRecent, "DraftExcluded"), undefined);
  pass("DRAFT prescription rows excluded");

  assert.equal(findByName(allRecent, "OtherDoctorOnly"), undefined);
  pass("other Doctor history excluded");

  assert.ok(findByName(allRecent, "Amoxicillin"));
  assert.ok(findByName(allRecent, "FrequentDrug"));
  assert.ok(findByName(allRecent, "RecentDrug"));
  pass("FINALIZED history only");

  const invalid = await createFinalizedPrescription(doctor, patient, {
    finalizedAt: new Date(now - 50_000),
    items: [{ displayName: "InvalidFinalizationState", position: 1 }],
  });
  const [constraint] = await sql`select pg_get_constraintdef(oid) as def
    from pg_constraint where conrelid='public.prescriptions'::regclass and conname='prescriptions_finalized_is_complete'`;
  assert.ok(constraint?.def);
  await sql.unsafe(`alter table public.prescriptions drop constraint prescriptions_finalized_is_complete`);
  await sql`update public.prescriptions set review_digest=null where id=${invalid.id}`;
  const invalidFiltered = await history(doctor.profileId, "RECENT", "InvalidFinalizationState", 25);
  assert.equal(invalidFiltered.length, 0);
  await sql`update public.prescriptions set review_digest=${`qa-digest-${invalid.id}`} where id=${invalid.id}`;
  await sql.unsafe(`alter table public.prescriptions add constraint prescriptions_finalized_is_complete ${constraint.def}`);
  pass("invalid/null finalization state excluded");

  const displaySearch = await history(doctor.profileId, "RECENT", "RecentDrug", 25);
  assert.equal(displaySearch.length, 1);
  assert.equal(displaySearch[0].display_name, "RecentDrug");
  pass("display-name lexical search");

  const brandSearch = await history(doctor.profileId, "RECENT", "Moxacil", 25);
  assert.equal(brandSearch.length, 1);
  assert.equal(brandSearch[0].display_name, "Amoxicillin");
  pass("brand lexical search");

  const genericSearch = await history(doctor.profileId, "RECENT", "historic-generic-key", 25);
  assert.equal(genericSearch.length, 1);
  assert.equal(genericSearch[0].display_name, "Amoxicillin");
  pass("generic lexical search");

  const [beforeCounts] = await sql`select
    (select count(*)::integer from public.prescriptions) as prescriptions,
    (select count(*)::integer from public.prescription_items) as items,
    (select count(*)::integer from public.prescription_events) as events,
    (select count(*)::integer from public.audit_events) as audits`;
  await history(doctor.profileId, "FREQUENT", "Amoxicillin", 25);
  const [afterCounts] = await sql`select
    (select count(*)::integer from public.prescriptions) as prescriptions,
    (select count(*)::integer from public.prescription_items) as items,
    (select count(*)::integer from public.prescription_events) as events,
    (select count(*)::integer from public.audit_events) as audits`;
  assert.deepEqual(afterCounts, beforeCounts);
  pass("search performs no clinical write");

  const amoxRow = findByName(await history(doctor.profileId, "FREQUENT", "Amoxicillin", 25), "Amoxicillin");
  assert.equal(amoxRow.times_used, 3);
  pass("timesUsed equals COUNT(DISTINCT source_prescription_id)");

  assert.equal(amoxRow.times_used, 3, "duplicate same-Rx line must not increment distinct Rx count");
  pass("duplicate medicine lines in one Rx count as one Rx");

  const recentOrder = await history(doctor.profileId, "RECENT", null, 25);
  assert.equal(recentOrder[0].display_name, "RecentDrug");
  pass("Recent ranks latest signed use first");

  const frequentOrder = await history(doctor.profileId, "FREQUENT", null, 25);
  assert.equal(frequentOrder[0].display_name, "FrequentDrug");
  pass("Frequent ranks distinct-Rx count first");

  const tieRecent = await history(doctor.profileId, "RECENT", "Tie", 25);
  assert.deepEqual(tieRecent.map((x) => x.display_name), ["AlphaTie", "BetaTie"]);
  const tieFrequent = await history(doctor.profileId, "FREQUENT", "Tie", 25);
  assert.deepEqual(tieFrequent.map((x) => x.display_name), ["AlphaTie", "BetaTie"]);
  pass("recency/name tie-break deterministic");

  assert.equal(amoxRow.strength_text, "625 mg latest");
  assert.equal(amoxRow.brand_name, "LatestBrand");
  assert.equal(amoxRow.generic_name, "amoxicillin-latest");
  pass("latest signed wording returned");

  assert.equal(brandSearch[0].times_used, 3);
  assert.equal(brandSearch[0].brand_name, "LatestBrand");
  assert.equal(genericSearch[0].times_used, 3);
  assert.equal(genericSearch[0].generic_name, "amoxicillin-latest");
  pass("historical brand/generic match discovers medicine without reducing total distinct-Rx count");

  // Central's explicit STOP condition: the new read must never surface live
  // wording that diverges from the immutable finalized bundle. Synthetic admin
  // corruption is used only in this ephemeral database to prove fail-closed
  // behavior. If the function returns the drifted wording, throw and stop.
  const beforeDrift = await history(doctor.profileId, "RECENT", "Amoxicillin", 25);
  assert.equal(beforeDrift[0].strength_text, "625 mg latest");
  await sql`update public.prescription_items set strength_text='UNSIGNED LIVE DRIFT' where id=${amoxLatest.items[0].id}`;
  const afterDrift = await history(doctor.profileId, "RECENT", "Amoxicillin", 25);
  if (afterDrift[0]?.strength_text === "UNSIGNED LIVE DRIFT") {
    throw new Error("M3_HISTORY_IMMUTABLE_SNAPSHOT_BYPASS: prescription_signed_medicine_history returned live wording that differs from the immutable finalized snapshot");
  }
  assert.equal(afterDrift[0]?.strength_text, "625 mg latest");
  pass("history wording remains consistent with immutable finalized snapshot under privileged live-row drift");

  console.log(`M3_HISTORY_MATRIX_PASS count=${passed}`);
  assert.equal(passed, 16);
} finally {
  await closeSql();
}
