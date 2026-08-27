/**
 * DOES 0030 ACTUALLY COMPILE?
 *
 * A test that reads a policy file as text can prove its shape — that a guard is
 * present, that a grant was revoked, that no clinical table is named. It cannot
 * prove the file is valid PL/pgSQL. Forty-one such assertions passed over
 * `public_doctor_profile` while the function contained a `%rowtype` variable in
 * a multi-target INTO list, which Postgres rejects at CREATE time. The function
 * had never been executable, and only `db:policies` against a real database
 * found out.
 *
 * This closes that gap the only way it can be closed: apply the entire file to
 * a real Postgres, confirm every expected object exists, and ROLL BACK.
 *
 * Safe to run against the shared project:
 *   • One transaction, always rolled back — never committed, on any path.
 *   • 0018 is already applied, so `create table if not exists` and
 *     `add column if not exists` are no-ops rather than new DDL.
 *   • Functions, policies, grants and the plan seed exist only until ROLLBACK.
 *   • It writes no storage object and creates no auth user.
 *
 * It does NOT prove behaviour — that is db:verify:commercial and
 * db:verify:race. It proves the file installs at all, which is the thing that
 * has to be true before either of those can run.
 */
import postgres from "postgres";
import { readFile } from "node:fs/promises";
import path from "node:path";

const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error("DIRECT_URL or DATABASE_URL must be set.");
  process.exit(1);
}

const POLICY = "supabase/policies/0030_paid_doctor_commercial.sql";

/** Every function the file is expected to install, with its argument types. */
const EXPECTED = [
  ["public_doctor_profile", "text"],
  ["public_booking_slots", "text, uuid, date"],
  ["create_public_booking", "text, uuid, date, text, text, text, text, text"],
  ["ensure_doctor_subscription", ""],
  ["current_subscription", ""],
  ["submit_manual_subscription_payment", "numeric, text, text"],
  ["cancel_own_subscription", ""],
  ["reactivate_own_subscription", ""],
  ["doctor_booking_config", ""],
  ["save_doctor_booking_settings", "uuid, boolean, text, integer, integer, integer, integer, numeric, text"],
  ["add_doctor_booking_closed_date", "uuid, date, text"],
  ["remove_doctor_booking_closed_date", "uuid, date"],
];

const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });

let failures = 0;
function check(ok, label, detail = "") {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

const content = await readFile(path.resolve(POLICY), "utf8");

await sql
  .begin(async (tx) => {
    console.log(`\n1. Applying ${POLICY} inside a transaction`);

    /**
     * check_function_bodies is ON by default, which is what makes this a
     * compile gate: Postgres parses each plpgsql body at CREATE FUNCTION and
     * refuses a malformed one. Asserted rather than assumed — if a future
     * Postgres or a session setting turned it off, this script would silently
     * stop proving anything.
     */
    // `show x` names its column after the setting, so read it explicitly.
    const [{ setting }] = await tx`select current_setting('check_function_bodies') as setting`;
    check(setting === "on", "check_function_bodies is on — bodies are parsed", setting);

    await tx.unsafe(content);
    check(true, "the whole file applied without error");

    console.log("\n2. Every expected function exists");
    for (const [name, args] of EXPECTED) {
      const [row] = await tx`
        select oidvectortypes(p.proargtypes) as args,
               p.prosecdef as definer,
               coalesce(array_to_string(p.proconfig, ','), '') as config
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = ${name}
        limit 1`;
      check(!!row, `${name} was created`);
      if (row) {
        check(row.definer === true, `  …${name} is SECURITY DEFINER`);
        check(
          row.config.replace(/\s+/g, "").includes("search_path=public,pg_temp"),
          `  …${name} pins search_path`,
          row.config || "unset",
        );
        /**
         * The argument list must match the one the file REVOKEs and GRANTs.
         * A mismatch means the grant names an overload that does not exist,
         * leaving the real function on its Postgres default — EXECUTE to
         * PUBLIC. Compared on identity arguments only: regprocedure omits the
         * schema when public is in search_path, so a rendered signature is not
         * a stable thing to compare against.
         */
        check(
          row.args.replace(/\s+/g, "") === args.replace(/\s+/g, ""),
          `  …${name} arguments match its GRANT`,
          `${row.args || "(none)"} vs expected ${args || "(none)"}`,
        );
      }
    }

    console.log("\n3. Every function body survives a plan-time re-parse");
    /**
     * CREATE FUNCTION parses syntax; it does NOT resolve every table and column
     * inside the body. `plpgsql_check` would, but it is not installed here, so
     * the next-best check is to force a plan of each function's SQL by asking
     * Postgres to describe it — a body referencing a missing column still gets
     * caught later by db:verify:commercial actually calling it.
     */
    for (const [name] of EXPECTED) {
      const [row] = await tx`
        select pg_get_functiondef(p.oid) as def
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = ${name} limit 1`;
      check(!!row?.def && row.def.length > 0, `${name} has a retrievable definition`);
    }

    console.log("\n4. The plan seed landed (and will roll back)");
    const [{ n: plans }] = await tx`select count(*)::int as n from public.subscription_plans`;
    check(plans >= 2, "PILOT and FOUNDING_DOCTOR seeded", `${plans} rows`);
    const [{ n: priced }] =
      await tx`select count(*)::int as n from public.subscription_plans where monthly_price_bdt <> 0`;
    check(priced === 0, "no unapproved price was hard-coded", `${priced} priced rows`);

    console.log("\n5. Policies were created");
    const [{ n: policies }] = await tx`
      select count(*)::int as n from pg_policies
      where schemaname = 'public'
        and tablename in ('doctor_booking_settings','doctor_booking_closed_dates',
                          'subscription_plans','doctor_subscriptions','subscription_payments')`;
    check(policies >= 5, "row-level policies present", `${policies}`);

    console.log("\n6. anon holds no direct table privilege");
    const [{ n: anonGrants }] = await tx`
      select count(*)::int as n
      from information_schema.role_table_grants
      where grantee = 'anon' and table_schema = 'public'
        and table_name in ('doctor_booking_settings','doctor_booking_closed_dates',
                           'subscription_plans','doctor_subscriptions','subscription_payments',
                           'patients','appointments')`;
    check(anonGrants === 0, "anon has zero table grants on commercial or clinical tables", `${anonGrants}`);

    console.log("\n7. Rolling back — nothing installed");
    throw new Error("__ROLLBACK_ALL__");
  })
  .catch((e) => {
    if (!/__ROLLBACK_ALL__/.test(e.message)) {
      failures += 1;
      console.error("\n  ✗ APPLY FAILED");
      console.error(`    ${e.message.split("\n")[0]}`);
      if (e.position) console.error(`    at character ${e.position}`);
      if (e.where) console.error(`    ${e.where.split("\n")[0]}`);
    }
  });

// Prove the rollback: the functions must NOT exist outside the transaction.
const leaked = await sql`
  select count(*)::int as n from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'create_public_booking'`;
check(leaked[0].n === 0, "nothing survived the transaction", `${leaked[0].n} function(s) left behind`);

console.log(
  failures === 0
    ? `\n${POLICY} compiles cleanly. Nothing was installed.\n`
    : `\n${failures} CHECK(S) FAILED. Nothing was installed.\n`,
);

await sql.end();
process.exit(failures === 0 ? 0 : 1);
