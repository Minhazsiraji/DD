import assert from "node:assert/strict";
import {
  sql, uuid, sleep, createDoctorAt, createLocation, addMembership, createPatient,
  createFinalizedPrescription, createDraftPrescription, createStaff, createProfile,
  getPrescriptionSnapshot, asAuthenticated, expectError, closeSql,
} from "./lib.mjs";

let passed = 0;
const pass = (label) => { passed += 1; console.log(`PASS PRINT ${passed}: ${label}`); };

async function initiate(profileId, prescriptionId, locationId, key = `print-${uuid()}`) {
  return asAuthenticated(profileId, async (tx) => {
    const [row] = await tx`select public.initiate_prescription_print(
      ${prescriptionId}::uuid,${locationId}::uuid,${key}::text
    ) as result`;
    return row.result;
  });
}

async function confirm(profileId, operationId, copies) {
  return asAuthenticated(profileId, async (tx) => {
    const [row] = await tx`select public.confirm_prescription_print(${operationId}::uuid,${copies}::integer) as result`;
    return row.result;
  });
}

async function history(profileId, prescriptionId, locationId) {
  return asAuthenticated(profileId, async (tx) => {
    const [row] = await tx`select public.prescription_print_history(${prescriptionId}::uuid,${locationId}::uuid) as result`;
    return row.result;
  });
}

