/**
 * MANUAL PAYMENT APPROVAL — the loop 0030 left open on purpose.
 *
 * 0030 shipped a payment a doctor could submit and nobody could confirm,
 * because letting a doctor confirm their own payment is not an approval
 * workflow. This proves the approver arrived without bringing anything else
 * with them:
 *
 *   • only an ACTIVE platform owner decides
 *   • the doctor still has no path to CONFIRMED
 *   • confirming moves commercial state and touches NO clinical row
 *   • a settled decision is never rewritten
 *
 * HERMETIC. Policies applied inside one transaction in deployment order,
 * everything proven, whole thing rolled back. db:policies never run.
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

/**
 * Migrations first, then policies — the real deployment order.
 *
 * 0033 deliberately does NOT create `platform_owners`; migration 0019 owns its
 * shape, so a policy file that conjured it would hide a skipped `db:migrate`.
 * That means this script has to build the table the same way production does.
 */
const MIGRATIONS = [
  ["platform_owners", "drizzle/migrations/0019_open_whizzer.sql"],
];

const FILES = [
  "supabase/policies/0030_paid_doctor_commercial.sql",
  "supabase/policies/0033_platform_owner_authority.sql",
  "supabase/policies/0037_manual_payment_approval.sql",
];

const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });

let failures = 0;
function check(ok, label, detail = "") {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

const uid = () => crypto.randomUUID();
const sha = (v) => crypto.createHash("sha256").update(JSON.stringify(v)).digest("hex").slice(0, 16);

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
    check(true, "0019 · 0030, 0033, 0037");

    // -----------------------------------------------------------------
    console.log("\n2. An owner, a stood-down owner, a doctor with a patient");

    const owner = uid();
    const stoodDown = uid();
    const doctor = uid();
    const other = uid();

    for (const [id, name] of [
      [owner, "The Owner"],
      [stoodDown, "Former Owner"],
      [doctor, "Dr Payer"],
      [other, "Dr Other"],
    ]) {
      await tx`insert into auth.users (id, email, encrypted_password, email_confirmed_at,
                                       confirmation_token, recovery_token,
                                       email_change_token_new, email_change)
               values (${id}, ${`pay.${id.slice(0, 8)}@qa.invalid`}, '', now(), '', '', '', '')`;
      await tx`insert into public.profiles (id, full_name) values (${id}, ${name})`;
    }

    const [doc] = await tx`insert into public.doctor_profiles (user_id, patient_number_prefix)
                           values (${doctor}, 'PY') returning id`;
    await tx`insert into public.doctor_profiles (user_id, patient_number_prefix)
             values (${other}, 'PO')`;
    const [loc] = await tx`insert into public.practice_locations (name, type, district, created_by)
                           values ('Payment Chamber','CLINIC','Dhaka',${doctor}) returning id`;
    await tx`insert into public.practice_location_members (practice_location_id, user_id, role, status)
             values (${loc.id}, ${doctor}, 'DOCTOR', 'ACTIVE')`;
    const [patient] = await tx`insert into public.patients
        (owner_doctor_id, patient_number, full_name, name_normalized, sex, created_by)
      values (${doc.id}, 'PY-000001', 'Private Patient', 'private patient', 'FEMALE', ${doctor})
      returning id`;

    await tx`insert into public.platform_owners (user_id, note) values (${owner}, 'fixture')`;
    await tx`insert into public.platform_owners (user_id, is_active, revoked_at, note)
             values (${stoodDown}, false, now(), 'stood down')`;
    check(true, "seeded");

    // -----------------------------------------------------------------
    console.log("\n3. The doctor submits, and can go no further");

    const paymentId = await as(tx, doctor, async () => {
      const [r] = await tx`select public.submit_manual_subscription_payment(
        5000, 'BANK-REF-777', 'first month') as id`;
      return r.id;
    });
    const [fresh] = await tx`select status, confirmed_at, recorded_by
                             from public.subscription_payments where id = ${paymentId}`;
    check(fresh.status === "PENDING", "the payment starts PENDING", fresh.status);
    check(fresh.confirmed_at === null && fresh.recorded_by === null, "…unconfirmed and unattributed");

    await refused(tx, "the doctor cannot decide their own payment", "NOT_PLATFORM_OWNER", async (sp) => {
      await sp`select set_config('request.jwt.claims', ${JSON.stringify({ sub: doctor, role: "authenticated" })}, true)`;
      await sp`select set_config('role', 'authenticated', true)`;
      await sp`select public.owner_decide_subscription_payment(${paymentId}, 'CONFIRM')`;
    });
    await refused(tx, "…nor update the row directly", "permission denied", async (sp) => {
      await sp`select set_config('request.jwt.claims', ${JSON.stringify({ sub: doctor, role: "authenticated" })}, true)`;
      await sp`select set_config('role', 'authenticated', true)`;
      await sp`update public.subscription_payments set status = 'CONFIRMED' where id = ${paymentId}`;
    });
    await refused(tx, "…nor activate their own subscription", "permission denied", async (sp) => {
      await sp`select set_config('request.jwt.claims', ${JSON.stringify({ sub: doctor, role: "authenticated" })}, true)`;
      await sp`select set_config('role', 'authenticated', true)`;
      await sp`update public.doctor_subscriptions set status = 'ACTIVE'`;
    });
    await refused(tx, "another doctor cannot decide it either", "NOT_PLATFORM_OWNER", async (sp) => {
      await sp`select set_config('request.jwt.claims', ${JSON.stringify({ sub: other, role: "authenticated" })}, true)`;
      await sp`select set_config('role', 'authenticated', true)`;
      await sp`select public.owner_decide_subscription_payment(${paymentId}, 'CONFIRM')`;
    });
    await refused(tx, "a stood-down owner cannot decide", "NOT_PLATFORM_OWNER", async (sp) => {
      await sp`select set_config('request.jwt.claims', ${JSON.stringify({ sub: stoodDown, role: "authenticated" })}, true)`;
      await sp`select set_config('role', 'authenticated', true)`;
      await sp`select public.owner_decide_subscription_payment(${paymentId}, 'CONFIRM')`;
    });
    await refused(tx, "anonymous cannot even list the queue", "permission denied", async (sp) => {
      await sp`select set_config('role', 'anon', true)`;
      await sp`select public.owner_pending_payments()`;
    });

    // -----------------------------------------------------------------
    console.log("\n4. The review queue shows money, not medicine");

    const queue = await as(tx, owner, async () => {
      const [r] = await tx`select public.owner_pending_payments() as v`;
      return r.v;
    });
    check(queue.length === 1, "the owner sees the pending payment", `${queue.length}`);
    const keys = Object.keys(queue[0]);
    check(
      !keys.some((k) => /patient|encounter|prescription|diagnos|queue/i.test(k)),
      "no clinical field in the payload",
      keys.join(","),
    );
    check(
      !JSON.stringify(queue[0]).toLowerCase().includes("private patient"),
      "the doctor's patient does not appear",
    );

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
        outcome = e.message.includes("permission denied") ? "permission denied" : e.message.slice(0, 36);
      }
      check(outcome === "permission denied" || outcome === "0 row(s)", `owner cannot read ${table}`, outcome);
    }

    // -----------------------------------------------------------------
    console.log("\n5. Confirmation moves money, never medicine");

    /**
     * MEASURE FROM A FIXED VANTAGE POINT.
     *
     * A digest is only meaningful if both readings are taken by the same
     * observer. `tx.savepoint()` that RETURNS normally commits — including any
     * `set_config('role', ...)` inside it — so the clinical-read loop above
     * leaves the session as `authenticated`. The first reading was then taken
     * as the owner (who correctly sees zero patients) and the second as the
     * superuser (who sees one), and the "clinical data changed!" alarm was
     * entirely an artefact of the observer moving.
     *
     * Resetting the role here makes both readings unprivileged and comparable.
     */
    const clinicalDigest = async () => {
      await tx`select set_config('role', null, true)`;
      await tx`select set_config('request.jwt.claims', null, true)`;
      const [row] = await tx`
        select
          (select count(*) from public.patients where owner_doctor_id = ${doc.id}) as patients,
          (select coalesce(string_agg(patient_number, ',' order by patient_number), '')
             from public.patients where owner_doctor_id = ${doc.id}) as numbers,
          (select count(*) from public.appointments where owner_doctor_id = ${doc.id}) as appts`;
      return row;
    };
    const before = await clinicalDigest();

    const first = await as(tx, owner, async () => {
      const [r] = await tx`select public.owner_decide_subscription_payment(
        ${paymentId}, 'CONFIRM', 'Bank statement checked') as v`;
      return r.v;
    });
    check(first.changed === true && first.status === "CONFIRMED", "the owner confirmed it");

    const [paid] = await tx`select status, confirmed_at, recorded_by, note
                            from public.subscription_payments where id = ${paymentId}`;
    check(paid.status === "CONFIRMED", "status is CONFIRMED");
    check(paid.recorded_by === owner, "recorded_by names the deciding owner");
    check(paid.confirmed_at !== null, "confirmed_at is stamped");

    const [sub] = await tx`select s.status, s.current_period_start, s.current_period_end
                           from public.doctor_subscriptions s where s.doctor_profile_id = ${doc.id}`;
    check(sub.status === "ACTIVE", "the subscription is now ACTIVE", sub.status);
    check(sub.current_period_end > sub.current_period_start, "a period was set");

    const after = await clinicalDigest();
    check(sha(before) === sha(after), "THE INVARIANT: clinical digest unchanged by confirmation",
      `${before.patients} patient(s), ${before.appts} appointment(s) — unchanged`);
    const [stillThere] = await tx`select id from public.patients where id = ${patient.id}`;
    check(!!stillThere, "…and the patient is still there");

    const [audit] = await tx`select action, actor_id, meta from public.audit_events
                             where resource_id = ${paymentId}
                               and action = 'SUBSCRIPTION_PAYMENT_CONFIRMED'`;
    check(!!audit, "an audit row records the confirmation");
    check(audit?.actor_id === owner, "…by whom");
    check(audit?.meta?.fromStatus === "PENDING" && audit?.meta?.toStatus === "CONFIRMED",
      "…with old → new status");

    // -----------------------------------------------------------------
    console.log("\n6. Idempotence and the protection of history");

    const repeat = await as(tx, owner, async () => {
      const [r] = await tx`select public.owner_decide_subscription_payment(
        ${paymentId}, 'CONFIRM', 'again') as v`;
      return r.v;
    });
    check(repeat.changed === false, "repeating the confirmation changes nothing");
    const [{ n: auditRows }] = await tx`select count(*)::int as n from public.audit_events
                                        where resource_id = ${paymentId}`;
    check(auditRows === 1, "…and writes no duplicate audit row", `${auditRows}`);

    await refused(tx, "a confirmed payment cannot be flipped to rejected", "PAYMENT_ALREADY_DECIDED", async (sp) => {
      await sp`select set_config('request.jwt.claims', ${JSON.stringify({ sub: owner, role: "authenticated" })}, true)`;
      await sp`select set_config('role', 'authenticated', true)`;
      await sp`select public.owner_decide_subscription_payment(${paymentId}, 'REJECT', 'changed my mind')`;
    });

    // -----------------------------------------------------------------
    console.log("\n7. Rejection, and paying early");

    const second = await as(tx, doctor, async () => {
      const [r] = await tx`select public.submit_manual_subscription_payment(
        5000, 'BANK-REF-778', null) as id`;
      return r.id;
    });
    const rejected = await as(tx, owner, async () => {
      const [r] = await tx`select public.owner_decide_subscription_payment(
        ${second}, 'REJECT', 'Reference not found') as v`;
      return r.v;
    });
    check(rejected.status === "REJECTED", "a payment can be rejected");
    const [rej] = await tx`select status, confirmed_at from public.subscription_payments where id = ${second}`;
    check(rej.confirmed_at === null, "…and carries no confirmed_at");

    const [subAfterReject] = await tx`select status from public.doctor_subscriptions
                                      where doctor_profile_id = ${doc.id}`;
    check(subAfterReject.status === "ACTIVE", "rejection does not deactivate an active subscription");

    // Pay again while still active: the period should EXTEND, not restart.
    const [{ current_period_end: endBefore }] =
      await tx`select current_period_end from public.doctor_subscriptions where doctor_profile_id = ${doc.id}`;
    const third = await as(tx, doctor, async () => {
      const [r] = await tx`select public.submit_manual_subscription_payment(5000, 'BANK-REF-779', null) as id`;
      return r.id;
    });
    await as(tx, owner, () => tx`select public.owner_decide_subscription_payment(${third}, 'CONFIRM')`);
    const [{ current_period_end: endAfter }] =
      await tx`select current_period_end from public.doctor_subscriptions where doctor_profile_id = ${doc.id}`;
    check(
      new Date(endAfter) > new Date(endBefore),
      "paying early EXTENDS the period rather than restarting it",
      `${new Date(endBefore).toISOString().slice(0, 10)} → ${new Date(endAfter).toISOString().slice(0, 10)}`,
    );

    const finalDigest = await clinicalDigest();
    check(sha(finalDigest) === sha(before), "clinical digest still unchanged after three decisions");

    console.log("\n8. Rolling back");
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
  select count(*)::int as n from auth.users where email like 'pay.%@qa.invalid'`;
check(strays === 0, "no fixture identity survived", `${strays}`);

console.log(
  failures === 0
    ? "\nManual payment approval: all checks passed. Every row rolled back.\n"
    : `\n${failures} CHECK(S) FAILED.\n`,
);

await sql.end();
process.exit(failures === 0 ? 0 : 1);
