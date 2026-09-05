import crypto from "node:crypto";
import {
  assert,
  expectSqlFailure,
  openLocalDatabase,
  qaEmail,
} from "./p0-b2-lib.mjs";

const sql = openLocalDatabase();

const expectedPracticeAuthorityRpcs = new Set([
  "create_clinical_patient(text,uuid)",
  "open_encounter(uuid,uuid)",
  "open_encounter_for_appointment(uuid)",
  "update_encounter_sections(uuid,integer,text,text,text,text,text,text)",
  "add_encounter_diagnosis(uuid,integer,text)",
  "add_encounter_investigation(uuid,integer,text)",
  "finish_consultation(uuid,integer)",
  "open_prescription(uuid)",
  "add_prescription_item(uuid,integer,jsonb)",
  "finalize_prescription(uuid,integer,jsonb,text,text)",
  "create_prescription_correction(uuid,text)",
  "prepare_prescription_signature_asset(uuid)",
  "create_prescription_template(text,jsonb)",
  "update_prescription_template(uuid,text,jsonb,boolean)",
  "resolve_public_booking_patient(uuid,uuid)",
  "register_public_booking_patient(uuid,text,text,text)",
]);

function compactArgs(value) {
  return value.replace(/\s+/g, "");
}

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

async function custodialExport({
  profileId,
  ownerDoctorId,
  fixture,
  foreignPatientId,
}) {
  await sql`
    select set_config(
      'request.jwt.claim.sub',
      ${profileId},
      true
    )
  `;

  await sql.unsafe("set local role authenticated");

  /*
   * Retrieve the complete synthetic owned clinical record set through the
   * ordinary authenticated RLS read surface.
   */
  const clinicalPatients = await sql`
    select id, owner_doctor_id, patient_number, full_name
    from public.clinical_patients
    order by id
  `;

  const encounters = await sql`
    select id, owner_doctor_id, clinical_patient_id
    from public.encounters
    order by id
  `;

  const diagnoses = await sql`
    select id, owner_doctor_id, encounter_id
    from public.encounter_diagnoses
    order by id
  `;

  const investigations = await sql`
    select id, owner_doctor_id, encounter_id
    from public.encounter_investigations
    order by id
  `;

  const encounterEvents = await sql`
    select id, owner_doctor_id, encounter_id
    from public.encounter_events
    order by id
  `;

  const prescriptions = await sql`
    select id, owner_doctor_id, encounter_id, clinical_patient_id
    from public.prescriptions
    order by id
  `;

  const prescriptionItems = await sql`
    select
      pi.id,
      pi.prescription_id,
      p.owner_doctor_id
    from public.prescription_items pi
    join public.prescriptions p
      on p.id = pi.prescription_id
    order by pi.id
  `;

  const prescriptionEvents = await sql`
    select
      pe.id,
      pe.prescription_id,
      p.owner_doctor_id
    from public.prescription_events pe
    join public.prescriptions p
      on p.id = pe.prescription_id
    order by pe.id
  `;

  const appointments = await sql`
    select
      id,
      owner_doctor_id,
      clinical_patient_id,
      source_channel,
      public_booking_ref
    from public.appointments
    order by id
  `;

  const appointmentEvents = await sql`
    select
      ae.id,
      ae.appointment_id,
      a.owner_doctor_id
    from public.appointment_events ae
    join public.appointments a
      on a.id = ae.appointment_id
    order by ae.id
  `;

  const queueEntries = await sql`
    select
      qe.id,
      qe.appointment_id,
      a.owner_doctor_id
    from public.queue_entries qe
    join public.appointments a
      on a.id = qe.appointment_id
    order by qe.id
  `;

  await sql.unsafe("reset role");

  const exportBundle = {
    clinicalPatients,
    encounters,
    diagnoses,
    investigations,
    encounterEvents,
    prescriptions,
    prescriptionItems,
    prescriptionEvents,
    appointments,
    appointmentEvents,
    queueEntries,
  };

  /*
   * Serialize in-memory as the P0 custodial exportability proof.
   */
  const serialized = JSON.stringify(exportBundle);

  assert(
    serialized.length > 0,
    "SUSPENDED: serialized custodial export is empty",
  );

  const allRows = Object.values(exportBundle).flat();

  assert(
    allRows.every(
      (row) =>
        !("owner_doctor_id" in row) ||
        row.owner_doctor_id === ownerDoctorId,
    ),
    "SUSPENDED: foreign doctor row leaked into custodial export",
  );

  /*
   * Exact synthetic owned-row completeness.
   */
  assert(
    clinicalPatients.some((r) => r.id === fixture.patientId),
    "SUSPENDED: owned clinical patient missing from export",
  );

  assert(
    encounters.some((r) => r.id === fixture.encounterId),
    "SUSPENDED: owned encounter missing from export",
  );

  assert(
    diagnoses.some((r) => r.id === fixture.diagnosisId),
    "SUSPENDED: owned diagnosis missing from export",
  );

  assert(
    investigations.some((r) => r.id === fixture.investigationId),
    "SUSPENDED: owned investigation missing from export",
  );

  assert(
    encounterEvents.some((r) => r.id === fixture.encounterEventId),
    "SUSPENDED: owned encounter event missing from export",
  );

  assert(
    prescriptions.some((r) => r.id === fixture.prescriptionId),
    "SUSPENDED: owned prescription missing from export",
  );

  assert(
    prescriptionItems.some((r) => r.id === fixture.prescriptionItemId),
    "SUSPENDED: owned prescription item missing from export",
  );

  assert(
    prescriptionEvents.some((r) => r.id === fixture.prescriptionEventId),
    "SUSPENDED: owned prescription event missing from export",
  );

  assert(
    appointments.some((r) => r.id === fixture.appointmentId),
    "SUSPENDED: owned appointment missing from export",
  );

  assert(
    appointmentEvents.some((r) => r.id === fixture.appointmentEventId),
    "SUSPENDED: owned appointment event missing from export",
  );

  assert(
    queueEntries.some((r) => r.id === fixture.queueEntryId),
    "SUSPENDED: owned queue entry missing from export",
  );

  /*
   * Foreign fixture exists physically but must be absent through RLS.
   */
  assert(
    !clinicalPatients.some((r) => r.id === foreignPatientId),
    "SUSPENDED: foreign clinical patient leaked through RLS",
  );

  return serialized;
}

