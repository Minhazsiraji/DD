import fs from "node:fs/promises";
import path from "node:path";
import { assert, openLocalDatabase } from "./p0-b2-lib.mjs";

const ROOTS = [
  "db/schema/0001_p0_baseline.sql",
  "db/functions/0002_p0_core.sql",
  "db/policies/0003_p0_rls.sql",
  "db/grants/0004_p0_grants.sql",
  "db/storage/0005_p0_buckets.sql",
];
const BANNED = ["bmdc", "bdt", "dhaka", "bangladesh"];

function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/--.*$/gm, "");
}

const staticHits = [];
for (const file of ROOTS) {
  const body = stripComments(await fs.readFile(path.resolve(file), "utf8"));
  const lines = body.split("\n");
  lines.forEach((line, index) => {
    for (const term of BANNED) {
      if (line.toLowerCase().includes(term)) {
        staticHits.push(`${file}:${index + 1}:${term}:${line.trim()}`);
      }
    }
  });
}
assert(staticHits.length === 0, `hardcoded jurisdiction literals found:\n${staticHits.join("\n")}`);

const sql = openLocalDatabase();
try {
  const rows = await sql`
    select 'column_default' as kind, c.table_name as object_name,
           c.column_name as member_name, c.column_default as definition
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.column_default is not null
    union all
    select 'constraint', cls.relname, con.conname,
           pg_get_constraintdef(con.oid, true)
    from pg_constraint con
    join pg_class cls on cls.oid = con.conrelid
    join pg_namespace n on n.oid = cls.relnamespace
    where n.nspname = 'public'
  `;

  const runtimeHits = rows.filter((row) =>
    BANNED.some((term) => String(row.definition ?? "").toLowerCase().includes(term)),
  );
  assert(runtimeHits.length === 0, `runtime defaults/constraints hardcode jurisdiction: ${JSON.stringify(runtimeHits)}`);

  console.log("verify-no-hardcoded-jurisdiction: PASS (empty exception list; schema/function/policy/grant/storage corpus + runtime defaults/constraints)");
} finally {
  await sql.end({ timeout: 5 });
}
