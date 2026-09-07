import assert from "node:assert/strict";
import {
  sql, uuid, createDoctorAt, createPatient, createFinalizedPrescription,
  createDraftPrescription, getPrescriptionSnapshot, countItems,
  asAuthenticated, asAuthenticatedWithoutUser, expectError, closeSql,
} from "./lib.mjs";

let passed = 0;
const pass = (label) => { passed += 1; console.log(`PASS REUSE ${passed}: ${label}`); };

async function callReuse(profileId, {
  sourceId, targetId, locationId, expectedVersion = 1,
  mode = "ALL", selectedIds = null, appendConfirmed = false, key = `reuse-${uuid()}`,
}) {
  return asAuthenticated(profileId, async (tx) => {
    const [row] = await tx`select public.reuse_finalized_prescription_items(
      ${sourceId}::uuid,
      ${targetId}::uuid,
      ${locationId}::uuid,
      ${expectedVersion}::integer,
      ${mode}::text,
      ${selectedIds}::uuid[],
      ${appendConfirmed}::boolean,
      ${key}::text
    ) as result`;
    return row.result;
  });
}

try {
  const doctor = await createDoctorAt("reuse-main", { secondLocation: true });
  const patient = await createPatient(doctor, "Reuse Patient", [doctor.locationId, doctor.secondLocationId]);
  const source = await createFinalizedPrescription(doctor, patient, {
    locationId: doctor.secondLocationId,
    items: [
      { displayName: "Medicine C", brandName: "Brand C", position: 30 },
      { displayName: "Medicine A", brandName: "Brand A", position: 10 },
      { displayName: "Medicine B", brandName: "Brand B", position: 20 },
    ],
  });
  const target = await createDraftPrescription(doctor, patient, { locationId: doctor.locationId });

  await expectError(asAuthenticatedWithoutUser(async (tx) => tx`select public.reuse_finalized_prescription_items(
    ${source.id}::uuid,${target.id}::uuid,${doctor.locationId}::uuid,1,'ALL',null,false,'reuse-noauth'
  )`), /only an authenticated doctor/, "authenticated Doctor required");
  pass("authenticated Doctor required");

  const beforeSource = await getPrescriptionSnapshot(source.id);
  const result = await callReuse(doctor.profileId, {
    sourceId: source.id, targetId: target.id, locationId: doctor.locationId, key: "reuse-base-all",
  });
  assert.equal(result.insertedCount, 3);
  pass("same Doctor source/target accepted");

  const otherDoctor = await createDoctorAt("reuse-other");
  const otherPatient = await createPatient(otherDoctor, "Other Patient");
  const otherSource = await createFinalizedPrescription(otherDoctor, otherPatient, {
    items: [{ displayName: "Other Doctor Drug", position: 1 }],
  });
  const otherTarget = await createDraftPrescription(doctor, patient, { locationId: doctor.locationId });
  await expectError(callReuse(doctor.profileId, {
    sourceId: otherSource.id, targetId: otherTarget.id, locationId: doctor.locationId, key: "reuse-other-doc",
  }), /source prescription not found/, "other Doctor source rejected");
  pass("other Doctor source rejected");

  const patient2 = await createPatient(doctor, "Different Patient", [doctor.locationId]);
  const diffPatientSource = await createFinalizedPrescription(doctor, patient2, {
    items: [{ displayName: "Different Patient Drug", position: 1 }],
  });
  const diffPatientTarget = await createDraftPrescription(doctor, patient, { locationId: doctor.locationId });
  await expectError(callReuse(doctor.profileId, {
    sourceId: diffPatientSource.id, targetId: diffPatientTarget.id, locationId: doctor.locationId, key: "reuse-diff-patient",
  }), /source prescription not found/, "same patient required");
  pass("different patient rejected");

  const finalizedTarget = await createFinalizedPrescription(doctor, patient, {
    locationId: doctor.locationId, items: [{ displayName: "Already Final", position: 1 }],
  });
  const freshTargetForFinalSource = await createDraftPrescription(doctor, patient, { locationId: doctor.locationId });
  const finalSourceResult = await callReuse(doctor.profileId, {
    sourceId: source.id, targetId: freshTargetForFinalSource.id, locationId: doctor.locationId, key: "reuse-final-source",
  });
  assert.equal(finalSourceResult.insertedCount, 3);
  pass("FINALIZED source accepted");

  const draftSource = await createDraftPrescription(doctor, patient, {
    locationId: doctor.secondLocationId, items: [{ displayName: "Draft Source", position: 1 }],
  });
  const draftSourceTarget = await createDraftPrescription(doctor, patient, { locationId: doctor.locationId });
  await expectError(callReuse(doctor.profileId, {
    sourceId: draftSource.id, targetId: draftSourceTarget.id, locationId: doctor.locationId, key: "reuse-draft-source",
  }), /source prescription not found/, "DRAFT source rejected");
  pass("DRAFT/non-finalized source rejected");

  const invalidSource = await createFinalizedPrescription(doctor, patient, {
    locationId: doctor.secondLocationId, items: [{ displayName: "Invalid State", position: 1 }],
  });
  const [constraint] = await sql`select pg_get_constraintdef(oid) as def
    from pg_constraint where conrelid='public.prescriptions'::regclass and conname='prescriptions_finalized_is_complete'`;
  assert.ok(constraint?.def);
  await sql.unsafe(`alter table public.prescriptions drop constraint prescriptions_finalized_is_complete`);
  await sql`update public.prescriptions set review_digest=null where id=${invalidSource.id}`;
  const invalidTarget = await createDraftPrescription(doctor, patient, { locationId: doctor.locationId });
  await expectError(callReuse(doctor.profileId, {
    sourceId: invalidSource.id, targetId: invalidTarget.id, locationId: doctor.locationId, key: "reuse-invalid-state",
  }), /PRESCRIPTION_FINALIZATION_STATE_INVALID/, "invalid finalized state fails closed");
  await sql`update public.prescriptions set review_digest=${`qa-digest-${invalidSource.id}`} where id=${invalidSource.id}`;
  await sql.unsafe(`alter table public.prescriptions add constraint prescriptions_finalized_is_complete ${constraint.def}`);
  pass("invalid finalized-state source fails closed");

  const targetMustDraft = await createFinalizedPrescription(doctor, patient, {
    locationId: doctor.locationId, items: [{ displayName: "Target Final", position: 1 }],
  });
  await expectError(callReuse(doctor.profileId, {
    sourceId: source.id, targetId: targetMustDraft.id, locationId: doctor.locationId, key: "reuse-target-final",
  }), /PRESCRIPTION_NOT_DRAFT/, "target must be DRAFT");
  pass("target must be DRAFT");

  const locationTarget = await createDraftPrescription(doctor, patient, { locationId: doctor.locationId });
  await expectError(callReuse(doctor.profileId, {
    sourceId: source.id, targetId: locationTarget.id, locationId: doctor.secondLocationId, key: "reuse-wrong-location",
  }), /prescription not found/, "wrong destination location rejected");
  pass("current destination location authority enforced");

  const crossLocationTarget = await createDraftPrescription(doctor, patient, { locationId: doctor.locationId });
  const crossLocationResult = await callReuse(doctor.profileId, {
    sourceId: source.id, targetId: crossLocationTarget.id, locationId: doctor.locationId, key: "reuse-cross-location",
  });
  assert.equal(crossLocationResult.insertedCount, 3);
  pass("same-Doctor source from another location works");

  const predecessor = await createFinalizedPrescription(doctor, patient, {
    locationId: doctor.locationId, items: [{ displayName: "Original Before Correction", position: 1 }],
  });
  const correctionTarget = await createDraftPrescription(doctor, patient, {
    locationId: doctor.locationId,
    encounterId: predecessor.encounterId,
    replacesPrescriptionId: predecessor.id,
    replacementReason: "QA correction",
  });
  await expectError(callReuse(doctor.profileId, {
    sourceId: source.id, targetId: correctionTarget.id, locationId: doctor.locationId, key: "reuse-correction-target",
  }), /CORRECTION_SUCCESSOR_REUSE_FORBIDDEN/, "correction successor rejected");
  pass("correction-successor target rejected");

  const selectedTarget = await createDraftPrescription(doctor, patient, { locationId: doctor.locationId });
  const selectedIds = [source.items[0].id, source.items[1].id];
  const selectedResult = await callReuse(doctor.profileId, {
    sourceId: source.id, targetId: selectedTarget.id, locationId: doctor.locationId,
    mode: "SELECTED", selectedIds, key: "reuse-selected",
  });
  assert.equal(selectedResult.insertedCount, 2);
  pass("SELECTED copy works");

  const allTarget = await createDraftPrescription(doctor, patient, { locationId: doctor.locationId });
  const allResult = await callReuse(doctor.profileId, {
    sourceId: source.id, targetId: allTarget.id, locationId: doctor.locationId, key: "reuse-all-mode",
  });
  assert.equal(allResult.insertedCount, 3);
  pass("ALL copy works");

  const emptySelectedTarget = await createDraftPrescription(doctor, patient, { locationId: doctor.locationId });
  await expectError(callReuse(doctor.profileId, {
    sourceId: source.id, targetId: emptySelectedTarget.id, locationId: doctor.locationId,
    mode: "SELECTED", selectedIds: [], key: "reuse-empty-selected",
  }), /SELECTED_ITEMS_REQUIRED/, "empty selected rejected");
  pass("empty selected set rejected");

  const dupSelectedTarget = await createDraftPrescription(doctor, patient, { locationId: doctor.locationId });
  await expectError(callReuse(doctor.profileId, {
    sourceId: source.id, targetId: dupSelectedTarget.id, locationId: doctor.locationId,
    mode: "SELECTED", selectedIds: [source.items[0].id, source.items[0].id], key: "reuse-dup-selected",
  }), /DUPLICATE_SELECTED_ITEM_ID/, "duplicate selected ids rejected");
  pass("duplicate selected IDs rejected");

  const foreignItemTarget = await createDraftPrescription(doctor, patient, { locationId: doctor.locationId });
  await expectError(callReuse(doctor.profileId, {
    sourceId: source.id, targetId: foreignItemTarget.id, locationId: doctor.locationId,
    mode: "SELECTED", selectedIds: [otherSource.items[0].id], key: "reuse-item-not-source",
  }), /SELECTED_ITEM_NOT_IN_SOURCE/, "selected item not in source rejected");
  pass("source item not belonging to source rejected");

  const copiedRows = await sql`select id,display_name,position from public.prescription_items
    where prescription_id=${allTarget.id} order by position`;
  const sourceIds = new Set(source.items.map((x) => x.id));
  assert.equal(copiedRows.some((x) => sourceIds.has(x.id)), false);
  pass("every copied destination item gets a new UUID");

  assert.deepEqual(copiedRows.map((x) => x.display_name), ["Medicine A", "Medicine B", "Medicine C"]);
  pass("source medicine order controls copied order");

  const appendTarget = await createDraftPrescription(doctor, patient, {
    locationId: doctor.locationId, items: [{ displayName: "Existing Line", position: 5 }],
  });
  const appendBeforeVersion = appendTarget.version;
  const appendResult = await callReuse(doctor.profileId, {
    sourceId: source.id, targetId: appendTarget.id, locationId: doctor.locationId,
    appendConfirmed: true, key: "reuse-append-confirmed",
  });
  const appendRows = await sql`select display_name,position from public.prescription_items
    where prescription_id=${appendTarget.id} order by position`;
  assert.deepEqual(appendRows.map((x) => x.position), [5, 6, 7, 8]);
  pass("append places copied rows after existing destination rows");

  const appendDenied = await createDraftPrescription(doctor, patient, {
    locationId: doctor.locationId, items: [{ displayName: "Existing Without Confirm", position: 1 }],
  });
  await expectError(callReuse(doctor.profileId, {
    sourceId: source.id, targetId: appendDenied.id, locationId: doctor.locationId,
    key: "reuse-append-denied",
  }), /APPEND_CONFIRMATION_REQUIRED/, "append confirmation required");
  pass("non-empty target without confirmation rejected");

  const staleTarget = await createDraftPrescription(doctor, patient, { locationId: doctor.locationId, version: 2 });
  await expectError(callReuse(doctor.profileId, {
    sourceId: source.id, targetId: staleTarget.id, locationId: doctor.locationId,
    expectedVersion: 1, key: "reuse-stale-version",
  }), /PRESCRIPTION_VERSION_CONFLICT/, "stale version rejected");
  pass("stale expected version rejected");

  assert.equal(appendResult.version, appendBeforeVersion + 1);
  const [appendVersionRow] = await sql`select version from public.prescriptions where id=${appendTarget.id}`;
  assert.equal(appendVersionRow.version, appendBeforeVersion + 1);
  pass("target version increments exactly once per reuse");

  const afterSource = await getPrescriptionSnapshot(source.id);
  assert.deepEqual(afterSource, beforeSource);
  pass("source prescription/items remain unchanged");

  const [targetMetadata] = await sql`select status,finalized_at,review_digest,signature_asset_path,replaces_prescription_id
    from public.prescriptions where id=${allTarget.id}`;
  assert.equal(targetMetadata.status, "DRAFT");
  assert.equal(targetMetadata.finalized_at, null);
  assert.equal(targetMetadata.review_digest, null);
  assert.equal(targetMetadata.signature_asset_path, null);
  assert.equal(targetMetadata.replaces_prescription_id, null);
  pass("finalized/signature/digest/lineage metadata is not copied");

  const failureTarget = await createDraftPrescription(doctor, patient, { locationId: doctor.locationId });
  const failureBeforeCount = await countItems(failureTarget.id);
  const [failureBeforeVersion] = await sql`select version from public.prescriptions where id=${failureTarget.id}`;
  await sql.unsafe(`
    create or replace function public.qa_m3_fail_reuse_receipt() returns trigger language plpgsql as $$
    begin raise exception 'FORCED_REUSE_FAILURE'; end $$;
    create trigger qa_m3_fail_reuse_receipt before insert on public.prescription_reuse_operations
    for each row execute function public.qa_m3_fail_reuse_receipt();
  `);
  await expectError(callReuse(doctor.profileId, {
    sourceId: source.id, targetId: failureTarget.id, locationId: doctor.locationId, key: "reuse-forced-rollback",
  }), /FORCED_REUSE_FAILURE/, "forced rollback");
  await sql.unsafe(`drop trigger qa_m3_fail_reuse_receipt on public.prescription_reuse_operations; drop function public.qa_m3_fail_reuse_receipt()`);
  assert.equal(await countItems(failureTarget.id), failureBeforeCount);
  const [failureAfterVersion] = await sql`select version from public.prescriptions where id=${failureTarget.id}`;
  assert.equal(failureAfterVersion.version, failureBeforeVersion.version);
  pass("forced failure leaves zero partial copied rows");

  const concurrentTarget = await createDraftPrescription(doctor, patient, { locationId: doctor.locationId });
  const concurrent = await Promise.allSettled([
    callReuse(doctor.profileId, {
      sourceId: source.id, targetId: concurrentTarget.id, locationId: doctor.locationId,
      expectedVersion: 1, key: "reuse-concurrent-a",
    }),
    callReuse(doctor.profileId, {
      sourceId: source.id, targetId: concurrentTarget.id, locationId: doctor.locationId,
      expectedVersion: 1, key: "reuse-concurrent-b",
    }),
  ]);
  const successes = concurrent.filter((x) => x.status === "fulfilled");
  const failures = concurrent.filter((x) => x.status === "rejected");
  assert.equal(successes.length, 1);
  assert.equal(failures.length, 1);
  assert.match(String(failures[0].reason?.message), /PRESCRIPTION_VERSION_CONFLICT/);
  assert.equal(await countItems(concurrentTarget.id), 3);
  pass("simultaneous writes serialize/conflict correctly");

  const retryTarget = await createDraftPrescription(doctor, patient, { locationId: doctor.locationId });
  const retryKey = "reuse-response-loss";
  const firstRetry = await callReuse(doctor.profileId, {
    sourceId: source.id, targetId: retryTarget.id, locationId: doctor.locationId,
    expectedVersion: 1, key: retryKey,
  });
  const retryCount = await countItems(retryTarget.id);
  const secondRetry = await callReuse(doctor.profileId, {
    sourceId: source.id, targetId: retryTarget.id, locationId: doctor.locationId,
    expectedVersion: 1, key: retryKey,
  });
  assert.deepEqual(secondRetry, firstRetry);
  assert.equal(await countItems(retryTarget.id), retryCount);
  pass("commit-success/response-loss retry does not duplicate rows");

  assert.deepEqual(secondRetry, firstRetry);
  pass("same key + same canonical request returns same result");

  await expectError(callReuse(doctor.profileId, {
    sourceId: source.id, targetId: retryTarget.id, locationId: doctor.locationId,
    expectedVersion: 1, appendConfirmed: true, key: retryKey,
  }), /IDEMPOTENCY_KEY_CONFLICT/, "idempotency conflict");
  pass("same key + different request conflicts");

  const [receiptAcl] = await sql`select c.relrowsecurity as rls, c.relforcerowsecurity as force_rls,
    has_table_privilege('authenticated','public.prescription_reuse_operations','SELECT') as auth_select,
    has_table_privilege('authenticated','public.prescription_reuse_operations','INSERT') as auth_insert,
    has_table_privilege('anon','public.prescription_reuse_operations','SELECT') as anon_select,
    has_table_privilege('service_role','public.prescription_reuse_operations','SELECT') as service_select
    from pg_class c where c.oid='public.prescription_reuse_operations'::regclass`;
  assert.equal(receiptAcl.rls, true);
  assert.equal(receiptAcl.force_rls, true);
  assert.equal(receiptAcl.auth_select, false);
  assert.equal(receiptAcl.auth_insert, false);
  assert.equal(receiptAcl.anon_select, false);
  assert.equal(receiptAcl.service_select, false);
  pass("receipt table has no browser CRUD authority");

  const agreementTarget = await createDraftPrescription(doctor, patient, { locationId: doctor.locationId });
  const agreement = await callReuse(doctor.profileId, {
    sourceId: source.id, targetId: agreementTarget.id, locationId: doctor.locationId, key: "reuse-snapshot-agreement",
  });
  assert.equal(agreement.insertedCount, 3);
  const [constraint2] = await sql`select pg_get_constraintdef(oid) as def
    from pg_constraint where conrelid='public.prescriptions'::regclass and conname='prescriptions_finalized_is_complete'`;
  await sql.unsafe(`alter table public.prescriptions drop constraint prescriptions_finalized_is_complete`);
  await sql`update public.prescription_items set dose_text='privileged drift' where id=${source.items[0].id}`;
  const driftTarget = await createDraftPrescription(doctor, patient, { locationId: doctor.locationId });
  await expectError(callReuse(doctor.profileId, {
    sourceId: source.id, targetId: driftTarget.id, locationId: doctor.locationId, key: "reuse-snapshot-drift",
  }), /PRESCRIPTION_FINALIZATION_STATE_INVALID/, "snapshot projection disagreement");
  await sql`update public.prescription_items set dose_text=null where id=${source.items[0].id}`;
  await sql.unsafe(`alter table public.prescriptions add constraint prescriptions_finalized_is_complete ${constraint2.def}`);
  pass("live finalized item projection must agree with immutable snapshot; disagreement fails closed");

  console.log(`M3_REUSE_MATRIX_PASS count=${passed}`);
  assert.equal(passed, 31);
} finally {
  await closeSql();
}
