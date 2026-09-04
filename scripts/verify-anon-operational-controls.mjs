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

const expectedBudgets = [
  ["PUBLIC_CHAMBER_AVAILABILITY", "SESSION_GLOBAL",   60,  60],
  ["PUBLIC_CHAMBER_AVAILABILITY", "NETWORK_GLOBAL",   60, 240],
  ["PUBLIC_CHAMBER_AVAILABILITY", "SESSION_RESOURCE", 60,  30],
  ["PUBLIC_CHAMBER_AVAILABILITY", "NETWORK_RESOURCE", 60, 120],

  ["PUBLIC_BOOKING_STATUS",       "SESSION_GLOBAL",   60,  30],
  ["PUBLIC_BOOKING_STATUS",       "NETWORK_GLOBAL",   60, 120],
  ["PUBLIC_BOOKING_STATUS",       "SESSION_RESOURCE", 60,  15],
  ["PUBLIC_BOOKING_STATUS",       "NETWORK_RESOURCE", 60,  60],

  ["CREATE_PUBLIC_BOOKING",       "SESSION_GLOBAL",   60,   6],
  ["CREATE_PUBLIC_BOOKING",       "NETWORK_GLOBAL",   60,  24],
  ["CREATE_PUBLIC_BOOKING",       "SESSION_RESOURCE", 60,   3],
  ["CREATE_PUBLIC_BOOKING",       "NETWORK_RESOURCE", 60,  12],
];

const bucketKinds = new Set([
  "SESSION_GLOBAL",
  "NETWORK_GLOBAL",
  "SESSION_RESOURCE",
  "NETWORK_RESOURCE",
]);

const expectedIngressFunctions = new Set([
  "set_public_ingress_context(uuid,timestampwithtimezone,bytea,bytea,bytea,appointment_source,uuid)",
  "public_chamber_availability(uuid,date,date)",
  "create_public_booking(uuid,timestampwithtimezone,text,text,text,text)",
  "public_booking_status(uuid)",
  "record_public_ingress_failure(text,uuid,uuid)",
]);

const testSecret = crypto.randomBytes(32);

function compactArgs(value) {
  return value.replace(/\s+/g, "");
}

function hmac(value) {
  return crypto
    .createHmac("sha256", testSecret)
    .update(String(value))
    .digest();
}

function hex(value) {
  return value.toString("hex");
}

function tomorrowIsoDate() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
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

async function clearBuckets() {
  await sql`
    delete from public.anon_rate_limit_buckets
  `;
}

async function setBudgets(
  rpcCode,
  {
    sessionGlobal = 100,
    networkGlobal = 100,
    sessionResource = 100,
    networkResource = 100,
  } = {},
) {
  const limits = new Map([
    ["SESSION_GLOBAL", sessionGlobal],
    ["NETWORK_GLOBAL", networkGlobal],
    ["SESSION_RESOURCE", sessionResource],
    ["NETWORK_RESOURCE", networkResource],
  ]);

  for (const [kind, limit] of limits) {
    await sql`
      update public.anon_rate_limit_policies
      set
        window_seconds = 3600,
        max_requests = ${limit}
      where rpc_code = ${rpcCode}
        and bucket_kind = ${kind}
        and enabled = true
    `;
  }
}

let sessionAuthorizationSavepointCounter = 0;

async function withSessionAuthorization(
  role,
  action,
) {
  assert(
    role === "dd_public_ingress" ||
      role === "anon",
    `unexpected verifier session role: ${role}`,
  );

  sessionAuthorizationSavepointCounter += 1;

  const savepoint =
    `dd_p0_session_auth_${sessionAuthorizationSavepointCounter}`;

  await sql.unsafe(
    `savepoint ${savepoint}`,
  );

  try {
    await sql.unsafe(
      `set session authorization ${role}`,
    );

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
        "session-authorization cleanup failed: " +
        (cleanupError?.message ?? cleanupError),
      );

      failure.cause = error;
      throw failure;
    }

    throw error;
  }
}

async function trustedCall({
  source = "PUBLIC_WEB",
  sessionRef = crypto.randomUUID(),
  sessionStartedAt = new Date(),
  sessionDigest = null,
  networkDigest = null,
  resourceDigest = null,
  requestKey = crypto.randomUUID(),
  action,
}) {
  const resolvedSessionDigest =
    sessionDigest ?? hmac(`session:${sessionRef}`);

  const resolvedNetworkDigest =
    networkDigest ?? hmac(`network:${sessionRef}`);

  const resolvedResourceDigest =
    resourceDigest ?? hmac(`resource:${requestKey}`);

  return withSessionAuthorization(
    "dd_public_ingress",
    async () => {
      const [identity] = await sql`
        select
          session_user as session_user_name,
          current_user as current_user_name
      `;

      assert(
        identity.session_user_name === "dd_public_ingress" &&
          identity.current_user_name === "dd_public_ingress",
        "trusted ingress database identity was not established",
      );

      await sql`
        select public.set_public_ingress_context(
          ${sessionRef},
          ${sessionStartedAt},
          ${resolvedSessionDigest},
          ${resolvedNetworkDigest},
          ${resolvedResourceDigest},
          ${source}::public.appointment_source,
          ${requestKey}
        )
      `;

      const result = await action();

      return {
        sessionRef,
        requestKey,
        result,
      };
    },
  );
}

