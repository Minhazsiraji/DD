import crypto from "node:crypto";
import {
  assert,
  expectSqlFailure,
  openLocalAdminDatabase,
} from "./p0-b2-lib.mjs";

const sql = openLocalAdminDatabase();
const suffix = crypto.randomBytes(6).toString("hex").toUpperCase();
const ddA = `DD-QA-${suffix}-A`;
const ddB = `DD-QA-${suffix}-B`;

try {
  await sql.unsafe("begin");

  await sql`
    insert into public.dd_number_allocations(dd_patient_number)
    values (${ddA}), (${ddB})
  `;
  const [subject] = await sql`
    insert into public.health_subjects(dd_patient_number, kind, full_name, sex)
    values (${ddA}, 'DEPENDENT', 'QA Immutable Subject', 'UNKNOWN')
    returning id
  `;
  await sql`
    update public.dd_number_allocations
    set health_subject_id = ${subject.id}
    where dd_patient_number = ${ddA}
  `;

  const changeError = await expectSqlFailure(
    sql,
    "health subject DD number mutation",
    () => sql`
      update public.health_subjects
      set dd_patient_number = ${ddB}
      where id = ${subject.id}
    `,
    ["P0001"],
  );
  assert(String(changeError.message).includes("DD_NUMBER_IMMUTABLE"), "wrong immutability failure");

  await sql`
    update public.dd_number_allocations
    set allocation_state = 'RETIRED'
    where dd_patient_number = ${ddA}
  `;
  const reactivateError = await expectSqlFailure(
    sql,
    "retired DD allocation reactivation",
    () => sql`
      update public.dd_number_allocations
      set allocation_state = 'LIVE'
      where dd_patient_number = ${ddA}
    `,
    ["P0001"],
  );
  assert(String(reactivateError.message).includes("DD_NUMBER_REACTIVATION_FORBIDDEN"), "wrong retired-allocation failure");

  const applicationRoles = [
    "anon",
    "authenticated",
    "dd_owner_analytics",
    "dd_metrics_reader",
    "dd_metrics_rollup",
    "dd_public_ingress",
    "service_role",
  ];
  for (const role of applicationRoles) {
    await expectSqlFailure(
      sql,
      `${role} direct allocation mutation`,
      async () => {
        await sql.unsafe(`set local role ${role}`);
        await sql`
          update public.dd_number_allocations
          set allocation_state = 'RETIRED'
          where dd_patient_number = ${ddB}
        `;
      },
      ["42501"],
    );
  }

  const rpcArgs = await sql`
    select p.proname, pg_get_function_arguments(p.oid) as arguments
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
  `;
  const mutatingDdParams = rpcArgs.filter((row) => {
    const args = String(row.arguments ?? "").toLowerCase();
    return /(dd(_| )?patient(_| )?number|dd(_| )?number|patient(_| )?number)/.test(args);
  });
  assert(
    mutatingDdParams.length === 0,
    `P0 RPC accepts DD/patient number authority parameter: ${JSON.stringify(mutatingDdParams)}`,
  );

  console.log(`verify-dd-number-immutable: PASS (${applicationRoles.length} application roles denied; subject number immutable; RETIRED cannot return LIVE; zero DD-number RPC parameters)`);
  await sql.unsafe("rollback");
} catch (error) {
  try { await sql.unsafe("rollback"); } catch {}
  throw error;
} finally {
  await sql.end({ timeout: 5 });
}
