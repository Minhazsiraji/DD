import crypto from "node:crypto";
import { assert, openLocalAdminDatabase } from "./p0-b2-lib.mjs";
import {
  asAuthenticated,
  expectAuthenticatedSqlFailure,
  insertAuthProfile,
} from "./p1-proof-lib.mjs";

const sql = openLocalAdminDatabase();
const student = crypto.randomUUID();
const regulator = crypto.randomUUID();
const institution = crypto.randomUUID();

try {
  await sql.unsafe("begin");
  await insertAuthProfile(sql, student, "student-no-clinical");
  await sql`
    insert into public.regulators(id, country_code, authority_code, authority_name)
    values (${regulator}, 'BD', ${`QA-STU-${student.slice(0, 8)}`}, 'QA Student Regulator')
  `;
  await sql`
    insert into public.regulator_professions(regulator_id, profession)
    values (${regulator}, 'MEDICAL_STUDENT')
  `;
  await sql`
    insert into public.medical_institutions(
      id, country_code, name, institution_type, regulator_id
    ) values (
      ${institution}, 'BD', ${`QA Medical College ${student.slice(0, 8)}`},
      'MEDICAL_COLLEGE', ${regulator}
    )
  `;
  const [studentProfile] = await sql`
    insert into public.medical_student_profiles(profile_id)
    values (${student}) returning id
  `;
  const [enrollment] = await sql`
    insert into public.student_enrollments(
      medical_student_profile_id, medical_institution_id,
      institution_country_code, student_id_display, programme,
      started_on, expected_graduation, verification_status,
      verification_method, verified_at
    ) values (
      ${studentProfile.id}, ${institution}, 'BD', 'QA-STUDENT-1', 'MBBS',
      current_date - 365, current_date + 365, 'VERIFIED',
      'MANUAL_REVIEW', clock_timestamp() - interval '1 day'
    ) returning id
  `;

  const caps = await sql`
    select capability, granted_by_kind, source_row_id, professional_profile_id
    from public.profile_capabilities where profile_id=${student}
    order by capability
  `;
  assert(caps.length === 2, `student projection expected 2 capabilities, got ${caps.length}`);
  const publicCap = caps.find((row) => row.capability === "PUBLIC");
  const studentCap = caps.find((row) => row.capability === "MEDICAL_STUDENT");
  assert(Boolean(publicCap), "student baseline PUBLIC capability missing");
  assert(Boolean(studentCap), "verified enrollment did not project MEDICAL_STUDENT");
  assert(studentCap.granted_by_kind === "ENROLLMENT", "student capability provenance kind is not ENROLLMENT");
  assert(studentCap.source_row_id === enrollment.id, "student capability source row mismatch");
  assert(studentCap.professional_profile_id === null, "student capability unexpectedly points to a professional profile");
  assert(!caps.some((row) => row.capability === "DOCTOR"), "student enrollment projected DOCTOR capability");

  const [identity] = await asAuthenticated(sql, student, () => sql`
    select public.current_profile_id() as profile_id,
           public.current_doctor_id() as doctor_id,
           public.has_capability(${student}, 'MEDICAL_STUDENT') as student_capability,
           public.has_capability(${student}, 'DOCTOR') as doctor_capability
  `);
  assert(identity.profile_id === student, "student request identity mismatch");
  assert(identity.doctor_id === null, "student resolved a doctor professional identity");
  assert(identity.student_capability === true, "student capability not usable");
  assert(identity.doctor_capability === false, "student obtained DOCTOR capability");

  const [clinicalRead] = await asAuthenticated(sql, student, () => sql`
    select count(*)::int as n from public.clinical_patients
  `);
  assert(clinicalRead.n === 0, "student could read private clinical patient rows");

  for (const [label, action] of [
    ["student cannot create clinical patient", () => sql`select public.create_clinical_patient('Forbidden', ${crypto.randomUUID()})`],
    ["student cannot open consultation", () => sql`select public.open_encounter(${crypto.randomUUID()}, ${crypto.randomUUID()})`],
    ["student cannot open prescription", () => sql`select public.open_prescription(${crypto.randomUUID()})`],
  ]) {
    await expectAuthenticatedSqlFailure(sql, student, label, action, ["42501"]);
  }

  const credentialError = await expectAuthenticatedSqlFailure(
    sql,
    student,
    "student capability is not professional credential authority",
    () => sql`select public.submit_credential(${regulator}, 'STUDENT-AS-DOCTOR', null)`,
    ["P0001"],
  );
  assert(
    String(credentialError.message).includes("PROFESSIONAL_PROFILE_REQUIRED"),
    `unexpected credential denial: ${credentialError.message}`,
  );
  const [professional] = await sql`
    select count(*)::int as n from public.professional_profiles where profile_id=${student}
  `;
  assert(professional.n === 0, "student fixture acquired a professional profile");

  console.log("verify-student-no-clinical: PASS (student projection only; clinical read/create/consult/prescribe denied; no professional credential authority)");
  await sql.unsafe("rollback");
} catch (error) {
  try { await sql.unsafe("rollback"); } catch {}
  throw error;
} finally {
  await sql.end({ timeout: 5 });
}
