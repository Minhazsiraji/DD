import crypto from "node:crypto";
import {
  assert,
  openLocalAdminDatabase,
  qaEmail,
} from "./p0-b2-lib.mjs";

const sql = openLocalAdminDatabase();

const forbiddenAuditColumnPattern =
  /(payload|metadata|context|details|clinical|diagnos|symptom|complaint|medicine|allerg|investigation|document|contact_name|phone|email|address|dob|blood_group|booking_ref|raw_ip|raw_ua|cookie|header|secret)/i;

const forbiddenFunctionTerms = [
  "contact_name",
  "phone_raw",
  "phone_e164",
  "email",
  "clinical_patient",
  "health_subject",
  "diagnosis",
  "symptom",
  "complaint",
  "allergy",
  "medicine",
  "investigation",
  "user_agent",
  "public_booking_ref",
];

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

try {
  await sql.unsafe("begin");

  /*
   * ------------------------------------------------------------------
   * STRUCTURAL AUDIT TABLE SAFETY
   * ------------------------------------------------------------------
   */
  const columns = await sql`
    select
      column_name,
      data_type,
      udt_name
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'audit_events'
    order by ordinal_position
  `;

  assert(
    columns.length > 0,
    "audit_events table missing",
  );

  const jsonColumns = columns.filter(
    (row) =>
      row.data_type === "json" ||
      row.data_type === "jsonb" ||
      row.udt_name === "json" ||
      row.udt_name === "jsonb",
  );

  assert(
    jsonColumns.length === 0,
    `audit_events contains generic JSON payload column(s): ${
      jsonColumns.map((r) => r.column_name).join(",")
    }`,
  );

  const forbiddenColumns = columns.filter(
    (row) =>
      forbiddenAuditColumnPattern.test(
        row.column_name,
      ),
  );

  assert(
    forbiddenColumns.length === 0,
    `audit_events contains sensitive/payload-style column(s): ${
      forbiddenColumns.map((r) => r.column_name).join(",")
    }`,
  );

  const columnNames = new Set(
    columns.map((r) => r.column_name),
  );

  assert(
    columnNames.has("anon_session_ref"),
    "audit_events.anon_session_ref missing",
  );

  /*
   * ------------------------------------------------------------------
   * REQUIRED CHECK CONSTRAINTS
   * ------------------------------------------------------------------
   */
  const constraints = await sql`
    select pg_get_constraintdef(c.oid) as definition
    from pg_constraint c
    join pg_class t
      on t.oid = c.conrelid
    join pg_namespace n
      on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'audit_events'
      and c.contype = 'c'
    order by c.conname
  `;

  const constraintText =
    constraints
      .map((r) => r.definition)
      .join("\n");

  assert(
    constraintText.includes("actor_kind") &&
      constraintText.includes("anon_session_ref") &&
      constraintText.includes("SYSTEM") &&
      constraintText.includes("actor_id"),
    "audit_events anonymous SYSTEM/null-actor structural constraint missing",
  );

  /*
   * ------------------------------------------------------------------
   * AUDIT-WRITER SIGNATURES MUST BE NARROW
   * ------------------------------------------------------------------
   */
  const writers = await sql`
    select
      p.proname,
      oidvectortypes(p.proargtypes) as identity_args,
      pg_get_functiondef(p.oid) as definition
    from pg_proc p
    join pg_namespace n
      on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'emit_audit_event',
        'emit_anon_audit_event',
        'record_public_ingress_failure'
      )
    order by p.proname
  `;

  const writerKeys = new Set(
    writers.map(
      (row) =>
        `${row.proname}(${
          row.identity_args.replace(/\s+/g, "")
        })`,
    ),
  );

  const expectedWriterKeys = new Set([
    "emit_audit_event(text,text,uuid,uuid)",
    "emit_anon_audit_event(text,text,text,uuid)",
    "record_public_ingress_failure(text,uuid,uuid)",
  ]);

  assert(
    writerKeys.size === expectedWriterKeys.size &&
      [...expectedWriterKeys].every(
        (key) => writerKeys.has(key),
      ),
    `unexpected audit writer surface: ${
      [...writerKeys].join(",")
    }`,
  );

  for (const row of writers) {
    const lower =
      row.definition.toLowerCase();

    assert(
      !lower.includes("jsonb") &&
        !lower.includes(" json "),
      `${row.proname}: generic JSON audit payload detected`,
    );
  }

  /*
   * ------------------------------------------------------------------
   * CONTACT-CORRECTION AUDIT CODES:
   * bounded changed-field names only, no values.
   * ------------------------------------------------------------------
   */
  const [contactCorrection] = await sql`
    select pg_get_functiondef(p.oid) as definition
    from pg_proc p
    join pg_namespace n
      on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname =
        'correct_public_booking_contact'
      and oidvectortypes(p.proargtypes) =
        'uuid, text, text, text, text'
  `;

  assert(
    contactCorrection,
    "correct_public_booking_contact function missing",
  );

  const correctionDefinition =
    contactCorrection.definition;

  for (const code of [
    "PUBLIC_BOOKING_CONTACT.NAME_CHANGED",
    "PUBLIC_BOOKING_CONTACT.PHONE_CHANGED",
    "PUBLIC_BOOKING_CONTACT.EMAIL_CHANGED",
    "PUBLIC_BOOKING_CONTACT.LOCALE_CHANGED",
    "PUBLIC_BOOKING_CONTACT.NO_CHANGE",
  ]) {
    assert(
      correctionDefinition.includes(code),
      `missing bounded contact audit code ${code}`,
    );
  }

  assert(
    !correctionDefinition.includes(
      "json_build_object",
    ) &&
      !correctionDefinition.includes(
        "jsonb_build_object",
      ),
    "contact correction emits arbitrary JSON audit payload",
  );

  /*
   * ------------------------------------------------------------------
   * BEHAVIORAL USER AUDIT PROOF
   * ------------------------------------------------------------------
   */
  const profileId =
    await createProfile(
      "audit-payload",
    );

  const resourceId =
    crypto.randomUUID();

  const correlationId =
    crypto.randomUUID();

  const actionCode =
    "QA_AUDIT_SAFE";

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

  await sql`
    select public.emit_audit_event(
      ${actionCode},
      'qa_resource',
      ${resourceId},
      ${correlationId}
    )
  `;

  await sql.unsafe("reset role");

  const [userAudit] = await sql`
    select
      actor_kind,
      actor_id,
      action,
      resource_type,
      resource_id,
      correlation_id,
      anon_session_ref,
      ip,
      user_agent
    from public.audit_events
    where action = ${actionCode}
      and resource_id = ${resourceId}
  `;

  assert(
    userAudit.actor_kind === "USER" &&
      userAudit.actor_id === profileId,
    "ordinary audit writer did not preserve user actor identity",
  );

  assert(
    userAudit.resource_type ===
      "qa_resource" &&
      userAudit.resource_id ===
        resourceId &&
      userAudit.correlation_id ===
        correlationId,
    "ordinary audit writer changed bounded resource identifiers",
  );

  assert(
    userAudit.anon_session_ref === null &&
      userAudit.ip === null &&
      userAudit.user_agent === null,
    "ordinary audit writer introduced anonymous/raw network fields",
  );

  /*
   * ------------------------------------------------------------------
   * BEHAVIORAL ANONYMOUS AUDIT PROOF
   *
   * Call the narrow writer directly as local superuser with synthetic
   * transaction context. This isolates audit behavior from booking logic.
   * ------------------------------------------------------------------
   */
  const anonSessionRef =
    crypto.randomUUID();

  const requestId =
    crypto.randomUUID();

  /*
   * The anonymous writer is deliberately unreachable without the trusted
   * ingress boundary. Establish that exact database identity and let the
   * canonical setter mint transaction-local context rather than fabricating
   * GUC values as a superuser.
   */
  await sql.unsafe("set session authorization dd_public_ingress");

  await sql`
    select public.set_public_ingress_context(
      ${anonSessionRef},
      ${new Date()},
      ${crypto.randomBytes(32)},
      ${crypto.randomBytes(32)},
      ${crypto.randomBytes(32)},
      'PUBLIC_WEB'::public.appointment_source,
      ${requestId}
    )
  `;

  /* Exercise the public anonymous RPC rather than granting the ingress role
   * direct access to the internal audit writer. A random reference drives the
   * bounded NOT_FOUND path and must still emit a safe SYSTEM audit row. */
  await sql`
    select *
    from public.public_booking_status(
      ${crypto.randomUUID()}::uuid
    )
  `;

  await sql.unsafe("reset session authorization");

  const anonRows = await sql`
    select
      actor_kind,
      actor_id,
      action,
      resource_type,
      resource_id,
      anon_session_ref,
      request_id,
      ip,
      user_agent
    from public.audit_events
    where anon_session_ref =
      ${anonSessionRef}
  `;

  assert(
    anonRows.length === 1,
    `expected exactly one anonymous audit row, found ${anonRows.length}`,
  );

  const anonAudit =
    anonRows[0];

  assert(
    anonAudit.actor_kind === "SYSTEM" &&
      anonAudit.actor_id === null,
    "anonymous audit actor contract violated",
  );

  assert(
    anonAudit.anon_session_ref ===
      anonSessionRef &&
      anonAudit.request_id === requestId,
    "anonymous audit correlation identifiers missing",
  );

  assert(
    anonAudit.resource_id === null,
    "anonymous audit unexpectedly persisted raw booking/resource identifier",
  );

  assert(
    anonAudit.ip === null &&
      anonAudit.user_agent === null,
    "anonymous audit persisted raw IP/user-agent",
  );

  /*
   * ------------------------------------------------------------------
   * SERIALIZED ROW SAFETY WITH SENTINELS
   * ------------------------------------------------------------------
   */
  const forbiddenSentinels = [
    "QA SECRET PATIENT NAME",
    "qa.secret@example.invalid",
    "+8801712345678",
    "Severe clinical complaint sentinel",
    crypto.randomUUID(),
  ];

  const serializedAudit =
    JSON.stringify(
      await sql`
        select to_jsonb(a) as row_data
        from public.audit_events a
        where a.action in (
          ${actionCode},
          ${anonAudit.action}
        )
      `,
    );

  for (const sentinel of forbiddenSentinels) {
    assert(
      !serializedAudit.includes(
        String(sentinel),
      ),
      `audit serialization contains forbidden sentinel ${sentinel}`,
    );
  }

  /*
   * No anonymous audit function should have arguments capable of carrying
   * public contact or clinical payload. Function names themselves may
   * legitimately mention booking/status; arguments are the authority here.
   */
  const anonWriterArgs =
    writers.find(
      (row) =>
        row.proname ===
        "emit_anon_audit_event",
    )?.identity_args ?? "";

  for (const term of forbiddenFunctionTerms) {
    assert(
      !anonWriterArgs
        .toLowerCase()
        .includes(term),
      `anonymous audit writer argument surface contains ${term}`,
    );
  }

  console.log(
    "verify-audit-no-clinical-payload: PASS " +
    "(no JSON payload + bounded writer signatures + SYSTEM anon actor + " +
    "no raw network/ref/contact/clinical payload)",
  );
} finally {
  try {
    await sql.unsafe("rollback");
  } finally {
    await sql.end();
  }
}
