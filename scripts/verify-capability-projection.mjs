import crypto from "node:crypto";
import {
  assert,
  expectSqlFailure,
  openLocalAdminDatabase,
  qaEmail,
} from "./p0-b2-lib.mjs";
import { insertAuthProfile } from "./p1-proof-lib.mjs";

const sql = openLocalAdminDatabase();

const applicationRoles = [
  "anon",
  "authenticated",
  "dd_owner_analytics",
  "dd_metrics_reader",
  "dd_metrics_rollup",
  "dd_public_ingress",
];

function canonicalRows(rows) {
  return rows
    .map((row) => [
      row.profile_id,
      row.capability,
      row.granted_by_kind,
      row.source_row_id,
      row.professional_profile_id,
    ].join("|"))
    .sort();
}

async function createDoctorFixture({
  label,
  regulatorId,
  status,
  verifiedAtSql,
  expiresAtSql,
}) {
  const profileId = crypto.randomUUID();

  await sql`
    insert into auth.users (
      instance_id,
      id,
      aud,
      role,
      email,
      encrypted_password,
      email_confirmed_at,
      created_at,
      updated_at,
      raw_app_meta_data,
      raw_user_meta_data,
      confirmation_token,
      recovery_token,
      email_change,
      email_change_token_new,
      email_change_token_current,
      phone_change,
      phone_change_token,
      reauthentication_token
    ) values (
      '00000000-0000-0000-0000-000000000000',
      ${profileId},
      'authenticated',
      'authenticated',
      ${qaEmail(`capability-${label}`)},
      '',
      now(),
      now(),
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{}'::jsonb,
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      ''
    )
  `;

  await sql`
    insert into public.profiles (
      id,
      full_name,
      onboarded_at
    ) values (
      ${profileId},
      ${`QA ${label}`},
      now()
    )
  `;

  const [professional] = await sql`
    insert into public.professional_profiles (
      profile_id,
      display_name,
      profession
    ) values (
      ${profileId},
      ${`QA ${label}`},
      'DOCTOR'
    )
    returning id
  `;

  const [credential] = await sql.unsafe(`
    insert into public.professional_credentials (
      professional_profile_id,
      regulator_id,
      country_code,
      profession,
      registration_display,
      verification_status,
      verified_at,
      expires_at,
      source_kind
    ) values (
      '${professional.id}'::uuid,
      '${regulatorId}'::uuid,
      'BD',
      'DOCTOR',
      'QA-${label.toUpperCase()}',
      '${status}',
      ${verifiedAtSql},
      ${expiresAtSql},
      'STAFF_VERIFIED'
    )
    returning id
  `);

  return {
    label,
    profileId,
    professionalId: professional.id,
    credentialId: credential.id,
    status,
  };
}

async function createStudentFixture({
  label,
  institutionId,
  verificationStatus,
  verifiedAtSql,
  endedOnSql = "null",
  profileStatus = "ACTIVE",
}) {
  const profileId = crypto.randomUUID();
  await insertAuthProfile(sql, profileId, `capability-student-${label}`);
  const [studentProfile] = await sql`
    insert into public.medical_student_profiles(profile_id, status)
    values (${profileId}, ${profileStatus}::medical_student_status)
    returning id
  `;
  const studentId = `QA-STU-${label}-${profileId.slice(0, 6)}`;
  const [enrollment] = await sql.unsafe(`
    insert into public.student_enrollments(
      medical_student_profile_id, medical_institution_id,
      institution_country_code, student_id_display, programme,
      started_on, expected_graduation, ended_on,
      verification_status, verification_method, verified_at
    ) values (
      '${studentProfile.id}'::uuid, '${institutionId}'::uuid,
      'BD', '${studentId}', 'MBBS', current_date - 365, current_date + 365,
      ${endedOnSql}, '${verificationStatus}', 'MANUAL_REVIEW', ${verifiedAtSql}
    ) returning id
  `);
  return {
    label,
    profileId,
    studentProfileId: studentProfile.id,
    enrollmentId: enrollment.id,
    verificationStatus,
    profileStatus,
  };
}

