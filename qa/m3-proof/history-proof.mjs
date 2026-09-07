import assert from "node:assert/strict";
import {
  sql, createDoctorAt, createPatient, createFinalizedPrescription,
  createDraftPrescription, addPrescriptionItems, asAuthenticated,
  asAuthenticatedWithoutUser, createProfile, expectError, closeSql,
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

function comparableRow(row) {
  if (!row) return row;
  return {
    display_name: row.display_name,
    brand_name: row.brand_name,
    generic_name: row.generic_name,
    strength_text: row.strength_text,
    dose_text: row.dose_text,
    dosage_form: row.dosage_form,
    route: row.route,
    schedule_text: row.schedule_text,
    duration_text: row.duration_text,
    quantity_text: row.quantity_text,
    food_relation: row.food_relation,
    is_prn: row.is_prn,
    instructions: row.instructions,
    substitution_allowed: row.substitution_allowed,
    last_used: row.last_used ? new Date(row.last_used).toISOString() : null,
    times_used: row.times_used,
  };
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
  await createFinalizedPrescription(doctor, patient, {
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
  pass("display-name lexical search uses signed wording");

  const brandSearch = await history(doctor.profileId, "RECENT", "Moxacil", 25);
  assert.equal(brandSearch.length, 1);
  assert.equal(brandSearch[0].display_name, "Amoxicillin");
  pass("brand lexical search uses signed wording");

  const genericSearch = await history(doctor.profileId, "RECENT", "historic-generic-key", 25);
  assert.equal(genericSearch.length, 1);
  assert.equal(genericSearch[0].display_name, "Amoxicillin");
  pass("generic lexical search uses signed wording");

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
  pass("duplicate medicine lines in one signed Rx count as one Rx");

  const recentOrder = await history(doctor.profileId, "RECENT", null, 25);
  assert.equal(recentOrder[0].display_name, "RecentDrug");
  pass("Recent ranks latest signed use first");

  const frequentOrder = await history(doctor.profileId, "FREQUENT", null, 25);
  assert.equal(frequentOrder[0].display_name, "FrequentDrug");
  pass("Frequent ranks distinct signed-Rx count first");

  const tieRecent = await history(doctor.profileId, "RECENT", "Tie", 25);
  assert.deepEqual(tieRecent.map((x) => x.display_name), ["AlphaTie", "BetaTie"]);
  const tieFrequent = await history(doctor.profileId, "FREQUENT", "Tie", 25);
  assert.deepEqual(tieFrequent.map((x) => x.display_name), ["AlphaTie", "BetaTie"]);
  pass("recency/name tie-break deterministic");

  assert.equal(amoxRow.strength_text, "625 mg latest");
  assert.equal(amoxRow.brand_name, "LatestBrand");
  assert.equal(amoxRow.generic_name, "amoxicillin-latest");
  pass("latest wording comes from most recent eligible signed snapshot");

  assert.equal(brandSearch[0].times_used, 3);
  assert.equal(brandSearch[0].brand_name, "LatestBrand");
  assert.equal(genericSearch[0].times_used, 3);
  assert.equal(genericSearch[0].generic_name, "amoxicillin-latest");
  pass("historical signed brand/generic discovery does not narrow total distinct-Rx frequency");

  const [historyAcl] = await sql`select
    has_function_privilege('authenticated','public.prescription_signed_medicine_history(text,text,integer)','EXECUTE') as auth_execute,
    has_function_privilege('anon','public.prescription_signed_medicine_history(text,text,integer)','EXECUTE') as anon_execute,
    has_function_privilege('service_role','public.prescription_signed_medicine_history(text,text,integer)','EXECUTE') as service_execute`;
  assert.equal(historyAcl.auth_execute, true);
  assert.equal(historyAcl.anon_execute, false);
  assert.equal(historyAcl.service_execute, false);
  const [historyPublicAcl] = await sql`select coalesce(bool_or(x.grantee=0),false) as public_execute
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    left join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) x on true
    where n.nspname='public' and p.proname='prescription_signed_medicine_history'`;
  assert.equal(historyPublicAcl.public_execute, false);
  pass("signed-history RPC ACL is authenticated-only with no PUBLIC/anon/service_role shortcut");

  // -----------------------------------------------------------------------
  // Central M3-BF-02-SEC-01 immutable-snapshot drift matrix.
  // -----------------------------------------------------------------------
  const napaOlder = await createFinalizedPrescription(doctor, patient, {
    finalizedAt: new Date(now - 760_000),
    items: [{
      displayName: "Napa", brandName: "SignedBrandOld", genericName: "SignedGenericOld",
      strengthText: "100 mg", doseText: "1", dosageForm: "Tablet", route: "Oral",
      scheduleText: "OD", durationText: "5 days", quantityText: "5",
      foodRelation: "AFTER_FOOD", isPrn: false, instructions: "Signed old instructions",
      substitutionAllowed: true, position: 1,
    }],
  });
  const napaLatest = await createFinalizedPrescription(doctor, patient, {
    finalizedAt: new Date(now - 700_000),
    items: [{
      displayName: "Napa", brandName: "SignedBrandLatest", genericName: "SignedGenericLatest",
      strengthText: "200 mg", doseText: "2", dosageForm: "Tablet", route: "Oral",
      scheduleText: "BD", durationText: "7 days", quantityText: "14",
      foodRelation: "BEFORE_FOOD", isPrn: true, instructions: "Signed latest instructions",
      substitutionAllowed: false, position: 1,
    }],
  });

  const napaRecentBefore = await history(doctor.profileId, "RECENT", null, 25);
  const napaFrequentBefore = await history(doctor.profileId, "FREQUENT", null, 25);
  const signedNapaBefore = findByName(napaRecentBefore, "Napa");
  assert.ok(signedNapaBefore);
  assert.equal(signedNapaBefore.brand_name, "SignedBrandLatest");
  assert.equal(signedNapaBefore.generic_name, "SignedGenericLatest");
  assert.equal(signedNapaBefore.strength_text, "200 mg");
  assert.equal(signedNapaBefore.schedule_text, "BD");
  assert.equal(signedNapaBefore.duration_text, "7 days");
  assert.equal(signedNapaBefore.times_used, 2);
  pass("immutable-snapshot drift baseline uses latest signed snapshot and two distinct signed prescriptions");

  // A. Privileged mutation of live finalized rows must have zero authority.
  await sql`update public.prescription_items set
    display_name='TamperedDrug',
    brand_name='TamperedBrand',
    generic_name='TamperedGeneric',
    strength_text='999 mg UNSIGNED',
    schedule_text='TAMPERED SCHEDULE',
    duration_text='TAMPERED DURATION'
    where id=${napaLatest.items[0].id}`;

  const napaAfterMutation = findByName(await history(doctor.profileId, "RECENT", "Napa", 25), "Napa");
  assert.equal(napaAfterMutation.display_name, "Napa");
  assert.equal(napaAfterMutation.brand_name, "SignedBrandLatest");
  assert.equal(napaAfterMutation.generic_name, "SignedGenericLatest");
  assert.equal(napaAfterMutation.strength_text, "200 mg");
  assert.equal(napaAfterMutation.schedule_text, "BD");
  assert.equal(napaAfterMutation.duration_text, "7 days");
  assert.equal(napaAfterMutation.dose_text, "2");
  assert.equal(napaAfterMutation.dosage_form, "Tablet");
  assert.equal(napaAfterMutation.route, "Oral");
  assert.equal(napaAfterMutation.quantity_text, "14");
  assert.equal(napaAfterMutation.food_relation, "BEFORE_FOOD");
  assert.equal(napaAfterMutation.is_prn, true);
  assert.equal(napaAfterMutation.instructions, "Signed latest instructions");
  assert.equal(napaAfterMutation.substitution_allowed, false);
  pass("live field mutation cannot change any signed-history medicine wording");

  // B. Search is over signed snapshot terms only.
  assert.equal((await history(doctor.profileId, "RECENT", "TamperedDrug", 25)).length, 0);
  assert.equal((await history(doctor.profileId, "RECENT", "Napa", 25))[0]?.display_name, "Napa");
  pass("live display-name drift is invisible to search while signed display name remains discoverable");

  assert.equal((await history(doctor.profileId, "RECENT", "TamperedBrand", 25)).length, 0);
  assert.equal((await history(doctor.profileId, "RECENT", "SignedBrandLatest", 25))[0]?.display_name, "Napa");
  pass("live brand drift is invisible to search while signed brand remains discoverable");

  assert.equal((await history(doctor.profileId, "RECENT", "TamperedGeneric", 25)).length, 0);
  assert.equal((await history(doctor.profileId, "RECENT", "SignedGenericLatest", 25))[0]?.display_name, "Napa");
  pass("live generic drift is invisible to search while signed generic remains discoverable");

  // C. A live-only row added after finalization is not signed history.
  await addPrescriptionItems(napaLatest.id, [{
    displayName: "LiveOnlyExtra", brandName: "LiveOnlyBrand", genericName: "LiveOnlyGeneric",
    strengthText: "777 mg", scheduleText: "LIVE ONLY", durationText: "forever", position: 99,
  }]);
  assert.equal((await history(doctor.profileId, "RECENT", "LiveOnlyExtra", 25)).length, 0);
  assert.equal((await history(doctor.profileId, "RECENT", "LiveOnlyBrand", 25)).length, 0);
  assert.equal((await history(doctor.profileId, "RECENT", "LiveOnlyGeneric", 25)).length, 0);
  pass("live extra finalized-row medicine never appears in signed history or signed search");

  // D. Removing the live row cannot erase the signed snapshot medicine.
  await sql`delete from public.prescription_items where id=${napaLatest.items[0].id}`;
  const napaAfterDelete = findByName(await history(doctor.profileId, "RECENT", "Napa", 25), "Napa");
  assert.ok(napaAfterDelete);
  assert.equal(napaAfterDelete.strength_text, "200 mg");
  assert.equal(napaAfterDelete.brand_name, "SignedBrandLatest");
  pass("live deletion cannot erase medicine preserved in immutable signed snapshot");

  // E. Live duplicate/tampered/deleted rows have zero effect on Recent/Frequent
  // output and COUNT(DISTINCT signed finalized prescriptions).
  const napaRecentAfter = await history(doctor.profileId, "RECENT", null, 25);
  const napaFrequentAfter = await history(doctor.profileId, "FREQUENT", null, 25);
  assert.deepEqual(napaRecentAfter.map(comparableRow), napaRecentBefore.map(comparableRow));
  assert.deepEqual(napaFrequentAfter.map(comparableRow), napaFrequentBefore.map(comparableRow));
  assert.equal(findByName(napaFrequentAfter, "Napa")?.times_used, 2);
  pass("live drift/duplicates/deletion leave Recent, Frequent, lastUsed and distinct signed-Rx frequency unchanged");

  // F. Invalid snapshot authority must be safely excluded, never replaced by
  // the still-present live prescription_items representation.
  const invalidSnapshotRx = await createFinalizedPrescription(doctor, patient, {
    finalizedAt: new Date(now - 650_000),
    items: [{ displayName: "InvalidSnapshotAuthority", brandName: "InvalidSnapshotBrand", position: 1 }],
  });
  const [invalidSnapshotOriginal] = await sql`select review_bundle_snapshot from public.prescriptions where id=${invalidSnapshotRx.id}`;

  const [constraintAgain] = await sql`select pg_get_constraintdef(oid) as def
    from pg_constraint where conrelid='public.prescriptions'::regclass and conname='prescriptions_finalized_is_complete'`;
  assert.ok(constraintAgain?.def);
  await sql.unsafe(`alter table public.prescriptions drop constraint prescriptions_finalized_is_complete`);

  await sql`update public.prescriptions
    set review_bundle_snapshot=jsonb_build_object('schemaVersion',4,'items',jsonb_build_object('display_name','InvalidSnapshotAuthority'))
    where id=${invalidSnapshotRx.id}`;
  assert.equal((await history(doctor.profileId, "RECENT", "InvalidSnapshotAuthority", 25)).length, 0);
  assert.equal((await history(doctor.profileId, "RECENT", "InvalidSnapshotBrand", 25)).length, 0);
  pass("non-array finalized snapshot items are excluded with no live-row fallback");

  await sql`update public.prescriptions
    set review_bundle_snapshot=${sql.json({ schemaVersion: 4, items: [{ display_name: 123, brand_name: "MalformedBrand", position: "1" }] })}
    where id=${invalidSnapshotRx.id}`;
  assert.equal((await history(doctor.profileId, "RECENT", "MalformedBrand", 25)).length, 0);
  assert.equal((await history(doctor.profileId, "RECENT", "InvalidSnapshotAuthority", 25)).length, 0);
  pass("malformed signed item representation is safely excluded and never substitutes live medicine rows");

  await sql`update public.prescriptions set review_bundle_snapshot=${invalidSnapshotOriginal.review_bundle_snapshot} where id=${invalidSnapshotRx.id}`;
  await sql.unsafe(`alter table public.prescriptions add constraint prescriptions_finalized_is_complete ${constraintAgain.def}`);

  // Keep these live-fixture ids referenced so accidental helper refactors cannot
  // silently remove one half of the two-prescription frequency proof.
  assert.ok(napaOlder.id && napaLatest.id);

  console.log(`M3_HISTORY_MATRIX_PASS count=${passed}`);
  assert.equal(passed, 27);
} finally {
  await closeSql();
}
