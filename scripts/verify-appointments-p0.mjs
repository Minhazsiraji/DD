import crypto from "node:crypto";
import postgres from "postgres";
import {
  assert,
  expectSqlFailure,
  localAdminDatabaseUrl,
  openLocalAdminDatabase,
  qaEmail,
} from "./p0-b2-lib.mjs";

const sql = openLocalAdminDatabase();
const ingressSecret = crypto.randomBytes(32);

function digest(value) {
  return crypto
    .createHmac("sha256", ingressSecret)
    .update(String(value))
    .digest();
}

function localTime(value, timezone) {
  return new Intl.DateTimeFormat(
    "en-GB",
    {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    },
  ).format(new Date(value));
}

async function createProfile(
  conn,
  label,
) {
  const profileId = crypto.randomUUID();

  await conn`
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

  await conn`
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

async function createPublicDoctorFixture(
  conn,
  {
    label,
    timezone = "Asia/Dhaka",
    countryCode = "BD",
  },
) {
  const profileId =
    await createProfile(
      conn,
      `${label}-doctor`,
    );

  const regulatorId =
    crypto.randomUUID();

  await conn`
    insert into public.regulators (
      id,
      country_code,
      authority_code,
      authority_name
    ) values (
      ${regulatorId},
      ${countryCode},
      ${`QA-${label.toUpperCase()}`},
      ${`QA ${label} Regulator`}
    )
  `;

  await conn`
    insert into public.regulator_professions (
      regulator_id,
      profession
    ) values (
      ${regulatorId},
      'DOCTOR'
    )
  `;

  const [professional] = await conn`
    insert into public.professional_profiles (
      profile_id,
      display_name,
      profession,
      profile_visibility
    ) values (
      ${profileId},
      ${`QA ${label} Doctor`},
      'DOCTOR',
      'PUBLIC'
    )
    returning id
  `;

  await conn`
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
      ${countryCode},
      'DOCTOR',
      ${`QA-${label.toUpperCase()}-001`},
      'VERIFIED',
      clock_timestamp() - interval '1 day',
      clock_timestamp() + interval '90 days',
      'STAFF_VERIFIED'
    )
  `;

  const [location] = await conn`
    insert into public.practice_locations (
      name,
      location_type,
      country_code,
      timezone,
      is_active,
      is_bookable,
      created_by
    ) values (
      ${`QA ${label} Location`},
      'PERSONAL_CHAMBER',
      ${countryCode},
      ${timezone},
      true,
      true,
      ${profileId}
    )
    returning id, timezone, country_code
  `;

  await conn`
    insert into public.practice_memberships (
      practice_location_id,
      profile_id,
      role,
      status,
      joined_at
    ) values (
      ${location.id},
      ${profileId},
      'DOCTOR',
      'ACTIVE',
      clock_timestamp()
    )
  `;

  const [chamber] = await conn`
    insert into public.doctor_chambers (
      doctor_id,
      practice_location_id
    ) values (
      ${professional.id},
      ${location.id}
    )
    returning id
  `;

  return {
    profileId,
    professionalId:
      professional.id,
    regulatorId,
    locationId:
      location.id,
    chamberId:
      chamber.id,
    timezone:
      location.timezone,
    countryCode:
      location.country_code,
  };
}

async function localDatePlus(
  conn,
  timezone,
  days,
) {
  const [row] = await conn`
    select (
      (
        clock_timestamp()
        at time zone ${timezone}
      )::date + ${days}::integer
    )::date as d
  `;

  return row.d;
}

async function localInstant(
  conn,
  timezone,
  localDate,
  localTimeValue,
) {
  const [row] = await conn`
    select (
      ${localDate}::date +
      ${localTimeValue}::time
    ) at time zone ${timezone} as instant
  `;

  return row.instant;
}

async function weekdayFor(
  conn,
  localDate,
) {
  const [row] = await conn`
    select extract(
      dow from ${localDate}::date
    )::integer as weekday
  `;

  return row.weekday;
}

async function addHours(
  conn,
  {
    chamberId,
    localDate,
    start,
    end,
  },
) {
  const weekday =
    await weekdayFor(
      conn,
      localDate,
    );

  const [row] = await conn`
    insert into public.doctor_chamber_hours (
      doctor_chamber_id,
      weekday,
      start_time,
      end_time
    ) values (
      ${chamberId},
      ${weekday},
      ${start}::time,
      ${end}::time
    )
    returning id
  `;

  return row.id;
}

async function trustedAvailability(
  conn,
  {
    chamberId,
    startDate,
    endDate,
  },
) {
  const sessionRef =
    crypto.randomUUID();

  await conn.unsafe(
    "set session authorization dd_public_ingress",
  );

  try {
    await conn`
      select public.set_public_ingress_context(
        ${sessionRef},
        clock_timestamp(),
        ${digest(`session:${sessionRef}`)},
        ${digest(`network:${sessionRef}`)},
        ${digest(`chamber:${chamberId}`)},
        'PUBLIC_WEB'::public.appointment_source,
        ${crypto.randomUUID()}
      )
    `;

    return await conn`
      select *
      from public.public_chamber_availability(
        ${chamberId},
        ${startDate}::date,
        ${endDate}::date
      )
    `;
  } finally {
    await conn.unsafe(
      "reset session authorization",
    );
  }
}

async function trustedPublicBooking(
  conn,
  {
    chamberId,
    slot,
    label,
    sessionRef =
      crypto.randomUUID(),
  },
) {
  await conn.unsafe(
    "set session authorization dd_public_ingress",
  );

  try {
    await conn`
      select public.set_public_ingress_context(
        ${sessionRef},
        clock_timestamp(),
        ${digest(`session:${sessionRef}`)},
        ${digest(`network:${sessionRef}`)},
        ${digest(`chamber:${chamberId}`)},
        'PUBLIC_WEB'::public.appointment_source,
        ${crypto.randomUUID()}
      )
    `;

    try {
      const rows = await conn`
        select *
        from public.create_public_booking(
          ${chamberId},
          ${slot},
          ${`QA ${label}`},
          null,
          ${`qa.${label}@example.invalid`},
          'en'
        )
      `;

      return {
        ok: rows.length === 1,
        rows,
        error: null,
        sessionRef,
      };
    } catch (error) {
      return {
        ok: false,
        rows: [],
        error,
        sessionRef,
      };
    }
  } finally {
    await conn.unsafe(
      "reset session authorization",
    );
  }
}

async function insertOwnedPatient(
  conn,
  fixture,
  suffix,
) {
  const [row] = await conn`
    insert into public.clinical_patients (
      owner_doctor_id,
      patient_number,
      full_name
    ) values (
      ${fixture.professionalId},
      ${`QA-${suffix}`},
      ${`QA ${suffix} Patient`}
    )
    returning id
  `;

  return row.id;
}

async function insertAppointment(
  conn,
  {
    fixture,
    patientId,
    bookedBy,
    slot,
    source,
    status = "SCHEDULED",
  },
) {
  const [row] = await conn`
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
      status
    ) values (
      ${fixture.professionalId},
      ${fixture.locationId},
      ${fixture.chamberId},
      ${patientId},
      null,
      ${bookedBy},
      ${slot},
      (
        ${slot}
        at time zone ${fixture.timezone}
      )::date,
      30,
      'GENERAL_CONSULTATION',
      'IN_PERSON',
      ${source}::public.appointment_source,
      ${status}::public.appointment_status
    )
    returning id
  `;

  return row.id;
}

/*
 * =================================================================
 * PHASE A — TRANSACTIONAL BEHAVIORAL PROOFS
 * =================================================================
 */

try {
  await sql.unsafe("begin");

  const fixture =
    await createPublicDoctorFixture(
      sql,
      {
        label: "appointments-p0",
      },
    );

  const patientId =
    await insertOwnedPatient(
      sql,
      fixture,
      "APPT-000001",
    );

  /*
   * ---------------------------------------------------------------
   * SOURCE SHAPE
   * ---------------------------------------------------------------
   */

  const sourceDate =
    await localDatePlus(
      sql,
      fixture.timezone,
      2,
    );

  const sourceSlot =
    await localInstant(
      sql,
      fixture.timezone,
      sourceDate,
      "09:00",
    );

  const otherLocation =
    await sql`
      insert into public.practice_locations (
        name,
        location_type,
        country_code,
        timezone,
        is_active,
        is_bookable,
        created_by
      ) values (
        'QA Other Source Location',
        'PERSONAL_CHAMBER',
        'BD',
        ${fixture.timezone},
        true,
        true,
        ${fixture.profileId}
      )
      returning id
    `;

  await expectSqlFailure(
    sql,
    "SUPPORT_ASSISTED absent as P0 creation branch",
    async () => {
      await sql`
        insert into public.appointments (
          owner_doctor_id,
          practice_location_id,
          doctor_chamber_id,
          clinical_patient_id,
          booked_by_profile_id,
          scheduled_at,
          session_date,
          duration_minutes,
          visit_type,
          mode,
          source_channel,
          status
        ) values (
          ${fixture.professionalId},
          ${fixture.locationId},
          ${fixture.chamberId},
          ${patientId},
          ${fixture.profileId},
          ${sourceSlot},
          ${sourceDate},
          30,
          'GENERAL_CONSULTATION',
          'IN_PERSON',
          'SUPPORT_ASSISTED',
          'SCHEDULED'
        )
      `;
    },
    ["23514"],
  );

  await expectSqlFailure(
    sql,
    "PUBLIC_WEB without public_booking_ref",
    async () => {
      await sql`
        insert into public.appointments (
          owner_doctor_id,
          practice_location_id,
          doctor_chamber_id,
          scheduled_at,
          session_date,
          duration_minutes,
          visit_type,
          mode,
          source_channel,
          status
        ) values (
          ${fixture.professionalId},
          ${fixture.locationId},
          ${fixture.chamberId},
          ${sourceSlot},
          ${sourceDate},
          30,
          'GENERAL_CONSULTATION',
          'IN_PERSON',
          'PUBLIC_WEB',
          'SCHEDULED'
        )
      `;
    },
    ["23514"],
  );

  await expectSqlFailure(
    sql,
    "PUBLIC_WEB without doctor_chamber_id",
    async () => {
      await sql`
        insert into public.appointments (
          owner_doctor_id,
          practice_location_id,
          scheduled_at,
          session_date,
          duration_minutes,
          visit_type,
          mode,
          source_channel,
          status,
          public_booking_ref
        ) values (
          ${fixture.professionalId},
          ${fixture.locationId},
          ${sourceSlot},
          ${sourceDate},
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

  await expectSqlFailure(
    sql,
    "public chamber/location mismatch",
    async () => {
      await sql`
        insert into public.appointments (
          owner_doctor_id,
          practice_location_id,
          doctor_chamber_id,
          scheduled_at,
          session_date,
          duration_minutes,
          visit_type,
          mode,
          source_channel,
          status,
          public_booking_ref
        ) values (
          ${fixture.professionalId},
          ${otherLocation[0].id},
          ${fixture.chamberId},
          ${sourceSlot},
          ${sourceDate},
          30,
          'GENERAL_CONSULTATION',
          'IN_PERSON',
          'PUBLIC_WEB',
          'SCHEDULED',
          ${crypto.randomUUID()}
        )
      `;
    },
    ["23503"],
  );

  await expectSqlFailure(
    sql,
    "WALK_IN without clinical patient",
    async () => {
      await sql`
        insert into public.appointments (
          owner_doctor_id,
          practice_location_id,
          doctor_chamber_id,
          clinical_patient_id,
          scheduled_at,
          session_date,
          duration_minutes,
          visit_type,
          mode,
          source_channel,
          status
        ) values (
          ${fixture.professionalId},
          ${fixture.locationId},
          ${fixture.chamberId},
          null,
          ${sourceSlot},
          ${sourceDate},
          30,
          'GENERAL_CONSULTATION',
          'IN_PERSON',
          'WALK_IN',
          'SCHEDULED'
        )
      `;
    },
    ["23514"],
  );

  console.log(
    "source-channel shape: PASS",
  );

  /*
   * ---------------------------------------------------------------
   * GRID ANCHORED TO HOURS START + PARTIAL OMITTED + EXACT 30 MIN
   * ---------------------------------------------------------------
   */

  const gridDate =
    await localDatePlus(
      sql,
      fixture.timezone,
      3,
    );

  await addHours(
    sql,
    {
      chamberId:
        fixture.chamberId,
      localDate: gridDate,
      start: "10:10",
      end: "11:25",
    },
  );

  const gridRows =
    await trustedAvailability(
      sql,
      {
        chamberId:
          fixture.chamberId,
        startDate:
          gridDate,
        endDate:
          gridDate,
      },
    );

  const gridStarts =
    gridRows.map(
      (row) =>
        localTime(
          row.starts_at,
          fixture.timezone,
        ),
    );

  assert(
    JSON.stringify(gridStarts) ===
      JSON.stringify([
        "10:10",
        "10:40",
      ]),
    `hours-start grid / partial omission mismatch: ${JSON.stringify(gridStarts)}`,
  );

  for (const row of gridRows) {
    assert(
      (
        new Date(
          row.ends_at,
        ).getTime() -
        new Date(
          row.starts_at,
        ).getTime()
      ) === 30 * 60 * 1000,
      "generated slot is not exactly 30 elapsed minutes",
    );

    assert(
      row.remaining_capacity === 1,
      "open slot capacity is not exactly 1",
    );
  }

  console.log(
    "30-minute anchored slot grid: PASS",
  );

  /*
   * ---------------------------------------------------------------
   * MAX 31 LOCAL DATES
   * 31 inclusive = end-start 30 allowed.
   * 32 inclusive = end-start 31 rejected/empty.
   * ---------------------------------------------------------------
   */
  const maxAllowedEnd =
    await sql`
      select (
        ${gridDate}::date + 30
      )::date as d
    `;

  const overMaxEnd =
    await sql`
      select (
        ${gridDate}::date + 31
      )::date as d
    `;

  await trustedAvailability(
    sql,
    {
      chamberId:
        fixture.chamberId,
      startDate:
        gridDate,
      endDate:
        maxAllowedEnd[0].d,
    },
  );

  const overMaxRows =
    await trustedAvailability(
      sql,
      {
        chamberId:
          fixture.chamberId,
      startDate:
          gridDate,
        endDate:
          overMaxEnd[0].d,
      },
    );

  assert(
    overMaxRows.length === 0,
    "availability accepted more than 31 consecutive local dates",
  );

  console.log(
    "31-local-date limit: PASS",
  );

  /*
   * ---------------------------------------------------------------
   * PAST SLOTS OMITTED
   * ---------------------------------------------------------------
   */
  const pastDate =
    await localDatePlus(
      sql,
      fixture.timezone,
      -1,
    );

  await addHours(
    sql,
    {
      chamberId:
        fixture.chamberId,
      localDate:
        pastDate,
      start:
        "07:00",
      end:
        "08:00",
    },
  );

  const pastRows =
    await trustedAvailability(
      sql,
      {
        chamberId:
          fixture.chamberId,
        startDate:
          pastDate,
        endDate:
          pastDate,
      },
    );

  assert(
    pastRows.length === 0,
    "past slots were exposed",
  );

  console.log(
    "past slot omission: PASS",
  );

  /*
   * ---------------------------------------------------------------
   * DST NONEXISTENT CANDIDATES OMITTED
   *
   * Australia/Sydney begins DST on 2026-10-04:
   * 02:00 -> 03:00, so 02:00 and 02:30 local candidates do not exist.
   * ---------------------------------------------------------------
   */
  const dstFixture =
    await createPublicDoctorFixture(
      sql,
      {
        label: "dst",
        timezone:
          "Australia/Sydney",
        countryCode:
          "AU",
      },
    );

  const dstDate =
    "2026-10-04";

  await addHours(
    sql,
    {
      chamberId:
        dstFixture.chamberId,
      localDate:
        dstDate,
      start:
        "02:00",
      end:
        "03:30",
    },
  );

  const dstRows =
    await trustedAvailability(
      sql,
      {
        chamberId:
          dstFixture.chamberId,
        startDate:
          dstDate,
        endDate:
          dstDate,
      },
    );

  const dstStarts =
    dstRows.map(
      (row) =>
        localTime(
          row.starts_at,
          dstFixture.timezone,
        ),
    );

  assert(
    JSON.stringify(dstStarts) ===
      JSON.stringify(["03:00"]),
    `DST nonexistent candidates were not omitted: ${JSON.stringify(dstStarts)}`,
  );

  console.log(
    "DST invalid-candidate omission: PASS",
  );

  /*
   * ---------------------------------------------------------------
   * CAPACITY / OVERLAP / BOUNDARY TOUCH
   * ---------------------------------------------------------------
   */
  const capacityDate =
    await localDatePlus(
      sql,
      fixture.timezone,
      4,
    );

  await addHours(
    sql,
    {
      chamberId:
        fixture.chamberId,
      localDate:
        capacityDate,
      start:
        "09:00",
      end:
        "12:00",
    },
  );

  const capacitySlots = {};

  for (const t of [
    "10:00",
    "11:00",
    "11:30",
  ]) {
    capacitySlots[t] =
      await localInstant(
        sql,
        fixture.timezone,
        capacityDate,
        t,
      );
  }

  await insertAppointment(
    sql,
    {
      fixture,
      patientId,
      bookedBy:
        fixture.profileId,
      slot:
        capacitySlots["10:00"],
      source:
        "DOCTOR",
      status:
        "SCHEDULED",
    },
  );

  await insertAppointment(
    sql,
    {
      fixture,
      patientId,
      bookedBy:
        fixture.profileId,
      slot:
        capacitySlots["11:00"],
      source:
        "DOCTOR",
      status:
        "CANCELLED",
    },
  );

  await insertAppointment(
    sql,
    {
      fixture,
      patientId,
      bookedBy:
        fixture.profileId,
      slot:
        capacitySlots["11:30"],
      source:
        "DOCTOR",
      status:
        "NO_SHOW",
    },
  );

  const capacityRows =
    await trustedAvailability(
      sql,
      {
        chamberId:
          fixture.chamberId,
        startDate:
          capacityDate,
        endDate:
          capacityDate,
      },
    );

  const capacityStarts =
    new Set(
      capacityRows.map(
        (row) =>
          localTime(
            row.starts_at,
            fixture.timezone,
          ),
      ),
    );

  assert(
    !capacityStarts.has("10:00"),
    "consuming overlap did not block exact slot",
  );

  assert(
    capacityStarts.has("09:30"),
    "boundary-touch slot ending at occupied start was blocked",
  );

  assert(
    capacityStarts.has("10:30"),
    "boundary-touch slot starting at occupied end was blocked",
  );

  assert(
    capacityStarts.has("11:00"),
    "CANCELLED appointment consumed capacity",
  );

  assert(
    capacityStarts.has("11:30"),
    "NO_SHOW appointment consumed capacity",
  );

  console.log(
    "capacity / overlap / boundary touch: PASS",
  );

  /*
   * ---------------------------------------------------------------
   * ALL CURRENT STATUSES:
   * every status except CANCELLED and NO_SHOW consumes capacity.
   * ---------------------------------------------------------------
   */
  const statusDate =
    await localDatePlus(
      sql,
      fixture.timezone,
      5,
    );

  await addHours(
    sql,
    {
      chamberId:
        fixture.chamberId,
      localDate:
        statusDate,
      start:
        "08:00",
      end:
        "12:00",
    },
  );

  const statusCases = [
    ["08:00", "SCHEDULED", false],
    ["08:30", "CONFIRMED", false],
    ["09:00", "ARRIVED", false],
    ["09:30", "IN_CONSULTATION", false],
    ["10:00", "COMPLETED", false],
    ["10:30", "CANCELLED", true],
    ["11:00", "NO_SHOW", true],
  ];

  for (const [
    localStart,
    status,
    expectedOpen,
  ] of statusCases) {
    const instant =
      await localInstant(
        sql,
        fixture.timezone,
        statusDate,
        localStart,
      );

    await insertAppointment(
      sql,
      {
        fixture,
        patientId,
        bookedBy:
          fixture.profileId,
        slot: instant,
        source:
          "DOCTOR",
        status,
      },
    );

    const [open] = await sql`
      select public.public_slot_is_open(
        ${fixture.chamberId},
        ${instant},
        clock_timestamp()
      ) as allowed
    `;

    assert(
      open.allowed ===
        expectedOpen,
      `${status}: expected slot open=${expectedOpen}, got ${open.allowed}`,
    );
  }

  console.log(
    "status capacity matrix: PASS",
  );

  /*
   * ---------------------------------------------------------------
   * HOURS EDIT IS PROSPECTIVE:
   * appointment stays unchanged and still blocks overlaps.
   * ---------------------------------------------------------------
   */
  const hoursDate =
    await localDatePlus(
      sql,
      fixture.timezone,
      6,
    );

  const hoursId =
    await addHours(
      sql,
      {
        chamberId:
          fixture.chamberId,
        localDate:
          hoursDate,
        start:
          "14:00",
        end:
          "15:00",
      },
    );

  const preservedSlot =
    await localInstant(
      sql,
      fixture.timezone,
      hoursDate,
      "14:00",
    );

  const preservedAppointmentId =
    await insertAppointment(
      sql,
      {
        fixture,
        patientId,
        bookedBy:
          fixture.profileId,
        slot:
          preservedSlot,
        source:
          "DOCTOR",
        status:
          "SCHEDULED",
      },
    );

  const [beforeHoursEdit] =
    await sql`
      select
        scheduled_at,
        status
      from public.appointments
      where id =
        ${preservedAppointmentId}
    `;

  await sql`
    update public.doctor_chamber_hours
    set
      start_time = '13:30',
      end_time = '14:30'
    where id = ${hoursId}
  `;

  const afterHoursRows =
    await trustedAvailability(
      sql,
      {
        chamberId:
          fixture.chamberId,
        startDate:
          hoursDate,
        endDate:
          hoursDate,
      },
    );

  const afterHoursStarts =
    new Set(
      afterHoursRows.map(
        (row) =>
          localTime(
            row.starts_at,
            fixture.timezone,
          ),
      ),
    );

  assert(
    afterHoursStarts.has("13:30"),
    "prospective hours edit did not regenerate new boundary slot",
  );

  assert(
    !afterHoursStarts.has("14:00"),
    "preserved existing appointment stopped blocking overlap after hours edit",
  );

  const [afterHoursEdit] =
    await sql`
      select
        scheduled_at,
        status
      from public.appointments
      where id =
        ${preservedAppointmentId}
    `;

  assert(
    new Date(
      afterHoursEdit.scheduled_at,
    ).getTime() ===
      new Date(
        beforeHoursEdit.scheduled_at,
      ).getTime() &&
      afterHoursEdit.status ===
        beforeHoursEdit.status,
    "hours edit rewrote/cancelled existing appointment",
  );

  console.log(
    "prospective chamber-hours change: PASS",
  );

  /*
   * ---------------------------------------------------------------
   * CURRENT PRODUCTION APPOINTMENT WRITER INVENTORY
   *
   * Do not invent doctor/receptionist app APIs for the race test.
   * Current app-facing appointment INSERT authority must remain the
   * public RPC only, and it must use the chamber lock/recheck boundary.
   * ---------------------------------------------------------------
   */
  const definerFunctions =
    await sql`
      select
        p.proname,
        oidvectortypes(
          p.proargtypes
        ) as identity_args,
        pg_get_functiondef(
          p.oid
        ) as definition
      from pg_proc p
      join pg_namespace n
        on n.oid =
          p.pronamespace
      where n.nspname =
        'public'
        and p.prosecdef
      order by p.proname
    `;

  const appointmentWriters =
    definerFunctions.filter(
      (row) =>
        row.definition
          .toLowerCase()
          .replace(/\s+/g, " ")
          .includes(
            "insert into public.appointments",
          ),
    );

  assert(
    appointmentWriters.length === 1 &&
      appointmentWriters[0].proname ===
        "create_public_booking",
    `unexpected current P0 appointment writer inventory: ${
      appointmentWriters
        .map(
          (row) =>
            `${row.proname}(${row.identity_args})`,
        )
        .join(",")
    }`,
  );

  const normalizedWriter =
    appointmentWriters[0]
      .definition
      .toLowerCase()
      .replace(/\s+/g, " ");

  assert(
    normalizedWriter.includes(
      "lock_public_booking_chamber",
    ),
    "create_public_booking does not use canonical chamber serialization lock",
  );

  assert(
    normalizedWriter.includes(
      "public_slot_is_open",
    ),
    "create_public_booking does not recheck slot availability",
  );

  const directAppointmentWrites =
    await sql`
      select
        grantee,
        privilege_type
      from information_schema.role_table_grants
      where table_schema =
        'public'
        and table_name =
          'appointments'
        and grantee in (
          'anon',
          'authenticated',
          'dd_owner_analytics',
          'dd_metrics_reader',
          'dd_metrics_rollup',
          'dd_public_ingress'
        )
        and privilege_type in (
          'INSERT',
          'UPDATE',
          'DELETE'
        )
      order by grantee,
               privilege_type
    `;

  assert(
    directAppointmentWrites.length ===
      0,
    `application direct appointment writes exist: ${
      directAppointmentWrites
        .map(
          (row) =>
            `${row.grantee}:${row.privilege_type}`,
        )
        .join(",")
    }`,
  );

  console.log(
    "current production chamber writer inventory: PASS",
  );

  console.log(
    "verify-appointments-p0 phase A: PASS",
  );
} finally {
  try {
    await sql.unsafe("rollback");
  } finally {
    await sql.end();
  }
}

/*
 * =================================================================
 * PHASE B — COMMITTED MULTI-SESSION RACE HARNESS
 *
 * Separate sessions must see the first committed appointment before the
 * losing transaction rechecks capacity. The harness uses no new app RPC.
 * Doctor/receptionist sides call the same canonical chamber lock directly
 * as verifier-only database-owner transactions.
 * =================================================================
 */

const raceSql = openLocalAdminDatabase();

let raceFixture = null;
let racePatientId = null;
let receptionistProfileId = null;
const raceSessionRefs = [];
const raceAppointmentIds = [];

async function independentPublicCall(
  {
    chamberId,
    slot,
    label,
  },
) {
  const client = postgres(
    localAdminDatabaseUrl(),
    {
      max: 1,
      prepare: false,
      onnotice: () => {},
    },
  );

  const sessionRef =
    crypto.randomUUID();

  raceSessionRefs.push(
    sessionRef,
  );

  const startedAt =
    Date.now();

  try {
    /* The trusted ingress setter is transaction-local by design. Independent
     * race workers therefore establish one explicit transaction spanning
     * context setup and the public RPC call. */
    await client.unsafe("begin");

    const result =
      await trustedPublicBooking(
        client,
        {
          chamberId,
          slot,
          label,
          sessionRef,
        },
      );

    await client.unsafe("commit");

    return {
      ...result,
      elapsedMs:
        Date.now() -
        startedAt,
    };
  } catch (error) {
    try {
      await client.unsafe("rollback");
    } catch {
      // no-op
    }
    throw error;
  } finally {
    await client.end();
  }
}

async function appCountAt(
  chamberId,
  slot,
) {
  const [row] =
    await raceSql`
      select count(*)::integer
        as count
      from public.appointments
      where doctor_chamber_id =
        ${chamberId}
        and scheduled_at =
          ${slot}
        and status not in (
          'CANCELLED',
          'NO_SHOW'
        )
    `;

  return row.count;
}

async function controlledInternalRace(
  {
    source,
    bookedBy,
    slot,
    label,
  },
) {
  const internal =
    postgres(
      localAdminDatabaseUrl(),
      {
        max: 1,
        prepare: false,
        onnotice: () => {},
      },
    );

  try {
    await internal.unsafe("begin");

    await internal`
      select *
      from public.lock_public_booking_chamber(
        ${raceFixture.chamberId}
      )
    `;

    const [before] =
      await internal`
        select public.public_slot_is_open(
          ${raceFixture.chamberId},
          ${slot},
          clock_timestamp()
        ) as allowed
      `;

    assert(
      before.allowed === true,
      `${label}: slot was not open before controlled race`,
    );

    const publicPromise =
      independentPublicCall({
        chamberId:
          raceFixture.chamberId,
        slot,
        label:
          `${label}-public`,
      });

    await new Promise(
      (resolve) =>
        setTimeout(
          resolve,
          175,
        ),
    );

    const appointmentId =
      await insertAppointment(
        internal,
        {
          fixture:
            raceFixture,
          patientId:
            racePatientId,
          bookedBy,
          slot,
          source,
          status:
            "SCHEDULED",
        },
      );

    raceAppointmentIds.push(
      appointmentId,
    );

    await internal.unsafe("commit");

    const publicResult =
      await publicPromise;

    assert(
      publicResult.elapsedMs >= 125,
      `${label}: public competitor did not wait on chamber lock (${publicResult.elapsedMs}ms)`,
    );

    assert(
      publicResult.ok === false,
      `${label}: public competitor also booked occupied slot`,
    );

    assert(
      await appCountAt(
        raceFixture.chamberId,
        slot,
      ) === 1,
      `${label}: capacity exceeded 1 after race`,
    );

    const rows =
      await raceSql`
        select
          id,
          source_channel
        from public.appointments
        where doctor_chamber_id =
          ${raceFixture.chamberId}
          and scheduled_at =
            ${slot}
          and status not in (
            'CANCELLED',
            'NO_SHOW'
          )
      `;

    assert(
      rows.length === 1 &&
        rows[0].source_channel ===
          source,
      `${label}: wrong race winner/source`,
    );

    console.log(
      `${label}: PASS`,
    );
  } catch (error) {
    try {
      await internal.unsafe(
        "rollback",
      );
    } catch {
      // no-op
    }

    throw error;
  } finally {
    await internal.end();
  }
}

try {
  raceFixture =
    await createPublicDoctorFixture(
      raceSql,
      {
        label:
          "appointment-race",
      },
    );

  racePatientId =
    await insertOwnedPatient(
      raceSql,
      raceFixture,
      "RACE-000001",
    );

  receptionistProfileId =
    await createProfile(
      raceSql,
      "race-receptionist",
    );

  await raceSql`
    insert into public.practice_memberships (
      practice_location_id,
      profile_id,
      role,
      status,
      joined_at
    ) values (
      ${raceFixture.locationId},
      ${receptionistProfileId},
      'RECEPTIONIST',
      'ACTIVE',
      clock_timestamp()
    )
  `;

  const raceDate =
    await localDatePlus(
      raceSql,
      raceFixture.timezone,
      10,
    );

  await addHours(
      raceSql,
      {
        chamberId:
          raceFixture.chamberId,
        localDate:
          raceDate,
        start:
          "09:00",
        end:
          "12:00",
      },
    );

  const slotPublic =
    await localInstant(
      raceSql,
      raceFixture.timezone,
      raceDate,
      "09:00",
    );

  const slotDoctor =
    await localInstant(
      raceSql,
      raceFixture.timezone,
      raceDate,
      "10:00",
    );

  const slotReception =
    await localInstant(
      raceSql,
      raceFixture.timezone,
      raceDate,
      "11:00",
    );

  /*
   * Two public callers race for the exact same slot.
   */
  const publicResults =
    await Promise.all([
      independentPublicCall({
        chamberId:
          raceFixture.chamberId,
        slot:
          slotPublic,
        label:
          "public-race-a",
      }),
      independentPublicCall({
        chamberId:
          raceFixture.chamberId,
        slot:
          slotPublic,
        label:
          "public-race-b",
      }),
    ]);

  const publicSuccesses =
    publicResults.filter(
      (result) =>
        result.ok,
    );

  assert(
    publicSuccesses.length === 1,
    `public/public race expected exactly one success, got ${publicSuccesses.length}; ` +
      publicResults.map((result, index) =>
        `call${index + 1}=${result.ok ? "OK" : (result.error?.message ?? "FAILED")}`
      ).join(" | "),
  );

  assert(
    await appCountAt(
      raceFixture.chamberId,
      slotPublic,
    ) === 1,
    "public/public race exceeded capacity 1",
  );

  const publicRaceRows =
    await raceSql`
      select id
      from public.appointments
      where doctor_chamber_id =
        ${raceFixture.chamberId}
        and scheduled_at =
          ${slotPublic}
    `;

  raceAppointmentIds.push(
    ...publicRaceRows.map(
      (row) => row.id,
    ),
  );

  console.log(
    "public vs public race: PASS",
  );

  /*
   * Doctor-vs-public controlled race.
   */
  await controlledInternalRace({
    source:
      "DOCTOR",
    bookedBy:
      raceFixture.profileId,
    slot:
      slotDoctor,
    label:
      "doctor vs public race",
  });

  /*
   * Receptionist-vs-public controlled race.
   */
  await controlledInternalRace({
    source:
      "RECEPTIONIST",
    bookedBy:
      receptionistProfileId,
    slot:
      slotReception,
    label:
      "receptionist vs public race",
  });

  console.log(
    "verify-appointments-p0: PASS " +
    "(source shape + slots + DST + capacity + hours + shared serialization races)",
  );
} finally {
  /*
   * ---------------------------------------------------------------
   * LOCAL VERIFIER CLEANUP
   * ---------------------------------------------------------------
   */
  try {
    if (
      raceSessionRefs.length >
      0
    ) {
      /*
       * audit_events is append-only in production. For verifier cleanup only,
       * locally disable its append-only trigger, delete exactly these synthetic
       * anonymous-session rows, then immediately restore the trigger.
       */
      try {
        await raceSql.unsafe(
          "alter table public.audit_events disable trigger audit_events_append_only",
        );

        await raceSql`
          delete
          from public.audit_events
          where anon_session_ref =
            any(${raceSessionRefs})
        `;
      } finally {
        await raceSql.unsafe(
          "alter table public.audit_events enable trigger audit_events_append_only",
        );
      }
    }

    if (raceFixture) {
      await raceSql`
        delete
        from public.public_booking_contacts
        where appointment_id in (
          select id
          from public.appointments
          where doctor_chamber_id =
            ${raceFixture.chamberId}
        )
      `;

      await raceSql`
        delete
        from public.appointment_events
        where appointment_id in (
          select id
          from public.appointments
          where doctor_chamber_id =
            ${raceFixture.chamberId}
        )
      `;

      await raceSql`
        delete
        from public.queue_entries
        where appointment_id in (
          select id
          from public.appointments
          where doctor_chamber_id =
            ${raceFixture.chamberId}
        )
      `;

      await raceSql`
        delete
        from public.appointments
        where doctor_chamber_id =
          ${raceFixture.chamberId}
      `;

      await raceSql`
        delete
        from public.anon_rate_limit_buckets
      `;

      await raceSql`
        delete
        from public.clinical_patients
        where owner_doctor_id =
          ${raceFixture.professionalId}
      `;

      await raceSql`
        delete
        from public.doctor_chamber_hours
        where doctor_chamber_id =
          ${raceFixture.chamberId}
      `;

      await raceSql`
        delete
        from public.doctor_chambers
        where id =
          ${raceFixture.chamberId}
      `;

      await raceSql`
        delete
        from public.practice_memberships
        where practice_location_id =
          ${raceFixture.locationId}
      `;

      await raceSql`
        delete
        from public.practice_locations
        where id =
          ${raceFixture.locationId}
      `;

      await raceSql`
        delete
        from public.professional_credentials
        where professional_profile_id =
          ${raceFixture.professionalId}
      `;

      await raceSql`
        delete
        from public.profile_capabilities
        where profile_id =
          ${raceFixture.profileId}
      `;

      await raceSql`
        delete
        from public.professional_profiles
        where id =
          ${raceFixture.professionalId}
      `;

      await raceSql`
        delete
        from public.regulator_professions
        where regulator_id =
          ${raceFixture.regulatorId}
      `;

      await raceSql`
        delete
        from public.regulators
        where id =
          ${raceFixture.regulatorId}
      `;

      await raceSql`
        delete
        from public.profiles
        where id in (
          ${raceFixture.profileId},
          ${receptionistProfileId}
        )
      `;

      await raceSql`
        delete
        from auth.users
        where id in (
          ${raceFixture.profileId},
          ${receptionistProfileId}
        )
      `;
    }
  } finally {
    await raceSql.end();
  }
}
