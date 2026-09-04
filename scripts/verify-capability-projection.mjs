import crypto from "node:crypto";
import { assert, openLocalDatabase, qaEmail } from "./p0-b2-lib.mjs";

const sql = openLocalDatabase();

function names(rows) {
  return rows.map((r) => r.capability).sort();
}

try {
  await sql.unsafe("begin");

  const profileId = crypto.randomUUID();
  const regulatorId = crypto.randomUUID();

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
      ${qaEmail("capability-projection")},
      '',
      now(), now(), now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{}'::jsonb,
      '', '', '', '', '', '', '', ''
    )
  `;

  await sql`
    insert into public.profiles (id, full_name, onboarded_at)
    values (${profileId}, 'QA Capability Doctor', now())
  `;

  await sql`
    insert into public.regulators (
      id, country_code, authority_code, authority_name
    ) values (
      ${regulatorId}, 'BD', 'QA-CAP', 'QA Capability Regulator'
    )
  `;

  await sql`
    insert into public.regulator_professions (regulator_id, profession)
    values (${regulatorId}, 'DOCTOR')
  `;

  const [professional] = await sql`
    insert into public.professional_profiles (
      profile_id, display_name, profession
    ) values (
      ${profileId}, 'QA Capability Doctor', 'DOCTOR'
    )
    returning id
  `;

  await sql`
    select public.refresh_profile_capabilities(${profileId})
  `;

  let projected = await sql`
    select capability, granted_by_kind, source_row_id, professional_profile_id
    from public.profile_capabilities
    where profile_id = ${profileId}
    order by capability
  `;

  assert(
    JSON.stringify(names(projected)) === JSON.stringify(["PUBLIC"]),
    `baseline projection expected PUBLIC only, got ${names(projected).join(",")}`,
  );

  const [baselineDoctor] = await sql`
    select public.has_capability(${profileId}, 'DOCTOR') as allowed
  `;

  assert(
    baselineDoctor.allowed === false,
    "PUBLIC baseline must not imply DOCTOR",
  );

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
      'QA-CAP-001',
      'VERIFIED',
      clock_timestamp() - interval '1 day',
      clock_timestamp() + interval '1 day',
      'STAFF_VERIFIED'
    )
    returning id
  `;

  projected = await sql`
    select capability, granted_by_kind, source_row_id, professional_profile_id
    from public.profile_capabilities
    where profile_id = ${profileId}
    order by capability
  `;

  assert(
    JSON.stringify(names(projected)) ===
      JSON.stringify(["DOCTOR", "PUBLIC"]),
    `VERIFIED projection expected DOCTOR+PUBLIC, got ${names(projected).join(",")}`,
  );

  const doctorRow = projected.find((r) => r.capability === "DOCTOR");

  assert(doctorRow, "DOCTOR projection row missing");
  assert(
    doctorRow.granted_by_kind === "CREDENTIAL",
    "DOCTOR must be credential-sourced",
  );
  assert(
    doctorRow.source_row_id === credential.id,
    "DOCTOR source_row_id must identify the VERIFIED credential",
  );
  assert(
    doctorRow.professional_profile_id === professional.id,
    "DOCTOR projection must identify the professional profile",
  );

  const [verifiedDoctor] = await sql`
    select public.has_capability(${profileId}, 'DOCTOR') as allowed
  `;

  assert(
    verifiedDoctor.allowed === true,
    "VERIFIED live credential must grant usable DOCTOR",
  );

  await sql`
    select public.refresh_profile_capabilities(${profileId})
  `;

  const recomputed = await sql`
    select capability, granted_by_kind, source_row_id, professional_profile_id
    from public.profile_capabilities
    where profile_id = ${profileId}
    order by capability
  `;

  assert(
    JSON.stringify(
      recomputed.map((r) => [
        r.capability,
        r.granted_by_kind,
        r.source_row_id,
        r.professional_profile_id,
      ]),
    ) ===
      JSON.stringify(
        projected.map((r) => [
          r.capability,
          r.granted_by_kind,
          r.source_row_id,
          r.professional_profile_id,
        ]),
      ),
    "recomputed credential projection differs from trigger projection",
  );

  await sql`
    update public.professional_credentials
    set expires_at = clock_timestamp() - interval '1 second'
    where id = ${credential.id}
  `;

  const [expiredByTime] = await sql`
    select public.has_capability(${profileId}, 'DOCTOR') as allowed
  `;

  assert(
    expiredByTime.allowed === false,
    "past effective_until must invalidate DOCTOR without waiting for refresh",
  );

  await sql`
    update public.professional_credentials
    set verification_status = 'EXPIRED'
    where id = ${credential.id}
  `;

  projected = await sql`
    select capability
    from public.profile_capabilities
    where profile_id = ${profileId}
    order by capability
  `;

  assert(
    JSON.stringify(names(projected)) === JSON.stringify(["PUBLIC"]),
    `EXPIRED credential must project PUBLIC only, got ${names(projected).join(",")}`,
  );

  console.log(
    "verify-capability-projection: PASS " +
    "(baseline, VERIFIED, recompute, live-expiry, EXPIRED)",
  );
} finally {
  try {
    await sql.unsafe("rollback");
  } finally {
    await sql.end();
  }
}
