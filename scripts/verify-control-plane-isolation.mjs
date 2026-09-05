import { assert, openLocalAdminDatabase } from "./p0-b2-lib.mjs";

const sql = openLocalAdminDatabase();
const roles = ["dd_owner_analytics", "dd_metrics_reader", "dd_metrics_rollup"];
const domainL = new Set([
  "metric_definitions",
  "metric_classification_registry",
  "metric_contributions",
  "metric_rollups",
]);
const allowedFkTargets = new Set([
  "metric_definitions",
  "metric_classification_registry",
  "professional_profiles",
  "practice_locations",
]);
const forbiddenTokens = [
  "patient", "health_subject", "clinical_patient", "encounter",
  "prescription", "document", "diagnosis", "medicine",
];

try {
  const grants = await sql`
    select grantee, table_name, privilege_type
    from information_schema.role_table_grants
    where table_schema='public' and grantee = any(${roles})
    order by grantee, table_name, privilege_type
  `;

  const ownerGrants = grants.filter((g) => g.grantee === "dd_owner_analytics");
  assert(ownerGrants.length === 0, `dd_owner_analytics has table grants: ${JSON.stringify(ownerGrants)}`);

  const readerGrants = grants.filter((g) => g.grantee === "dd_metrics_reader");
  assert(
    readerGrants.length === 1 &&
      readerGrants[0].table_name === "metric_rollups" &&
      readerGrants[0].privilege_type === "SELECT",
    `dd_metrics_reader grants drifted: ${JSON.stringify(readerGrants)}`,
  );

  const rollupGrants = grants.filter((g) => g.grantee === "dd_metrics_rollup");
  const expectedRollup = new Set([
    "metric_contributions:SELECT",
    "metric_rollups:DELETE",
    "metric_rollups:INSERT",
    "metric_rollups:SELECT",
    "metric_rollups:UPDATE",
  ]);
  const actualRollup = new Set(rollupGrants.map((g) => `${g.table_name}:${g.privilege_type}`));
  assert(
    actualRollup.size === expectedRollup.size && [...expectedRollup].every((x) => actualRollup.has(x)),
    `dd_metrics_rollup grants drifted: ${JSON.stringify([...actualRollup].sort())}`,
  );

  const columns = await sql`
    select table_name, column_name, data_type
    from information_schema.columns
    where table_schema='public' and table_name = any(${[...domainL]})
  `;
  const forbiddenColumns = columns.filter((c) =>
    forbiddenTokens.some((token) => c.column_name.toLowerCase().includes(token)),
  );
  assert(forbiddenColumns.length === 0, `Domain L forbidden dimensions: ${JSON.stringify(forbiddenColumns)}`);

  const rawTimestamp = columns.filter((c) =>
    c.table_name === "metric_contributions" && c.data_type.includes("timestamp"),
  );
  assert(rawTimestamp.length === 0, "metric_contributions contains sub-day timestamp");

  const fks = await sql`
    select src.relname as source_table, con.conname,
           dst.relname as target_table
    from pg_constraint con
    join pg_class src on src.oid=con.conrelid
    join pg_namespace ns on ns.oid=src.relnamespace
    join pg_class dst on dst.oid=con.confrelid
    where ns.nspname='public'
      and con.contype='f'
      and src.relname = any(${[...domainL]})
  `;
  const badFks = fks.filter((fk) => !allowedFkTargets.has(fk.target_table));
  assert(badFks.length === 0, `Domain L unexpected FK target: ${JSON.stringify(badFks)}`);

  const [sourceColumn] = await sql`
    select data_type
    from information_schema.columns
    where table_schema='public' and table_name='metric_contributions'
      and column_name='source_event_key'
  `;
  assert(sourceColumn?.data_type === "uuid", "metric_contributions.source_event_key must be native uuid");
  assert(
    !fks.some((fk) => fk.source_table === "metric_contributions" && fk.target_table === "metric_source_refs"),
    "Domain L must not FK source_event_key back to clinical metric_source_refs",
  );

  const routineGrants = await sql`
    select grantee, routine_name, privilege_type
    from information_schema.role_routine_grants
    where specific_schema='public' and grantee = any(${roles})
    order by grantee, routine_name
  `;
  const ownerRoutines = routineGrants.filter((g) => g.grantee === "dd_owner_analytics");
  assert(ownerRoutines.length === 0, `P0 owner role unexpectedly executes functions: ${JSON.stringify(ownerRoutines)}`);
  const readerRoutines = routineGrants.filter((g) => g.grantee === "dd_metrics_reader");
  assert(readerRoutines.length === 0, `metrics reader unexpectedly executes functions: ${JSON.stringify(readerRoutines)}`);
  const rollupRoutines = routineGrants.filter((g) => g.grantee === "dd_metrics_rollup");
  assert(
    rollupRoutines.length === 1 && rollupRoutines[0].routine_name === "rebuild_metric_rollups",
    `metrics rollup routine allowlist drifted: ${JSON.stringify(rollupRoutines)}`,
  );

  console.log("verify-control-plane-isolation: PASS (owner zero SELECT; reader aggregate-only; rollup raw->aggregate only; no clinical FK/dimension; opaque source uuid)");
} finally {
  await sql.end({ timeout: 5 });
}
