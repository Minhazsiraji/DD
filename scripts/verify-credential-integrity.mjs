import crypto from "node:crypto";
import {
  assert,
  expectSqlFailure,
  openLocalDatabase,
  qaEmail,
} from "./p0-b2-lib.mjs";

const sql = openLocalDatabase();

function assertForeignKeyFailure(error, columns, table, label) {
  const detail = error?.detail ?? "";

  assert(
    detail.includes(`Key (${columns})=`) &&
      detail.includes(`table "${table}"`),
    `${label}: unexpected FK failure detail: ${detail || "(none)"}`,
  );
}

try {
  await sql.unsafe("begin");

  const profileId = crypto.randomUUID();
  const doctorRegulatorId = crypto.randomUUID();
  const dentistRegulatorId = crypto.randomUUID();

  await sql`
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data,
      confirmation_token, recovery_token, email_change,
      email_change_token_new, email_change_token_current,
      phone_change, phone_change_token, reauthentication_token
    ) values (
      '00000000-0000-0000-0000-000000000000',
      ${profileId},
      'authenticated',
      'authenticated',
      ${qaEmail("credential-integrity")},
      '',
      now(), now(), now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{}'::jsonb,
      '', '', '', '', '', '', '', ''
    )
  `;

  await sql`
    insert into public.profiles (id, full_name, onboarded_at)
    values (${profileId}, 'QA Credential Doctor', now())
  `;

  const [professional] = await sql`
    insert into public.professional_profiles (
      profile_id, display_name, profession
    ) values (
      ${profileId}, 'QA Credential Doctor', 'DOCTOR'
    )
    returning id
  `;

  await sql`
    insert into public.regulators (
      id, country_code, authority_code, authority_name
    ) values
      (
        ${doctorRegulatorId},
        'BD',
        'QA-DOC',
        'QA Doctor Regulator'
      ),
      (
        ${dentistRegulatorId},
        'BD',
        'QA-DENT',
        'QA Dentist Regulator'
      )
  `;

  await sql`
    insert into public.regulator_professions (
      regulator_id, profession
    ) values
      (${doctorRegulatorId}, 'DOCTOR'),
      (${doctorRegulatorId}, 'DENTIST'),
      (${dentistRegulatorId}, 'DENTIST')
  `;

  /*
   * CI-1
   * The regulator accepts DENTIST, but this professional profile is DOCTOR.
   * Therefore only the professional_profile/profession composite FK is wrong.
   */
  const ci1 = await expectSqlFailure(
    sql,
    "CI-1 professional profile/profession mismatch",
    () => sql`
      insert into public.professional_credentials (
        professional_profile_id,
        regulator_id,
        country_code,
        profession,
        registration_display,
        verification_status,
        source_kind
      ) values (
        ${professional.id},
        ${doctorRegulatorId},
        'BD',
        'DENTIST',
        'QA-CI1-001',
        'UNVERIFIED',
        'SELF_ASSERTED'
      )
    `,
    ["23503"],
  );

  assertForeignKeyFailure(
    ci1,
    "professional_profile_id, profession",
    "professional_profiles",
    "CI-1",
  );

  /*
   * CI-2
   * Professional profile and profession agree, regulator supports DOCTOR,
   * but the credential country does not match the regulator's country.
   */
  const ci2 = await expectSqlFailure(
    sql,
    "CI-2 regulator/country mismatch",
    () => sql`
      insert into public.professional_credentials (
        professional_profile_id,
        regulator_id,
        country_code,
        profession,
        registration_display,
        verification_status,
        source_kind
      ) values (
        ${professional.id},
        ${doctorRegulatorId},
        'US',
        'DOCTOR',
        'QA-CI2-001',
        'UNVERIFIED',
        'SELF_ASSERTED'
      )
    `,
    ["23503"],
  );

  assertForeignKeyFailure(
    ci2,
    "regulator_id, country_code",
    "regulators",
    "CI-2",
  );

  /*
   * CI-3
   * Professional profile and country agree, but this regulator only
   * registers DENTIST and cannot issue a DOCTOR credential.
   */
  const ci3 = await expectSqlFailure(
    sql,
    "CI-3 regulator/profession mismatch",
    () => sql`
      insert into public.professional_credentials (
        professional_profile_id,
        regulator_id,
        country_code,
        profession,
        registration_display,
        verification_status,
        source_kind
      ) values (
        ${professional.id},
        ${dentistRegulatorId},
        'BD',
        'DOCTOR',
        'QA-CI3-001',
        'UNVERIFIED',
        'SELF_ASSERTED'
      )
    `,
    ["23503"],
  );

  assertForeignKeyFailure(
    ci3,
    "regulator_id, profession",
    "regulator_professions",
    "CI-3",
  );

  /*
   * Establish the legitimate baseline projection as the privileged fixture
   * owner before switching to the application role.
   */
  await sql`
    select public.refresh_profile_capabilities(${profileId})
  `;

  const baseline = await sql`
    select capability
    from public.profile_capabilities
    where profile_id = ${profileId}
    order by capability
  `;

  assert(
    baseline.length === 1 && baseline[0].capability === "PUBLIC",
    "fixture baseline should contain PUBLIC only",
  );

  /*
   * Application users may consume the credential projection through
   * authorized functions/policies, but may never mint or edit capability rows.
   */
  await expectSqlFailure(
    sql,
    "authenticated direct capability INSERT",
    async () => {
      await sql.unsafe("set local role authenticated");

      await sql`
        insert into public.profile_capabilities (
          profile_id,
          capability,
          granted_by_kind,
          effective_from
        ) values (
          ${profileId},
          'DOCTOR',
          'BASELINE',
          clock_timestamp()
        )
      `;
    },
    ["42501"],
  );

  await expectSqlFailure(
    sql,
    "authenticated direct capability UPDATE",
    async () => {
      await sql.unsafe("set local role authenticated");

      await sql`
        update public.profile_capabilities
        set effective_until = clock_timestamp() + interval '10 years'
        where profile_id = ${profileId}
          and capability = 'PUBLIC'
      `;
    },
    ["42501"],
  );

  await expectSqlFailure(
    sql,
    "authenticated direct capability DELETE",
    async () => {
      await sql.unsafe("set local role authenticated");

      await sql`
        delete from public.profile_capabilities
        where profile_id = ${profileId}
          and capability = 'PUBLIC'
      `;
    },
    ["42501"],
  );

  const afterAttacks = await sql`
    select capability, granted_by_kind
    from public.profile_capabilities
    where profile_id = ${profileId}
    order by capability
  `;

  assert(
    afterAttacks.length === 1 &&
      afterAttacks[0].capability === "PUBLIC" &&
      afterAttacks[0].granted_by_kind === "BASELINE",
    "direct authenticated capability attacks changed projection state",
  );

  console.log(
    "verify-credential-integrity: PASS " +
    "(CI-1, CI-2, CI-3, capability table write denial)",
  );
} finally {
  try {
    await sql.unsafe("rollback");
  } finally {
    await sql.end();
  }
}
