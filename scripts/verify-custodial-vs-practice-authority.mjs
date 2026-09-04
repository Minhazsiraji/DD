import crypto from "node:crypto";
import {
  assert,
  expectSqlFailure,
  openLocalDatabase,
  qaEmail,
} from "./p0-b2-lib.mjs";

const sql = openLocalDatabase();

async function capabilities(profileId) {
  return sql`
    select capability
    from public.profile_capabilities
    where profile_id = ${profileId}
    order by capability
  `;
}

async function assertPublicOnly(profileId, status) {
  const rows = await capabilities(profileId);

  assert(
    rows.length === 1 && rows[0].capability === "PUBLIC",
    `${status}: expected PUBLIC only, got ${
      rows.map((r) => r.capability).join(",")
    }`,
  );

  const [usable] = await sql`
    select public.has_capability(
      ${profileId},
      'DOCTOR'
    ) as allowed
  `;

  assert(
    usable.allowed === false,
    `${status}: DOCTOR practice capability remained usable`,
  );
}

async function custodialPatientRead(profileId, patientId, status) {
  await sql`
    select set_config(
      'request.jwt.claim.sub',
      ${profileId},
      true
    )
  `;

  await sql.unsafe("set local role authenticated");

  const rows = await sql`
    select id
    from public.clinical_patients
    where id = ${patientId}
  `;

  await sql.unsafe("reset role");

  assert(
    rows.length === 1,
    `${status}: owned custodial patient read was lost`,
  );
}

async function expectPracticeDenied({
  profileId,
  patientId,
  locationId,
  prescriptionId,
  status,
}) {
  await expectSqlFailure(
    sql,
    `${status} create_clinical_patient`,
    async () => {
      await sql`
        select set_config(
          'request.jwt.claim.sub',
          ${profileId},
          true
        )
      `;

      await sql.unsafe("set local role authenticated");

      await sql`
        select public.create_clinical_patient(
          ${`Denied ${status}`},
          ${locationId}
        )
      `;
    },
    ["42501"],
  );

  await expectSqlFailure(
    sql,
    `${status} open_encounter`,
    async () => {
      await sql`
        select set_config(
          'request.jwt.claim.sub',
          ${profileId},
          true
        )
      `;

      await sql.unsafe("set local role authenticated");

      await sql`
        select public.open_encounter(
          ${patientId},
          ${locationId}
        )
      `;
    },
    ["42501"],
  );

  await expectSqlFailure(
    sql,
    `${status} finalize_prescription`,
    async () => {
      await sql`
        select set_config(
          'request.jwt.claim.sub',
          ${profileId},
          true
        )
      `;

      await sql.unsafe("set local role authenticated");

      await sql`
        select public.finalize_prescription(
          ${prescriptionId},
          1,
          '{}'::jsonb,
          'qa-digest',
          'qa/signature.png'
        )
      `;
    },
    ["42501"],
  );

  const [rx] = await sql`
    select status, version
    from public.prescriptions
    where id = ${prescriptionId}
  `;

  assert(
    rx.status === "DRAFT" && rx.version === 1,
    `${status}: denied finalization changed prescription state`,
  );
}

try {
  await sql.unsafe("begin");

  const profileId = crypto.randomUUID();
  const regulatorId = crypto.randomUUID();

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
      ${qaEmail("custodial-authority")},
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
      'QA Authority Doctor',
      now()
    )
  `;

  await sql`
    insert into public.regulators (
      id,
      country_code,
      authority_code,
      authority_name
    ) values (
      ${regulatorId},
      'BD',
      'QA-AUTH',
      'QA Authority Regulator'
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

  const [professional] = await sql`
    insert into public.professional_profiles (
      profile_id,
      display_name,
      profession
    ) values (
      ${profileId},
      'QA Authority Doctor',
      'DOCTOR'
    )
    returning id
  `;

  const [location] = await sql`
    insert into public.practice_locations (
      name,
      location_type,
      country_code,
      timezone,
      created_by
    ) values (
      'QA Authority Chamber',
      'PERSONAL_CHAMBER',
      'BD',
      'Asia/Dhaka',
      ${profileId}
    )
    returning id
  `;

  const [credential] = await sql`
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
      ${professional.id},
      ${regulatorId},
      'BD',
      'DOCTOR',
      'QA-AUTH-001',
      'VERIFIED',
      clock_timestamp() - interval '1 day',
      clock_timestamp() + interval '30 days',
      'STAFF_VERIFIED'
    )
    returning id
  `;

  /*
   * VERIFIED
   */
  let projected = await capabilities(profileId);

  assert(
    projected.some((r) => r.capability === "DOCTOR"),
    "VERIFIED: DOCTOR capability missing",
  );

  const [verifiedCapability] = await sql`
    select public.has_capability(
      ${profileId},
      'DOCTOR'
    ) as allowed
  `;

  assert(
    verifiedCapability.allowed === true,
    "VERIFIED: live practice capability denied",
  );

  await sql`
    select set_config(
      'request.jwt.claim.sub',
      ${profileId},
      true
    )
  `;

  await sql.unsafe("set local role authenticated");

  const [patientResult] = await sql`
    select public.create_clinical_patient(
      'QA Custodial Patient',
      ${location.id}
    ) as id
  `;

  const patientId = patientResult.id;

  const [encounterResult] = await sql`
    select public.open_encounter(
      ${patientId},
      ${location.id}
    ) as id
  `;

  const encounterId = encounterResult.id;

  const [prescriptionResult] = await sql`
    select public.open_prescription(
      ${encounterId}
    ) as id
  `;

  const prescriptionId = prescriptionResult.id;

  await sql.unsafe("reset role");

  assert(patientId, "VERIFIED: clinical patient creation failed");
  assert(encounterId, "VERIFIED: encounter creation failed");
  assert(prescriptionId, "VERIFIED: prescription creation failed");

  console.log("VERIFIED: PASS");

  /*
   * Every non-VERIFIED credential state must lose usable
   * practice authority.
   */
  const deniedStates = [
    "SUSPENDED",
    "EXPIRED",
    "PENDING",
    "UNVERIFIED",
    "NEEDS_INFORMATION",
    "REJECTED",
    "REVOKED",
  ];

  for (const status of deniedStates) {
    await sql`
      update public.professional_credentials
      set verification_status = ${status}
      where id = ${credential.id}
    `;

    await assertPublicOnly(profileId, status);

    /*
     * Structural doctor ownership remains separate from practice authority.
     * These two states explicitly prove the custodial-read distinction.
     */
    if (status === "SUSPENDED" || status === "EXPIRED") {
      await custodialPatientRead(
        profileId,
        patientId,
        status,
      );
    }

    await expectPracticeDenied({
      profileId,
      patientId,
      locationId: location.id,
      prescriptionId,
      status,
    });

    console.log(`${status}: PASS`);
  }

  console.log(
    "verify-custodial-vs-practice-authority: PASS " +
    "(VERIFIED + 7 denied credential states)",
  );
} finally {
  try {
    await sql.unsafe("rollback");
  } finally {
    await sql.end();
  }
}