async function auditRows(sessionRef) {
  return sql`
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
    where anon_session_ref = ${sessionRef}
    order by seq
  `;
}

async function assertOutcome(sessionRef, outcome) {
  const rows = await auditRows(sessionRef);

  assert(
    rows.some((row) =>
      row.action.includes(outcome)
    ),
    `${sessionRef}: missing audit outcome ${outcome}; got ${
      rows.map((row) => row.action).join(",")
    }`,
  );

  for (const row of rows) {
    assert(
      row.actor_kind === "SYSTEM",
      `${row.action}: anonymous audit actor_kind is not SYSTEM`,
    );

    assert(
      row.actor_id === null,
      `${row.action}: anonymous audit actor_id is not NULL`,
    );

    assert(
      row.ip === null,
      `${row.action}: anonymous audit persisted raw IP`,
    );

    assert(
      row.user_agent === null,
      `${row.action}: anonymous audit persisted raw user-agent`,
    );
  }

  return rows;
}

async function statusNotFound(context = {}) {
  const bookingRef = crypto.randomUUID();

  return trustedCall({
    ...context,
    resourceDigest:
      context.resourceDigest ??
      hmac(`booking-ref:${bookingRef}`),
    action: async () => sql`
      select *
      from public.public_booking_status(
        ${bookingRef}
      )
    `,
  });
}

async function availabilityNotFound({
  chamberId = crypto.randomUUID(),
  startDate = tomorrowIsoDate(),
  endDate = startDate,
  ...context
} = {}) {
  return trustedCall({
    ...context,
    resourceDigest:
      context.resourceDigest ??
      hmac(`chamber:${chamberId}`),
    action: async () => sql`
      select *
      from public.public_chamber_availability(
        ${chamberId}::uuid,
        ${startDate}::date,
        ${endDate}::date
      )
    `,
  });
}

async function bookingNotFound({
  chamberId = crypto.randomUUID(),
  contactName = "QA Rate Contact",
  contactEmail = "qa.rate@example.invalid",
  ...context
} = {}) {
  const requestedSlot =
    new Date(Date.now() + 24 * 60 * 60 * 1000);

  return trustedCall({
    ...context,
    resourceDigest:
      context.resourceDigest ??
      hmac(`chamber:${chamberId}`),
    action: async () => sql`
      select *
      from public.create_public_booking(
        ${chamberId},
        ${requestedSlot},
        ${contactName},
        null,
        ${contactEmail},
        'en'
      )
    `,
  });
}

/*
 * ------------------------------------------------------------------
 * CONCURRENCY-SAFE RATE COUNTER PROOF
 *
 * This runs before the verifier transaction because independent database
 * sessions must be able to commit against the same four bucket rows.
 * It calls the canonical rate function directly as the local superuser.
 * No anonymous audit rows are created.
 * ------------------------------------------------------------------
 */
