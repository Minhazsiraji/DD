import { assert, openLocalDatabase } from "./p0-b2-lib.mjs";

const sql = openLocalDatabase();

try {
  const [role] = await sql`
    select exists(
      select 1 from pg_roles where rolname = 'anon'
    ) as present
  `;

  assert(role.present, "anon role is missing");

  const tableLeaks = await sql`
    select
      c.relname as object_name,
      has_table_privilege('anon', c.oid, 'SELECT') as can_select,
      has_table_privilege('anon', c.oid, 'INSERT') as can_insert,
      has_table_privilege('anon', c.oid, 'UPDATE') as can_update,
      has_table_privilege('anon', c.oid, 'DELETE') as can_delete,
      has_table_privilege('anon', c.oid, 'TRUNCATE') as can_truncate,
      has_table_privilege('anon', c.oid, 'REFERENCES') as can_reference,
      has_table_privilege('anon', c.oid, 'TRIGGER') as can_trigger
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r','p','v','m','f')
    order by c.relname
  `;

  const badTables = tableLeaks.filter((row) =>
    row.can_select ||
    row.can_insert ||
    row.can_update ||
    row.can_delete ||
    row.can_truncate ||
    row.can_reference ||
    row.can_trigger
  );

  assert(
    badTables.length === 0,
    `anon table authority detected: ${
      badTables.map((r) => r.object_name).join(", ")
    }`,
  );

  const sequenceLeaks = await sql`
    select
      c.relname as object_name,
      has_sequence_privilege('anon', c.oid, 'USAGE') as can_usage,
      has_sequence_privilege('anon', c.oid, 'SELECT') as can_select,
      has_sequence_privilege('anon', c.oid, 'UPDATE') as can_update
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'S'
    order by c.relname
  `;

  const badSequences = sequenceLeaks.filter((row) =>
    row.can_usage || row.can_select || row.can_update
  );

  assert(
    badSequences.length === 0,
    `anon sequence authority detected: ${
      badSequences.map((r) => r.object_name).join(", ")
    }`,
  );

  const functionLeaks = await sql`
    select
      p.oid,
      p.proname,
      oidvectortypes(p.proargtypes) as identity_args,
      has_function_privilege('anon', p.oid, 'EXECUTE') as can_execute
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
    order by p.proname, identity_args
  `;

  const badFunctions = functionLeaks.filter((row) => row.can_execute);

  assert(
    badFunctions.length === 0,
    `anon function EXECUTE detected: ${
      badFunctions
        .map((r) => `${r.proname}(${r.identity_args})`)
        .join(", ")
    }`,
  );

  console.log(
    "verify-anon-surface: PASS " +
    `(${tableLeaks.length} relations, ` +
    `${sequenceLeaks.length} sequences, ` +
    `${functionLeaks.length} functions checked)`,
  );
} finally {
  await sql.end();
}
