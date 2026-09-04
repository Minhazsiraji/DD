import { assert, openLocalDatabase } from "./p0-b2-lib.mjs";

const sql = openLocalDatabase();

const expected = new Map([
  ["allocate_dd_patient_number()", new Set(["authenticated"])],
  ["current_profile_id()", new Set(["authenticated"])],
  ["current_doctor_id()", new Set(["authenticated"])],
  ["has_capability(uuid,capability)", new Set(["authenticated"])],
  ["refresh_profile_capabilities(uuid)", new Set(["dd_metrics_rollup"])],
  ["refresh_capability_trigger()", new Set()],
  ["create_professional_profile(text,profession)", new Set(["authenticated"])],
  ["emit_audit_event(text,text,uuid,uuid)", new Set(["authenticated"])],
  ["create_health_subject(text,subject_kind,text)", new Set(["authenticated"])],
  ["create_clinical_patient(text,uuid)", new Set(["authenticated"])],
  ["open_encounter(uuid,uuid)", new Set(["authenticated"])],
  ["open_prescription(uuid)", new Set(["authenticated"])],
  ["finalize_prescription(uuid,integer,jsonb,text,text)", new Set(["authenticated"])],
  ["allocate_queue_token(uuid,date,uuid)", new Set(["authenticated"])],
]);

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
    definers.length === 14,
    `expected 14 P0 SECURITY DEFINER functions, found ${definers.length}`,
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

    assert(
      !actual.has("anon"),
      `${key}: anon has EXECUTE`,
    );

    /*
     * Supabase's exact built-in service_role is substrate infrastructure.
     * The local pinned substrate grants it EXECUTE through postgres-owned
     * default ACLs. It is not a Doctor's Diary application/service-agent role.
     *
     * Keep PUBLIC/anon checks against the raw catalog surface above, and
     * exclude only this exact substrate role from the DD declared-grantee
     * comparison. DD service-agent roles are checked separately below.
     */
    const applicationActual = new Set(
      [...actual].filter((role) => role !== "service_role"),
    );

    const wanted = expected.get(key);

    const extras = [...applicationActual].filter((r) => !wanted.has(r));
    const missing = [...wanted].filter((r) => !applicationActual.has(r));

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
