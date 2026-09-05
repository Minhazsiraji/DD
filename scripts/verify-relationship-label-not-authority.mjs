import { assert, openLocalAdminDatabase } from "./p0-b2-lib.mjs";

const sql = openLocalAdminDatabase();

try {
  const policies = await sql`
    select schemaname, tablename, policyname,
           coalesce(qual,'') || ' ' || coalesce(with_check,'') as definition
    from pg_policies where schemaname in ('public','storage')
  `;
  const policyHits = policies.filter((row) =>
    String(row.definition).toLowerCase().includes("relationship_label"),
  );
  assert(policyHits.length === 0, `relationship_label appears in RLS authority: ${JSON.stringify(policyHits)}`);

  const functions = await sql`
    select p.proname, pg_get_functiondef(p.oid) as definition
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.prokind='f'
  `;
  const functionHits = functions.filter((row) =>
    String(row.definition).toLowerCase().includes("relationship_label"),
  );
  assert(
    functionHits.length === 1 && functionHits[0].proname === "grant_health_subject_access",
    `unexpected relationship_label function reference(s): ${JSON.stringify(functionHits.map(r => r.proname))}`,
  );
  const grantBody = String(functionHits[0].definition);
  assert(
    (grantBody.match(/relationship_label/gi) ?? []).length === 1 &&
      /insert\s+into\s+public\.health_subject_access\s*\([^)]*relationship_label/i.test(grantBody) &&
      !/(where|if|case|join|having|order\s+by)[^;]*relationship_label/i.test(grantBody),
    "relationship_label must be write-only display metadata, never an authority predicate",
  );

  const indexes = await sql`
    select indexname, indexdef from pg_indexes
    where schemaname='public' and tablename='health_subject_access'
  `;
  const labelIndexes = indexes.filter((row) =>
    String(row.indexdef).toLowerCase().includes("relationship_label"),
  );
  assert(labelIndexes.length === 0, `relationship_label has authority-supporting index: ${JSON.stringify(labelIndexes)}`);

  const [column] = await sql`
    select data_type from information_schema.columns
    where table_schema='public' and table_name='health_subject_access'
      and column_name='relationship_label'
  `;
  assert(column?.data_type === "text", "relationship_label should remain plain display metadata");

  console.log("verify-relationship-label-not-authority: PASS (zero policy/index authority references; sole function reference is metadata assignment only)");
} finally {
  await sql.end({ timeout: 5 });
}
