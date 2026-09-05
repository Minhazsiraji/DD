import crypto from "node:crypto";
import {
  assert,
  openLocalAdminDatabase,
  qaEmail,
} from "./p0-b2-lib.mjs";

const sql = openLocalAdminDatabase();

const secret = crypto.randomBytes(32);

let trustedBookingSavepointCounter = 0;

function digest(value) {
  return crypto
    .createHmac("sha256", secret)
    .update(String(value))
    .digest();
}

async function createProfile(label) {
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
      ${qaEmail(label)},
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

async function trustedBooking({
  chamberId,
  slot,
  contactName,
  phoneRaw = null,
  email = null,
}) {
  const sessionRef = crypto.randomUUID();
  let publicBookingRef = null;
  trustedBookingSavepointCounter += 1;
  const savepoint = `dd_phone_booking_${trustedBookingSavepointCounter}`;

  await sql.unsafe(`savepoint ${savepoint}`);

  try {
    await sql.unsafe(
      "set session authorization dd_public_ingress",
    );

    await sql`
      select public.set_public_ingress_context(
        ${sessionRef},
        clock_timestamp(),
        ${digest(`session:${sessionRef}`)},
        ${digest("network:phone-verifier")},
        ${digest(`chamber:${chamberId}`)},
        'PUBLIC_WEB'::public.appointment_source,
        ${crypto.randomUUID()}
      )
    `;

    const rows = await sql`
      select *
      from public.create_public_booking(
        ${chamberId},
        ${slot},
        ${contactName},
        ${phoneRaw},
        ${email},
        'en'
      )
    `;

    assert(
      rows.length === 1 &&
        rows[0].public_booking_ref,
      "public booking failed in phone verifier",
    );

    publicBookingRef = rows[0].public_booking_ref;

    await sql.unsafe(
      "reset session authorization",
    );
    await sql.unsafe(`release savepoint ${savepoint}`);
  } catch (error) {
    await sql.unsafe(`rollback to savepoint ${savepoint}`);
    await sql.unsafe("reset session authorization");
    await sql.unsafe(`release savepoint ${savepoint}`);
    throw error;
  }

  /* Inspect persisted state only after leaving the ingress identity. The
   * ingress role intentionally has zero direct table read authority. */
  const [appointment] = await sql`
    select id
    from public.appointments
    where public_booking_ref =
      ${publicBookingRef}
  `;

  assert(
    appointment,
    "phone verifier booking appointment missing",
  );

  const [contact] = await sql`
    select
      appointment_id,
      phone_raw,
      phone_e164,
      phone_country_hint,
      email
    from public.public_booking_contacts
    where appointment_id = ${appointment.id}
  `;

  assert(
    contact,
    "phone verifier contact companion missing",
  );

  return {
    appointmentId: appointment.id,
    contact,
  };
}

async function asAuthenticated(
  profileId,
  action,
) {
  await sql`
    select set_config(
      'request.jwt.claim.sub',
      ${profileId},
      true
    )
  `;

  await sql.unsafe(
    "set local role authenticated",
  );

  try {
    return await action();
  } finally {
    await sql.unsafe("reset role");
  }
}

try {
  await sql.unsafe("begin");

  /*
   * ---------------------------------------------------------------
   * STRUCTURAL CONTRACT:
   * public_booking_contacts has exactly the canonical three phone fields.
   * ---------------------------------------------------------------
   */
  const phoneColumns = await sql`
    select column_name
    from information_schema.columns
    where table_schema = 'public'
      and table_name =
        'public_booking_contacts'
      and column_name like 'phone%'
    order by column_name
  `;

  const actualPhoneColumns =
    phoneColumns.map(
      (row) => row.column_name,
    );

  const expectedPhoneColumns = [
    "phone_country_hint",
    "phone_e164",
    "phone_raw",
  ];

  assert(
    JSON.stringify(actualPhoneColumns) ===
      JSON.stringify(expectedPhoneColumns),
    `unexpected public booking phone shape: ${
      JSON.stringify(actualPhoneColumns)
    }`,
  );

  const normalizedColumns = await sql`
    select
      table_name,
      column_name
    from information_schema.columns
    where table_schema = 'public'
      and (
        lower(column_name) =
          'phone_normalized'
        or lower(column_name) like
          '%phone%normalized%'
        or lower(column_name) like
          '%phone%digits%'
      )
    order by table_name, column_name
  `;

  assert(
    normalizedColumns.length === 0,
    `forbidden phone normalization/digits column(s): ${
      normalizedColumns
        .map(
          (row) =>
            `${row.table_name}.${row.column_name}`,
        )
        .join(",")
    }`,
  );

  /*
   * E164 column must have a structural +E164 check.
   */
  const contactChecks = await sql`
    select pg_get_constraintdef(c.oid)
      as definition
    from pg_constraint c
    join pg_class t
      on t.oid = c.conrelid
    join pg_namespace n
      on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname =
        'public_booking_contacts'
      and c.contype = 'c'
  `;

  const contactCheckText =
    contactChecks
      .map((row) => row.definition)
      .join("\n");

  assert(
    contactCheckText.includes(
      "phone_e164",
    ) &&
      (
        contactCheckText.includes(
          "[+][1-9]"
        ) ||
        contactCheckText.includes(
          "\\+[1-9]"
        )
      ),
    "public_booking_contacts E164 structural constraint missing",
  );

  /*
   * ---------------------------------------------------------------
   * PHONE HANDLING IMPLEMENTATION MUST NOT USE DIGITS-ONLY GUESSING.
   * ---------------------------------------------------------------
   */
  const phoneFunctions = await sql`
    select
      p.proname,
      pg_get_functiondef(p.oid)
        as definition
    from pg_proc p
    join pg_namespace n
      on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'create_public_booking',
        'correct_public_booking_contact',
        'register_public_booking_patient'
      )
    order by p.proname
  `;

  assert(
    phoneFunctions.length === 3,
    `expected 3 P0 phone-handling functions, found ${phoneFunctions.length}`,
  );

  for (const fn of phoneFunctions) {
    const lower =
      fn.definition.toLowerCase();

    assert(
      !lower.includes(
        "phone_normalized",
      ),
      `${fn.proname}: forbidden phone_normalized use`,
    );

    assert(
      !lower.includes(
        "regexp_replace"
      ),
      `${fn.proname}: digits-only phone rewriting detected`,
    );

    assert(
      !lower.includes(
        "'880'"
      ) &&
        !lower.includes(
          "'+880'"
        ),
      `${fn.proname}: Bangladesh country-code guessing is hard-coded`,
    );
  }

  /*
   * ---------------------------------------------------------------
   * PUBLIC DOCTOR / CHAMBER FIXTURE
   * ---------------------------------------------------------------
   */
  const doctorProfileId =
    await createProfile(
      "phone-contract-doctor",
    );

  const regulatorId =
    crypto.randomUUID();

  await sql`
    insert into public.regulators (
      id,
      country_code,
      authority_code,
      authority_name
    ) values (
      ${regulatorId},
      'BD',
      'QA-PHONE',
      'QA Phone Contract Regulator'
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
      profession,
      profile_visibility
    ) values (
      ${doctorProfileId},
      'QA Phone Contract Doctor',
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
      ${professional.id},
      ${regulatorId},
      'BD',
      'DOCTOR',
      'QA-PHONE-001',
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
      'QA Phone Contract Chamber',
      'PERSONAL_CHAMBER',
      'BD',
      'Asia/Dhaka',
      true,
      true,
      ${doctorProfileId}
    )
    returning id, timezone, country_code
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
      ${doctorProfileId},
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
      ${professional.id},
      ${location.id}
    )
    returning id
  `;

  const [slotFixture] = await sql`
    select
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
      ) at time zone ${location.timezone}
        as slot_email,

      (
        (
          (
            clock_timestamp()
            at time zone ${location.timezone}
          )::date + 1
        )::date + time '10:30'
      ) at time zone ${location.timezone}
        as slot_e164,

      (
        (
          (
            clock_timestamp()
            at time zone ${location.timezone}
          )::date + 1
        )::date + time '11:00'
      ) at time zone ${location.timezone}
        as slot_local
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
   * ---------------------------------------------------------------
   * CASE 1: EMAIL-ONLY BOOKING
   * ---------------------------------------------------------------
   */
  const emailOnly =
    await trustedBooking({
      chamberId: chamber.id,
      slot: slotFixture.slot_email,
      contactName:
        "QA Email Only Contact",
      phoneRaw: null,
      email:
        "qa.email.only@example.invalid",
    });

  assert(
    emailOnly.contact.phone_raw ===
      null &&
      emailOnly.contact.phone_e164 ===
        null &&
      emailOnly.contact
        .phone_country_hint === null,
    "email-only booking manufactured phone fields",
  );

  console.log(
    "email-only phone fields: PASS",
  );

  /*
   * ---------------------------------------------------------------
   * CASE 2: CALLER SUPPLIES ALREADY-CANONICAL +E164
   * ---------------------------------------------------------------
   */
  const canonical =
    "+8801712345678";

  const e164Booking =
    await trustedBooking({
      chamberId: chamber.id,
      slot: slotFixture.slot_e164,
      contactName:
        "QA Canonical Contact",
      phoneRaw: canonical,
      email: null,
    });

  assert(
    e164Booking.contact.phone_raw ===
      canonical,
    "canonical phone_raw was rewritten",
  );

  assert(
    e164Booking.contact.phone_e164 ===
      canonical,
    "already-canonical +E164 was not preserved",
  );

  assert(
    e164Booking.contact
      .phone_country_hint ===
      location.country_code,
    "trusted chamber country context was not recorded",
  );

  console.log(
    "explicit +E164 preservation: PASS",
  );

  /*
   * ---------------------------------------------------------------
   * CASE 3: LOCAL NUMBER — PRESERVE RAW, DO NOT GUESS E164
   * ---------------------------------------------------------------
   */
  const localRaw =
    "01712 345678";

  const localBooking =
    await trustedBooking({
      chamberId: chamber.id,
      slot: slotFixture.slot_local,
      contactName:
        "QA Local Phone Contact",
      phoneRaw: localRaw,
      email: null,
    });

  assert(
    localBooking.contact.phone_raw ===
      localRaw,
    "local phone_raw was rewritten",
  );

  assert(
    localBooking.contact.phone_e164 ===
      null,
    "local number was guessed into E164",
  );

  assert(
    localBooking.contact
      .phone_country_hint ===
      location.country_code,
    "local phone did not retain trusted chamber-country hint",
  );

  console.log(
    "local-number no-guess behavior: PASS",
  );

  /*
   * ---------------------------------------------------------------
   * OPERATIONAL CORRECTION USES THE SAME CONTRACT.
   * Change canonical booking to a non-canonical local value:
   * raw remains exact, E164 clears, trusted location hint remains.
   * ---------------------------------------------------------------
   */
  const correctedRaw =
    "01888-123456";

  await asAuthenticated(
    doctorProfileId,
    async () => {
      const result = await sql`
        select public.correct_public_booking_contact(
          ${e164Booking.appointmentId},
          'QA Canonical Contact',
          ${correctedRaw},
          null,
          'en'
        ) as appointment_id
      `;

      assert(
        result.length === 1 &&
          result[0].appointment_id ===
            e164Booking.appointmentId,
        "phone correction RPC failed",
      );
    },
  );

  const [corrected] = await sql`
    select
      phone_raw,
      phone_e164,
      phone_country_hint
    from public.public_booking_contacts
    where appointment_id =
      ${e164Booking.appointmentId}
  `;

  assert(
    corrected.phone_raw ===
      correctedRaw,
    "corrected local raw phone was rewritten",
  );

  assert(
    corrected.phone_e164 === null,
    "corrected local phone was guessed into E164",
  );

  assert(
    corrected.phone_country_hint ===
      location.country_code,
    "corrected phone lost trusted location country hint",
  );

  console.log(
    "contact-correction phone contract: PASS",
  );

  /*
   * ---------------------------------------------------------------
   * INVALID '+' FORM IS NOT SILENTLY CANONICALIZED.
   * ---------------------------------------------------------------
   */
  const badPlus =
    "+012345678";

  await asAuthenticated(
    doctorProfileId,
    async () => {
      await sql`
        select public.correct_public_booking_contact(
          ${localBooking.appointmentId},
          'QA Local Phone Contact',
          ${badPlus},
          null,
          'en'
        )
      `;
    },
  );

  const [invalidCanonical] = await sql`
    select
      phone_raw,
      phone_e164,
      phone_country_hint
    from public.public_booking_contacts
    where appointment_id =
      ${localBooking.appointmentId}
  `;

  assert(
    invalidCanonical.phone_raw ===
      badPlus,
    "invalid plus-format raw phone was rewritten",
  );

  assert(
    invalidCanonical.phone_e164 ===
      null,
    "invalid +0... value was incorrectly accepted as E164",
  );

  assert(
    invalidCanonical
      .phone_country_hint ===
      location.country_code,
    "invalid canonical attempt lost trusted country context",
  );

  console.log(
    "invalid +E164 rejection: PASS",
  );

  console.log(
    "verify-phone-canonicalization: PASS " +
    "(canonical 3-field model + no phone_normalized + " +
    "email-only nulls + explicit +E164 preservation + no country guessing)",
  );
} finally {
  try {
    await sql.unsafe("rollback");
  } finally {
    await sql.end();
  }
}
