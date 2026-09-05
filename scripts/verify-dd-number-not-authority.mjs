import crypto from "node:crypto";
import {
  assert,
  openLocalAdminDatabase,
  qaEmail,
} from "./p0-b2-lib.mjs";

const sql = openLocalAdminDatabase();
const userA = crypto.randomUUID();
const userB = crypto.randomUUID();
const dd = `DD-QA-AUTH-${crypto.randomBytes(6).toString("hex").toUpperCase()}`;

async function insertAuthUser(id, email) {
  await sql`
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data,
      confirmation_token, recovery_token, email_change,
      email_change_token_new, email_change_token_current,
      phone_change, phone_change_token, reauthentication_token
    ) values (
      '00000000-0000-0000-0000-000000000000', ${id},
      'authenticated', 'authenticated', ${email}, '', now(), now(), now(),
      '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
      '', '', '', '', '', '', '', ''
    )
  `;
}

async function asAuthenticated(uid, action) {
  await sql`select set_config('request.jwt.claims', ${JSON.stringify({ sub: uid, role: "authenticated" })}, true)`;
  await sql.unsafe("set local role authenticated");
  try {
    return await action();
  } finally {
    await sql.unsafe("reset role");
    await sql`select set_config('request.jwt.claims', '', true)`;
  }
}

try {
  await sql.unsafe("begin");
  await insertAuthUser(userA, qaEmail(`dd-owner-${userA.slice(0, 8)}`));
  await insertAuthUser(userB, qaEmail(`dd-stranger-${userB.slice(0, 8)}`));
  await sql`
    insert into public.profiles(id, full_name) values
      (${userA}, 'QA Subject Owner'), (${userB}, 'QA Stranger')
  `;
  await sql`insert into public.dd_number_allocations(dd_patient_number) values (${dd})`;
  const [subject] = await sql`
    insert into public.health_subjects(dd_patient_number, kind, full_name, sex)
    values (${dd}, 'DEPENDENT', 'QA Protected Subject', 'UNKNOWN')
    returning id
  `;
  await sql`
    update public.dd_number_allocations set health_subject_id=${subject.id}
    where dd_patient_number=${dd}
  `;
  await sql`
    insert into public.health_subject_access(health_subject_id, profile_id, authority)
    values (${subject.id}, ${userA}, 'GUARDIAN')
  `;

  const ownerRows = await asAuthenticated(userA, () => sql`
    select id from public.health_subjects where dd_patient_number=${dd}
  `);
  assert(ownerRows.length === 1, "live authorized edge should permit subject read");

  const strangerRows = await asAuthenticated(userB, () => sql`
    select id from public.health_subjects where dd_patient_number=${dd}
  `);
  assert(strangerRows.length === 0, "knowing DD number alone disclosed subject row");

  const policies = await sql`
    select schemaname, tablename, policyname,
           coalesce(qual, '') || ' ' || coalesce(with_check, '') as expression
    from pg_policies
    where schemaname in ('public','storage')
  `;
  const ddPolicies = policies.filter((row) =>
    String(row.expression).toLowerCase().includes("dd_patient_number"),
  );
  assert(ddPolicies.length === 0, `DD number appears in RLS authority: ${JSON.stringify(ddPolicies)}`);

  const clinicalDdColumns = await sql`
    select table_name, column_name
    from information_schema.columns
    where table_schema='public'
      and table_name = any(${[
        "clinical_patients", "encounters", "encounter_diagnoses",
        "encounter_investigations", "prescriptions", "prescription_items",
        "appointments", "queue_entries",
      ]})
      and column_name='dd_patient_number'
  `;
  assert(clinicalDdColumns.length === 0, "DD number leaked into clinical/practice authority tables");

  const functions = await sql`
    select p.proname, pg_get_function_arguments(p.oid) as args,
           pg_get_function_result(p.oid) as result,
           pg_get_functiondef(p.oid) as definition
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.prokind='f'
  `;
  const unsafeResolvers = functions.filter((row) => {
    const def = String(row.definition).toLowerCase();
    const args = String(row.args).toLowerCase();
    if (!def.includes("dd_patient_number")) return false;
    if (["allocate_dd_patient_number", "prevent_dd_number_change", "create_health_subject"].includes(row.proname)) return false;
    return /(dd(_| )?patient(_| )?number|dd(_| )?number)/.test(args) || /where[^;]*dd_patient_number/.test(def);
  });
  assert(unsafeResolvers.length === 0, `P0 DD-number resolver surface found: ${JSON.stringify(unsafeResolvers.map(r => r.proname))}`);

  console.log("verify-dd-number-not-authority: PASS (zero DD RLS predicates; stranger lookup returns zero; zero clinical DD columns; zero DD resolver endpoints)");
  await sql.unsafe("rollback");
} catch (error) {
  try { await sql.unsafe("rollback"); } catch {}
  throw error;
} finally {
  await sql.end({ timeout: 5 });
}
