/**
 * Verifies the database-side security posture.
 *
 * This asserts the things that are easy to break silently: RLS being enabled
 * AND forced, policies actually existing, the audit trail being append-only,
 * and anon having no reach. A passing app test suite proves none of this.
 *
 *   node --env-file=.env.local scripts/verify-security.mjs
 */
import postgres from "postgres";

const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error("DIRECT_URL or DATABASE_URL must be set.");
  process.exit(1);
}

const TABLES = [
  "profiles",
  "doctor_profiles",
  "clinics",
  "clinic_members",
  "audit_events",
];

const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
const failures = [];

function check(ok, label, detail = "") {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(label);
}

// 1. Every table exists, with RLS enabled and FORCED.
const rls = await sql`
  select c.relname as table, c.relrowsecurity as enabled, c.relforcerowsecurity as forced
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = any(${TABLES})
`;

console.log("\nRow Level Security");
for (const t of TABLES) {
  const row = rls.find((r) => r.table === t);
  check(Boolean(row?.enabled && row?.forced), `${t}: RLS enabled + forced`,
    row ? "" : "table missing");
}

// 2. Each table has at least one policy. A table with RLS on and no policy
//    returns nothing — safe, but means the feature is silently broken.
const policies = await sql`
  select tablename, count(*)::int as n
  from pg_policies
  where schemaname = 'public' and tablename = any(${TABLES})
  group by tablename
`;

console.log("\nPolicies");
for (const t of TABLES) {
  const n = policies.find((p) => p.tablename === t)?.n ?? 0;
  check(n > 0, `${t}: ${n} policies`);
}

// 3. audit_events must be append-only for application users.
const auditGrants = await sql`
  select privilege_type
  from information_schema.role_table_grants
  where table_schema = 'public'
    and table_name = 'audit_events'
    and grantee = 'authenticated'
`;
const auditVerbs = auditGrants.map((g) => g.privilege_type);

console.log("\nAudit trail is append-only");
check(auditVerbs.includes("INSERT"), "authenticated may INSERT");
check(auditVerbs.includes("SELECT"), "authenticated may SELECT");
check(!auditVerbs.includes("UPDATE"), "authenticated may NOT UPDATE",
  auditVerbs.includes("UPDATE") ? "UPDATE is granted!" : "");
check(!auditVerbs.includes("DELETE"), "authenticated may NOT DELETE",
  auditVerbs.includes("DELETE") ? "DELETE is granted!" : "");

const auditPolicies = await sql`
  select cmd from pg_policies
  where schemaname = 'public' and tablename = 'audit_events'
`;
const cmds = auditPolicies.map((p) => p.cmd);
check(!cmds.includes("UPDATE") && !cmds.includes("DELETE"),
  "no UPDATE/DELETE policy exists on audit_events");

// 4. anon must not reach any application table.
const anonGrants = await sql`
  select table_name, privilege_type
  from information_schema.role_table_grants
  where table_schema = 'public'
    and grantee = 'anon'
    and table_name = any(${TABLES})
`;

console.log("\nAnonymous access");
check(anonGrants.length === 0, "anon has no grants on any application table",
  anonGrants.length ? anonGrants.map((g) => `${g.table_name}:${g.privilege_type}`).join(", ") : "");

// 5. The SECURITY DEFINER helpers must exist and have a pinned search_path.
const fns = await sql`
  select p.proname, p.prosecdef, array_to_string(p.proconfig, ',') as config
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('is_active_member','has_clinic_role','shares_clinic_with')
`;

console.log("\nAuthorization helpers");
for (const name of ["is_active_member", "has_clinic_role", "shares_clinic_with"]) {
  const fn = fns.find((f) => f.proname === name);
  check(Boolean(fn?.prosecdef), `${name}: exists, SECURITY DEFINER`);
  check(Boolean(fn?.config?.includes("search_path")), `${name}: search_path pinned`);
}

await sql.end();

console.log(
  failures.length === 0
    ? "\nAll security checks passed.\n"
    : `\n${failures.length} CHECK(S) FAILED:\n  - ${failures.join("\n  - ")}\n`,
);
process.exit(failures.length === 0 ? 0 : 1);
