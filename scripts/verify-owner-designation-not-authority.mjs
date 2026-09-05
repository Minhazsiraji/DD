import crypto from "node:crypto";
import { assert, openLocalAdminDatabase } from "./p0-b2-lib.mjs";
import {
  asAuthenticated,
  expectAuthenticatedSqlFailure,
  insertAuthProfile,
} from "./p1-proof-lib.mjs";

const sql = openLocalAdminDatabase();
const owner = crypto.randomUUID();
const ROLES = [
  "COMMUNITY_MODERATOR", "MODERATION_SUPERVISOR", "SUPPORT_AGENT",
  "CREDENTIAL_VERIFIER", "FINANCE_OPERATOR", "PLATFORM_ADMIN",
  "HEALTH_ADVISORY_EDITOR", "PUBLIC_HEALTH_SOURCE_STEWARD", "PLATFORM_ANALYST",
];

try {
  await sql.unsafe("begin");
  await insertAuthProfile(sql, owner, "owner-designation");
  await sql`
    insert into public.platform_staff(profile_id, granted_by, is_owner_account)
    values (${owner}, ${owner}, true)
  `;

  const [roleCount] = await sql`
    select count(*)::int as n from public.platform_staff_roles
    where profile_id=${owner} and revoked_at is null
  `;
  assert(roleCount.n === 0, "owner designation implicitly created a staff role");
  for (const role of ROLES) {
    const [row] = await sql`select public.has_platform_staff_role(${owner}, ${role}::platform_staff_role) as v`;
    assert(row.v === false, `owner designation implicitly grants ${role}`);
  }
  const [capCount] = await sql`
    select count(*)::int as n from public.profile_capabilities
    where profile_id=${owner} and capability in ('DOCTOR','MEDICAL_STUDENT')
  `;
  assert(capCount.n === 0, "owner designation created clinical/persona capability");

  const [identity] = await asAuthenticated(sql, owner, () => sql`
    select public.current_doctor_id() as doctor_id,
           public.has_capability(${owner}, 'DOCTOR') as doctor_capability
  `);
  assert(identity.doctor_id === null && identity.doctor_capability === false,
    "owner designation resolves as doctor authority");
  const [clinicalRead] = await asAuthenticated(sql, owner, () => sql`
    select count(*)::int as n from public.clinical_patients
  `);
  assert(clinicalRead.n === 0, "owner designation can read private clinical patients");

  await expectAuthenticatedSqlFailure(
    sql, owner, "owner is not automatic PLATFORM_ADMIN",
    () => sql`select public.grant_platform_staff_role(${owner}, 'PLATFORM_ADMIN')`, ["42501"],
  );
  await expectAuthenticatedSqlFailure(
    sql, owner, "owner is not automatic PLATFORM_ANALYST",
    () => sql`select public.owner_metrics_overview(current_date, current_date)`, ["42501"],
  );
  await expectAuthenticatedSqlFailure(
    sql, owner, "owner is not a clinical superuser",
    () => sql`select public.create_clinical_patient('Forbidden', ${crypto.randomUUID()})`, ["42501"],
  );

  console.log("verify-owner-designation-not-authority: PASS (designation grants zero staff roles, analytics authority, or clinical authority)");
  await sql.unsafe("rollback");
} catch (error) {
  try { await sql.unsafe("rollback"); } catch {}
  throw error;
} finally {
  await sql.end({ timeout: 5 });
}