async function expectPracticeDenied({
  profileId,
  patientId,
  encounterId,
  locationId,
  chamberId,
  appointmentId,
  prescriptionId,
  status,
}) {
  const cases = [
    [
      "create_clinical_patient",
      async () => {
        await sql`
          select public.create_clinical_patient(
            ${`Denied ${status}`},
            ${locationId}
          )
        `;
      },
    ],
    [
      "open_encounter",
      async () => {
        await sql`
          select public.open_encounter(
            ${patientId},
            ${locationId}
          )
        `;
      },
    ],
    [
      "open_encounter_for_appointment",
      async () => { await sql`select public.open_encounter_for_appointment(${appointmentId})`; },
    ],
    [
      "update_encounter_sections",
      async () => { await sql`select public.update_encounter_sections(${encounterId},1,null,null,null,null,null,null)`; },
    ],
    [
      "add_encounter_diagnosis",
      async () => { await sql`select public.add_encounter_diagnosis(${encounterId},1,'Denied diagnosis')`; },
    ],
    [
      "add_encounter_investigation",
      async () => { await sql`select public.add_encounter_investigation(${encounterId},1,'Denied investigation')`; },
    ],
    [
      "finish_consultation",
      async () => { await sql`select public.finish_consultation(${encounterId},1)`; },
    ],
    [
      "open_prescription",
      async () => {
        await sql`
          select public.open_prescription(
            ${encounterId}
          )
        `;
      },
    ],
    [
      "add_prescription_item",
      async () => { await sql`select public.add_prescription_item(${prescriptionId},1,'{"display_name":"Denied medicine"}'::jsonb)`; },
    ],
    [
      "finalize_prescription",
      async () => {
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
    ],
    [
      "create_prescription_correction",
      async () => { await sql`select public.create_prescription_correction(${prescriptionId},'Denied correction')`; },
    ],
    [
      "prepare_prescription_signature_asset",
      async () => { await sql`select public.prepare_prescription_signature_asset(${prescriptionId})`; },
    ],
    [
      "create_prescription_template",
      async () => { await sql`select public.create_prescription_template('Denied template','{}'::jsonb)`; },
    ],
    [
      "update_prescription_template",
      async () => { await sql`select public.update_prescription_template(gen_random_uuid(),'Denied template','{}'::jsonb,true)`; },
    ],
    [
      "allocate_queue_token",
      async () => {
        await sql`
          select public.allocate_queue_token(
            ${chamberId},
            current_date,
            ${appointmentId}
          )
        `;
      },
    ],
    [
      "resolve_public_booking_patient",
      async () => {
        await sql`
          select public.resolve_public_booking_patient(
            ${appointmentId},
            ${patientId}
          )
        `;
      },
    ],
    [
      "register_public_booking_patient",
      async () => {
        await sql`
          select public.register_public_booking_patient(
            ${appointmentId},
            'Denied Registration',
            null,
            'denied@example.invalid'
          )
        `;
      },
    ],
  ];

  for (const [name, action] of cases) {
    await expectSqlFailure(
      sql,
      `${status} ${name}`,
      async () => {
        await sql`
          select set_config(
            'request.jwt.claim.sub',
            ${profileId},
            true
          )
        `;

        await sql.unsafe("set local role authenticated");
        await action();
      },
      ["42501"],
    );
  }

  const [rx] = await sql`
    select status, version
    from public.prescriptions
    where id = ${prescriptionId}
  `;

  assert(
    rx.status === "DRAFT" && rx.version === 1,
    `${status}: denied finalization changed prescription state`,
  );

  const [appointment] = await sql`
    select clinical_patient_id
    from public.appointments
    where id = ${appointmentId}
  `;

  assert(
    appointment.clinical_patient_id === null,
    `${status}: denied patient resolution changed appointment identity`,
  );
}

try {
  await sql.unsafe("begin");

  /*
   * Inventory every current P0 mutation-capable SECURITY DEFINER path that explicitly uses
   * PRACTICE_AUTHORITY_REQUIRED.
   */
  const inventory = await sql`
    select
      p.proname,
      oidvectortypes(p.proargtypes) as identity_args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and p.provolatile = 'v'
        and position(
        'PRACTICE_AUTHORITY_REQUIRED'
        in p.prosrc
      ) > 0
    order by p.proname, identity_args
  `;

  const actualInventory = new Set(
    inventory.map(
      (row) =>
        `${row.proname}(${compactArgs(row.identity_args)})`,
    ),
  );

  const inventoryExtras = [...actualInventory].filter(
    (key) => !expectedPracticeAuthorityRpcs.has(key),
  );

  const inventoryMissing = [...expectedPracticeAuthorityRpcs].filter(
    (key) => !actualInventory.has(key),
  );

  assert(
    inventoryExtras.length === 0,
    `unexpected practice-authority RPC(s): ${inventoryExtras.join(", ")}`,
  );

  assert(
    inventoryMissing.length === 0,
    `missing practice-authority RPC(s): ${inventoryMissing.join(", ")}`,
  );


    /*
     * Candidate search is practice-authority gated but read-only.
     * It must remain STABLE and must never enter the clinical
     * create/mutate/finalize inventory.
     */
    const candidateSearchInventory = await sql`
      select
        p.provolatile,
        p.prosecdef,
        position(
          'PRACTICE_AUTHORITY_REQUIRED'
          in p.prosrc
        ) > 0 as practice_guarded
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname =
          'search_public_booking_patient_candidates'
        and oidvectortypes(p.proargtypes) =
          'uuid, text, text'
    `;

    assert(
      candidateSearchInventory.length === 1,
      "candidate-search authority helper missing or duplicated",
    );

    assert(
      candidateSearchInventory[0].prosecdef === true &&
        candidateSearchInventory[0].provolatile === "s" &&
        candidateSearchInventory[0].practice_guarded === true,
      "candidate-search helper must remain STABLE, SECURITY DEFINER, and practice-authority guarded",
    );

    assert(
      !actualInventory.has(
        "search_public_booking_patient_candidates(uuid,text,text)",
      ),
      "read-only candidate search leaked into mutation inventory",
    );

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
      is_active,
      is_bookable,
      created_by
    ) values (
      'QA Authority Chamber',
      'PERSONAL_CHAMBER',
      'BD',
      'Asia/Dhaka',
      true,
      true,
      ${profileId}
    )
    returning id
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

  await sql`
    insert into public.practice_memberships(
      practice_location_id, profile_id, role, status, joined_at
    ) values (
      ${location.id}, ${profileId}, 'DOCTOR', 'ACTIVE', clock_timestamp()
    )
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

  const [encounterResult] = await sql`
    select public.open_encounter(
      ${patientResult.id},
      ${location.id}
    ) as id
  `;

  const [prescriptionResult] = await sql`
    select public.open_prescription(
      ${encounterResult.id}
    ) as id
  `;

  await sql.unsafe("reset role");

  const [diagnosis] = await sql`
    insert into public.encounter_diagnoses (
      encounter_id,
      owner_doctor_id,
      diagnosis_text
    ) values (
      ${encounterResult.id},
      ${professional.id},
      'QA diagnosis'
    )
    returning id
  `;

  const [investigation] = await sql`
    insert into public.encounter_investigations (
      encounter_id,
      owner_doctor_id,
      investigation_text
    ) values (
      ${encounterResult.id},
      ${professional.id},
      'QA investigation'
    )
    returning id
  `;

  const [encounterEvent] = await sql`
    insert into public.encounter_events (
      encounter_id,
      owner_doctor_id,
      event
    ) values (
      ${encounterResult.id},
      ${professional.id},
      'QA_EVENT'
    )
    returning id
  `;

  const [prescriptionItem] = await sql`
    insert into public.prescription_items (
      prescription_id,
      display_name,
      position
    ) values (
      ${prescriptionResult.id},
      'QA Medicine',
      1
    )
    returning id
  `;

  const [prescriptionEvent] = await sql`
    insert into public.prescription_events (
      prescription_id,
      event,
      actor_kind,
      actor_id
    ) values (
      ${prescriptionResult.id},
      'QA_EVENT',
      'USER',
      ${profileId}
    )
    returning id
  `;

  const publicRef = crypto.randomUUID();

  const [appointment] = await sql`
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
      ${professional.id},
      ${location.id},
      ${chamber.id},
      null,
      null,
      null,
      clock_timestamp() + interval '1 day',
      (
        clock_timestamp() + interval '1 day'
      ) at time zone 'Asia/Dhaka',
      30,
      'GENERAL_CONSULTATION',
      'IN_PERSON',
      'PUBLIC_WEB',
      'SCHEDULED',
      ${publicRef}
    )
    returning id
  `;

  await sql`
    insert into public.public_booking_contacts (
      appointment_id,
      contact_name,
      email,
      lifecycle_status
    ) values (
      ${appointment.id},
      'QA Public Contact',
      'qa.public.contact@example.invalid',
      'ACTIVE'
    )
  `;

  const [appointmentEvent] = await sql`
    insert into public.appointment_events (
      appointment_id,
      to_status,
      actor_kind,
      actor_id
    ) values (
      ${appointment.id},
      'SCHEDULED',
      'USER',
      ${profileId}
    )
    returning id
  `;

  const [queueEntry] = await sql`
    insert into public.queue_entries (
      appointment_id,
      doctor_chamber_id,
      practice_location_id,
      session_date,
      queue_token
    ) values (
      ${appointment.id},
      ${chamber.id},
      ${location.id},
      current_date,
      1
    )
    returning id
  `;

  /*
   * Foreign-doctor fixture physically exists so RLS exclusion is meaningful.
   */
  const foreignProfileId = crypto.randomUUID();

  /*
   * public.profiles.id references auth.users.id.
   * Create the synthetic foreign auth identity first so the
   * cross-doctor RLS fixture is structurally valid.
   */
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
      ${foreignProfileId},
      'authenticated',
      'authenticated',
      ${qaEmail("custodial-foreign-doctor")},
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
      ${foreignProfileId},
      'QA Foreign Doctor',
      now()
    )
  `;

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
      full_name
    ) values (
      ${foreignProfessional.id},
      'QA-FOREIGN-000001',
      'QA Foreign Patient'
    )
    returning id
  `;

  const fixture = {
    patientId: patientResult.id,
    encounterId: encounterResult.id,
    diagnosisId: diagnosis.id,
    investigationId: investigation.id,
    encounterEventId: encounterEvent.id,
    prescriptionId: prescriptionResult.id,
    prescriptionItemId: prescriptionItem.id,
    prescriptionEventId: prescriptionEvent.id,
    appointmentId: appointment.id,
    appointmentEventId: appointmentEvent.id,
    queueEntryId: queueEntry.id,
  };

  console.log(
    `practice-authority inventory: PASS (${actualInventory.size} RPCs)`,
  );
  console.log("VERIFIED: PASS");

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

    if (status === "SUSPENDED") {
      const serialized = await custodialExport({
        profileId,
        ownerDoctorId: professional.id,
        fixture,
        foreignPatientId: foreignPatient.id,
      });

      assert(
        serialized.includes(fixture.patientId),
        "SUSPENDED: serialized export missing patient identity",
      );

      console.log("SUSPENDED custodial export: PASS");
    }

    await expectPracticeDenied({
      profileId,
      patientId: patientResult.id,
      encounterId: encounterResult.id,
      locationId: location.id,
      chamberId: chamber.id,
      appointmentId: appointment.id,
      prescriptionId: prescriptionResult.id,
      status,
    });

    console.log(`${status}: practice writes denied`);
  }

  console.log(
    "verify-custodial-vs-practice-authority: PASS " +
    `(historical export + zero foreign rows + ` +
    `${expectedPracticeAuthorityRpcs.size} RPC inventory + ` +
    `${deniedStates.length} denied credential states)`,
  );
} finally {
  try {
    await sql.unsafe("rollback");
  } finally {
    await sql.end();
  }
}
