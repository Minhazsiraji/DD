import { assert, openLocalDatabase } from "./p0-b2-lib.mjs";
import { P0_DEFINER_EXECUTE as expected } from "./p0-definer-contract.mjs";

const sql = openLocalDatabase();

try {
  const definers = await sql`
    select
      p.oid,
      p.proowner,
      p.proname,
      oidvectortypes(p.proargtypes) as identity_args,
      coalesce(p.proconfig, array[]::text[]) as proconfig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
    order by p.proname
  `;

  assert(
    definers.length === expected.size,
    `expected ${expected.size} P0 SECURITY DEFINER functions, found ${definers.length}`,
  );

  const observedKeys = new Set();

  for (const fn of definers) {
    const compactArgs = fn.identity_args.replace(/\s+/g, "");
    const key = `${fn.proname}(${compactArgs})`;

    observedKeys.add(key);

    assert(expected.has(key),
      `unexpected SECURITY DEFINER function: ${key}`);

    const searchPath = fn.proconfig.find((v) =>
      v.toLowerCase().startsWith("search_path=")
    );

    assert(searchPath,
      `${key}: missing explicit search_path`);

    const schemas = searchPath
      .slice(searchPath.indexOf("=") + 1)
      .split(",")
      .map((v) => v.trim().replace(/^"|"$/g, ""))
      .filter(Boolean);

    assert(
      schemas.at(-1) === "pg_temp",
      `${key}: pg_temp must be last in search_path`,
    );

    const acl = await sql`
      select
        x.grantee,
        coalesce(r.rolname, 'PUBLIC') as grantee_name,
        x.privilege_type
      from pg_proc p
      cross join lateral aclexplode(
        coalesce(p.proacl, acldefault('f', p.proowner))
      ) x
      left join pg_roles r on r.oid = x.grantee
      where p.oid = ${fn.oid}
        and x.privilege_type = 'EXECUTE'
        and x.grantee <> p.proowner
      order by grantee_name
    `;

    const actual = new Set(acl.map((row) => row.grantee_name));

    assert(
      !actual.has("PUBLIC"),
      `${key}: PUBLIC has EXECUTE`,
    );

    const wanted = expected.get(key);

    if (!wanted.has("anon")) {
      assert(
        !actual.has("anon"),
        `${key}: undeclared anon EXECUTE`,
      );
    }

    assert(
      !actual.has("service_role"),
      `${key}: service_role has undeclared EXECUTE`,
    );

    /*
     * Compare the REAL catalog ACL against the exact declared allowlist.
     * service_role is intentionally NOT filtered: Central requires any
     * undeclared service_role EXECUTE on a DD-owned definer to fail.
     */
    const extras = [...actual].filter((r) => !wanted.has(r));
    const missing = [...wanted].filter((r) => !actual.has(r));

    assert(
      extras.length === 0,
      `${key}: undeclared EXECUTE grantee(s): ${extras.join(", ")}`,
    );

    assert(
      missing.length === 0,
      `${key}: missing required EXECUTE grantee(s): ${missing.join(", ")}`,
    );
  }

  const missingDefiners = [...expected.keys()].filter(
    (key) => !observedKeys.has(key),
  );

  assert(
    missingDefiners.length === 0,
    `missing expected SECURITY DEFINER function(s): ${missingDefiners.join(", ")}`,
  );

  const roles = await sql`
    select rolname
    from pg_roles
    order by rolname
  `;

  const appServiceRoles = roles
    .map((r) => r.rolname)
    .filter((name) =>
      name === "service_agent" ||
      name === "service_agents" ||
      /^dd_.*service.*$/i.test(name)
    );

  const clinicalTables = [
    "clinical_patients",
    "encounters",
    "encounter_diagnoses",
    "encounter_investigations",
    "encounter_events",
    "prescriptions",
    "prescription_items",
    "prescription_events",
    "appointments",
    "appointment_events",
    "queue_entries",
  ];

  for (const role of appServiceRoles) {
    for (const table of clinicalTables) {
      const [row] = await sql`
        select
          has_table_privilege(${role}, ${`public.${table}`}, 'SELECT')
          or has_table_privilege(${role}, ${`public.${table}`}, 'INSERT')
          or has_table_privilege(${role}, ${`public.${table}`}, 'UPDATE')
          or has_table_privilege(${role}, ${`public.${table}`}, 'DELETE')
          as has_clinical_authority
      `;

      assert(
        !row.has_clinical_authority,
        `${role}: service-agent role has clinical table authority on ${table}`,
      );
    }
  }

  console.log(
    `verify-definer-grants: PASS (${definers.length} definers)`,
  );
} finally {
  await sql.end();
}
