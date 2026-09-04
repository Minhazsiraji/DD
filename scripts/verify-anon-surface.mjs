import { assert, openLocalDatabase } from "./p0-b2-lib.mjs";

const sql = openLocalDatabase();

const expectedAnon = new Set([
  "public_chamber_availability(uuid,date,date)",
  "create_public_booking(uuid,timestampwithtimezone,text,text,text,text)",
  "public_booking_status(uuid)",
]);

const rpcPolicyCode = new Map([
  [
    "public_chamber_availability(uuid,date,date)",
    "PUBLIC_CHAMBER_AVAILABILITY",
  ],
  [
    "create_public_booking(uuid,timestampwithtimezone,text,text,text,text)",
    "CREATE_PUBLIC_BOOKING",
  ],
  [
    "public_booking_status(uuid)",
    "PUBLIC_BOOKING_STATUS",
  ],
]);

const requiredBuckets = new Set([
  "SESSION_GLOBAL",
  "NETWORK_GLOBAL",
  "SESSION_RESOURCE",
  "NETWORK_RESOURCE",
]);

function compactArgs(value) {
  return value.replace(/\s+/g, "");
}

try {
  const [role] = await sql`
    select exists(
      select 1
      from pg_roles
      where rolname = 'anon'
    ) as present
  `;

  assert(role.present, "anon role is missing");

  /*
   * anon must have no direct relation authority of any kind.
   */
  const relationPrivileges = await sql`
    select
      c.relname as object_name,
      c.relkind,
      has_table_privilege('anon', c.oid, 'SELECT') as can_select,
      has_table_privilege('anon', c.oid, 'INSERT') as can_insert,
      has_table_privilege('anon', c.oid, 'UPDATE') as can_update,
      has_table_privilege('anon', c.oid, 'DELETE') as can_delete,
      has_table_privilege('anon', c.oid, 'TRUNCATE') as can_truncate,
      has_table_privilege('anon', c.oid, 'REFERENCES') as can_reference,
      has_table_privilege('anon', c.oid, 'TRIGGER') as can_trigger
    from pg_class c
    join pg_namespace n
      on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r','p','v','m','f')
    order by c.relname
  `;

  const badRelations = relationPrivileges.filter((row) =>
    row.can_select ||
    row.can_insert ||
    row.can_update ||
    row.can_delete ||
    row.can_truncate ||
    row.can_reference ||
    row.can_trigger
  );

  assert(
    badRelations.length === 0,
    `anon relation authority detected: ${
      badRelations.map((r) => r.object_name).join(", ")
    }`,
  );

  /*
   * anon must also have zero direct sequence authority.
   */
  const sequencePrivileges = await sql`
    select
      c.relname as object_name,
      has_sequence_privilege('anon', c.oid, 'USAGE') as can_usage,
      has_sequence_privilege('anon', c.oid, 'SELECT') as can_select,
      has_sequence_privilege('anon', c.oid, 'UPDATE') as can_update
    from pg_class c
    join pg_namespace n
      on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'S'
    order by c.relname
  `;

  const badSequences = sequencePrivileges.filter((row) =>
    row.can_usage ||
    row.can_select ||
    row.can_update
  );

  assert(
    badSequences.length === 0,
    `anon sequence authority detected: ${
      badSequences.map((r) => r.object_name).join(", ")
    }`,
  );

  /*
   * Inspect the real effective EXECUTE surface.
   */
  const functions = await sql`
    select
      p.oid,
      p.proname,
      oidvectortypes(p.proargtypes) as identity_args,
      has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute
    from pg_proc p
    join pg_namespace n
      on n.oid = p.pronamespace
    where n.nspname = 'public'
    order by p.proname, identity_args
  `;

  const actualAnon = new Set(
    functions
      .filter((row) => row.anon_execute)
      .map(
        (row) =>
          `${row.proname}(${compactArgs(row.identity_args)})`,
      ),
  );

  const extras = [...actualAnon].filter(
    (key) => !expectedAnon.has(key),
  );

  const missing = [...expectedAnon].filter(
    (key) => !actualAnon.has(key),
  );

  assert(
    extras.length === 0,
    `unexpected anon EXECUTE function(s): ${extras.join(", ")}`,
  );

  assert(
    missing.length === 0,
    `missing required anon EXECUTE function(s): ${missing.join(", ")}`,
  );

  assert(
    actualAnon.size === 3,
    `anon EXECUTE must contain exactly 3 functions, found ${actualAnon.size}`,
  );

  /*
   * PUBLIC must have no function EXECUTE in the DD public schema.
   * grantee OID 0 in an ACL means PUBLIC.
   */
  const publicExecute = await sql`
    select
      p.proname,
      oidvectortypes(p.proargtypes) as identity_args
    from pg_proc p
    join pg_namespace n
      on n.oid = p.pronamespace
    cross join lateral aclexplode(
      coalesce(
        p.proacl,
        acldefault('f', p.proowner)
      )
    ) x
    where n.nspname = 'public'
      and x.grantee = 0
      and x.privilege_type = 'EXECUTE'
    order by p.proname, identity_args
  `;

  assert(
    publicExecute.length === 0,
    `PUBLIC function EXECUTE detected: ${
      publicExecute
        .map(
          (row) =>
            `${row.proname}(${compactArgs(row.identity_args)})`,
        )
        .join(", ")
    }`,
  );

  /*
   * Later-phase anonymous functions must remain unreachable at P0.
   */
  const laterPhaseNames = [
    "public_doctor_profile",
    "search_public_doctors",
    "list_medical_specialties",
    "get_published_advisories",
  ];

  const laterPhaseReachability = await sql`
    select
      p.proname,
      oidvectortypes(p.proargtypes) as identity_args,
      has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute
    from pg_proc p
    join pg_namespace n
      on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = any(${laterPhaseNames})
    order by p.proname, identity_args
  `;

  const reachableLaterPhase = laterPhaseReachability.filter(
    (row) => row.anon_execute,
  );

  assert(
    reachableLaterPhase.length === 0,
    `P5/P7 anon reachability detected: ${
      reachableLaterPhase
        .map(
          (row) =>
            `${row.proname}(${compactArgs(row.identity_args)})`,
        )
        .join(", ")
    }`,
  );

  /*
   * Every executable anon RPC must have the complete active
   * four-bucket operational-control configuration.
   */
  const activePolicies = await sql`
    select
      rpc_code,
      bucket_kind,
      policy_version,
      window_seconds,
      max_requests
    from public.anon_rate_limit_policies
    where enabled = true
      and effective_from <= clock_timestamp()
    order by rpc_code, bucket_kind
  `;

  for (const fnKey of expectedAnon) {
    const rpcCode = rpcPolicyCode.get(fnKey);

    const rows = activePolicies.filter(
      (row) => row.rpc_code === rpcCode,
    );

    assert(
      rows.length === 4,
      `${rpcCode}: expected 4 active rate buckets, found ${rows.length}`,
    );

    const actualBuckets = new Set(
      rows.map((row) => row.bucket_kind),
    );

    const bucketExtras = [...actualBuckets].filter(
      (bucket) => !requiredBuckets.has(bucket),
    );

    const bucketMissing = [...requiredBuckets].filter(
      (bucket) => !actualBuckets.has(bucket),
    );

    assert(
      bucketExtras.length === 0,
      `${rpcCode}: unexpected rate bucket(s): ${bucketExtras.join(", ")}`,
    );

    assert(
      bucketMissing.length === 0,
      `${rpcCode}: missing rate bucket(s): ${bucketMissing.join(", ")}`,
    );

    for (const row of rows) {
      assert(
        row.policy_version &&
          row.window_seconds > 0 &&
          row.max_requests > 0,
        `${rpcCode}/${row.bucket_kind}: incomplete active rate policy`,
      );
    }
  }

  const activeRpcCodes = new Set(
    activePolicies.map((row) => row.rpc_code),
  );

  const expectedRpcCodes = new Set(rpcPolicyCode.values());

  const unexpectedConfiguredRpc = [...activeRpcCodes].filter(
    (code) => !expectedRpcCodes.has(code),
  );

  assert(
    unexpectedConfiguredRpc.length === 0,
    `unexpected active anonymous RPC policy code(s): ${
      unexpectedConfiguredRpc.join(", ")
    }`,
  );

  console.log(
    "verify-anon-surface: PASS " +
    `(${relationPrivileges.length} relations, ` +
    `${sequencePrivileges.length} sequences, ` +
    `${functions.length} functions checked; ` +
    `anon EXECUTE exact=3; active rate rows=${activePolicies.length})`,
  );
} finally {
  await sql.end();
}
