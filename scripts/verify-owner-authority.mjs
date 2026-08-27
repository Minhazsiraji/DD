/**
 * PLATFORM OWNER AUTHORITY — proven against a real Postgres.
 *
 * Two questions, and the second matters more than the first:
 *
 *   1. Does owner authority work? (the right people are owners, nobody else is)
 *   2. Does it stay OUT of the clinical record?
 *
 * The second is a promise made to every doctor: their patients are theirs, and
 * the existence of a platform administrator does not change that. It is
 * enforced by ABSENCE — no clinical policy mentions `is_platform_owner()` —
 * and absence is exactly the kind of control that erodes silently. So this
 * script seats a real owner and makes them try to read real clinical rows.
 *
 * SELF-CONTAINED AND HERMETIC. Inside ONE transaction it applies migration 0019
 * and then policy 0033 — the real deployment order — proves everything, and
 * rolls the whole thing back. Nothing is installed and no row survives. It
 * writes no storage object and never runs db:policies.
 *
 * Applying the migration here is not a convenience. 0033 deliberately does NOT
 * create `platform_owners`: the migration is the sole authority for its shape,
 * so a policy file that conjured the table would hide a skipped `db:migrate`.
 * This script therefore has to build the table the same way production does,
 * which means it also proves the two files compose in that order.
 */
import postgres from "postgres";
import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error("DIRECT_URL or DATABASE_URL must be set.");
  process.exit(1);
}

const POLICY = "supabase/policies/0033_platform_owner_authority.sql";
const MIGRATION = "drizzle/migrations/0019_open_whizzer.sql";
const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });

