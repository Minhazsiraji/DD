import crypto from "node:crypto";
import {
  assert,
  expectSqlFailure,
  openLocalAdminDatabase,
  openLocalDatabase,
} from "./p0-b2-lib.mjs";
import { insertAuthProfile } from "./p1-proof-lib.mjs";

const ownerSql = openLocalDatabase();
const adminSql = openLocalAdminDatabase();
const target = crypto.randomUUID();
const secondTarget = crypto.randomUUID();

try {
  const [publicAcl] = await adminSql`
    select count(*)::int as n
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
    where n.nspname='public' and p.proname='bootstrap_platform_admin'
      and acl.grantee=0 and acl.privilege_type='EXECUTE'
  `;
  assert(publicAcl.n === 0, "PUBLIC executes bootstrap_platform_admin");

  await adminSql.unsafe("begin");
  for (const role of ["anon", "authenticated", "service_role"]) {
    await adminSql.unsafe(`set local role ${role}`);
    await expectSqlFailure(
      adminSql,
      `${role} bootstrap execution`,
      () => adminSql`select public.bootstrap_platform_admin(${target}, 'forbidden')`,
      ["42501"],
    );
    await adminSql.unsafe("reset role");
  }
  await adminSql.unsafe("rollback");
  await ownerSql.unsafe("begin");
  await insertAuthProfile(ownerSql, target, "bootstrap target");
  await insertAuthProfile(ownerSql, secondTarget, "bootstrap second target");

  const [ownerIdentity] = await ownerSql`
    select current_user as current_user,
           session_user as session_user,
           pg_get_userbyid(d.datdba) as database_owner
    from pg_database d where d.datname=current_database()
  `;
  assert(ownerIdentity.current_user === ownerIdentity.database_owner &&
         ownerIdentity.session_user === ownerIdentity.database_owner,
    `owner test connection is not DB owner: ${JSON.stringify(ownerIdentity)}`);

  const [boot] = await ownerSql`
    select public.bootstrap_platform_admin(${target}, 'initial local bootstrap') as result
  `;
  assert(boot.result.profile_id === target && boot.result.role_id,
    `bootstrap result mismatch: ${JSON.stringify(boot.result)}`);

  const [staff] = await ownerSql`
    select is_active, revoked_at, is_owner_account
    from public.platform_staff where profile_id=${target}
  `;
  assert(staff.is_active === true && staff.revoked_at === null && staff.is_owner_account === false,
    `bootstrap staff state mismatch: ${JSON.stringify(staff)}`);

  const roles = await ownerSql`
    select role::text as role from public.platform_staff_roles
    where profile_id=${target} and revoked_at is null
  `;
  assert(JSON.stringify(roles.map((row) => row.role)) === JSON.stringify(["PLATFORM_ADMIN"]),
    `bootstrap role inventory mismatch: ${JSON.stringify(roles)}`);
  const [authority] = await ownerSql`
    select public.has_capability(${target}, 'DOCTOR') as doctor,
           public.has_platform_staff_role(${target}, 'PLATFORM_ADMIN') as platform_admin
  `;
  assert(authority.platform_admin === true && authority.doctor === false,
    `bootstrap leaked clinical authority: ${JSON.stringify(authority)}`);
  const [professionalCount] = await ownerSql`
    select count(*)::int as n from public.professional_profiles where profile_id=${target}
  `;
  assert(professionalCount.n === 0, "bootstrap created a professional/clinical identity");

  await expectSqlFailure(
    ownerSql,
    "second bootstrap while live admin exists",
    () => ownerSql`select public.bootstrap_platform_admin(${secondTarget}, 'second forbidden bootstrap')`,
    ["P0001"],
  );

  const audit = await ownerSql`
    select actor_kind::text as actor_kind, acted_as, action, resource_id
    from public.audit_events
    where acted_as='DB_OWNER_BOOTSTRAP'
    order by seq
  `;
  assert(audit.length === 2 && audit.every((row) => row.actor_kind === "SYSTEM"),
    `bootstrap audit shape mismatch: ${JSON.stringify(audit)}`);
  assert(audit.map((row) => row.action).join(",") ===
    "PLATFORM_STAFF_BOOTSTRAPPED,PLATFORM_ROLE_GRANTED",
    `bootstrap audit actions mismatch: ${JSON.stringify(audit)}`);

  console.log(
    "verify-platform-admin-bootstrap: PASS " +
    "(PUBLIC/anon/authenticated/service_role denied; DB owner succeeds at zero admins; " +
    "second bootstrap denied; explicit PLATFORM_ADMIN only; owner/clinical authority absent; SYSTEM audit present)",
  );
  await ownerSql.unsafe("rollback");
} catch (error) {
  try { await ownerSql.unsafe("rollback"); } catch {}
  try { await adminSql.unsafe("rollback"); } catch {}
  throw error;
} finally {
  await ownerSql.end({ timeout: 5 });
  await adminSql.end({ timeout: 5 });
}
