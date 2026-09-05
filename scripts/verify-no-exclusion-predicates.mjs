import { assert, openLocalAdminDatabase } from "./p0-b2-lib.mjs";

const sql = openLocalAdminDatabase();
const sensitive = "(?:session_user|role|capability|actor_kind|grantee_kind|authority|source_channel|public_source)";
const directExclusion = new RegExp(`\\b${sensitive}\\b\\s*(?:::\w+)?\\s*(?:<>|!=)`, "i");
const reversedExclusion = new RegExp(`(?:<>|!=)\\s*\\b${sensitive}\\b`, "i");
const notIn = new RegExp(`\\b${sensitive}\\b\\s+not\\s+in\\s*\\(`, "i");
const negatedMembership = new RegExp(`\\bnot\\s*\\([^)]{0,160}\\b${sensitive}\\b[^)]*\\bin\\s*\\(`, "i");

function firstHit(text) {
  const compact = String(text ?? "").replace(/\s+/g, " ");
  for (const pattern of [directExclusion, reversedExclusion, notIn, negatedMembership]) {
    const match = compact.match(pattern);
    if (match) return match[0];
  }
  return null;
}

try {
  const policies = await sql`
    select schemaname, tablename, policyname,
           coalesce(qual,'') || ' ' || coalesce(with_check,'') as definition
    from pg_policies where schemaname in ('public','storage')
  `;
  const policyHits = policies
    .map((row) => ({ ...row, hit: firstHit(row.definition) }))
    .filter((row) => row.hit);
  assert(policyHits.length === 0, `exclusion authorization in RLS: ${JSON.stringify(policyHits)}`);

  const functions = await sql`
    select p.oid, p.proname, pg_get_functiondef(p.oid) as definition
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.prokind='f'
  `;
  const functionHits = functions
    .map((row) => ({ proname: row.proname, hit: firstHit(row.definition) }))
    .filter((row) => row.hit);
  assert(functionHits.length === 0, `exclusion authorization in functions: ${JSON.stringify(functionHits)}`);

  console.log(`verify-no-exclusion-predicates: PASS (${policies.length} policies + ${functions.length} functions; sensitive authority dimensions use positive allowlists)`);
} finally {
  await sql.end({ timeout: 5 });
}
