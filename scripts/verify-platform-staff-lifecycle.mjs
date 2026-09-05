import crypto from "node:crypto";
import { assert, expectSqlFailure, openLocalAdminDatabase } from "./p0-b2-lib.mjs";
import { asAuthenticated, insertAuthProfile } from "./p1-proof-lib.mjs";

const sql = openLocalAdminDatabase();
const ids = {
  admin: crypto.randomUUID(),
  target: crypto.randomUUID(),
  ordinary: crypto.randomUUID(),
  secondAdmin: crypto.randomUUID(),
};

try {
  await sql.unsafe("begin");
  for (const [id, label] of Object.entries({
    [ids.admin]: "staff lifecycle admin",
    [ids.target]: "staff lifecycle target",
    [ids.ordinary]: "staff lifecycle ordinary",
    [ids.secondAdmin]: "staff lifecycle second admin",
  })) {
    await insertAuthProfile(sql, id, label);
  }

  await sql`insert into public.platform_staff(profile_id, granted_by) values (${ids.admin}, ${ids.admin})`;
  const [adminRole] = await sql`
    insert into public.platform_staff_roles(profile_id, role, granted_by)
    values (${ids.admin}, 'PLATFORM_ADMIN', ${ids.admin}) returning id
  `;
  await asAuthenticated(sql, ids.ordinary, () =>
    expectSqlFailure(
      sql,
      "ordinary authenticated cannot onboard platform staff",
      () => sql`select public.activate_platform_staff(${ids.target}, 'ordinary attempt')`,
      ["42501"],
    ));

  const onboard = await asAuthenticated(sql, ids.admin, async () => {
    const [row] = await sql`
      select public.activate_platform_staff(${ids.target}, 'QA onboarding') as result
    `;
    return row.result;
  });
  assert(onboard.changed === true, `onboard did not change target: ${JSON.stringify(onboard)}`);

  let liveRoles = await sql`
    select role::text as role from public.platform_staff_roles
    where profile_id=${ids.target} and revoked_at is null order by role
  `;
  assert(liveRoles.length === 0, "onboarded staff unexpectedly received a role");
  let [staff] = await sql`
    select is_active, revoked_at, is_owner_account from public.platform_staff
    where profile_id=${ids.target}
  `;
  assert(staff.is_active === true && staff.revoked_at === null && staff.is_owner_account === false,
    `staff activation state mismatch: ${JSON.stringify(staff)}`);
  const supportRoleId = await asAuthenticated(sql, ids.admin, async () => {
    const [row] = await sql`
      select public.grant_platform_staff_role(${ids.target}, 'SUPPORT_AGENT') as id
    `;
    return row.id;
  });
  assert(supportRoleId, "support role grant returned no role id");
  liveRoles = await sql`
    select role::text as role from public.platform_staff_roles
    where profile_id=${ids.target} and revoked_at is null order by role
  `;
  assert(JSON.stringify(liveRoles.map((row) => row.role)) === JSON.stringify(["SUPPORT_AGENT"]),
    `role grant created unexpected live roles: ${JSON.stringify(liveRoles)}`);

  const [authority] = await sql`
    select public.has_platform_staff_role(${ids.target}, 'SUPPORT_AGENT') as support,
           public.has_platform_staff_role(${ids.target}, 'PLATFORM_ADMIN') as admin,
           public.has_capability(${ids.target}, 'DOCTOR') as doctor
  `;
  assert(authority.support === true && authority.admin === false && authority.doctor === false,
    `platform role leaked authority: ${JSON.stringify(authority)}`);

  const deactivated = await asAuthenticated(sql, ids.admin, async () => {
    const [row] = await sql`
      select public.deactivate_platform_staff(${ids.target}, 'QA deactivate') as result
    `;
    return row.result;
  });
  assert(deactivated.changed === true && deactivated.revoked_roles === 1,
    `deactivation result mismatch: ${JSON.stringify(deactivated)}`);
  [staff] = await sql`
    select is_active, revoked_at from public.platform_staff where profile_id=${ids.target}
  `;
  const [afterDeactivate] = await sql`
    select public.has_platform_staff_role(${ids.target}, 'SUPPORT_AGENT') as support
  `;
  assert(staff.is_active === false && staff.revoked_at !== null && afterDeactivate.support === false,
    "deactivation left effective staff authority");

  const reactivated = await asAuthenticated(sql, ids.admin, async () => {
    const [row] = await sql`
      select public.activate_platform_staff(${ids.target}, 'QA reactivate') as result
    `;
    return row.result;
  });
  assert(reactivated.changed === true, "reactivation did not reactivate target");
  liveRoles = await sql`
    select role::text as role from public.platform_staff_roles
    where profile_id=${ids.target} and revoked_at is null
  `;
  const [afterReactivate] = await sql`
    select public.has_platform_staff_role(${ids.target}, 'SUPPORT_AGENT') as support
  `;
  assert(liveRoles.length === 0 && afterReactivate.support === false,
    "reactivation silently restored revoked roles");

  await asAuthenticated(sql, ids.admin, () =>
    expectSqlFailure(
      sql,
      "last PLATFORM_ADMIN role cannot be revoked",
      () => sql`select public.revoke_platform_staff_role(${adminRole.id})`,
      ["P0001"],
    ));
  await asAuthenticated(sql, ids.admin, () =>
    expectSqlFailure(
      sql,
      "last PLATFORM_ADMIN cannot be deactivated",
      () => sql`select public.deactivate_platform_staff(${ids.admin}, 'forbidden last admin')`,
      ["P0001"],
    ));

  await asAuthenticated(sql, ids.admin, async () => {
    await sql`select public.activate_platform_staff(${ids.secondAdmin}, 'second admin')`;
    await sql`select public.grant_platform_staff_role(${ids.secondAdmin}, 'PLATFORM_ADMIN')`;
  });
  const [adminCount] = await sql`
    select count(*)::int as n
    from public.platform_staff ps
    join public.platform_staff_roles psr on psr.profile_id=ps.profile_id
    where ps.is_active and ps.revoked_at is null
      and psr.role='PLATFORM_ADMIN' and psr.revoked_at is null
  `;
  assert(adminCount.n === 2, `expected two live admins, got ${adminCount.n}`);

  const auditActions = await sql`
    select action from public.audit_events
    where resource_id in (${ids.target}, ${supportRoleId})
    order by seq
  `;
  const observed = new Set(auditActions.map((row) => row.action));
  for (const action of [
    "PLATFORM_STAFF_ONBOARDED", "PLATFORM_ROLE_GRANTED",
    "PLATFORM_ROLE_REVOKED", "PLATFORM_STAFF_DEACTIVATED",
    "PLATFORM_STAFF_REACTIVATED",
  ]) {
    assert(observed.has(action), `missing lifecycle audit action ${action}`);
  }
  console.log(
    "verify-platform-staff-lifecycle: PASS " +
    "(admin-only onboarding; zero implicit authority; explicit role only; " +
    "deactivate/revoke; reactivation stays role-free; last-admin protections; audit preserved)",
  );
  await sql.unsafe("rollback");
} catch (error) {
  try { await sql.unsafe("rollback"); } catch {}
  throw error;
} finally {
  await sql.end({ timeout: 5 });
}
