import crypto from "node:crypto";
import { assert, expectSqlFailure, openLocalAdminDatabase } from "./p0-b2-lib.mjs";
import { asAuthenticated, insertAuthProfile } from "./p1-proof-lib.mjs";

const sql = openLocalAdminDatabase();
const ids = {
  admin: crypto.randomUUID(),
  verifier1: crypto.randomUUID(),
  verifier2: crypto.randomUUID(),
  ordinary: crypto.randomUUID(),
  regulator: crypto.randomUUID(),
};
const applicants = Array.from({ length: 5 }, () => crypto.randomUUID());

async function createApplicantCredential(profileId, index) {
  await insertAuthProfile(sql, profileId, `queue applicant ${index}`);
  const [professional] = await sql`
    insert into public.professional_profiles(profile_id, profession, display_name)
    values (${profileId}, 'DOCTOR', ${`QA Queue Doctor ${index}`}) returning id
  `;
  const credentialId = await asAuthenticated(sql, profileId, async () => {
    const [row] = await sql`
      select public.submit_credential(
        ${ids.regulator}, ${`QA-QUEUE-${index}`}, ${`qa/evidence/queue-${index}`}
      ) as id
    `;
    return row.id;
  });
  return { profileId, professionalId: professional.id, credentialId };
}
try {
  await sql.unsafe("begin");
  for (const [id, label] of [
    [ids.admin, "queue admin"],
    [ids.verifier1, "queue verifier one"],
    [ids.verifier2, "queue verifier two"],
    [ids.ordinary, "queue ordinary"],
  ]) {
    await insertAuthProfile(sql, id, label);
  }

  await sql`
    insert into public.regulators(id, country_code, authority_code, authority_name)
    values (${ids.regulator}, 'BD', 'QA-S3-QUEUE', 'QA Slice 3 Queue Regulator')
  `;
  await sql`
    insert into public.regulator_professions(regulator_id, profession)
    values (${ids.regulator}, 'DOCTOR')
  `;

  for (const [profileId, role] of [
    [ids.admin, "PLATFORM_ADMIN"],
    [ids.verifier1, "CREDENTIAL_VERIFIER"],
    [ids.verifier2, "CREDENTIAL_VERIFIER"],
  ]) {
    await sql`insert into public.platform_staff(profile_id, granted_by) values (${profileId}, ${ids.admin})`;
    await sql`
      insert into public.platform_staff_roles(profile_id, role, granted_by)
      values (${profileId}, ${role}::platform_staff_role, ${ids.admin})
    `;
  }

  const fixtures = [];
  for (let index = 0; index < applicants.length; index += 1) {
    fixtures.push(await createApplicantCredential(applicants[index], index + 1));
  }

  await asAuthenticated(sql, ids.ordinary, () =>
    expectSqlFailure(
      sql,
      "ordinary authenticated queue discovery",
      () => sql`select * from public.list_pending_credential_reviews(null, 10)`,
      ["42501"],
    ));
  await asAuthenticated(sql, ids.admin, () =>
    expectSqlFailure(
      sql,
      "PLATFORM_ADMIN without verifier queue discovery",
      () => sql`select * from public.list_pending_credential_reviews(null, 10)`,
      ["42501"],
    ));

  const expectedKeys = [
    "credential_id", "actionable_since_seq", "applicant_profile_id",
    "applicant_full_name", "professional_profile_id", "professional_display_name",
    "applicant_profession", "regulator_id", "regulator_country_code",
    "regulator_authority_code", "regulator_authority_name", "registration_display",
    "evidence_ref", "verification_status", "awaiting_second_verifier",
    "caller_is_first_verifier",
  ].sort();

  let cursor = null;
  const seen = [];
  for (;;) {    const page = await asAuthenticated(sql, ids.verifier1, () => sql`
      select * from public.list_pending_credential_reviews(${cursor}, 2)
    `);
    if (page.length === 0) break;
    for (const row of page) {
      assert(JSON.stringify(Object.keys(row).sort()) === JSON.stringify(expectedKeys),
        `queue exposed unexpected fields: ${JSON.stringify(Object.keys(row))}`);
      assert(row.verification_status === "PENDING", "queue returned a non-PENDING credential");
      assert(row.evidence_ref?.startsWith("qa/evidence/queue-"),
        `queue evidence metadata mismatch: ${row.evidence_ref}`);
      assert(!seen.includes(row.credential_id), `duplicate queue case ${row.credential_id}`);
      if (cursor !== null) {
        assert(Number(row.actionable_since_seq) > Number(cursor), "queue cursor did not advance strictly");
      }
      seen.push(row.credential_id);
    }
    cursor = page.at(-1).actionable_since_seq;
  }
  assert(seen.length === fixtures.length,
    `stable queue pagination expected ${fixtures.length}, got ${seen.length}`);
  assert(new Set(seen).size === seen.length, "stable queue pagination duplicated a case");

  const firstCredential = fixtures[0].credentialId;
  const [knownCase] = await asAuthenticated(sql, ids.verifier1, () => sql`
    select * from public.read_credential_review_case(${firstCredential})
  `);
  assert(knownCase.credential_id === firstCredential && knownCase.evidence_ref === "qa/evidence/queue-1",
    `known case read mismatch: ${JSON.stringify(knownCase)}`);

  const initialHistory = await asAuthenticated(sql, ids.verifier1, () => sql`
    select * from public.read_credential_review_history(${firstCredential}, null, 20)
  `);
  assert(initialHistory.map((row) => row.event_kind).join(",") === "SUBMITTED",
    `initial history mismatch: ${initialHistory.map((row) => row.event_kind).join(",")}`);
  await sql`insert into public.platform_staff(profile_id, granted_by) values (${fixtures[0].profileId}, ${ids.admin})`;
  await sql`
    insert into public.platform_staff_roles(profile_id, role, granted_by)
    values (${fixtures[0].profileId}, 'CREDENTIAL_VERIFIER', ${ids.admin})
  `;
  await asAuthenticated(sql, fixtures[0].profileId, () =>
    expectSqlFailure(
      sql,
      "credential applicant self review",
      () => sql`
        select public.decide_credential(
          ${firstCredential}, 'VERIFIED', 'self review', 'MANUAL_REVIEW'
        )
      `,
      ["42501"],
    ));

  const firstDecision = await asAuthenticated(sql, ids.verifier1, async () => {
    const [row] = await sql`
      select public.decide_credential(
        ${firstCredential}, 'VERIFIED', 'first verifier', 'MANUAL_REVIEW'
      ) as result
    `;
    return row.result;
  });
  assert(firstDecision.changed === false && firstDecision.awaiting_second_verifier === true,
    `first verifier result mismatch: ${JSON.stringify(firstDecision)}`);

  const [waitingForSecond] = await asAuthenticated(sql, ids.verifier1, () => sql`
    select * from public.read_credential_review_case(${firstCredential})
  `);
  assert(waitingForSecond.awaiting_second_verifier === true && waitingForSecond.caller_is_first_verifier === true,
    `second-verifier state not exposed: ${JSON.stringify(waitingForSecond)}`);
  await asAuthenticated(sql, ids.verifier1, () =>
    expectSqlFailure(
      sql,
      "first verifier cannot become second verifier",
      () => sql`
        select public.decide_credential(
          ${firstCredential}, 'VERIFIED', 'same verifier again', 'MANUAL_REVIEW'
        )
      `,
      ["42501"],
    ));

  const secondDecision = await asAuthenticated(sql, ids.verifier2, async () => {
    const [row] = await sql`
      select public.decide_credential(
        ${firstCredential}, 'VERIFIED', 'distinct second verifier', 'MANUAL_REVIEW'
      ) as result
    `;
    return row.result;
  });
  assert(secondDecision.changed === true && secondDecision.status === "VERIFIED",
    `second verifier result mismatch: ${JSON.stringify(secondDecision)}`);

  const openAfterClose = await asAuthenticated(sql, ids.verifier2, () => sql`
    select * from public.list_pending_credential_reviews(null, 100)
  `);
  assert(!openAfterClose.some((row) => row.credential_id === firstCredential),
    "closed credential remained actionable in shared queue");

  const finalHistory = await asAuthenticated(sql, ids.verifier2, () => sql`
    select * from public.read_credential_review_history(${firstCredential}, null, 20)
  `);
  assert(finalHistory.map((row) => row.event_kind).join(",") ===
    "SUBMITTED,FIRST_VERIFIER_APPROVED,VERIFIED",
    `final review history mismatch: ${finalHistory.map((row) => row.event_kind).join(",")}`);
  const directCredentialRead = await asAuthenticated(sql, ids.verifier1, () => sql`
    select id from public.professional_credentials where id=${fixtures[1].credentialId}
  `);
  assert(directCredentialRead.length === 0,
    "CREDENTIAL_VERIFIER gained blanket professional_credentials visibility");
  await asAuthenticated(sql, ids.verifier1, () =>
    expectSqlFailure(
      sql,
      "CREDENTIAL_VERIFIER direct review-event read",
      () => sql`select seq from public.credential_review_events where credential_id=${fixtures[1].credentialId}`,
      ["42501"],
    ));

  const definitions = await sql`
    select p.proname, lower(pg_get_functiondef(p.oid)) as definition
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname in (
        'list_pending_credential_reviews',
        'read_credential_review_case',
        'read_credential_review_history',
        'decide_credential'
      )
  `;
  for (const row of definitions.filter((item) => item.proname !== "decide_credential")) {
    for (const forbidden of [
      "clinical_patients", "health_subjects", "encounters", "prescriptions", "storage.objects",
    ]) {
      assert(!row.definition.includes(forbidden),
        `${row.proname} unexpectedly references ${forbidden}`);
    }
  }
  const decideDef = definitions.find((row) => row.proname === "decide_credential")?.definition ?? "";
  assert(decideDef.includes("for update"), "decide_credential lost row-locking semantics");
  console.log(
    "verify-credential-review-queue: PASS " +
    "(ordinary/admin denied; verifier pull queue; keyset pagination; minimal metadata; " +
    "self-denial; four-eyes; closed removal; append-only history; no blanket/clinical/storage read; row lock preserved)",
  );
  await sql.unsafe("rollback");
} catch (error) {
  try { await sql.unsafe("rollback"); } catch {}
  throw error;
} finally {
  await sql.end({ timeout: 5 });
}
