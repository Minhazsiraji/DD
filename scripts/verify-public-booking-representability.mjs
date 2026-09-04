import crypto from "node:crypto";
import {
  assert,
  expectSqlFailure,
  openLocalAdminDatabase,
  qaEmail,
} from "./p0-b2-lib.mjs";

const sql = openLocalAdminDatabase();

const ingressSecret = crypto.randomBytes(32);
const networkDigest = crypto
  .createHmac("sha256", ingressSecret)
  .update("203.0.113.10")
  .digest();

function digest(value) {
  return crypto
    .createHmac("sha256", ingressSecret)
    .update(value)
    .digest();
}

async function createProfile(label, email = qaEmail(label)) {
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
      ${email},
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

  return profileId;
}

async function asAuthenticated(profileId, action) {
  await sql`
    select set_config(
      'request.jwt.claim.sub',
      ${profileId},
      true
    )
  `;

  await sql.unsafe("set local role authenticated");

  try {
    return await action();
  } finally {
    await sql.unsafe("reset role");
  }
}

let trustedRpcSavepointCounter = 0;

async function trustedRpc({
  source,
  resourceKey,
  action,
}) {
  const sessionRef = crypto.randomUUID();
  const requestKey = crypto.randomUUID();

  trustedRpcSavepointCounter += 1;

  const savepoint =
    `dd_p0_trusted_rpc_${trustedRpcSavepointCounter}`;

  await sql.unsafe(`savepoint ${savepoint}`);

  try {
    await sql.unsafe(
      "set session authorization dd_public_ingress",
    );

    const [identity] = await sql`
      select
        session_user as session_user_name,
        current_user as current_user_name
    `;

    assert(
      identity.session_user_name === "dd_public_ingress",
      "trusted ingress session_user was not established",
    );

    assert(
      identity.current_user_name === "dd_public_ingress",
      "trusted ingress current_user was not established",
    );

    await sql`
      select public.set_public_ingress_context(
        ${sessionRef},
        clock_timestamp(),
        ${digest(sessionRef)},
        ${networkDigest},
        ${digest(resourceKey)},
        ${source}::public.appointment_source,
        ${requestKey}
      )
    `;

    const result = await action();

    await sql.unsafe(
      "reset session authorization",
    );

    await sql.unsafe(
      `release savepoint ${savepoint}`,
    );

    return result;
  } catch (error) {
    let cleanupError = null;

    try {
      await sql.unsafe(
        `rollback to savepoint ${savepoint}`,
      );
    } catch (candidate) {
      cleanupError = candidate;
    }

    try {
      await sql.unsafe(
        "reset session authorization",
      );
    } catch (candidate) {
      cleanupError ??= candidate;
    }

    try {
      await sql.unsafe(
        `release savepoint ${savepoint}`,
      );
    } catch (candidate) {
      cleanupError ??= candidate;
    }

    if (cleanupError) {
      const failure = new Error(
        "trustedRpc failure cleanup failed: " +
        (cleanupError?.message ?? cleanupError),
      );

      failure.cause = error;
      throw failure;
    }

    throw error;
  }
}

async function identityCounts() {
  const [row] = await sql`
    select
      (select count(*)::integer
       from public.dd_number_allocations) as dd_numbers,

      (select count(*)::integer
       from public.health_subjects) as health_subjects,

      (select count(*)::integer
       from public.health_subject_access) as subject_access,

      (select count(*)::integer
       from public.clinical_patients) as clinical_patients
  `;

  return row;
}

async function contactRead(profileId, appointmentId) {
  return asAuthenticated(profileId, async () => {
    return sql`
      select
        appointment_id,
        lifecycle_status
      from public.public_booking_contacts
      where appointment_id = ${appointmentId}
    `;
  });
}

