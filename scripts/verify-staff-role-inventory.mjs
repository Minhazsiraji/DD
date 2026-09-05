import crypto from "node:crypto";
import { assert, expectSqlFailure, openLocalAdminDatabase } from "./p0-b2-lib.mjs";
import { insertAuthProfile } from "./p1-proof-lib.mjs";

const sql = openLocalAdminDatabase();
const profile = crypto.randomUUID();
const EXPECTED = [
  "COMMUNITY_MODERATOR", "MODERATION_SUPERVISOR", "SUPPORT_AGENT",
  "CREDENTIAL_VERIFIER", "FINANCE_OPERATOR", "PLATFORM_ADMIN",
  "HEALTH_ADVISORY_EDITOR", "PUBLIC_HEALTH_SOURCE_STEWARD", "PLATFORM_ANALYST",
];

try {
  await sql.unsafe("begin");
  const labels = await sql`
    select e.enumlabel
    from pg_type t join pg_enum e on e.enumtypid=t.oid
    where t.typname='platform_staff_role'
    order by e.enumsortorder
  `;
  const actual = labels.map((row) => row.enumlabel);
  assert(JSON.stringify(actual) === JSON.stringify(EXPECTED),
    `platform staff role inventory mismatch: ${JSON.stringify(actual)}`);
  const [column] = await sql`
    select udt_name from information_schema.columns
    where table_schema='public' and table_name='platform_staff_roles' and column_name='role'
  `;
  assert(column?.udt_name === "platform_staff_role", "platform_staff_roles.role is not the canonical enum");

  await insertAuthProfile(sql, profile, "staff-inventory");
  await sql`insert into public.platform_staff(profile_id, granted_by) values (${profile}, ${profile})`;
  const [support] = await sql`
    insert into public.platform_staff_roles(profile_id, role, granted_by)
    values (${profile}, 'SUPPORT_AGENT', ${profile}) returning id
  `;
  let [allowed] = await sql`select public.has_platform_staff_role(${profile}, 'SUPPORT_AGENT') as v`;
  assert(allowed.v === true, "active staff role was not authoritative");
  await sql`update public.platform_staff_roles set revoked_at=clock_timestamp() where id=${support.id}`;
  [allowed] = await sql`select public.has_platform_staff_role(${profile}, 'SUPPORT_AGENT') as v`;
  assert(allowed.v === false, "revoked staff role remained authoritative");

  await sql`
    insert into public.platform_staff_roles(profile_id, role, granted_by)
    values (${profile}, 'HEALTH_ADVISORY_EDITOR', ${profile})
  `;
  await expectSqlFailure(
    sql,
    "mutually exclusive health editorial/steward roles",
    () => sql`
      insert into public.platform_staff_roles(profile_id, role, granted_by)
      values (${profile}, 'PUBLIC_HEALTH_SOURCE_STEWARD', ${profile})
    `,
    ["23514"],
  );

  await sql`
    insert into public.platform_staff_roles(profile_id, role, granted_by)
    values (${profile}, 'FINANCE_OPERATOR', ${profile})
  `;
  [allowed] = await sql`select public.has_platform_staff_role(${profile}, 'FINANCE_OPERATOR') as v`;
  assert(allowed.v === true, "second active staff role was not authoritative");
  await sql`
    update public.platform_staff
    set is_active=false, revoked_at=clock_timestamp()
    where profile_id=${profile}
  `;
  [allowed] = await sql`select public.has_platform_staff_role(${profile}, 'FINANCE_OPERATOR') as v`;
  assert(allowed.v === false, "inactive platform_staff row left role authoritative");

  console.log(`verify-staff-role-inventory: PASS (${EXPECTED.length} canonical roles; revocation/inactive semantics; mutual exclusion enforced)`);
  await sql.unsafe("rollback");
} catch (error) {
  try { await sql.unsafe("rollback"); } catch {}
  throw error;
} finally {
  await sql.end({ timeout: 5 });
}