async function proveConcurrentCounters() {
  /*
   * This proof is intentionally independent of prior append-only audit rows.
   * Other P0 verifiers may already have exercised audited anonymous paths in
   * the same local database, and deleting audit history merely to make a
   * concurrency test order-dependent would weaken the verifier contract.
   */
  await sql`
    delete from public.anon_rate_limit_buckets
  `;

  const sessionRef =
    crypto.randomUUID();

  const sessionStartedAt =
    new Date();

  const bookingRef =
    crypto.randomUUID();

  const sessionDigest =
    hmac(`concurrency-session:${sessionRef}`);

  const networkDigest =
    hmac("concurrency-network");

  const resourceDigest =
    hmac(`booking-ref:${bookingRef}`);

  const calls = 12;

  /*
   * Each worker is a real independent database session.
   *
   * It must establish the exact trusted-ingress database identity,
   * mint trusted context through set_public_ingress_context(), and
   * then exercise the canonical PUBLIC_BOOKING_STATUS RPC.
   *
   * All workers deliberately share the same session/network/resource
   * digests so the four rate buckets must each converge atomically to
   * exactly `calls`.
   */
  const workers = Array.from(
    { length: calls },
    async (_, index) => {
      const client = postgres(
        localAdminDatabaseUrl(),
        {
          max: 1,
          prepare: false,
          onnotice: () => {},
        },
      );

      let transactionOpen = false;
      let sessionAuthorized = false;

      try {
        await client.unsafe("begin");
        transactionOpen = true;

        await client.unsafe(
          "set session authorization dd_public_ingress",
        );
        sessionAuthorized = true;

        const [identity] = await client`
          select
            session_user as session_user_name,
            current_user as current_user_name
        `;

        assert(
          identity.session_user_name ===
            "dd_public_ingress" &&
            identity.current_user_name ===
              "dd_public_ingress",
          `concurrency worker ${index}: trusted ingress identity not established`,
        );

        const requestId =
          crypto.randomUUID();

        await client`
          select public.set_public_ingress_context(
            ${sessionRef},
            ${sessionStartedAt},
            ${sessionDigest},
            ${networkDigest},
            ${resourceDigest},
            'PUBLIC_WEB'::public.appointment_source,
            ${requestId}
          )
        `;

        const result = await client`
          select *
          from public.public_booking_status(
            ${bookingRef}
          )
        `;

        assert(
          result.length === 0,
          `concurrency worker ${index}: nonexistent booking unexpectedly resolved`,
        );

        await client.unsafe(
          "reset session authorization",
        );
        sessionAuthorized = false;

        await client.unsafe("commit");
        transactionOpen = false;
      } catch (error) {
        if (transactionOpen) {
          try {
            await client.unsafe("rollback");
          } catch {
            // Preserve the original verifier failure.
          }

          transactionOpen = false;
        }

        if (sessionAuthorized) {
          try {
            await client.unsafe(
              "reset session authorization",
            );
          } catch {
            // Preserve the original verifier failure.
          }

          sessionAuthorized = false;
        }

        throw error;
      } finally {
        await client.end();
      }
    },
  );

  try {
    /*
     * Wait for every worker even when one fails, so cleanup cannot race
     * still-running concurrent transactions.
     */
    const settled =
      await Promise.allSettled(workers);

    const failures =
      settled.filter(
        (result) =>
          result.status === "rejected",
      );

    if (failures.length > 0) {
      throw failures[0].reason;
    }

    const bucketColumns = await sql`
      select
        column_name,
        data_type
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'anon_rate_limit_buckets'
      order by ordinal_position
    `;

    const counterCandidates =
      bucketColumns.filter((column) =>
        /count|requests|hits/i.test(
          column.column_name,
        ) &&
        [
          "smallint",
          "integer",
          "bigint",
        ].includes(column.data_type)
      );

    assert(
      counterCandidates.length === 1,
      `expected exactly one rate counter column, found ${
        counterCandidates
          .map((c) => c.column_name)
          .join(",")
      }`,
    );

    const counterColumn =
      counterCandidates[0].column_name;

    assert(
      /^[a-z_][a-z0-9_]*$/.test(
        counterColumn,
      ),
      `unsafe discovered counter column ${counterColumn}`,
    );

    const rows = await sql.unsafe(`
      select
        bucket_kind,
        "${counterColumn}"::integer as counter_value
      from public.anon_rate_limit_buckets
      where rpc_code = 'PUBLIC_BOOKING_STATUS'
      order by bucket_kind
    `);

    assert(
      rows.length === 4,
      `concurrency proof expected 4 shared bucket rows, found ${rows.length}`,
    );

    assert(
      rows.every(
        (row) =>
          row.counter_value === calls,
      ),
      `concurrent counters are not atomic: ${
        rows
          .map(
            (row) =>
              `${row.bucket_kind}=${row.counter_value}`,
          )
          .join(",")
      }`,
    );

    const concurrencyAuditRows = await sql`
      select
        actor_kind,
        actor_id,
        action,
        resource_type,
        anon_session_ref,
        ip,
        user_agent
      from public.audit_events
      where anon_session_ref = ${sessionRef}
      order by seq
    `;

    assert(
      concurrencyAuditRows.length === calls,
      `concurrency audit expected ${calls} append-only rows, found ${concurrencyAuditRows.length}`,
    );

    assert(
      concurrencyAuditRows.every(
        (row) =>
          row.actor_kind === "SYSTEM" &&
          row.actor_id === null &&
          row.action ===
            "ANON.PUBLIC_BOOKING_STATUS.NOT_FOUND" &&
          row.resource_type === "public_booking" &&
          row.anon_session_ref === sessionRef &&
          row.ip === null &&
          row.user_agent === null,
      ),
      "concurrency audit rows violated anonymous audit safety contract",
    );

    console.log(
      `concurrency-safe counters: PASS (${calls} parallel trusted RPC calls x 4 buckets)`,
    );

    console.log(
      `concurrency append-only audit: PASS (${calls} SYSTEM/NOT_FOUND rows)`,
    );
  } finally {
    /*
     * Rate buckets are disposable operational state and are removed here.
     *
     * The concurrency audit rows are intentionally NOT deleted:
     * audit_events is append-only by contract. A fresh isolated local
     * replay is required after this verifier to restore a clean Track-A DB.
     */
    await sql`
      delete from public.anon_rate_limit_buckets
      where rpc_code = 'PUBLIC_BOOKING_STATUS'
    `;

  }
}

await proveConcurrentCounters();

