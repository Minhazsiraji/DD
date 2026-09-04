import { assert, openLocalDatabase } from "./p0-b2-lib.mjs";

const sql = openLocalDatabase();

try {
  const definers = await sql`
    select
      p.oid,
      p.proname,
      coalesce(p.proconfig, array[]::text[]) as proconfig,
      p.prosrc
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
    order by p.proname
  `;

  assert(definers.length === 14,
    `expected 14 P0 SECURITY DEFINER functions, found ${definers.length}`);

  const paths = new Map();

  for (const fn of definers) {
    const setting = fn.proconfig.find((v) =>
      v.toLowerCase().startsWith("search_path=")
    );

    assert(setting,
      `${fn.proname}: SECURITY DEFINER missing explicit search_path`);

    const schemas = setting
      .slice(setting.indexOf("=") + 1)
      .split(",")
      .map((v) => v.trim().replace(/^"|"$/g, ""))
      .filter(Boolean);

    assert(schemas.length > 0,
      `${fn.proname}: empty search_path`);

    const tempIndex = schemas.indexOf("pg_temp");
    if (tempIndex !== -1) {
      assert(tempIndex === schemas.length - 1,
        `${fn.proname}: pg_temp must be last`);
    }

    assert(!schemas.includes("extensions"),
      `${fn.proname}: extensions must not be trusted through search_path`);

    paths.set(fn.proname, schemas);
  }

  const trustedSchemas = [
    ...new Set([...paths.values()].flat().filter((s) => s !== "pg_temp")),
  ];

  const acl = await sql`
    select
      n.nspname as schema_name,
      coalesce(r.rolname, 'PUBLIC') as grantee,
      x.privilege_type
    from pg_namespace n
    cross join lateral aclexplode(
      coalesce(n.nspacl, acldefault('n', n.nspowner))
    ) x
    left join pg_roles r on r.oid = x.grantee
    where n.nspname = any(${trustedSchemas})
      and x.privilege_type = 'CREATE'
    order by n.nspname, grantee
  `;

  const forbiddenCreators = new Set([
    "PUBLIC",
    "anon",
    "authenticated",
    "dd_owner_analytics",
    "dd_metrics_reader",
    "dd_metrics_rollup",
  ]);

  const unsafeAcl = acl.filter((row) =>
    forbiddenCreators.has(row.grantee)
  );

  assert(
    unsafeAcl.length === 0,
    `trusted schema CREATE authority present: ${
      unsafeAcl.map((r) => `${r.schema_name}:${r.grantee}`).join(", ")
    }`,
  );

  const tables = await sql`
    select tablename
    from pg_tables
    where schemaname = 'public'
    order by tablename
  `;

  for (const fn of definers) {
    for (const { tablename } of tables) {
      const escaped = tablename.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

      const unsafe = new RegExp(
        String.raw`\b(?:from|join|update|into|delete\s+from|insert\s+into)\s+${escaped}\b`,
        "i",
      );

      assert(
        !unsafe.test(fn.prosrc),
        `${fn.proname}: unqualified application object reference: ${tablename}`,
      );
    }
  }

  const pgcrypto = await sql`
    select n.nspname as schema_name
    from pg_extension e
    join pg_namespace n on n.oid = e.extnamespace
    where e.extname = 'pgcrypto'
  `;

  assert(pgcrypto.length === 1,
    "pgcrypto extension missing");

  assert(pgcrypto[0].schema_name === "extensions",
    `pgcrypto must be installed in extensions, found ${pgcrypto[0].schema_name}`);

  for (const fn of definers) {
    if (/gen_random_bytes\s*\(/i.test(fn.prosrc)) {
      assert(
        /extensions\.gen_random_bytes\s*\(/i.test(fn.prosrc),
        `${fn.proname}: gen_random_bytes must be extensions-qualified`,
      );
    }
  }

  console.log(
    `verify-definer-search-path-trust: PASS (${definers.length} definers)`,
  );
} finally {
  await sql.end();
}