try {
  await sql.unsafe("begin");

  /*
   * P3 subject-link object must not have been pulled into P0.
   */
  const [subjectLinkObject] = await sql`
    select
      to_regclass(
        'public.patient_subject_links'
      )::text as relation_name
  `;

  assert(
    subjectLinkObject.relation_name === null,
    "P3 patient_subject_links object unexpectedly exists in P0",
  );

  /*
   * ------------------------------------------------------------------
   * FIXTURE: PUBLIC DOCTOR / EXACT LOCATION / CHAMBER / HOURS
   * ------------------------------------------------------------------
   */
  const ownerProfileId = await createProfile(
    "booking-owner-doctor",
  );

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
      'QA-PUBLIC-BOOKING',
      'QA Public Booking Regulator'
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

  const [ownerProfessional] = await sql`
    insert into public.professional_profiles (
      profile_id,
      display_name,
      profession,
      profile_visibility
    ) values (
      ${ownerProfileId},
      'QA Public Doctor',
      'DOCTOR',
      'PUBLIC'
    )
    returning id
  `;

  await sql`
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
      ${ownerProfessional.id},
      ${regulatorId},
      'BD',
      'DOCTOR',
      'QA-PUBLIC-BOOKING-001',
      'VERIFIED',
      clock_timestamp() - interval '1 day',
      clock_timestamp() + interval '30 days',
      'STAFF_VERIFIED'
    )
  `;

  const [location] = await sql`
    insert into public.practice_locations (
      name,
      location_type,
      country_code,
      timezone,
      is_active,
      is_bookable,
      created_by
    ) values (
      'QA Public Chamber Location',
      'PERSONAL_CHAMBER',
      'BD',
      'Asia/Dhaka',
      true,
      true,
      ${ownerProfileId}
    )
    returning id, timezone
  `;

  await sql`
    insert into public.practice_memberships (
      practice_location_id,
      profile_id,
      role,
      status,
      joined_at
    ) values (
      ${location.id},
      ${ownerProfileId},
      'DOCTOR',
      'ACTIVE',
      clock_timestamp()
    )
  `;

  const [chamber] = await sql`
    insert into public.doctor_chambers (
      doctor_id,
      practice_location_id
    ) values (
      ${ownerProfessional.id},
      ${location.id}
    )
    returning id
  `;

  const [slotFixture] = await sql`
    select
      (
        (
          clock_timestamp()
          at time zone ${location.timezone}
        )::date + 1
      )::date as local_day,

      extract(
        dow from (
          (
            clock_timestamp()
            at time zone ${location.timezone}
          )::date + 1
        )
      )::integer as weekday,

      (
        (
          (
            clock_timestamp()
            at time zone ${location.timezone}
          )::date + 1
        )::date + time '10:00'
      ) at time zone ${location.timezone} as web_slot,

      (
        (
          (
            clock_timestamp()
            at time zone ${location.timezone}
          )::date + 1
        )::date + time '10:30'
      ) at time zone ${location.timezone} as app_slot,

      (
        (
          (
            clock_timestamp()
            at time zone ${location.timezone}
          )::date + 1
        )::date + time '11:00'
      ) at time zone ${location.timezone} as private_test_slot
  `;

  await sql`
    insert into public.doctor_chamber_hours (
      doctor_chamber_id,
      weekday,
      start_time,
      end_time
    ) values (
      ${chamber.id},
      ${slotFixture.weekday},
      '10:00',
      '12:00'
    )
  `;

  /*
   * ------------------------------------------------------------------
   * AUTHORITY FIXTURES
   * ------------------------------------------------------------------
   */

  const contactEmail = qaEmail(
    "booking-contact-match",
  );

  /*
   * Same authenticated human/email as public contact data,
   * but with no doctor/membership authority.
   */
  const assistantProfileId = await createProfile(
    "booking-contact-match",
    contactEmail,
  );

  const unrelatedDoctorProfileId = await createProfile(
    "booking-unrelated-doctor",
  );

  await sql`
    insert into public.professional_profiles (
      profile_id,
      display_name,
      profession
    ) values (
      ${unrelatedDoctorProfileId},
      'QA Unrelated Doctor',
      'DOCTOR'
    )
  `;

  const receptionistProfileId = await createProfile(
    "booking-receptionist",
  );

  const adminProfileId = await createProfile(
    "booking-location-admin",
  );

  const crossReceptionistProfileId = await createProfile(
    "booking-cross-receptionist",
  );

  const crossAdminProfileId = await createProfile(
    "booking-cross-admin",
  );

  await sql`
    insert into public.practice_memberships (
      practice_location_id,
      profile_id,
      role,
      status
    ) values
      (
        ${location.id},
        ${receptionistProfileId},
        'RECEPTIONIST',
        'ACTIVE'
      ),
      (
        ${location.id},
        ${adminProfileId},
        'LOCATION_ADMIN',
        'ACTIVE'
      )
  `;

  const [otherLocation] = await sql`
    insert into public.practice_locations (
      name,
      location_type,
      country_code,
      timezone,
      is_active,
      is_bookable,
      created_by
    ) values (
      'QA Other Location',
      'PERSONAL_CHAMBER',
      'BD',
      'Asia/Dhaka',
      true,
      true,
      ${ownerProfileId}
    )
    returning id
  `;

  await sql`
    insert into public.practice_memberships (
      practice_location_id,
      profile_id,
      role,
      status
    ) values
      (
        ${otherLocation.id},
        ${crossReceptionistProfileId},
        'RECEPTIONIST',
        'ACTIVE'
      ),
      (
        ${otherLocation.id},
        ${crossAdminProfileId},
        'LOCATION_ADMIN',
        'ACTIVE'
      )
  `;

  /*
   * Pre-existing health subject/access fixture.
   * It exists BEFORE public booking, so count equality can prove
   * public booking created no DD number / subject / authority row.
   */
  const subjectId = crypto.randomUUID();

  await sql`
    insert into public.dd_number_allocations (
      dd_patient_number
    ) values (
      'QA-PREEXISTING-SUBJECT'
    )
  `;

  await sql`
    insert into public.health_subjects (
      id,
      dd_patient_number,
      kind,
      full_name,
      sex
    ) values (
      ${subjectId},
      'QA-PREEXISTING-SUBJECT',
      'DEPENDENT',
      'QA Existing Subject',
      'OTHER'
    )
  `;

  await sql`
    update public.dd_number_allocations
    set health_subject_id = ${subjectId}
    where dd_patient_number = 'QA-PREEXISTING-SUBJECT'
  `;

  await sql`
    insert into public.health_subject_access (
      health_subject_id,
      profile_id,
      authority
    ) values (
      ${subjectId},
      ${assistantProfileId},
      'GUARDIAN'
    )
  `;

  /*
   * Existing owner/foreign patients also predate booking.
   * They let us prove public contact is not auto-matched.
   */
  const [ownerPatient] = await sql`
    insert into public.clinical_patients (
      owner_doctor_id,
      patient_number,
      full_name,
      phone_raw,
      phone_e164,
      email
    ) values (
      ${ownerProfessional.id},
      'QA-OWNER-000001',
      'Confirmed Existing Patient',
      '+8801700000001',
      '+8801700000001',
      'existing.patient@example.invalid'
    )
    returning id, full_name, phone_raw, phone_e164, email
  `;

  const foreignProfileId = await createProfile(
    "booking-foreign-doctor",
  );

  const [foreignProfessional] = await sql`
    insert into public.professional_profiles (
      profile_id,
      display_name,
      profession
    ) values (
      ${foreignProfileId},
      'QA Foreign Doctor',
      'DOCTOR'
    )
    returning id
  `;

  const [foreignPatient] = await sql`
    insert into public.clinical_patients (
      owner_doctor_id,
      patient_number,
      full_name,
      phone_raw,
      phone_e164
    ) values (
      ${foreignProfessional.id},
      'QA-FOREIGN-000001',
      'QA Foreign Patient',
      '+8801999999999',
      '+8801999999999'
    )
    returning id
  `;

  /*
   * ------------------------------------------------------------------
   * RPC INPUT CONTRACT
   * ------------------------------------------------------------------
   */
  const [bookingSignature] = await sql`
    select
      p.pronargs,
      p.proargnames[1:p.pronargs] as input_arg_names
    from pg_proc p
    join pg_namespace n
      on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'create_public_booking'
      and oidvectortypes(p.proargtypes) =
        'uuid, timestamp with time zone, text, text, text, text'
  `;

  assert(
    bookingSignature.pronargs === 6,
    `create_public_booking must have 6 inputs, found ${bookingSignature.pronargs}`,
  );

  assert(
    JSON.stringify(bookingSignature.input_arg_names) ===
      JSON.stringify([
        "chamber_id",
        "requested_slot",
        "contact_name",
        "phone_raw",
        "email",
        "locale",
      ]),
    `unexpected create_public_booking inputs: ${
      JSON.stringify(bookingSignature.input_arg_names)
    }`,
  );

  assert(
    !bookingSignature.input_arg_names.includes(
      "visit_type",
    ),
    "public caller can supply visit_type",
  );

  assert(
    !bookingSignature.input_arg_names.includes("mode"),
    "public caller can supply appointment mode",
  );

  const beforeBooking = await identityCounts();

  /*
   * ------------------------------------------------------------------
   * GENUINE PUBLIC_WEB BOOKING
   * ------------------------------------------------------------------
   */
  const webResult = await trustedRpc({
    source: "PUBLIC_WEB",
    resourceKey: chamber.id,
    action: async () => sql`
      select *
      from public.create_public_booking(
        ${chamber.id},
        ${slotFixture.web_slot},
        'QA Anonymous Contact',
        null,
        ${contactEmail},
        'en'
      )
    `,
  });

  assert(
    webResult.length === 1 &&
      webResult[0].public_booking_ref,
    "PUBLIC_WEB booking did not return exactly one booking ref",
  );

  assert(
    JSON.stringify(Object.keys(webResult[0]).sort()) ===
      JSON.stringify(["public_booking_ref"]),
    "create_public_booking return shape is not exact",
  );

  const [webAppointment] = await sql`
    select
      id,
      owner_doctor_id,
      practice_location_id,
      doctor_chamber_id,
      clinical_patient_id,
      health_subject_id,
      booked_by_profile_id,
      scheduled_at,
      session_date,
      duration_minutes,
      visit_type,
      mode,
      source_channel,
      status,
      public_booking_ref
    from public.appointments
    where public_booking_ref =
      ${webResult[0].public_booking_ref}
  `;

  assert(
    webAppointment,
    "canonical appointment row missing",
  );

  assert(
    webAppointment.owner_doctor_id ===
      ownerProfessional.id,
    "public booking owner doctor was not derived from exact chamber",
  );

  assert(
    webAppointment.practice_location_id === location.id,
    "public booking location was not derived from exact chamber",
  );

  assert(
    webAppointment.doctor_chamber_id === chamber.id,
    "exact public chamber was not preserved",
  );

  assert(
    webAppointment.clinical_patient_id === null &&
      webAppointment.health_subject_id === null &&
      webAppointment.booked_by_profile_id === null,
    "genuine public booking fabricated clinical/subject/profile identity",
  );

  assert(
    webAppointment.duration_minutes === 30,
    "public booking duration is not exactly 30",
  );

  assert(
    webAppointment.visit_type ===
      "GENERAL_CONSULTATION",
    "public booking visit_type is not deterministic GENERAL_CONSULTATION",
  );

  assert(
    webAppointment.mode === "IN_PERSON",
    "public booking mode is not deterministic IN_PERSON",
  );

  assert(
    webAppointment.status === "SCHEDULED",
    "public booking initial status is not SCHEDULED",
  );

  assert(
    webAppointment.source_channel === "PUBLIC_WEB",
    "trusted PUBLIC_WEB source was not preserved",
  );

  const webContacts = await sql`
    select
      appointment_id,
      contact_name,
      phone_raw,
      phone_e164,
      phone_country_hint,
      email,
      locale,
      lifecycle_status
    from public.public_booking_contacts
    where appointment_id = ${webAppointment.id}
  `;

  assert(
    webContacts.length === 1,
    `PUBLIC_WEB booking expected exactly 1 contact companion, found ${webContacts.length}`,
  );

  assert(
    webContacts[0].lifecycle_status === "ACTIVE",
    "new public contact lifecycle is not ACTIVE",
  );

  assert(
    webContacts[0].phone_raw === null &&
      webContacts[0].phone_e164 === null &&
      webContacts[0].phone_country_hint === null,
    "email-only booking created phone canonicalization data",
  );

  const afterWebBooking = await identityCounts();

  assert(
    JSON.stringify(afterWebBooking) ===
      JSON.stringify(beforeBooking),
    "public booking created DD/subject/access/clinical-patient identity side effects",
  );

  /*
   * Exactly the P0 public companion exists; prohibited identity/authority
   * columns must not appear on it.
   */
  const contactColumns = await sql`
    select column_name
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'public_booking_contacts'
    order by ordinal_position
  `;

  const contactColumnSet = new Set(
    contactColumns.map((r) => r.column_name),
  );

  for (const prohibited of [
    "public_booking_ref",
    "health_subject_id",
    "clinical_patient_id",
    "booked_by_profile_id",
    "dd_patient_number",
    "profile_id",
    "doctor_id",
    "owner_doctor_id",
    "anon_session_ref",
    "ip",
    "user_agent",
    "authorization_token",
  ]) {
    assert(
      !contactColumnSet.has(prohibited),
      `public_booking_contacts contains prohibited column ${prohibited}`,
    );
  }

  /*
   * ------------------------------------------------------------------
   * PUBLIC_APP uses the same canonical model.
   * ------------------------------------------------------------------
   */
  const appResult = await trustedRpc({
    source: "PUBLIC_APP",
    resourceKey: chamber.id,
    action: async () => sql`
      select *
      from public.create_public_booking(
        ${chamber.id},
        ${slotFixture.app_slot},
        'QA App Contact',
        null,
        'qa.app.contact@example.invalid',
        'en'
      )
    `,
  });

  assert(
    appResult.length === 1,
    "PUBLIC_APP booking failed",
  );

  const [appAppointment] = await sql`
    select
      id,
      source_channel,
      doctor_chamber_id,
      clinical_patient_id,
      health_subject_id,
      booked_by_profile_id,
      duration_minutes,
      visit_type,
      mode,
      status
    from public.appointments
    where public_booking_ref =
      ${appResult[0].public_booking_ref}
  `;

  assert(
    appAppointment.source_channel === "PUBLIC_APP" &&
      appAppointment.doctor_chamber_id === chamber.id &&
      appAppointment.clinical_patient_id === null &&
      appAppointment.health_subject_id === null &&
      appAppointment.booked_by_profile_id === null &&
      appAppointment.duration_minutes === 30 &&
      appAppointment.visit_type === "GENERAL_CONSULTATION" &&
      appAppointment.mode === "IN_PERSON" &&
      appAppointment.status === "SCHEDULED",
    "PUBLIC_APP canonical creation contract differs from PUBLIC_WEB",
  );

  const [appContactCount] = await sql`
    select count(*)::integer as count
    from public.public_booking_contacts
    where appointment_id = ${appAppointment.id}
  `;

  assert(
    appContactCount.count === 1,
    "PUBLIC_APP did not create exactly one contact companion",
  );

  /*
   * ------------------------------------------------------------------
   * CONTACT / OPERATIONAL AUTHORITY BOUNDARY
   * ------------------------------------------------------------------
   */

  const ownerRead = await contactRead(
    ownerProfileId,
    webAppointment.id,
  );

  assert(
    ownerRead.length === 1,
    "owning doctor cannot read own booking contact",
  );

  const unrelatedDoctorRead = await contactRead(
    unrelatedDoctorProfileId,
    webAppointment.id,
  );

  assert(
    unrelatedDoctorRead.length === 0,
    "unrelated doctor read public booking contact",
  );

  const receptionistRead = await contactRead(
    receptionistProfileId,
    webAppointment.id,
  );

  assert(
    receptionistRead.length === 1,
    "exact-location receptionist cannot read booking contact",
  );

  const adminRead = await contactRead(
    adminProfileId,
    webAppointment.id,
  );

  assert(
    adminRead.length === 1,
    "exact-location LOCATION_ADMIN cannot read booking contact",
  );

  const crossReceptionistRead = await contactRead(
    crossReceptionistProfileId,
    webAppointment.id,
  );

  assert(
    crossReceptionistRead.length === 0,
    "cross-location receptionist read booking contact",
  );

  const crossAdminRead = await contactRead(
    crossAdminProfileId,
    webAppointment.id,
  );

  assert(
    crossAdminRead.length === 0,
    "cross-location LOCATION_ADMIN read booking contact",
  );

  /*
   * Same email as booking contact does not confer authority.
   * This actor also holds pre-existing GUARDIAN subject authority.
   */
  const assistantRead = await contactRead(
    assistantProfileId,
    webAppointment.id,
  );

  assert(
    assistantRead.length === 0,
    "contact match / assistant-like profile became booking authority",
  );

  const [assistantPracticeRole] = await sql`
    select exists (
      select 1
      from unnest(enum_range(null::public.practice_role)) role_value
      where role_value::text = 'ASSISTANT'
    ) as assistant_is_authority_role
  `;

  assert(
    assistantPracticeRole.assistant_is_authority_role === false,
    "ASSISTANT unexpectedly became a P0 practice authority role",
  );


  /*
   * ------------------------------------------------------------------
   * SAFE EXISTING-PATIENT CANDIDATE SEARCH
   *
   * Search authority derives from this appointment only.
   * Exact E164 / exact normalized name are human candidate aids.
   * Search does not resolve or mutate patient/contact identity.
   * ------------------------------------------------------------------
   */

  const candidateByPhone =
    await asAuthenticated(
      receptionistProfileId,
      async () => sql`
        select *
        from public.search_public_booking_patient_candidates(
          ${webAppointment.id},
          '+8801700000001',
          null
        )
      `,
    );

  assert(
    candidateByPhone.length === 1 &&
      candidateByPhone[0].clinical_patient_id === ownerPatient.id,
    "exact-location receptionist could not find owner patient by exact E164",
  );

  assert(
    candidateByPhone.every(
      (row) =>
        row.clinical_patient_id !== foreignPatient.id
    ),
    "candidate search leaked a foreign-doctor patient",
  );

  const candidateByName =
    await asAuthenticated(
      receptionistProfileId,
      async () => sql`
        select *
        from public.search_public_booking_patient_candidates(
          ${webAppointment.id},
          null,
          'Confirmed Existing Patient'
        )
      `,
    );

  assert(
    candidateByName.length === 1 &&
      candidateByName[0].clinical_patient_id === ownerPatient.id,
    "exact normalized patient-name candidate search failed",
  );

  const foreignPhoneSearch =
    await asAuthenticated(
      receptionistProfileId,
      async () => sql`
        select *
        from public.search_public_booking_patient_candidates(
          ${webAppointment.id},
          '+8801999999999',
          null
        )
      `,
    );

  assert(
    foreignPhoneSearch.length === 0,
    "foreign-doctor exact E164 leaked through appointment-scoped search",
  );

  await expectSqlFailure(
    sql,
    "candidate search fuzzy/local phone",
    async () => {
      await sql`
        select set_config(
          'request.jwt.claim.sub',
          ${receptionistProfileId},
          true
        )
      `;

      await sql.unsafe("set local role authenticated");

      await sql`
        select *
        from public.search_public_booking_patient_candidates(
          ${webAppointment.id},
          '01700000001',
          null
        )
      `;
    },
    ["22023"],
  );

  await expectSqlFailure(
    sql,
    "candidate search without criteria",
    async () => {
      await sql`
        select set_config(
          'request.jwt.claim.sub',
          ${receptionistProfileId},
          true
        )
      `;

      await sql.unsafe("set local role authenticated");

      await sql`
        select *
        from public.search_public_booking_patient_candidates(
          ${webAppointment.id},
          null,
          null
        )
      `;
    },
    ["22023"],
  );

  for (const [label, profileId] of [
    ["LOCATION_ADMIN", adminProfileId],
    ["cross-location receptionist", crossReceptionistProfileId],
    ["unrelated doctor", unrelatedDoctorProfileId],
    ["contact-matched assistant profile", assistantProfileId],
  ]) {
    await expectSqlFailure(
      sql,
      `${label} candidate search`,
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
          select *
          from public.search_public_booking_patient_candidates(
            ${webAppointment.id},
            '+8801700000001',
            null
          )
        `;
      },
      ["42501"],
    );
  }

  const [afterCandidateSearchAppointment] = await sql`
    select
      clinical_patient_id,
      health_subject_id,
      source_channel
    from public.appointments
    where id = ${webAppointment.id}
  `;

  assert(
    afterCandidateSearchAppointment.clinical_patient_id === null &&
      afterCandidateSearchAppointment.health_subject_id === null &&
      afterCandidateSearchAppointment.source_channel === 'PUBLIC_WEB',
    "candidate search automatically changed booking identity",
  );

  const [afterCandidateSearchContact] = await sql`
    select lifecycle_status
    from public.public_booking_contacts
    where appointment_id = ${webAppointment.id}
  `;

  assert(
    afterCandidateSearchContact.lifecycle_status === 'ACTIVE',
    "candidate search changed booking-contact lifecycle",
  );

  console.log(
    "appointment-scoped patient candidate search: PASS",
  );


  /*
   * ------------------------------------------------------------------
   * PRIVATE / INELIGIBLE DOCTOR: no public availability or booking.
   * ------------------------------------------------------------------
   */
  await sql`
    update public.professional_profiles
    set profile_visibility = 'PRIVATE'
    where id = ${ownerProfessional.id}
  `;

  const privateAvailability = await trustedRpc({
    source: "PUBLIC_WEB",
    resourceKey: chamber.id,
    action: async () => sql`
      select *
      from public.public_chamber_availability(
        ${chamber.id}::uuid,
        ${slotFixture.local_day}::date,
        ${slotFixture.local_day}::date
      )
    `,
  });

  assert(
    privateAvailability.length === 0,
    "PRIVATE doctor exposed public availability",
  );

  const [appointmentCountBeforePrivate] = await sql`
    select count(*)::integer as count
    from public.appointments
  `;

  const privateBooking = await trustedRpc({
    source: "PUBLIC_WEB",
    resourceKey: chamber.id,
    action: async () => sql`
      select *
      from public.create_public_booking(
        ${chamber.id},
        ${slotFixture.private_test_slot},
        'QA Private Attempt',
        null,
        'qa.private@example.invalid',
        'en'
      )
    `,
  });

  assert(
    privateBooking.length === 0,
    "PRIVATE doctor accepted public booking",
  );

  const [appointmentCountAfterPrivate] = await sql`
    select count(*)::integer as count
    from public.appointments
  `;

  assert(
    appointmentCountAfterPrivate.count ===
      appointmentCountBeforePrivate.count,
    "ineligible public booking created an appointment",
  );

  await sql`
    update public.professional_profiles
    set profile_visibility = 'PUBLIC'
    where id = ${ownerProfessional.id}
  `;

  /*
   * ------------------------------------------------------------------
   * SOURCE SHAPE NEGATIVES.
   * ------------------------------------------------------------------
   */

  await expectSqlFailure(
    sql,
    "WALK_IN without clinical_patient_id",
    async () => {
      await sql`
        insert into public.appointments (
          owner_doctor_id,
          practice_location_id,
          doctor_chamber_id,
          clinical_patient_id,
          scheduled_at,
          session_date,
          visit_type,
          mode,
          source_channel,
          status
        ) values (
          ${ownerProfessional.id},
          ${location.id},
          ${chamber.id},
          null,
          ${slotFixture.private_test_slot}
            + interval '4 hours',
          ${slotFixture.local_day},
          'GENERAL_CONSULTATION',
          'IN_PERSON',
          'WALK_IN',
          'SCHEDULED'
        )
      `;
    },
    ["23514"],
  );

  await expectSqlFailure(
    sql,
    "malformed PUBLIC_WEB direct insert with patient identity",
    async () => {
      await sql`
        insert into public.appointments (
          owner_doctor_id,
          practice_location_id,
          doctor_chamber_id,
          clinical_patient_id,
          health_subject_id,
          booked_by_profile_id,
          scheduled_at,
          session_date,
          duration_minutes,
          visit_type,
          mode,
          source_channel,
          status,
          public_booking_ref
        ) values (
          ${ownerProfessional.id},
          ${location.id},
          ${chamber.id},
          ${ownerPatient.id},
          null,
          null,
          ${slotFixture.private_test_slot}
            + interval '5 hours',
          ${slotFixture.local_day},
          30,
          'GENERAL_CONSULTATION',
          'IN_PERSON',
          'PUBLIC_WEB',
          'SCHEDULED',
          ${crypto.randomUUID()}
        )
      `;
    },
    ["23514"],
  );

  const [walkIn] = await sql`
    insert into public.appointments (
      owner_doctor_id,
      practice_location_id,
      doctor_chamber_id,
      clinical_patient_id,
      scheduled_at,
      session_date,
      visit_type,
      mode,
      source_channel,
      status
    ) values (
      ${ownerProfessional.id},
      ${location.id},
      ${chamber.id},
      ${ownerPatient.id},
      ${slotFixture.private_test_slot}
        + interval '6 hours',
      ${slotFixture.local_day},
      'GENERAL_CONSULTATION',
      'IN_PERSON',
      'WALK_IN',
      'SCHEDULED'
    )
    returning id
  `;

  await expectSqlFailure(
    sql,
    "retrofit WALK_IN to PUBLIC_WEB",
    async () => {
      await sql`
        update public.appointments
        set
          source_channel = 'PUBLIC_WEB',
          public_booking_ref = ${crypto.randomUUID()}
        where id = ${walkIn.id}
      `;
    },
    ["23514"],
  );

  /*
   * ------------------------------------------------------------------
   * EXPLICIT PATIENT RESOLUTION.
   *
   * LOCATION_ADMIN must NOT resolve.
   * Wrong-doctor patient must NOT resolve.
   * Exact-location receptionist may explicitly resolve only to
   * appointment owner doctor's patient.
   * ------------------------------------------------------------------
   */

  await expectSqlFailure(
    sql,
    "LOCATION_ADMIN patient resolution",
    async () => {
      await sql`
        select set_config(
          'request.jwt.claim.sub',
          ${adminProfileId},
          true
        )
      `;

      await sql.unsafe("set local role authenticated");

      await sql`
        select public.resolve_public_booking_patient(
          ${webAppointment.id},
          ${ownerPatient.id}
        )
      `;
    },
    ["42501"],
  );

  await expectSqlFailure(
    sql,
    "receptionist foreign-doctor patient resolution",
    async () => {
      await sql`
        select set_config(
          'request.jwt.claim.sub',
          ${receptionistProfileId},
          true
        )
      `;

      await sql.unsafe("set local role authenticated");

      await sql`
        select public.resolve_public_booking_patient(
          ${webAppointment.id},
          ${foreignPatient.id}
        )
      `;
    },
    ["P0001"],
  );

  const ownerPatientBeforeResolution = await sql`
    select
      id,
      full_name,
      phone_raw,
      email
    from public.clinical_patients
    where id = ${ownerPatient.id}
  `;

  await asAuthenticated(
    receptionistProfileId,
    async () => {
      const result = await sql`
        select public.resolve_public_booking_patient(
          ${webAppointment.id},
          ${ownerPatient.id}
        ) as patient_id
      `;

      assert(
        result.length === 1 &&
          result[0].patient_id === ownerPatient.id,
        "receptionist explicit patient resolution failed",
      );
    },
  );

  const [resolvedAppointment] = await sql`
    select
      clinical_patient_id,
      health_subject_id,
      source_channel,
      public_booking_ref,
      doctor_chamber_id,
      owner_doctor_id,
      practice_location_id
    from public.appointments
    where id = ${webAppointment.id}
  `;

  assert(
    resolvedAppointment.clinical_patient_id ===
      ownerPatient.id,
    "explicit patient association was not stored",
  );

  assert(
    resolvedAppointment.health_subject_id === null,
    "patient resolution silently created health-subject association",
  );

  assert(
    resolvedAppointment.source_channel === "PUBLIC_WEB",
    "patient resolution rewrote original public source",
  );

  assert(
    resolvedAppointment.public_booking_ref ===
      webResult[0].public_booking_ref &&
      resolvedAppointment.doctor_chamber_id === chamber.id &&
      resolvedAppointment.owner_doctor_id ===
        ownerProfessional.id &&
      resolvedAppointment.practice_location_id === location.id,
    "patient resolution rewrote immutable booking provenance",
  );

  const ownerPatientAfterResolution = await sql`
    select
      id,
      full_name,
      phone_raw,
      email
    from public.clinical_patients
    where id = ${ownerPatient.id}
  `;

  assert(
    JSON.stringify(ownerPatientAfterResolution) ===
      JSON.stringify(ownerPatientBeforeResolution),
    "public contact silently overwrote existing clinical patient data",
  );

  const [resolvedContact] = await sql`
    select
      lifecycle_status,
      resolved_at
    from public.public_booking_contacts
    where appointment_id = ${webAppointment.id}
  `;

  assert(
    resolvedContact.lifecycle_status === "RESOLVED" &&
      resolvedContact.resolved_at,
    "resolved booking contact did not enter RESOLVED lifecycle",
  );

  await expectSqlFailure(
    sql,
    "normal contact correction after resolution",
    async () => {
      await sql`
        select set_config(
          'request.jwt.claim.sub',
          ${receptionistProfileId},
          true
        )
      `;

      await sql.unsafe("set local role authenticated");

      await sql`
        select public.correct_public_booking_contact(
          ${webAppointment.id},
          'Changed After Resolution',
          null,
          'changed@example.invalid',
          'en'
        )
      `;
    },
    ["P0001"],
  );

  /*
   * ------------------------------------------------------------------
   * HEALTH-SUBJECT AUTHORITY REMAINS INDEPENDENT.
   *
   * Controlled verifier-only association to an already-existing subject:
   * subject access does not grant appointment/contact/clinical authority.
   * ------------------------------------------------------------------
   */
  await sql`
    update public.appointments
    set health_subject_id = ${subjectId}
    where id = ${webAppointment.id}
  `;

  const assistantAppointmentRead = await asAuthenticated(
    assistantProfileId,
    async () => sql`
      select id
      from public.appointments
      where id = ${webAppointment.id}
    `,
  );

  assert(
    assistantAppointmentRead.length === 0,
    "health-subject access became appointment clinical authority",
  );

  const assistantContactAfterSubjectLink =
    await contactRead(
      assistantProfileId,
      webAppointment.id,
    );

  assert(
    assistantContactAfterSubjectLink.length === 0,
    "health-subject/contact association became contact authority",
  );

  /*
   * Create history before contact purge.
   */
  const [historyEvent] = await sql`
    insert into public.appointment_events (
      appointment_id,
      from_status,
      to_status,
      actor_kind,
      actor_id
    ) values (
      ${webAppointment.id},
      'SCHEDULED',
      'CONFIRMED',
      'USER',
      ${ownerProfileId}
    )
    returning id
  `;

  const [resolutionAuditBeforePurge] = await sql`
    select count(*)::integer as count
    from public.audit_events
    where action = 'PUBLIC_BOOKING_PATIENT.RESOLVED'
      and resource_id = ${webAppointment.id}
  `;

  assert(
    resolutionAuditBeforePurge.count >= 1,
    "patient-resolution audit row missing before purge test",
  );

  /*
   * Controlled retention proof: delete only operational contact PII.
   */
  await sql`
    delete from public.public_booking_contacts
    where appointment_id = ${webAppointment.id}
  `;

  const [contactAfterPurge] = await sql`
    select count(*)::integer as count
    from public.public_booking_contacts
    where appointment_id = ${webAppointment.id}
  `;

  assert(
    contactAfterPurge.count === 0,
    "contact purge did not remove operational PII row",
  );

  const [appointmentAfterPurge] = await sql`
    select
      count(*)::integer as count
    from public.appointments
    where id = ${webAppointment.id}
  `;

  assert(
    appointmentAfterPurge.count === 1,
    "contact purge broke canonical appointment history",
  );

  const [eventAfterPurge] = await sql`
    select count(*)::integer as count
    from public.appointment_events
    where id = ${historyEvent.id}
  `;

  assert(
    eventAfterPurge.count === 1,
    "contact purge broke appointment event history",
  );

  const [auditAfterPurge] = await sql`
    select count(*)::integer as count
    from public.audit_events
    where action = 'PUBLIC_BOOKING_PATIENT.RESOLVED'
      and resource_id = ${webAppointment.id}
  `;

  assert(
    auditAfterPurge.count ===
      resolutionAuditBeforePurge.count,
    "contact purge broke audit history",
  );

  const [patientAfterPurge] = await sql`
    select count(*)::integer as count
    from public.clinical_patients
    where id = ${ownerPatient.id}
  `;

  assert(
    patientAfterPurge.count === 1,
    "contact purge broke resolved clinical patient",
  );

  console.log(
    "verify-public-booking-representability: PASS " +
    "(PUBLIC_WEB/PUBLIC_APP + exact companion + no auto identity + " +
    "authority boundaries + explicit patient resolution + purge independence)",
  );
} finally {
  try {
    await sql.unsafe("rollback");
  } finally {
    await sql.end();
  }
}