try {
  const doctor = await createDoctorAt("print-main", { secondLocation: true });
  const patient = await createPatient(doctor, "Print Patient", [doctor.locationId, doctor.secondLocationId]);
  const receptionist = await createStaff("print-reception", doctor.locationId, "RECEPTIONIST");
  const adminStaff = await createStaff("print-admin", doctor.locationId, "LOCATION_ADMIN");
  const crossStaff = await createStaff("print-cross", doctor.secondLocationId, "RECEPTIONIST");
  const unrelated = await createProfile("print-unrelated", "QA Unrelated Actor");

  const rx = await createFinalizedPrescription(doctor, patient, {
    locationId: doctor.locationId,
    items: [{ displayName: "Print Drug", position: 1 }],
  });
  const draft = await createDraftPrescription(doctor, patient, {
    locationId: doctor.locationId,
    items: [{ displayName: "Draft Print Drug", position: 1 }],
  });

  await expectError(initiate(doctor.profileId, draft.id, doctor.locationId, "print-draft-denied"), /prescription not found/, "finalized required");
  pass("finalized Rx required");

  const doctorOp = await initiate(doctor.profileId, rx.id, doctor.locationId, "print-doctor-init");
  assert.ok(doctorOp.operationId);
  pass("Doctor owner can initiate");

  const staffOp = await initiate(receptionist.profileId, rx.id, doctor.locationId, "print-staff-init");
  assert.ok(staffOp.operationId);
  const adminOp = await initiate(adminStaff.profileId, rx.id, doctor.locationId, "print-admin-init");
  assert.ok(adminOp.operationId);
  pass("valid exact-location receptionist/admin can initiate");

  await expectError(initiate(unrelated.id, rx.id, doctor.locationId, "print-unrelated-denied"), /prescription not found/, "unrelated denied");
  pass("unrelated actor denied");

  await expectError(initiate(crossStaff.profileId, rx.id, doctor.locationId, "print-cross-location-denied"), /prescription not found/, "cross-location denied");
  pass("cross-location staff denied");

  const superseded = await createFinalizedPrescription(doctor, patient, {
    locationId: doctor.locationId,
    items: [{ displayName: "Superseded Drug", position: 1 }],
  });
  const successor = await createFinalizedPrescription(doctor, patient, {
    locationId: doctor.locationId,
    encounterId: superseded.encounterId,
    replacesPrescriptionId: superseded.id,
    replacementReason: "QA replacement",
    items: [{ displayName: "Current Drug", position: 1 }],
  });
  await expectError(initiate(receptionist.profileId, superseded.id, doctor.locationId, "print-superseded-staff"), /SUPERSEDED_PRESCRIPTION_HANDOVER_FORBIDDEN/, "superseded staff denied");
  pass("staff initiation of superseded handover sheet denied");

  const historicDoctorOp = await initiate(doctor.profileId, superseded.id, doctor.locationId, "print-superseded-doctor");
  assert.ok(historicDoctorOp.operationId);
  pass("owning Doctor may handle longitudinal historical Rx");

  const [unconfirmedRow] = await sql`select confirmed_at,confirmed_copy_count from public.prescription_print_operations where id=${doctorOp.operationId}`;
  assert.equal(unconfirmedRow.confirmed_at, null);
  assert.equal(unconfirmedRow.confirmed_copy_count, null);
  pass("initiation may remain permanently unconfirmed");

  const rxBefore = await getPrescriptionSnapshot(rx.id);
  await initiate(doctor.profileId, rx.id, doctor.locationId, "print-doctor-no-rx-change");
  const rxAfter = await getPrescriptionSnapshot(rx.id);
  assert.deepEqual(rxAfter, rxBefore);
  pass("initiation does not modify prescription");

  const idemKey = "print-idempotent-key";
  const idem1 = await initiate(doctor.profileId, rx.id, doctor.locationId, idemKey);
  const idem2 = await initiate(doctor.profileId, rx.id, doctor.locationId, idemKey);
  assert.deepEqual(idem2, idem1);
  const [idemCount] = await sql`select count(*)::integer as count from public.prescription_print_operations where actor_profile_id=${doctor.profileId} and idempotency_key=${idemKey}`;
  assert.equal(idemCount.count, 1);
  pass("same key/same request returns same operation");

  await expectError(initiate(doctor.profileId, superseded.id, doctor.locationId, idemKey), /IDEMPOTENCY_KEY_CONFLICT/, "print key conflict");
  pass("same key/different request conflicts");

  const [doctorStored] = await sql`select actor_profile_id,authorization_basis,doctor_profile_id,practice_membership_id from public.prescription_print_operations where id=${doctorOp.operationId}`;
  assert.equal(doctorStored.actor_profile_id, doctor.profileId);
  assert.equal(doctorStored.authorization_basis, "DOCTOR_OWNER");
  assert.equal(doctorStored.doctor_profile_id, doctor.doctorId);
  assert.equal(doctorStored.practice_membership_id, null);
  pass("Doctor operation stores Doctor actor");

  const [staffStored] = await sql`select actor_profile_id,authorization_basis,doctor_profile_id,practice_membership_id from public.prescription_print_operations where id=${staffOp.operationId}`;
  assert.equal(staffStored.actor_profile_id, receptionist.profileId);
  assert.equal(staffStored.authorization_basis, "LOCATION_STAFF");
  assert.equal(staffStored.doctor_profile_id, null);
  assert.equal(staffStored.practice_membership_id, receptionist.membershipId);
  pass("receptionist operation stores receptionist actor");

  assert.notEqual(staffStored.actor_profile_id, doctor.profileId);
  pass("issuing Doctor is never substituted for receptionist");

  const staffHistory = await history(receptionist.profileId, rx.id, doctor.locationId);
  const staffHistoryOp = staffHistory.operations.find((o) => o.operationId === staffOp.operationId);
  assert.equal(staffHistoryOp.actorName, receptionist.fullName);
  pass("safe actor display name returned");

  assert.match(staffHistoryOp.actorDisplayId, /^MEM-[A-F0-9]{8}$/);
  pass("safe display reference returned");

  const staffHistoryText = JSON.stringify(staffHistory);
  assert.equal(staffHistoryText.includes(receptionist.profileId), false);
  assert.equal(staffHistoryText.includes(doctor.profileId), false);
  pass("no raw auth UUID exposed through print-history result");

  const differentActorOp = await initiate(receptionist.profileId, rx.id, doctor.locationId, "print-different-actor-confirm");
  await expectError(confirm(adminStaff.profileId, differentActorOp.operationId, 1), /print operation not found/, "same initiator required");
  pass("same authenticated initiator required");

  await expectError(confirm(unrelated.id, differentActorOp.operationId, 1), /print operation not found/, "different actor cannot confirm");
  pass("different actor cannot confirm");

  const revalidateStaffOp = await initiate(receptionist.profileId, rx.id, doctor.locationId, "print-revalidate-staff");
  await sql`update public.practice_location_members set status='SUSPENDED' where id=${receptionist.membershipId}`;
  await expectError(confirm(receptionist.profileId, revalidateStaffOp.operationId, 1), /PRINT_AUTHORITY_REVOKED/, "staff authority revoked");
  const [revokedState] = await sql`select confirmed_at,confirmed_copy_count from public.prescription_print_operations where id=${revalidateStaffOp.operationId}`;
  assert.equal(revokedState.confirmed_at, null);
  assert.equal(revokedState.confirmed_copy_count, null);
  await sql`update public.practice_location_members set status='ACTIVE' where id=${receptionist.membershipId}`;
  pass("authority revalidated at confirmation");
  pass("revoked staff authority rejects confirmation");
  pass("revoked confirmation leaves initiated/unconfirmed state");

  const doctorRevokeOp = await initiate(doctor.profileId, rx.id, doctor.locationId, "print-revoke-doctor");
  const shadow = await createProfile("print-doctor-shadow", "QA Doctor Shadow");
  await sql`update public.doctor_profiles set user_id=${shadow.id} where id=${doctor.doctorId}`;
  await expectError(confirm(doctor.profileId, doctorRevokeOp.operationId, 1), /PRINT_AUTHORITY_REVOKED/, "Doctor identity authority revoked");
  await sql`update public.doctor_profiles set user_id=${doctor.profileId} where id=${doctor.doctorId}`;
  pass("revoked Doctor authority rejects confirmation");

  const boundsOp = await initiate(doctor.profileId, rx.id, doctor.locationId, "print-bounds-zero");
  await expectError(confirm(doctor.profileId, boundsOp.operationId, 0), /INVALID_PRINT_COPY_COUNT/, "zero copies rejected");
  pass("copy count 0 rejected");

  const bounds101Op = await initiate(doctor.profileId, rx.id, doctor.locationId, "print-bounds-101");
  await expectError(confirm(doctor.profileId, bounds101Op.operationId, 101), /INVALID_PRINT_COPY_COUNT/, "101 copies rejected");
  pass("copy count 101 rejected");

  const oneOp = await initiate(doctor.profileId, rx.id, doctor.locationId, "print-copy-one");
  const oneConfirmed = await confirm(doctor.profileId, oneOp.operationId, 1);
  assert.equal(oneConfirmed.confirmedCopyCount, 1);
  pass("copy count 1 accepted");

  const hundredOp = await initiate(doctor.profileId, rx.id, doctor.locationId, "print-copy-hundred");
  const hundredConfirmed = await confirm(doctor.profileId, hundredOp.operationId, 100);
  assert.equal(hundredConfirmed.confirmedCopyCount, 100);
  pass("copy count 100 accepted");

  const timeOp = await initiate(doctor.profileId, rx.id, doctor.locationId, "print-db-time");
  const [beforeTime] = await sql`select clock_timestamp() as t`;
  const timeConfirmed = await confirm(doctor.profileId, timeOp.operationId, 2);
  const [afterTime] = await sql`select clock_timestamp() as t`;
  const confirmedAt = new Date(timeConfirmed.confirmedAt).getTime();
  assert.ok(confirmedAt >= new Date(beforeTime.t).getTime() && confirmedAt <= new Date(afterTime.t).getTime());
  pass("confirmation writes canonical DB timestamp");

  const idemConfirm = await confirm(doctor.profileId, timeOp.operationId, 2);
  assert.deepEqual(idemConfirm, timeConfirmed);
  pass("same operation/same copy-count retry idempotent");

  await expectError(confirm(doctor.profileId, timeOp.operationId, 3), /PRINT_CONFIRMATION_CONFLICT/, "conflicting later copy count");
  pass("conflicting later copy count rejected");

  await expectError(sql`update public.prescription_print_operations set confirmed_copy_count=4 where id=${timeOp.operationId}`, /PRINT_CONFIRMATION_IMMUTABLE/, "confirmation immutable");
  pass("confirmation fields cannot later be rewritten");

  const historyRx = await createFinalizedPrescription(doctor, patient, {
    locationId: doctor.locationId,
    items: [{ displayName: "History Print Drug", position: 1 }],
  });
  const histConfirmedOp = await initiate(receptionist.profileId, historyRx.id, doctor.locationId, "print-history-confirmed");
  await confirm(receptionist.profileId, histConfirmedOp.operationId, 2);
  await sleep(20);
  const histPendingOp = await initiate(receptionist.profileId, historyRx.id, doctor.locationId, "print-history-pending");
  const hist = await history(receptionist.profileId, historyRx.id, doctor.locationId);
  assert.equal(hist.latestInitiation.operationId, histPendingOp.operationId);
  pass("latest initiation correct");

  assert.equal(hist.latestConfirmedPrint.operationId, histConfirmedOp.operationId);
  pass("latest confirmed print correct");

  assert.equal(hist.latestConfirmedPrint.actorName, receptionist.fullName);
  pass("confirmed actor identity correct");

  const confirmedOperation = hist.operations.find((o) => o.operationId === histConfirmedOp.operationId);
  assert.equal(confirmedOperation.confirmedCopyCount, 2);
  pass("operation confirmed copies correct");

  assert.equal(hist.totalConfirmedCopies, 2);
  pass("total confirmed copies correct");

  assert.equal(hist.latestInitiation.confirmedAt, null);
  assert.equal(hist.latestConfirmedPrint.operationId, histConfirmedOp.operationId);
  pass("newer unconfirmed initiation does not erase previous confirmed state");

  const doctorHist = await history(doctor.profileId, historyRx.id, doctor.locationId);
  assert.equal(doctorHist.prescriptionId, historyRx.id);
  pass("Doctor may read own Rx history");

  assert.equal(hist.prescriptionId, historyRx.id);
  pass("staff read exact-location only");

  await expectError(history(crossStaff.profileId, historyRx.id, doctor.locationId), /prescription not found/, "cross-location history denied");
  pass("cross-location staff history denied");

  const oldBefore = await getPrescriptionSnapshot(superseded.id);
  const currentBefore = await getPrescriptionSnapshot(successor.id);
  const oldOp = await initiate(doctor.profileId, superseded.id, doctor.locationId, "print-history-old-separate");
  const currentOp = await initiate(doctor.profileId, successor.id, doctor.locationId, "print-history-current-separate");
  const oldHistory = await history(doctor.profileId, superseded.id, doctor.locationId);
  const currentHistory = await history(doctor.profileId, successor.id, doctor.locationId);
  assert.ok(oldHistory.operations.some((o) => o.operationId === oldOp.operationId));
  assert.equal(oldHistory.operations.some((o) => o.operationId === currentOp.operationId), false);
  assert.ok(currentHistory.operations.some((o) => o.operationId === currentOp.operationId));
  assert.equal(currentHistory.operations.some((o) => o.operationId === oldOp.operationId), false);
  pass("superseded prescription keeps separate history");

  const oldAfter = await getPrescriptionSnapshot(superseded.id);
  const currentAfter = await getPrescriptionSnapshot(successor.id);
  assert.deepEqual(oldAfter, oldBefore);
  assert.deepEqual(currentAfter, currentBefore);
  pass("print audit never changes correction lineage/current status");

  const [acl] = await sql`select
    (select relrowsecurity from pg_class where oid='public.prescription_print_operations'::regclass) as rls,
    (select relforcerowsecurity from pg_class where oid='public.prescription_print_operations'::regclass) as force_rls,
    has_table_privilege('anon','public.prescription_print_operations','SELECT') as anon_select,
    has_table_privilege('authenticated','public.prescription_print_operations','SELECT') as auth_select,
    has_table_privilege('authenticated','public.prescription_print_operations','INSERT') as auth_insert,
    has_table_privilege('authenticated','public.prescription_print_operations','UPDATE') as auth_update,
    has_table_privilege('authenticated','public.prescription_print_operations','DELETE') as auth_delete,
    has_table_privilege('service_role','public.prescription_print_operations','SELECT') as service_select`;
  assert.equal(acl.rls, true);
  pass("RLS enabled");
  assert.equal(acl.force_rls, true);
  pass("FORCE RLS enabled");

  const [publicAcl] = await sql`select coalesce(bool_or(x.grantee=0),false) as public_has_acl
    from pg_class c left join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) x on true
    where c.oid='public.prescription_print_operations'::regclass`;
  assert.equal(publicAcl.public_has_acl, false);
  pass("PUBLIC direct table CRUD/read denied");

  assert.equal(acl.anon_select, false);
  pass("anon denied");

  assert.equal(acl.auth_select, false);
  assert.equal(acl.auth_insert, false);
  assert.equal(acl.auth_update, false);
  assert.equal(acl.auth_delete, false);
  pass("authenticated direct table CRUD denied");

  assert.equal(acl.service_select, false);
  for (const sig of [
    "public.initiate_prescription_print(uuid,uuid,text)",
    "public.confirm_prescription_print(uuid,integer)",
    "public.prescription_print_history(uuid,uuid)",
  ]) {
    const [row] = await sql`select has_function_privilege('service_role',${sig},'EXECUTE') as can`;
    assert.equal(row.can, false, `${sig} service_role execute`);
  }
  pass("service_role has no explicit DD table/RPC shortcut");

  const intended = [
    "public.initiate_prescription_print(uuid,uuid,text)",
    "public.confirm_prescription_print(uuid,integer)",
    "public.prescription_print_history(uuid,uuid)",
  ];
  for (const sig of intended) {
    const [row] = await sql`select has_function_privilege('authenticated',${sig},'EXECUTE') as can`;
    assert.equal(row.can, true, `${sig} authenticated execute`);
  }
  const [overloads] = await sql`select count(*)::integer as count from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('initiate_prescription_print','confirm_prescription_print','prescription_print_history')`;
  assert.equal(overloads.count, 3);
  pass("authenticated execute exists only on intended RPC signatures");

  await expectError(sql`update public.prescription_print_operations set actor_display_name='TAMPER' where id=${doctorOp.operationId}`, /PRINT_OPERATION_IMMUTABLE/, "immutable initiation fields");
  pass("update guard prevents changing immutable initiation/reference fields");

  console.log(`M3_PRINT_MATRIX_PASS count=${passed}`);
  assert.equal(passed, 49);
} finally {
  await closeSql();
}