try {
  await sql.unsafe("begin");

  const regulatorId = crypto.randomUUID();

  await sql`
    insert into public.regulators (
      id,
      country_code,
      authority_code,
      authority_name
    ) values (
      ${regulatorId},
      'BD',
      'QA-CAP-SET',
      'QA Capability Projection Regulator'
    )
  `;

  await sql`
    insert into public.regulator_professions (
      regulator_id,
      profession
    ) values (
      ${regulatorId},
      'DOCTOR'
    )
  `;

  /*
   * Synthetic credential-source matrix.
   *
   * Only VERIFIED + already-verified + currently-unexpired is expected
   * to project credential-derived DOCTOR authority.
   */
  const fixtures = [];
  let studentFixtures = [];

  fixtures.push(await createDoctorFixture({
    label: "verified-live",
    regulatorId,
    status: "VERIFIED",
    verifiedAtSql: "clock_timestamp() - interval '1 day'",
    expiresAtSql: "clock_timestamp() + interval '30 days'",
  }));

  fixtures.push(await createDoctorFixture({
    label: "verified-expired-time",
    regulatorId,
    status: "VERIFIED",
    verifiedAtSql: "clock_timestamp() - interval '2 days'",
    expiresAtSql: "clock_timestamp() - interval '1 day'",
  }));

  fixtures.push(await createDoctorFixture({
    label: "verified-future",
    regulatorId,
    status: "VERIFIED",
    verifiedAtSql: "clock_timestamp() + interval '1 day'",
    expiresAtSql: "clock_timestamp() + interval '30 days'",
  }));

  for (const status of [
    "SUSPENDED",
    "EXPIRED",
    "PENDING",
    "UNVERIFIED",
    "NEEDS_INFORMATION",
    "REJECTED",
    "REVOKED",
  ]) {
    fixtures.push(await createDoctorFixture({
      label: status.toLowerCase().replaceAll("_", "-"),
      regulatorId,
      status,
      verifiedAtSql: "clock_timestamp() - interval '1 day'",
      expiresAtSql: "clock_timestamp() + interval '30 days'",
    }));
  }

  /*
   * Explicit rebuild/recompute from canonical source rows.
   */
  for (const fixture of fixtures) {
    await sql`
      select public.refresh_profile_capabilities(
        ${fixture.profileId}
      )
    `;
  }

  const fixtureProfileIds = fixtures.map((f) => f.profileId);

  const actualCredentialProjection = await sql`
    select
      profile_id,
      capability,
      granted_by_kind,
      source_row_id,
      professional_profile_id
    from public.profile_capabilities
    where profile_id = any(${fixtureProfileIds})
      and granted_by_kind = 'CREDENTIAL'
    order by
      profile_id,
      capability,
      source_row_id
  `;

  /*
   * Expected source-derived set, independently derived from the fixture
   * contract. Only the VERIFIED live fixture qualifies.
   */
  const liveFixture = fixtures.find(
    (f) => f.label === "verified-live",
  );

  assert(liveFixture, "VERIFIED live fixture missing");

  const expectedCredentialProjection = [{
    profile_id: liveFixture.profileId,
    capability: "DOCTOR",
    granted_by_kind: "CREDENTIAL",
    source_row_id: liveFixture.credentialId,
    professional_profile_id: liveFixture.professionalId,
  }];

  const actualSet = canonicalRows(actualCredentialProjection);
  const expectedSet = canonicalRows(expectedCredentialProjection);

  assert(
    JSON.stringify(actualSet) === JSON.stringify(expectedSet),
    "credential-derived projection set mismatch\n" +
    `expected=${JSON.stringify(expectedSet)}\n` +
    `actual=${JSON.stringify(actualSet)}`,
  );

  assert(
    actualCredentialProjection.every(
      (row) => row.capability === "DOCTOR",
    ),
    "P0 credential projection produced a non-DOCTOR capability",
  );

  assert(
    actualCredentialProjection.every(
      (row) =>
        row.granted_by_kind === "CREDENTIAL" &&
        row.source_row_id &&
        row.professional_profile_id,
    ),
    "credential projection provenance is incomplete",
  );

  /*
   * Every non-live fixture must have no usable DOCTOR authority.
   */
  for (const fixture of fixtures) {
    const [usable] = await sql`
      select public.has_capability(
        ${fixture.profileId},
        'DOCTOR'
      ) as allowed
    `;

    const expectedAllowed = fixture.label === "verified-live";

    assert(
      usable.allowed === expectedAllowed,
      `${fixture.label}: expected DOCTOR usable=${expectedAllowed}, ` +
      `got ${usable.allowed}`,
    );
  }

  /*
   * P1 student-enrollment source matrix.
   * Only ACTIVE profile + VERIFIED + already-verified + non-ended enrollment
   * may project MEDICAL_STUDENT. This is independent from DOCTOR authority.
   */
  await sql`
    insert into public.regulator_professions(regulator_id, profession)
    values (${regulatorId}, 'MEDICAL_STUDENT')
  `;
  const institutionId = crypto.randomUUID();
  await sql`
    insert into public.medical_institutions(
      id, country_code, name, institution_type, regulator_id
    ) values (
      ${institutionId}, 'BD', 'QA Capability Medical College',
      'MEDICAL_COLLEGE', ${regulatorId}
    )
  `;

  studentFixtures = [
    await createStudentFixture({
      label: "verified-active",
      institutionId,
      verificationStatus: "VERIFIED",
      verifiedAtSql: "clock_timestamp() - interval '1 day'",
    }),
    await createStudentFixture({
      label: "pending-active",
      institutionId,
      verificationStatus: "PENDING",
      verifiedAtSql: "null",
    }),
    await createStudentFixture({
      label: "rejected-active",
      institutionId,
      verificationStatus: "REJECTED",
      verifiedAtSql: "null",
    }),
    await createStudentFixture({
      label: "verified-future",
      institutionId,
      verificationStatus: "VERIFIED",
      verifiedAtSql: "clock_timestamp() + interval '1 day'",
    }),
    await createStudentFixture({
      label: "verified-ended",
      institutionId,
      verificationStatus: "VERIFIED",
      verifiedAtSql: "clock_timestamp() - interval '2 days'",
      endedOnSql: "current_date - 1",
    }),
    await createStudentFixture({
      label: "verified-graduated",
      institutionId,
      verificationStatus: "VERIFIED",
      verifiedAtSql: "clock_timestamp() - interval '1 day'",
      profileStatus: "GRADUATED",
    }),
  ];

  for (const fixture of studentFixtures) {
    await sql`select public.refresh_profile_capabilities(${fixture.profileId})`;
  }
  const studentProfileIds = studentFixtures.map((fixture) => fixture.profileId);
  const actualEnrollmentProjection = await sql`
    select profile_id, capability, granted_by_kind, source_row_id, professional_profile_id
    from public.profile_capabilities
    where profile_id = any(${studentProfileIds}) and granted_by_kind='ENROLLMENT'
    order by profile_id, capability, source_row_id
  `;
  const liveStudent = studentFixtures.find((fixture) => fixture.label === "verified-active");
  assert(liveStudent, "VERIFIED active student fixture missing");
  const expectedEnrollmentProjection = [{
    profile_id: liveStudent.profileId,
    capability: "MEDICAL_STUDENT",
    granted_by_kind: "ENROLLMENT",
    source_row_id: liveStudent.enrollmentId,
    professional_profile_id: null,
  }];
  const actualStudentSet = canonicalRows(actualEnrollmentProjection);
  const expectedStudentSet = canonicalRows(expectedEnrollmentProjection);
  assert(
    JSON.stringify(actualStudentSet) === JSON.stringify(expectedStudentSet),
    "enrollment-derived projection set mismatch\n" +
      `expected=${JSON.stringify(expectedStudentSet)}\nactual=${JSON.stringify(actualStudentSet)}`,
  );
  assert(actualEnrollmentProjection.every((row) => row.capability === "MEDICAL_STUDENT"),
    "student enrollment projection produced a non-MEDICAL_STUDENT capability");
  assert(actualEnrollmentProjection.every((row) => row.professional_profile_id === null),
    "student enrollment projection acquired professional-profile provenance");

  for (const fixture of studentFixtures) {
    const [usable] = await sql`
      select public.has_capability(${fixture.profileId}, 'MEDICAL_STUDENT') as allowed,
             public.has_capability(${fixture.profileId}, 'DOCTOR') as doctor_allowed
    `;
    assert(usable.doctor_allowed === false, `${fixture.label}: student source granted DOCTOR`);
    assert(usable.allowed === (fixture.label === "verified-active"),
      `${fixture.label}: unexpected MEDICAL_STUDENT usable=${usable.allowed}`);
  }

  await sql`
    update public.medical_student_profiles set status='GRADUATED'
    where id=${liveStudent.studentProfileId}
  `;
  let [stale] = await sql`
    select public.has_capability(${liveStudent.profileId}, 'MEDICAL_STUDENT') as allowed
  `;
  assert(stale.allowed === false, "graduated student retained MEDICAL_STUDENT capability");
  await sql`
    update public.medical_student_profiles set status='ACTIVE'
    where id=${liveStudent.studentProfileId}
  `;
  [stale] = await sql`
    select public.has_capability(${liveStudent.profileId}, 'MEDICAL_STUDENT') as allowed
  `;
  assert(stale.allowed === true, "reactivated verified student did not regain capability");
  await sql`
    update public.student_enrollments set ended_on=current_date
    where id=${liveStudent.enrollmentId}
  `;
  [stale] = await sql`
    select public.has_capability(${liveStudent.profileId}, 'MEDICAL_STUDENT') as allowed
  `;
  assert(stale.allowed === false, "ended enrollment retained MEDICAL_STUDENT capability");

  /*
   * Read-time expiry proof:
   * create a separate VERIFIED credential that naturally expires shortly,
   * do not refresh it after time passes, and prove has_capability()
   * stops accepting the still-present projection row.
   */
  const expiring = await createDoctorFixture({
    label: "read-time-expiry",
    regulatorId,
    status: "VERIFIED",
    verifiedAtSql: "clock_timestamp() - interval '1 day'",
    expiresAtSql: "clock_timestamp() + interval '4 seconds'",
  });

  await sql`
    select public.refresh_profile_capabilities(
      ${expiring.profileId}
    )
  `;

  const [beforeExpiry] = await sql`
    select public.has_capability(
      ${expiring.profileId},
      'DOCTOR'
    ) as allowed
  `;

  assert(
    beforeExpiry.allowed === true,
    "read-time expiry fixture was not initially usable",
  );

  const beforeRows = await sql`
    select
      capability,
      granted_by_kind,
      source_row_id,
      effective_until
    from public.profile_capabilities
    where profile_id = ${expiring.profileId}
      and granted_by_kind = 'CREDENTIAL'
  `;

  assert(
    beforeRows.length === 1 &&
    beforeRows[0].capability === "DOCTOR" &&
    beforeRows[0].source_row_id === expiring.credentialId,
    "read-time expiry projection row/provenance missing",
  );

  await sql`select pg_sleep(4.25)`;

  const afterRows = await sql`
    select
      capability,
      source_row_id
    from public.profile_capabilities
    where profile_id = ${expiring.profileId}
      and granted_by_kind = 'CREDENTIAL'
  `;

  assert(
    afterRows.length === 1,
    "read-time expiry proof requires the projection row to remain present",
  );

  const [afterExpiry] = await sql`
    select public.has_capability(
      ${expiring.profileId},
      'DOCTOR'
    ) as allowed
  `;

  assert(
    afterExpiry.allowed === false,
    "expired effective_until remained usable without refresh",
  );

  /*
   * No application caller may directly INSERT / UPDATE / DELETE
   * profile_capabilities, including the narrow public-ingress role.
   */
  const existingRoles = await sql`
    select rolname
    from pg_roles
    where rolname = any(${applicationRoles})
    order by rolname
  `;

  const observedRoleNames = new Set(
    existingRoles.map((row) => row.rolname),
  );

  for (const role of applicationRoles) {
    assert(
      observedRoleNames.has(role),
      `required P0 application role missing: ${role}`,
    );
  }

  for (const role of applicationRoles) {
    if (!/^[a-z_][a-z0-9_]*$/.test(role)) {
      throw new Error(`unsafe test role name: ${role}`);
    }

    await expectSqlFailure(
      sql,
      `${role} direct profile_capabilities INSERT`,
      async () => {
        await sql.unsafe(`set local role ${role}`);

        await sql`
          insert into public.profile_capabilities (
            profile_id,
            capability,
            granted_by_kind,
            source_row_id,
            professional_profile_id,
            effective_from,
            effective_until
          ) values (
            ${liveFixture.profileId},
            'DOCTOR',
            'CREDENTIAL',
            ${crypto.randomUUID()},
            ${liveFixture.professionalId},
            clock_timestamp(),
            clock_timestamp() + interval '1 day'
          )
        `;
      },
      ["42501"],
    );

    await expectSqlFailure(
      sql,
      `${role} direct profile_capabilities UPDATE`,
      async () => {
        await sql.unsafe(`set local role ${role}`);

        await sql`
          update public.profile_capabilities
          set effective_until = clock_timestamp() + interval '90 days'
          where profile_id = ${liveFixture.profileId}
            and capability = 'DOCTOR'
        `;
      },
      ["42501"],
    );

    await expectSqlFailure(
      sql,
      `${role} direct profile_capabilities DELETE`,
      async () => {
        await sql.unsafe(`set local role ${role}`);

        await sql`
          delete from public.profile_capabilities
          where profile_id = ${liveFixture.profileId}
            and capability = 'DOCTOR'
        `;
      },
      ["42501"],
    );
  }

  const [stillUsable] = await sql`
    select public.has_capability(
      ${liveFixture.profileId},
      'DOCTOR'
    ) as allowed
  `;

  assert(
    stillUsable.allowed === true,
    "direct-write denial tests changed canonical DOCTOR authority",
  );

  console.log(
    "verify-capability-projection: PASS " +
    `(${fixtures.length} credential fixtures; ${studentFixtures.length} student fixtures; ` +
    `exact credential+enrollment set equality; student staleness; read-time expiry; ` +
    `${applicationRoles.length} application roles x 3 writes denied)`,
  );
} finally {
  try {
    await sql.unsafe("rollback");
  } finally {
    await sql.end();
  }
}
