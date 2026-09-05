import crypto from "node:crypto";
import { assert, expectSqlFailure, openLocalAdminDatabase } from "./p0-b2-lib.mjs";
import { asAuthenticated, insertAuthProfile } from "./p1-proof-lib.mjs";

const sql = openLocalAdminDatabase();
const ids = {
  applicant: crypto.randomUUID(),
  reviewer1: crypto.randomUUID(),
  reviewer2: crypto.randomUUID(),
  regulatorA: crypto.randomUUID(),
  regulatorB: crypto.randomUUID(),
};

async function decideAs(uid, credential, decision, note) {
  return asAuthenticated(sql, uid, async () => {
    const [row] = await sql`
      select public.decide_credential(${credential}, ${decision}::credential_status,
        ${note}, 'MANUAL_REVIEW'::credential_verification_method) as result
    `;
    return row.result;
  });
}

try {
  await sql.unsafe("begin");
  await insertAuthProfile(sql, ids.applicant, "credential applicant");
  await insertAuthProfile(sql, ids.reviewer1, "credential reviewer one");
  await insertAuthProfile(sql, ids.reviewer2, "credential reviewer two");

  await sql`
    insert into public.professional_profiles(profile_id, profession, display_name)
    values (${ids.applicant}, 'DOCTOR', 'QA P1 Credential Applicant')
  `;
  for (const [regulator, code] of [[ids.regulatorA, 'QA-P1-A'], [ids.regulatorB, 'QA-P1-B']]) {
    await sql`
      insert into public.regulators(id, country_code, authority_code, authority_name)
      values (${regulator}, 'BD', ${code}, ${`QA ${code}`})
    `;
    await sql`insert into public.regulator_professions(regulator_id, profession) values (${regulator}, 'DOCTOR')`;
  }

  for (const uid of [ids.applicant, ids.reviewer1, ids.reviewer2]) {
    await sql`insert into public.platform_staff(profile_id, granted_by) values (${uid}, ${ids.reviewer1})`;
    await sql`
      insert into public.platform_staff_roles(profile_id, role, granted_by)
      values (${uid}, 'CREDENTIAL_VERIFIER', ${ids.reviewer1})
    `;
  }

  const credentialA = await asAuthenticated(sql, ids.applicant, async () => {
    const [row] = await sql`
      select public.submit_credential(${ids.regulatorA}, 'QA-REG-A-100', 'qa/evidence/a') as id
    `;
    return row.id;
  });

  await asAuthenticated(sql, ids.applicant, () =>
    expectSqlFailure(sql, "applicant self-verification", () => sql`
      select public.decide_credential(${credentialA}, 'VERIFIED', 'self', 'MANUAL_REVIEW')
    `, ["42501"]));

  const first = await decideAs(ids.reviewer1, credentialA, 'VERIFIED', 'first verifier');
  assert(first.awaiting_second_verifier === true && first.changed === false,
    `first verifier result mismatch: ${JSON.stringify(first)}`);

  await asAuthenticated(sql, ids.reviewer1, () =>
    expectSqlFailure(sql, "same verifier cannot complete four-eyes", () => sql`
      select public.decide_credential(${credentialA}, 'VERIFIED', 'same reviewer', 'MANUAL_REVIEW')
    `, ["42501"]));

  const second = await decideAs(ids.reviewer2, credentialA, 'VERIFIED', 'second verifier');
  assert(second.awaiting_second_verifier === false && second.changed === true && second.status === 'VERIFIED',
    `second verifier result mismatch: ${JSON.stringify(second)}`);

  const [verified] = await sql`
    select verification_status, verified_by_staff_id, verification_method
    from public.professional_credentials where id=${credentialA}
  `;
  assert(verified.verification_status === 'VERIFIED' && verified.verified_by_staff_id === ids.reviewer2,
    `verified credential metadata mismatch: ${JSON.stringify(verified)}`);
  const [doctorCap] = await sql`select public.has_capability(${ids.applicant}, 'DOCTOR') as allowed`;
  assert(doctorCap.allowed === true, "verified doctor credential did not project DOCTOR capability");

  const eventsA = await sql`
    select event_kind, actor_profile_id from public.credential_review_events
    where credential_id=${credentialA} order by seq
  `;
  assert(eventsA.map(r => r.event_kind).join(',') === 'SUBMITTED,FIRST_VERIFIER_APPROVED,VERIFIED',
    `credential A event sequence mismatch: ${eventsA.map(r => r.event_kind).join(',')}`);
  await expectSqlFailure(sql, "credential review events append-only", () => sql`
    update public.credential_review_events set note='tampered' where credential_id=${credentialA}
  `, ["P0001"]);

  const credentialB = await asAuthenticated(sql, ids.applicant, async () => {
    const [row] = await sql`
      select public.submit_credential(${ids.regulatorB}, 'QA-REG-B-200', 'qa/evidence/b1') as id
    `;
    return row.id;
  });
  const needsInfo = await decideAs(ids.reviewer1, credentialB, 'NEEDS_INFORMATION', 'clearer evidence required');
  assert(needsInfo.status === 'NEEDS_INFORMATION' && needsInfo.changed === true,
    `needs-information result mismatch: ${JSON.stringify(needsInfo)}`);

  const resubmitted = await asAuthenticated(sql, ids.applicant, async () => {
    const [row] = await sql`
      select public.respond_to_credential(${credentialB}, 'RESUBMIT', 'qa/evidence/b2') as status
    `;
    return row.status;
  });
  assert(resubmitted === 'PENDING', `resubmit status mismatch: ${resubmitted}`);
  const [afterResubmit] = await sql`
    select verification_status, evidence_ref, verified_at, verified_by_staff_id
    from public.professional_credentials where id=${credentialB}
  `;
  assert(afterResubmit.verification_status === 'PENDING' && afterResubmit.evidence_ref === 'qa/evidence/b2'
    && afterResubmit.verified_at === null && afterResubmit.verified_by_staff_id === null,
    `resubmit metadata mismatch: ${JSON.stringify(afterResubmit)}`);

  const eventsB = await sql`
    select event_kind from public.credential_review_events where credential_id=${credentialB} order by seq
  `;
  assert(eventsB.map(r => r.event_kind).join(',') === 'SUBMITTED,NEEDS_INFORMATION,RESUBMITTED',
    `credential B event sequence mismatch: ${eventsB.map(r => r.event_kind).join(',')}`);

  console.log("verify-p1-credential-workflow: PASS (submit; self-denial; four-eyes; verified projection; needs-info/resubmit; append-only events)");
  await sql.unsafe("rollback");
} catch (error) {
  try { await sql.unsafe("rollback"); } catch {}
  throw error;
} finally {
  await sql.end({ timeout: 5 });
}