let failures = 0;
function check(ok, label, detail = "") {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

const uid = () => crypto.randomUUID();

/** Run `fn` as a specific authenticated user, then drop back to no role. */
async function as(tx, user, fn) {
  await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: user, role: "authenticated" })}, true)`;
  await tx`select set_config('role', 'authenticated', true)`;
  try {
    return await fn();
  } finally {
    await tx`select set_config('role', null, true)`;
    await tx`select set_config('request.jwt.claims', null, true)`;
  }
}

/** Does the database refuse this, for the stated reason? */
async function refused(tx, label, expected, fn) {
  try {
    await tx.savepoint(async (sp) => {
      await fn(sp);
      throw new Error("__ALLOWED__");
    });
    check(false, label, "ALLOWED");
  } catch (e) {
    if (/__ALLOWED__/.test(e.message)) return check(false, label, "ALLOWED");
    const first = e.message.split("\n")[0];
    check(first.includes(expected), label, first.slice(0, 64));
  }
}

const policySql = await readFile(path.resolve(POLICY), "utf8");
const migrationSql = await readFile(path.resolve(MIGRATION), "utf8");

await sql
  .begin(async (tx) => {
    console.log("\n1. Applying migration, then policy — the deployment order");

    /*
     * If `platform_owners` already exists (the migration has been applied for
     * real), skip creating it — this script must work both before and after
     * that has happened.
     */
    const [{ exists: alreadyMigrated }] = await tx`
      select exists (
        select 1 from information_schema.tables
        where table_schema = 'public' and table_name = 'platform_owners'
      ) as exists`;

    if (!alreadyMigrated) {
      // drizzle-kit separates statements with a breakpoint marker.
      for (const stmt of migrationSql.split("--> statement-breakpoint")) {
        if (stmt.trim()) await tx.unsafe(stmt);
      }
    }
    check(true, `migration 0019 ${alreadyMigrated ? "already applied" : "applied"}`);

    await tx.unsafe(policySql);
    check(true, "policy 0033 applied on top of it");

    /*
     * The policy must NOT be able to stand up the table by itself. If this ever
     * passes against an unmigrated database, 0033 has grown a create statement
     * and the deployment-order guard is gone.
     */
    const [{ n: cols }] = await tx`
      select count(*)::int as n from information_schema.columns
      where table_schema = 'public' and table_name = 'platform_owners'`;
    check(cols === 6, "the table has the migration's full shape", `${cols} columns`);

    const [{ setting }] = await tx`select current_setting('check_function_bodies') as setting`;
    check(setting === "on", "check_function_bodies is on — the body was parsed", setting);

    // -----------------------------------------------------------------
    console.log("\n2. Four identities");

    const owner = uid();
    const doctor = uid();
    const staff = uid();
    const stoodDown = uid();

    for (const [id, name] of [
      [owner, "The Owner"],
      [doctor, "Dr Clinical"],
      [staff, "Reception"],
      [stoodDown, "Former Owner"],
    ]) {
      await tx`insert into auth.users (id, email, encrypted_password, email_confirmed_at,
                                       confirmation_token, recovery_token,
                                       email_change_token_new, email_change)
               values (${id}, ${`own.${id.slice(0, 8)}@qa.invalid`}, '', now(), '', '', '', '')`;
      await tx`insert into public.profiles (id, full_name) values (${id}, ${name})`;
    }

    const [doc] = await tx`insert into public.doctor_profiles (user_id, patient_number_prefix)
                           values (${doctor}, 'OW') returning id`;
    const [loc] = await tx`insert into public.practice_locations (name, type, district, created_by)
                           values ('Owner Test Chamber','CLINIC','Dhaka',${doctor}) returning id`;
    await tx`insert into public.practice_location_members (practice_location_id, user_id, role, status)
             values (${loc.id}, ${doctor}, 'DOCTOR', 'ACTIVE')`;
    await tx`insert into public.practice_location_members (practice_location_id, user_id, role, status)
             values (${loc.id}, ${staff}, 'LOCATION_ADMIN', 'ACTIVE')`;

    // A real patient in that doctor's repository — the thing an owner must not reach.
    const [patient] = await tx`insert into public.patients
        (owner_doctor_id, patient_number, full_name, name_normalized, sex, created_by)
      values (${doc.id}, 'OW-000001', 'Private Patient', 'private patient', 'FEMALE', ${doctor})
      returning id`;

    await tx`insert into public.platform_owners (user_id, granted_by, note)
             values (${owner}, ${doctor}, 'verification fixture')`;
    await tx`insert into public.platform_owners (user_id, is_active, revoked_at, note)
             values (${stoodDown}, false, now(), 'stood down')`;

    check(true, "owner, doctor, staff, stood-down owner and one patient seeded");

    // -----------------------------------------------------------------
    console.log("\n3. Who is a platform owner?");

    const isOwner = (who) =>
      as(tx, who, async () => {
        const [r] = await tx`select public.is_platform_owner() as v`;
        return r.v;
      });

    /*
     * Anonymous is refused OUTRIGHT rather than answered `false`. Execute is
     * revoked from anon, so the question cannot even be asked — a stronger
     * property than a false answer, and correct because nothing anonymous has
     * any business probing platform authority. The app never calls this without
     * a session: `/owner` is not a public path, so the proxy sends signed-out
     * visitors to /login exactly as it does for any unknown route.
     */
    await refused(tx, "anonymous cannot even ask", "permission denied", async (sp) => {
      await sp`select set_config('role', 'anon', true)`;
      await sp`select public.is_platform_owner()`;
    });
    check((await isOwner(doctor)) === false, "a doctor is NOT an owner");
    check((await isOwner(staff)) === false, "a LOCATION_ADMIN is NOT an owner");
    check((await isOwner(owner)) === true, "the authorised account IS an owner");
    check((await isOwner(stoodDown)) === false, "a stood-down owner loses authority");

    // -----------------------------------------------------------------
    console.log("\n4. Authority cannot be forged");

    const [{ n: overloads }] = await tx`
      select count(*)::int as n from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'is_platform_owner'`;
    check(overloads === 1, "exactly one is_platform_owner — no id-taking overload", `${overloads}`);

    const [{ args }] = await tx`
      select oidvectortypes(p.proargtypes) as args from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'is_platform_owner'`;
    check(args === "", "it takes NO argument — identity comes from auth.uid() only", `(${args})`);

    const [{ src }] = await tx`
      select pg_get_functiondef(p.oid) as src from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'is_platform_owner'`;
    check(src.includes("auth.uid()"), "resolves the caller through auth.uid()");

    /*
     * Read proconfig, not the rendered definition: pg_get_functiondef prints
     * `SET search_path TO public, pg_temp`, so matching on `search_path=` there
     * fails against a function that is in fact pinned.
     */
    const [{ definer, config }] = await tx`
      select p.prosecdef as definer, coalesce(array_to_string(p.proconfig, ','), '') as config
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'is_platform_owner'`;
    check(definer === true, "is SECURITY DEFINER");
    check(
      config.replace(/\s+/g, "").includes("search_path=public,pg_temp"),
      "pins search_path",
      config || "unset",
    );

    // A doctor renaming themselves, or editing their profile, changes nothing.
    await tx`update public.profiles set full_name = 'The Owner' where id = ${doctor}`;
    check((await isOwner(doctor)) === false, "renaming a profile grants nothing");

    await refused(tx, "a doctor cannot insert themselves as an owner", "permission denied", async (sp) => {
      await sp`select set_config('request.jwt.claims', ${JSON.stringify({ sub: doctor, role: "authenticated" })}, true)`;
      await sp`select set_config('role', 'authenticated', true)`;
      await sp`insert into public.platform_owners (user_id) values (${doctor})`;
    });

    await refused(tx, "a doctor cannot even read the owner list", "permission denied", async (sp) => {
      await sp`select set_config('request.jwt.claims', ${JSON.stringify({ sub: doctor, role: "authenticated" })}, true)`;
      await sp`select set_config('role', 'authenticated', true)`;
      await sp`select * from public.platform_owners`;
    });

    await refused(tx, "anon cannot execute the helper at all", "permission denied", async (sp) => {
      await sp`select set_config('role', 'anon', true)`;
      await sp`select public.is_platform_owner()`;
    });

    // -----------------------------------------------------------------
    console.log("\n5. THE PROMISE: an owner is not a clinical superuser");

    /*
     * Counted, not caught. A thrown error and an empty result are both
     * acceptable outcomes — "permission denied" and "RLS returned nothing" are
     * equally good — but they are different, and lumping them into a
     * catch-anything helper would let an unrelated failure read as a pass.
     */
    for (const table of [
      "patients",
      "encounters",
      "prescriptions",
      "prescription_items",
      "appointments",
      "queue_entries",
    ]) {
      let outcome;
      try {
        outcome = await tx.savepoint(async (sp) => {
          await sp`select set_config('request.jwt.claims', ${JSON.stringify({ sub: owner, role: "authenticated" })}, true)`;
          await sp`select set_config('role', 'authenticated', true)`;
          const rows = await sp.unsafe(`select * from public.${table} limit 1`);
          return `${rows.length} row(s) visible`;
        });
      } catch (e) {
        outcome = e.message.split("\n")[0].includes("permission denied")
          ? "permission denied"
          : `error: ${e.message.split("\n")[0].slice(0, 40)}`;
      }
      check(
        outcome === "permission denied" || outcome === "0 row(s) visible",
        `owner cannot read ${table}`,
        outcome,
      );
    }

    const ownerSeesPatient = await as(tx, owner, async () => {
      const rows = await tx`select id from public.patients where id = ${patient.id}`;
      return rows.length;
    });
    check(ownerSeesPatient === 0, "owner cannot see a specific patient by id", `${ownerSeesPatient} rows`);

    // The doctor still can — proving the patient exists and RLS is the reason.
    const doctorSeesPatient = await as(tx, doctor, async () => {
      const rows = await tx`select id from public.patients where id = ${patient.id}`;
      return rows.length;
    });
    check(doctorSeesPatient === 1, "…while the owning doctor still can", `${doctorSeesPatient} row`);

    // -----------------------------------------------------------------
    console.log("\n6. No clinical policy references owner status");

    const [{ n: clinicalRefs }] = await tx`
      select count(*)::int as n from pg_policies
      where schemaname = 'public'
        and tablename in ('patients','encounters','prescriptions','prescription_items',
                          'appointments','queue_entries','encounter_diagnoses',
                          'encounter_investigations','patient_allergies','patient_conditions')
        and (coalesce(qual,'') || coalesce(with_check,'')) like '%is_platform_owner%'`;
    check(clinicalRefs === 0, "zero clinical policies mention is_platform_owner()", `${clinicalRefs}`);

    console.log("\n7. Rolling back");
    throw new Error("__ROLLBACK_ALL__");
  })
  .catch((e) => {
    if (!/__ROLLBACK_ALL__/.test(e.message)) {
      failures += 1;
      console.error("\n  ✗ ABORTED");
      console.error(`    ${e.message.split("\n")[0]}`);
    }
  });

// Prove the rollback: the helper must not exist outside the transaction unless
// it was already installed before this run.
const [{ n: leaked }] = await sql`
  select count(*)::int as n from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'is_platform_owner'`;
console.log(`\n  · is_platform_owner installed on this database: ${leaked === 1 ? "yes (pre-existing)" : "no"}`);

const [{ n: strays }] = await sql`
  select count(*)::int as n from auth.users where email like 'own.%@qa.invalid'`;
check(strays === 0, "no fixture identity survived the transaction", `${strays}`);

console.log(
  failures === 0
    ? "\nPlatform owner authority: all checks passed. Every row rolled back.\n"
    : `\n${failures} CHECK(S) FAILED.\n`,
);

await sql.end();
process.exit(failures === 0 ? 0 : 1);
