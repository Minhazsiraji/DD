/**
 * OWNER ADOPTION METRICS — counting doctors without becoming one.
 *
 * A platform owner has no clinical authority and no cross-doctor read. That is
 * the invariant 0033 established and `db:verify:owner` protects, and it is
 * precisely what makes "how many doctors enabled booking?" hard to answer: the
 * honest query is one the owner is not allowed to run.
 *
 * `owner_adoption_metrics()` is the narrow exception, and this proves the
 * exception stayed narrow:
 *
 *   • only an ACTIVE platform owner may call it
 *   • the counts are TRUE — checked against rows this script seeded
 *   • the payload carries no id, no name, no slug, no uuid of any kind
 *   • calling it leaves the owner exactly as blind to clinical data as before
 *   • it writes nothing
 *
 * HERMETIC. Policies applied inside one transaction in deployment order,
 * everything proven, the whole thing rolled back. db:policies never run.
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

const MIGRATIONS = [["platform_owners", "drizzle/migrations/0019_open_whizzer.sql"]];

const FILES = [
  "supabase/policies/0033_platform_owner_authority.sql",
  "supabase/policies/0042_owner_adoption_metrics.sql",
];

const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });

let failures = 0;
function check(ok, label, detail = "") {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

const uid = () => crypto.randomUUID();
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

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
    check(first.includes(expected), label, first.slice(0, 58));
  }
}

await sql
  .begin(async (tx) => {
    console.log("\n1. Migrations, then policies — deployment order");
    for (const [table, file] of MIGRATIONS) {
      const [{ exists }] = await tx`
        select exists (
          select 1 from information_schema.tables
          where table_schema = 'public' and table_name = ${table}
        ) as exists`;
      if (!exists) {
        const text = await readFile(path.resolve(file), "utf8");
        for (const stmt of text.split("--> statement-breakpoint")) {
          if (stmt.trim()) await tx.unsafe(stmt);
        }
      }
    }
    for (const f of FILES) await tx.unsafe(await readFile(path.resolve(f), "utf8"));
    check(true, "0019 · 0033, 0042");

    // -----------------------------------------------------------------
    console.log("\n2. A baseline, then a known population on top of it");

    /*
     * MEASURE THE DELTA, NOT THE TOTAL.
     *
     * This runs against a development database that already holds rows, so
     * "doctors = 3" would be wrong and "doctors > 0" would prove nothing. Every
     * count below is asserted as before-plus-what-we-seeded, which is exact
     * regardless of what was already there.
     */
    const baseline = await tx`
      select
        (select count(*)::int from public.doctor_profiles) as doctors,
        (select count(*)::int from public.doctor_profiles
           where profile_visibility = 'PUBLIC') as public_profiles,
        (select count(distinct doctor_profile_id)::int from public.doctor_chambers) as with_chambers,
        (select count(distinct doctor_profile_id)::int from public.doctor_booking_settings
           where booking_enabled) as with_booking,
        (select count(distinct owner_doctor_id)::int from public.encounters
           where status = 'COMPLETED') as with_consult,
        (select count(*)::int from public.doctor_subscriptions
           where status = 'ACTIVE') as active_subs,
        (select count(*)::int from public.doctor_subscriptions
           where status = 'CANCELLED') as cancelled_subs,
        (select count(*)::int from public.subscription_payments
           where status = 'PENDING' and method = 'MANUAL_BANK') as pending_manual`;
    const base = baseline[0];

    const owner = uid();
    const stoodDown = uid();
    const alice = uid();
    const bob = uid();

    for (const [id, name] of [
      [owner, "The Owner"],
      [stoodDown, "Former Owner"],
      [alice, "Dr Alice"],
      [bob, "Dr Bob"],
    ]) {
      await tx`insert into auth.users (id, email, encrypted_password, email_confirmed_at,
                                       confirmation_token, recovery_token,
                                       email_change_token_new, email_change)
               values (${id}, ${`met.${id.slice(0, 8)}@qa.invalid`}, '', now(), '', '', '', '')`;
      await tx`insert into public.profiles (id, full_name) values (${id}, ${name})`;
    }

    /*
     * Alice is fully adopted: public profile with a slug, a chamber, booking
     * on, and a completed consultation. Bob has signed up and stopped — a
     * private profile and nothing else. Two doctors at opposite ends is what
     * makes every count below discriminating rather than merely non-zero.
     */
    const [aDoc] = await tx`
      insert into public.doctor_profiles
        (user_id, patient_number_prefix, profile_visibility, profile_slug)
      values (${alice}, 'AL', 'PUBLIC', ${`alice-${alice.slice(0, 8)}`}) returning id`;
    const [bDoc] = await tx`
      insert into public.doctor_profiles (user_id, patient_number_prefix)
      values (${bob}, 'BO') returning id`;

    const [loc] = await tx`insert into public.practice_locations (name, type, district, created_by)
                           values ('Metrics Chamber','CLINIC','Dhaka',${alice}) returning id`;
    await tx`insert into public.practice_location_members (practice_location_id, user_id, role, status)
             values (${loc.id}, ${alice}, 'DOCTOR', 'ACTIVE')`;
    const [chamber] = await tx`insert into public.doctor_chambers
        (doctor_profile_id, practice_location_id, position)
      values (${aDoc.id}, ${loc.id}, 0) returning id`;
    await tx`insert into public.doctor_booking_settings
        (doctor_profile_id, doctor_chamber_id, booking_enabled)
      values (${aDoc.id}, ${chamber.id}, true)`;

    const [patient] = await tx`insert into public.patients
        (owner_doctor_id, patient_number, full_name, name_normalized, sex, created_by)
      values (${aDoc.id}, 'AL-000001', 'Private Patient', 'private patient', 'FEMALE', ${alice})
      returning id`;
    await tx`insert into public.encounters
        (owner_doctor_id, patient_id, practice_location_id, status, created_by)
      values (${aDoc.id}, ${patient.id}, ${loc.id}, 'COMPLETED', ${alice})`;
    /* A DRAFT must not count as a first consultation. */
    await tx`insert into public.encounters
        (owner_doctor_id, patient_id, practice_location_id, status, created_by)
      values (${bDoc.id}, ${patient.id}, ${loc.id}, 'DRAFT', ${bob})`;

    /*
     * Subscriptions in two different states, plus one pending manual payment.
     *
     * Seeded because an EMPTY breakdown makes the assertion below vacuous:
     * "every value is a count" is trivially true of an object with no values,
     * and the development database has no subscription rows of its own.
     */
    const [plan] = await tx`
      insert into public.subscription_plans (code, name, monthly_price_bdt, is_active)
      values ('QA_METRICS_PLAN', 'QA Metrics', 500, true) returning id`;
    const [aSub] = await tx`
      insert into public.doctor_subscriptions (doctor_profile_id, plan_id, status)
      values (${aDoc.id}, ${plan.id}, 'ACTIVE') returning id`;
    await tx`insert into public.doctor_subscriptions (doctor_profile_id, plan_id, status)
             values (${bDoc.id}, ${plan.id}, 'CANCELLED')`;
    await tx`insert into public.subscription_payments
        (subscription_id, amount, currency, method, status, payer_reference)
      values (${aSub.id}, 500, 'BDT', 'MANUAL_BANK', 'PENDING', 'QA-METRICS-1')`;
    /* A gateway payment must not be counted as one waiting for a human. */
    await tx`insert into public.subscription_payments
        (subscription_id, amount, currency, method, status, payer_reference)
      values (${aSub.id}, 500, 'BDT', 'SSLCOMMERZ', 'PENDING', 'QA-METRICS-2')`;

    await tx`insert into public.platform_owners (user_id, note) values (${owner}, 'fixture')`;
    await tx`insert into public.platform_owners (user_id, is_active, revoked_at, note)
             values (${stoodDown}, false, now(), 'stood down')`;
    check(true, "seeded: one adopted doctor, one dormant, one owner, one stood down");

    // -----------------------------------------------------------------
    console.log("\n3. Only an active platform owner may ask");

    for (const [who, label] of [
      [alice, "a doctor cannot read platform metrics"],
      [bob, "…nor another doctor"],
      [stoodDown, "…nor an owner who was stood down"],
    ]) {
      await refused(tx, label, "NOT_PLATFORM_OWNER", async (sp) => {
        await sp`select set_config('request.jwt.claims', ${JSON.stringify({ sub: who, role: "authenticated" })}, true)`;
        await sp`select set_config('role', 'authenticated', true)`;
        await sp`select public.owner_adoption_metrics()`;
      });
    }
    await refused(tx, "anonymous cannot even execute it", "permission denied", async (sp) => {
      await sp`select set_config('role', 'anon', true)`;
      await sp`select public.owner_adoption_metrics()`;
    });

    // -----------------------------------------------------------------
    console.log("\n4. The counts are true");

    const metrics = await as(tx, owner, async () => {
      const [r] = await tx`select public.owner_adoption_metrics() as v`;
      return r.v;
    });

    check(metrics.doctors === base.doctors + 2, "two more doctors", `${base.doctors} → ${metrics.doctors}`);
    check(
      metrics.publicProfiles === base.public_profiles + 1,
      "one more public profile — Bob's private one is not counted",
      `${base.public_profiles} → ${metrics.publicProfiles}`,
    );
    check(
      metrics.profilesWithSlug === base.public_profiles + 1,
      "…and it is reachable, because it has a slug",
    );
    check(
      metrics.withChambers === base.with_chambers + 1,
      "one more doctor with a chamber",
      `${base.with_chambers} → ${metrics.withChambers}`,
    );
    check(
      metrics.withBookingEnabled === base.with_booking + 1,
      "one more doctor with booking on",
      `${base.with_booking} → ${metrics.withBookingEnabled}`,
    );
    check(
      metrics.withFirstConsultation === base.with_consult + 1,
      "one more doctor past their first consultation",
      `${base.with_consult} → ${metrics.withFirstConsultation}`,
    );
    check(
      metrics.withFirstConsultation !== base.with_consult + 2,
      "…and a DRAFT encounter did not count as one",
    );
    check(typeof metrics.generatedAt === "string" && metrics.generatedAt.length > 0,
      "the reading is stamped");

    check(
      metrics.subscriptions.ACTIVE === base.active_subs + 1,
      "one more ACTIVE subscription",
      `${base.active_subs} → ${metrics.subscriptions.ACTIVE}`,
    );
    check(
      metrics.subscriptions.CANCELLED === base.cancelled_subs + 1,
      "…and churn is counted separately, not folded into it",
      `${base.cancelled_subs} → ${metrics.subscriptions.CANCELLED}`,
    );
    check(
      metrics.pendingManualPayments === base.pending_manual + 1,
      "one more manual payment awaiting a decision",
      `${base.pending_manual} → ${metrics.pendingManualPayments}`,
    );
    check(
      metrics.pendingManualPayments !== base.pending_manual + 2,
      "…and the PENDING gateway payment was not counted as one for a human",
    );

    // -----------------------------------------------------------------
    console.log("\n5. Counts, and nothing that identifies anybody");

    const payload = JSON.stringify(metrics);
    check(!UUID_RE.test(payload), "no uuid appears anywhere in the payload");
    check(!payload.includes("Dr Alice") && !payload.includes("Dr Bob"), "no doctor's name");
    check(!payload.toLowerCase().includes("private patient"), "no patient's name");
    check(!payload.includes(`alice-${alice.slice(0, 8)}`), "no profile slug");
    check(!payload.includes("Metrics Chamber"), "no chamber or location name");

    const scalars = Object.entries(metrics).filter(([k]) => k !== "subscriptions" && k !== "generatedAt");
    check(
      scalars.every(([, v]) => typeof v === "number"),
      "every metric is a number",
      scalars.map(([k]) => k).join(","),
    );
    const subKeys = Object.keys(metrics.subscriptions);
    check(
      subKeys.length > 0 && Object.values(metrics.subscriptions).every((v) => typeof v === "number"),
      "…and the subscription breakdown is counts by status",
      subKeys.join(",") || "none",
    );
    check(
      subKeys.every((k) => /^[A-Z_]+$/.test(k)),
      "…keyed by status, never by a doctor",
      subKeys.join(","),
    );

    // -----------------------------------------------------------------
    console.log("\n6. THE INVARIANT: asking makes the owner no less blind");

    for (const table of ["patients", "encounters", "prescriptions", "appointments"]) {
      let outcome;
      try {
        outcome = await tx.savepoint(async (sp) => {
          await sp`select set_config('request.jwt.claims', ${JSON.stringify({ sub: owner, role: "authenticated" })}, true)`;
          await sp`select set_config('role', 'authenticated', true)`;
          const rows = await sp.unsafe(`select * from public.${table} limit 1`);
          return `${rows.length} row(s)`;
        });
      } catch (e) {
        outcome = e.message.includes("permission denied")
          ? "permission denied"
          : e.message.slice(0, 36);
      }
      check(
        outcome === "permission denied" || outcome === "0 row(s)",
        `owner still cannot read ${table}`,
        outcome,
      );
    }

    /*
     * `tx.savepoint()` that RETURNS normally commits, including the role it
     * set. Reset before reading as the superuser, or the "did anything change?"
     * comparison is taken by a different observer than the baseline was.
     */
    await tx`select set_config('role', null, true)`;
    await tx`select set_config('request.jwt.claims', null, true)`;

    const [after] = await tx`
      select
        (select count(*)::int from public.patients where owner_doctor_id = ${aDoc.id}) as patients,
        (select count(*)::int from public.encounters where owner_doctor_id = ${aDoc.id}) as encounters,
        (select count(*)::int from public.audit_events
           where action like 'ADOPTION%' or action like 'METRIC%') as audits`;
    check(after.patients === 1 && after.encounters === 1, "no clinical row was added or removed");
    check(after.audits === 0, "reading metrics wrote nothing at all", `${after.audits} rows`);

    const second = await as(tx, owner, async () => {
      const [r] = await tx`select public.owner_adoption_metrics() as v`;
      return r.v;
    });
    check(second.doctors === metrics.doctors, "asking twice changes nothing");

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

const [{ n: strays }] = await sql`
  select count(*)::int as n from auth.users where email like 'met.%@qa.invalid'`;
check(strays === 0, "no fixture identity survived", `${strays}`);

console.log(
  failures === 0
    ? "\nOwner adoption metrics: all checks passed. Every row rolled back.\n"
    : `\n${failures} CHECK(S) FAILED.\n`,
);

await sql.end();
process.exit(failures === 0 ? 0 : 1);
