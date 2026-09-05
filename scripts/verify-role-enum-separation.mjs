import crypto from "node:crypto";
import { assert, openLocalAdminDatabase } from "./p0-b2-lib.mjs";
import { insertAuthProfile } from "./p1-proof-lib.mjs";

const sql = openLocalAdminDatabase();
const profile = crypto.randomUUID();
const TYPES = ["platform_staff_role", "practice_role", "capability", "profession"];

try {
  await sql.unsafe("begin");
  const rows = await sql`
    select t.typname, e.enumlabel
    from pg_type t join pg_enum e on e.enumtypid=t.oid
    where t.typname = any(${TYPES})
    order by t.typname, e.enumsortorder
  `;
  const byType = new Map(TYPES.map((name) => [name, new Set()]));
  for (const row of rows) byType.get(row.typname)?.add(row.enumlabel);
  for (const type of TYPES) assert(byType.get(type).size > 0, `${type} enum inventory missing`);

  const staff = byType.get("platform_staff_role");
  for (const other of ["practice_role", "capability", "profession"]) {
    const overlap = [...staff].filter((label) => byType.get(other).has(label));
    assert(overlap.length === 0, `platform staff roles overlap ${other}: ${overlap.join(",")}`);
  }

  const casts = await sql`
    select source.typname as source_type, target.typname as target_type, c.castcontext
    from pg_cast c
    join pg_type source on source.oid=c.castsource
    join pg_type target on target.oid=c.casttarget
    where source.typname='platform_staff_role'
      and target.typname = any(${["practice_role", "capability", "profession"]})
  `;
  assert(casts.length === 0, `platform_staff_role has cross-authority casts: ${JSON.stringify(casts)}`);

  await insertAuthProfile(sql, profile, "role-separation");
  await sql`
    insert into public.platform_staff(profile_id, granted_by)
    values (${profile}, ${profile})
  `;
  await sql`
    insert into public.platform_staff_roles(profile_id, role, granted_by)
    values (${profile}, 'SUPPORT_AGENT', ${profile})
  `;
  const [staffRole] = await sql`
    select public.has_platform_staff_role(${profile}, 'SUPPORT_AGENT') as allowed
  `;
  assert(staffRole.allowed === true, "staff role fixture was not recognized as staff authority");
  const capabilities = await sql`
    select capability from public.profile_capabilities where profile_id=${profile}
  `;
  assert(capabilities.length === 0, "platform staff role insertion created a clinical/persona capability");
  const [clinical] = await sql`
    select public.has_capability(${profile}, 'DOCTOR') as doctor,
           public.has_capability(${profile}, 'MEDICAL_STUDENT') as student
  `;
  assert(clinical.doctor === false && clinical.student === false,
    "platform staff authority leaked into clinical/persona capability");

  console.log("verify-role-enum-separation: PASS (enum sets/casts separated; staff role creates no clinical or persona capability)");
  await sql.unsafe("rollback");
} catch (error) {
  try { await sql.unsafe("rollback"); } catch {}
  throw error;
} finally {
  await sql.end({ timeout: 5 });
}