try {
  await sql.unsafe("begin");

  /*
   * ------------------------------------------------------------------
   * EXACT CONFIG-BACKED RATE POLICY
   * ------------------------------------------------------------------
   */
  const policies = await sql`
    select
      rpc_code,
      bucket_kind,
      window_seconds,
      max_requests,
      enabled,
      policy_version,
      effective_from
    from public.anon_rate_limit_policies
    order by rpc_code, bucket_kind
  `;

  assert(
    policies.length === 12,
    `expected exactly 12 P0 rate-policy rows, found ${policies.length}`,
  );

  for (const [
    rpcCode,
    bucketKind,
    windowSeconds,
    maxRequests,
  ] of expectedBudgets) {
    const row = policies.find(
      (candidate) =>
        candidate.rpc_code === rpcCode &&
        candidate.bucket_kind === bucketKind,
    );

    assert(
      row,
      `missing rate policy ${rpcCode}/${bucketKind}`,
    );

    assert(
      row.enabled === true,
      `${rpcCode}/${bucketKind} is disabled`,
    );

    assert(
      row.window_seconds === windowSeconds &&
        row.max_requests === maxRequests,
      `${rpcCode}/${bucketKind}: expected ${maxRequests}/${windowSeconds}s, ` +
        `got ${row.max_requests}/${row.window_seconds}s`,
    );

    assert(
      row.policy_version ===
        "P0-2026-09-04-V1",
      `${rpcCode}/${bucketKind}: unexpected policy version ${row.policy_version}`,
    );
  }

  for (const rpcCode of [
    "PUBLIC_CHAMBER_AVAILABILITY",
    "PUBLIC_BOOKING_STATUS",
    "CREATE_PUBLIC_BOOKING",
  ]) {
    const kinds = new Set(
      policies
        .filter(
          (row) =>
            row.rpc_code === rpcCode,
        )
        .map((row) => row.bucket_kind),
    );

    assert(
      kinds.size === 4 &&
        [...bucketKinds].every(
          (kind) => kinds.has(kind),
        ),
      `${rpcCode}: four-bucket policy set incomplete`,
    );
  }

  console.log(
    "rate policy configuration: PASS (12 rows, P0-2026-09-04-V1)",
  );

  /*
   * ------------------------------------------------------------------
   * TRUSTED INGRESS HAS ZERO TABLE AUTHORITY + EXACT FUNCTION SURFACE
   * ------------------------------------------------------------------
   */
  const ingressRelations = await sql`
    select
      c.relname,
      has_table_privilege(
        'dd_public_ingress',
        c.oid,
        'SELECT'
      ) as can_select,
      has_table_privilege(
        'dd_public_ingress',
        c.oid,
        'INSERT'
      ) as can_insert,
      has_table_privilege(
        'dd_public_ingress',
        c.oid,
        'UPDATE'
      ) as can_update,
      has_table_privilege(
        'dd_public_ingress',
        c.oid,
        'DELETE'
      ) as can_delete
    from pg_class c
    join pg_namespace n
      on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r','p','v','m','f')
    order by c.relname
  `;

  const ingressTableLeaks =
    ingressRelations.filter(
      (row) =>
        row.can_select ||
        row.can_insert ||
        row.can_update ||
        row.can_delete,
    );

  assert(
    ingressTableLeaks.length === 0,
    `dd_public_ingress direct table authority: ${
      ingressTableLeaks
        .map((r) => r.relname)
        .join(",")
    }`,
  );

  const ingressFunctions = await sql`
    select
      p.proname,
      oidvectortypes(
        p.proargtypes
      ) as identity_args,
      has_function_privilege(
        'dd_public_ingress',
        p.oid,
        'EXECUTE'
      ) as can_execute
    from pg_proc p
    join pg_namespace n
      on n.oid = p.pronamespace
    where n.nspname = 'public'
    order by p.proname, identity_args
  `;

  const actualIngressFunctions =
    new Set(
      ingressFunctions
        .filter((row) => row.can_execute)
        .map(
          (row) =>
            `${row.proname}(${compactArgs(
              row.identity_args,
            )})`,
        ),
    );

  const ingressExtras =
    [...actualIngressFunctions].filter(
      (key) =>
        !expectedIngressFunctions.has(
          key,
        ),
    );

  const ingressMissing =
    [...expectedIngressFunctions].filter(
      (key) =>
        !actualIngressFunctions.has(
          key,
        ),
    );

  assert(
    ingressExtras.length === 0,
    `unexpected ingress EXECUTE: ${ingressExtras.join(",")}`,
  );

  assert(
    ingressMissing.length === 0,
    `missing ingress EXECUTE: ${ingressMissing.join(",")}`,
  );


  const [ingressRole] = await sql`
    select
      rolsuper,
      rolcreatedb,
      rolcreaterole,
      rolinherit,
      rolcanlogin,
      rolreplication,
      rolbypassrls
    from pg_roles
    where rolname = 'dd_public_ingress'
  `;

  assert(
    ingressRole,
    "dd_public_ingress role missing",
  );

  assert(
    ingressRole.rolsuper === false &&
      ingressRole.rolcreatedb === false &&
      ingressRole.rolcreaterole === false &&
      ingressRole.rolinherit === false &&
      ingressRole.rolcanlogin === true &&
      ingressRole.rolreplication === false &&
      ingressRole.rolbypassrls === false,
    "dd_public_ingress role attributes are not exact least privilege",
  );

  console.log(
    "trusted ingress role attributes: PASS",
  );

  console.log(
    "trusted ingress privilege boundary: PASS",
  );

  /*
   * ------------------------------------------------------------------
   * FABRICATED CLIENT CONTEXT MUST FAIL
   * ------------------------------------------------------------------
   */
  await expectSqlFailure(
    sql,
    "fabricated anon ingress context",
    async () => {
      await withSessionAuthorization(
        "anon",
        async () => {
        await sql`
          select
            set_config(
              'dd.anon_session_ref',
              ${crypto.randomUUID()},
              true
            ),
            set_config(
              'dd.anon_session_started_at',
              ${new Date().toISOString()},
              true
            ),
            set_config(
              'dd.anon_session_digest',
              ${hex(hmac("fake-session"))},
              true
            ),
            set_config(
              'dd.network_digest',
              ${hex(hmac("fake-network"))},
              true
            ),
            set_config(
              'dd.resource_digest',
              ${hex(hmac("fake-resource"))},
              true
            ),
            set_config(
              'dd.public_source_channel',
              'PUBLIC_WEB',
              true
            ),
            set_config(
              'dd.public_request_id',
              ${crypto.randomUUID()},
              true
            ),
            set_config(
              'dd.public_ingress_ready',
              '1',
              true
            )
        `;

        await sql`
          select *
          from public.public_booking_status(
            ${crypto.randomUUID()}
          )
        `;
        },
      );
    },
    ["42501", "P0001"],
  );

  console.log(
    "fabricated trusted ingress context: PASS",
  );

  /*
   * ------------------------------------------------------------------
   * UNDER-BUDGET / OVER-BUDGET
   * ------------------------------------------------------------------
   */
  await clearBuckets();

  await setBudgets(
    "PUBLIC_BOOKING_STATUS",
    {
      sessionGlobal: 3,
      networkGlobal: 100,
      sessionResource: 3,
      networkResource: 100,
    },
  );

  const limitSessionRef =
    crypto.randomUUID();

  const limitStartedAt = new Date();
  const limitSessionDigest =
    hmac(`limit-session:${limitSessionRef}`);
  const limitNetworkDigest =
    hmac("limit-network");
  const limitResourceDigest =
    hmac("limit-resource");

  for (let attempt = 1; attempt <= 4; attempt += 1) {
    await statusNotFound({
      sessionRef: limitSessionRef,
      sessionStartedAt: limitStartedAt,
      sessionDigest: limitSessionDigest,
      networkDigest: limitNetworkDigest,
      resourceDigest: limitResourceDigest,
    });
  }

  const limitAudit =
    await auditRows(limitSessionRef);

  const limitedCount =
    limitAudit.filter(
      (row) =>
        row.action.includes(
          "RATE_LIMITED",
        ),
    ).length;

  const passedCount =
    limitAudit.filter(
      (row) =>
        !row.action.includes(
          "RATE_LIMITED",
        ),
    ).length;

  assert(
    passedCount === 3 &&
      limitedCount === 1,
    `expected 3 under-budget + 1 rate-limited, got passed=${passedCount}, limited=${limitedCount}`,
  );

  console.log(
    "under/over budget behavior: PASS",
  );

  /*
   * ------------------------------------------------------------------
   * DATE-RANGE VARIATION CANNOT EVADE AVAILABILITY RESOURCE LIMIT
   * ------------------------------------------------------------------
   */
  await clearBuckets();

  await setBudgets(
    "PUBLIC_CHAMBER_AVAILABILITY",
    {
      sessionGlobal: 100,
      networkGlobal: 100,
      sessionResource: 2,
      networkResource: 100,
    },
  );

  const dateSessionRef =
    crypto.randomUUID();
  const dateSessionDigest =
    hmac(`date-session:${dateSessionRef}`);
  const dateNetworkDigest =
    hmac("date-network");
  const dateChamber =
    crypto.randomUUID();
  const dateResourceDigest =
    hmac(`chamber:${dateChamber}`);

  for (const day of [
    tomorrowIsoDate(),
    "2026-09-06",
    "2026-09-07",
  ]) {
    await availabilityNotFound({
      chamberId: dateChamber,
      startDate: day,
      endDate: day,
      sessionRef: dateSessionRef,
      sessionDigest: dateSessionDigest,
      networkDigest: dateNetworkDigest,
      resourceDigest: dateResourceDigest,
    });
  }

  await assertOutcome(
    dateSessionRef,
    "RATE_LIMITED",
  );

  console.log(
    "availability date-range rotation resistance: PASS",
  );

  /*
   * ------------------------------------------------------------------
   * CHAMBER ROTATION CANNOT EVADE SESSION-GLOBAL LIMIT
   * ------------------------------------------------------------------
   */
  await clearBuckets();

  await setBudgets(
    "PUBLIC_CHAMBER_AVAILABILITY",
    {
      sessionGlobal: 2,
      networkGlobal: 100,
      sessionResource: 100,
      networkResource: 100,
    },
  );

  const chamberSessionRef =
    crypto.randomUUID();
  const chamberSessionDigest =
    hmac(`chamber-session:${chamberSessionRef}`);
  const chamberNetworkDigest =
    hmac("chamber-network");

  for (let i = 0; i < 3; i += 1) {
    const chamberId =
      crypto.randomUUID();

    await availabilityNotFound({
      chamberId,
      sessionRef: chamberSessionRef,
      sessionDigest: chamberSessionDigest,
      networkDigest: chamberNetworkDigest,
      resourceDigest:
        hmac(`chamber:${chamberId}`),
    });
  }

  await assertOutcome(
    chamberSessionRef,
    "RATE_LIMITED",
  );

  console.log(
    "chamber rotation global-limit resistance: PASS",
  );

  /*
   * ------------------------------------------------------------------
   * BOOKING-REF ROTATION CANNOT EVADE SESSION-GLOBAL LIMIT
   * ------------------------------------------------------------------
   */
  await clearBuckets();

  await setBudgets(
    "PUBLIC_BOOKING_STATUS",
    {
      sessionGlobal: 2,
      networkGlobal: 100,
      sessionResource: 100,
      networkResource: 100,
    },
  );

  const refSessionRef =
    crypto.randomUUID();
  const refSessionDigest =
    hmac(`ref-session:${refSessionRef}`);
  const refNetworkDigest =
    hmac("ref-network");

  for (let i = 0; i < 3; i += 1) {
    const bookingRef =
      crypto.randomUUID();

    await trustedCall({
      sessionRef: refSessionRef,
      sessionDigest: refSessionDigest,
      networkDigest: refNetworkDigest,
      resourceDigest:
        hmac(`booking-ref:${bookingRef}`),
      action: async () => sql`
        select *
        from public.public_booking_status(
          ${bookingRef}
        )
      `,
    });
  }

  await assertOutcome(
    refSessionRef,
    "RATE_LIMITED",
  );

  console.log(
    "booking-ref rotation global-limit resistance: PASS",
  );

  /*
   * ------------------------------------------------------------------
   * SESSION ROTATION CANNOT EVADE NETWORK-GLOBAL LIMIT
   * ------------------------------------------------------------------
   */
  await clearBuckets();

  await setBudgets(
    "PUBLIC_BOOKING_STATUS",
    {
      sessionGlobal: 100,
      networkGlobal: 2,
      sessionResource: 100,
      networkResource: 100,
    },
  );

  const sharedNetwork =
    hmac("rotating-session-network");

  const rotationSessions = [];

  for (let i = 0; i < 3; i += 1) {
    const sessionRef =
      crypto.randomUUID();

    rotationSessions.push(sessionRef);

    await statusNotFound({
      sessionRef,
      sessionDigest:
        hmac(`rotation:${sessionRef}`),
      networkDigest: sharedNetwork,
      resourceDigest:
        hmac(`rotation-resource:${i}`),
    });
  }

  await assertOutcome(
    rotationSessions[2],
    "RATE_LIMITED",
  );

  console.log(
    "anon-session rotation network-limit resistance: PASS",
  );

  /*
   * ------------------------------------------------------------------
   * RATE STATE MUST CONTAIN DIGESTS, NEVER RAW SENSITIVE INPUTS
   * ------------------------------------------------------------------
   */
  await clearBuckets();

  await setBudgets(
    "CREATE_PUBLIC_BOOKING",
  );

  await setBudgets(
    "PUBLIC_BOOKING_STATUS",
  );

  const rawIp =
    "203.0.113.77";
  const rawContactName =
    "QA RAW CONTACT SENTINEL";
  const rawContactEmail =
    "qa.raw.sentinel@example.invalid";
  const rawBookingRef =
    crypto.randomUUID();

  await bookingNotFound({
    chamberId: crypto.randomUUID(),
    contactName: rawContactName,
    contactEmail: rawContactEmail,
    networkDigest: hmac(rawIp),
  });

  await trustedCall({
    networkDigest: hmac(rawIp),
    resourceDigest:
      hmac(`booking-ref:${rawBookingRef}`),
    action: async () => sql`
      select *
      from public.public_booking_status(
        ${rawBookingRef}
      )
    `,
  });

  const bucketColumnNames =
    await sql`
      select column_name
      from information_schema.columns
      where table_schema = 'public'
        and table_name =
          'anon_rate_limit_buckets'
      order by ordinal_position
    `;

  const forbiddenColumnPattern =
    /(raw_?ip|public_booking_ref|contact|phone|email|user_agent|cookie|header|anon_session_ref)/i;

  const forbiddenColumns =
    bucketColumnNames.filter(
      (row) =>
        forbiddenColumnPattern.test(
          row.column_name,
        ),
    );

  assert(
    forbiddenColumns.length === 0,
    `rate-state schema contains raw-sensitive column(s): ${
      forbiddenColumns
        .map((r) => r.column_name)
        .join(",")
    }`,
  );

  const bucketJson = await sql`
    select to_jsonb(b)::text as row_json
    from public.anon_rate_limit_buckets b
  `;

  const bucketText =
    bucketJson
      .map((row) => row.row_json)
      .join("\n");

  for (const rawValue of [
    rawIp,
    rawContactName,
    rawContactEmail,
    rawBookingRef,
  ]) {
    assert(
      !bucketText.includes(String(rawValue)),
      `raw sensitive value persisted in rate state: ${rawValue}`,
    );
  }

  console.log(
    "rate-state raw identifier / PII exclusion: PASS",
  );

  /*
   * ------------------------------------------------------------------
   * RESTORE HIGH TEST BUDGETS FOR AUDIT MATRIX
   * ------------------------------------------------------------------
   */
  for (const rpcCode of [
    "PUBLIC_CHAMBER_AVAILABILITY",
    "PUBLIC_BOOKING_STATUS",
    "CREATE_PUBLIC_BOOKING",
  ]) {
    await setBudgets(
      rpcCode,
      {
        sessionGlobal: 100,
        networkGlobal: 100,
        sessionResource: 100,
        networkResource: 100,
      },
    );
  }

  await clearBuckets();

  /*
   * ------------------------------------------------------------------
   * PUBLIC DOCTOR FIXTURE FOR SUCCESS OUTCOMES
   * ------------------------------------------------------------------
   */
  const doctorProfileId =
    await createProfile(
      "anon-operational-doctor",
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
      'QA-ANON-OPS',
      'QA Anonymous Operations Regulator'
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
      'QA Anonymous Operations Doctor',
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
      'QA-ANON-OPS-001',
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
      'QA Anonymous Operations Location',
      'PERSONAL_CHAMBER',
      'BD',
      'Asia/Dhaka',
      true,
      true,
      ${doctorProfileId}
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

  const [slot] = await sql`
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
      ) at time zone ${location.timezone}
        as starts_at
  `;

  await sql`
    insert into public.doctor_chamber_hours (
      doctor_chamber_id,
      weekday,
      start_time,
      end_time
    ) values (
      ${chamber.id},
      ${slot.weekday},
      '10:00',
      '12:00'
    )
  `;

  const auditSessionRefs = [];
  const sensitiveContactName =
    "QA Audit Contact Sentinel";
  const sensitiveContactEmail =
    "qa.audit.sentinel@example.invalid";

  /*
   * AVAILABILITY SUCCESS
   */
  const availabilitySuccess =
    await trustedCall({
      resourceDigest:
        hmac(`chamber:${chamber.id}`),
      action: async () => sql`
        select *
        from public.public_chamber_availability(
          ${chamber.id}::uuid,
          ${slot.local_day}::date,
          ${slot.local_day}::date
        )
      `,
    });

  auditSessionRefs.push(
    availabilitySuccess.sessionRef,
  );

  assert(
    availabilitySuccess.result.length > 0,
    "availability success fixture returned no open slots",
  );

  assert(
    JSON.stringify(
      Object.keys(
        availabilitySuccess.result[0],
      ).sort(),
    ) ===
      JSON.stringify([
        "ends_at",
        "remaining_capacity",
        "starts_at",
      ]),
    "availability return shape is not exact",
  );

  assert(
    availabilitySuccess.result.every(
      (row) =>
        row.remaining_capacity === 1,
    ),
    "availability returned non-unit remaining capacity",
  );

  await assertOutcome(
    availabilitySuccess.sessionRef,
    "SUCCESS",
  );

  /*
   * AVAILABILITY VALIDATION_FAILURE
   */
  const availabilityValidation =
    await trustedCall({
      resourceDigest:
        hmac(`chamber:${chamber.id}`),
      action: async () => sql`
        select *
        from public.public_chamber_availability(
          ${chamber.id}::uuid,
          ${slot.local_day}::date,
          (${slot.local_day}::date + 31)
        )
      `,
    });

  auditSessionRefs.push(
    availabilityValidation.sessionRef,
  );

  assert(
    availabilityValidation.result.length === 0,
    "invalid availability range returned rows",
  );

  await assertOutcome(
    availabilityValidation.sessionRef,
    "VALIDATION_FAILURE",
  );

  /*
   * AVAILABILITY NOT_FOUND
   */
  const availabilityMissing =
    await availabilityNotFound();

  auditSessionRefs.push(
    availabilityMissing.sessionRef,
  );

  await assertOutcome(
    availabilityMissing.sessionRef,
    "NOT_FOUND",
  );

  /*
   * BOOKING SUCCESS
   */
  const bookingSuccess =
    await trustedCall({
      resourceDigest:
        hmac(`chamber:${chamber.id}`),
      action: async () => sql`
        select *
        from public.create_public_booking(
          ${chamber.id},
          ${slot.starts_at},
          ${sensitiveContactName},
          null,
          ${sensitiveContactEmail},
          'en'
        )
      `,
    });

  auditSessionRefs.push(
    bookingSuccess.sessionRef,
  );

  assert(
    bookingSuccess.result.length === 1 &&
      bookingSuccess.result[0]
        .public_booking_ref,
    "booking success did not return one booking ref",
  );

  assert(
    JSON.stringify(
      Object.keys(
        bookingSuccess.result[0],
      ).sort(),
    ) ===
      JSON.stringify([
        "public_booking_ref",
      ]),
    "booking return shape is not exact",
  );

  const bookingRef =
    bookingSuccess.result[0]
      .public_booking_ref;

  await assertOutcome(
    bookingSuccess.sessionRef,
    "SUCCESS",
  );

  /*
   * BOOKING VALIDATION_FAILURE
   */
  const bookingValidation =
    await trustedCall({
      resourceDigest:
        hmac(`chamber:${chamber.id}`),
      action: async () => sql`
        select *
        from public.create_public_booking(
          ${chamber.id},
          ${slot.starts_at}
            + interval '30 minutes',
          '',
          null,
          null,
          'en'
        )
      `,
    });

  auditSessionRefs.push(
    bookingValidation.sessionRef,
  );

  assert(
    bookingValidation.result.length === 0,
    "invalid booking input returned a booking",
  );

  await assertOutcome(
    bookingValidation.sessionRef,
    "VALIDATION_FAILURE",
  );

  /*
   * BOOKING NOT_FOUND
   */
  const bookingMissing =
    await bookingNotFound();

  auditSessionRefs.push(
    bookingMissing.sessionRef,
  );

  await assertOutcome(
    bookingMissing.sessionRef,
    "NOT_FOUND",
  );

  /*
   * STATUS SUCCESS
   */
  const statusSuccess =
    await trustedCall({
      resourceDigest:
        hmac(`booking-ref:${bookingRef}`),
      action: async () => sql`
        select *
        from public.public_booking_status(
          ${bookingRef}
        )
      `,
    });

  auditSessionRefs.push(
    statusSuccess.sessionRef,
  );

  assert(
    statusSuccess.result.length === 1,
    "status success returned no row",
  );

  assert(
    JSON.stringify(
      Object.keys(
        statusSuccess.result[0],
      ).sort(),
    ) ===
      JSON.stringify([
        "location_name",
        "scheduled_for",
        "status",
      ]),
    "status return shape is not exact",
  );

  await assertOutcome(
    statusSuccess.sessionRef,
    "SUCCESS",
  );

  /*
   * STATUS VALIDATION_FAILURE
   */
  const statusValidation =
    await trustedCall({
      resourceDigest:
        hmac("status-null-resource"),
      action: async () => sql`
        select *
        from public.public_booking_status(
          null
        )
      `,
    });

  auditSessionRefs.push(
    statusValidation.sessionRef,
  );

  assert(
    statusValidation.result.length === 0,
    "NULL booking ref returned status",
  );

  await assertOutcome(
    statusValidation.sessionRef,
    "VALIDATION_FAILURE",
  );

  /*
   * STATUS NOT_FOUND
   */
  const statusMissing =
    await statusNotFound();

  auditSessionRefs.push(
    statusMissing.sessionRef,
  );

  await assertOutcome(
    statusMissing.sessionRef,
    "NOT_FOUND",
  );

  /*
   * RATE_LIMITED AUDIT FOR EACH RPC.
   */
  const rateCases = [
    [
      "PUBLIC_CHAMBER_AVAILABILITY",
      async (context) =>
        availabilityNotFound(context),
    ],
    [
      "CREATE_PUBLIC_BOOKING",
      async (context) =>
        bookingNotFound(context),
    ],
    [
      "PUBLIC_BOOKING_STATUS",
      async (context) =>
        statusNotFound(context),
    ],
  ];

  for (const [rpcCode, invoke] of rateCases) {
    await clearBuckets();

    await setBudgets(
      rpcCode,
      {
        sessionGlobal: 1,
        networkGlobal: 100,
        sessionResource: 100,
        networkResource: 100,
      },
    );

    const sessionRef =
      crypto.randomUUID();

    const shared = {
      sessionRef,
      sessionStartedAt: new Date(),
      sessionDigest:
        hmac(`rate-audit:${sessionRef}`),
      networkDigest:
        hmac(`rate-audit-network:${rpcCode}`),
    };

    await invoke(shared);
    await invoke(shared);

    auditSessionRefs.push(
      sessionRef,
    );

    await assertOutcome(
      sessionRef,
      "RATE_LIMITED",
    );
  }

  /*
   * ------------------------------------------------------------------
   * INTERNAL_FAILURE IS RESTRICTED TO TRUSTED INGRESS
   * ------------------------------------------------------------------
   */
  await expectSqlFailure(
    sql,
    "anon internal-failure audit path",
    async () => {
      await withSessionAuthorization(
        "anon",
        async () => {
        await sql`
          select public.record_public_ingress_failure(
            'PUBLIC_BOOKING_STATUS',
            ${crypto.randomUUID()},
            ${crypto.randomUUID()}
          )
        `;
        },
      );
    },
    ["42501"],
  );

  const internalFailureSession =
    crypto.randomUUID();

  const internalFailureRequest =
    crypto.randomUUID();

  await withSessionAuthorization(
    "dd_public_ingress",
    async () => {
      await sql`
        select public.record_public_ingress_failure(
        'PUBLIC_BOOKING_STATUS',
        ${internalFailureSession},
        ${internalFailureRequest}
        )
      `;
    },
  );

  auditSessionRefs.push(
    internalFailureSession,
  );

  await assertOutcome(
    internalFailureSession,
    "INTERNAL_FAILURE",
  );

  console.log(
    "restricted INTERNAL_FAILURE audit path: PASS",
  );

  /*
   * ------------------------------------------------------------------
   * ANON AUDIT PAYLOAD SAFETY
   * ------------------------------------------------------------------
   */
  const allAuditRows = [];

  for (const sessionRef of auditSessionRefs) {
    allAuditRows.push(
      ...(await auditRows(sessionRef)),
    );
  }

  for (const row of allAuditRows) {
    assert(
      row.actor_kind === "SYSTEM" &&
        row.actor_id === null &&
        row.ip === null &&
        row.user_agent === null,
      `unsafe anonymous audit row: ${row.action}`,
    );

    assert(
      row.resource_id !== bookingRef,
      "raw public booking ref persisted as audit resource_id",
    );
  }

  const auditText =
    JSON.stringify(allAuditRows);

  for (const secretValue of [
    sensitiveContactName,
    sensitiveContactEmail,
    bookingRef,
    testSecret.toString("hex"),
    "203.0.113.77",
  ]) {
    assert(
      !auditText.includes(
        String(secretValue),
      ),
      `sensitive value appeared in anonymous audit payload: ${secretValue}`,
    );
  }

  console.log(
    "anonymous audit payload safety: PASS",
  );

  console.log(
    "verify-anon-operational-controls: PASS " +
      "(config + 4 buckets + under/over + concurrency + rotation resistance + " +
      "trusted-ingress refusal + audit matrix + exact return shapes)",
  );
} finally {
  try {
    await sql.unsafe("rollback");
  } finally {
    await sql.end();
  }
}
