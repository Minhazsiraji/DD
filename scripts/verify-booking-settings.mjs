/**
 * BOOKING SETTINGS — the doctor's control over an anonymous write path.
 *
 * Enabling public booking is the single switch that lets strangers create rows
 * in a doctor's appointment book. Two properties matter most:
 *
 *   • Only a doctor who is ACTIVE at that location may open it — and anyone
 *     who owns the chamber may always close it again.
 *   • Closing it stops future exposure without touching a single appointment
 *     that already exists.
 *
 * HERMETIC. Migration and policies are applied inside one transaction in
 * deployment order, everything is proven, and the whole thing is rolled back.
 * Nothing installed, no row survives, db:policies never run.
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

const BASE_POLICY = "supabase/policies/0030_paid_doctor_commercial.sql";
const HARDENING = "supabase/policies/0036_booking_settings_hardening.sql";

const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });

let failures = 0;
function check(ok, label, detail = "") {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

const uid = () => crypto.randomUUID();

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

const save = (tx, chamber, enabled, over = {}) => {
  const a = { mode: "TIME_SLOT", slot: 15, max: 20, window: 30, lead: 0, ...over };
  return tx`select public.save_doctor_booking_settings(
    ${chamber}, ${enabled}, ${a.mode}, ${a.slot}, ${a.max}, ${a.window}, ${a.lead}, null, 'BDT')`;
};

await sql
  .begin(async (tx) => {
    console.log("\n1. Policies applied in order");
    await tx.unsafe(await readFile(path.resolve(BASE_POLICY), "utf8"));
    await tx.unsafe(await readFile(path.resolve(HARDENING), "utf8"));
    check(true, "0030 then 0036");

    // -----------------------------------------------------------------
    console.log("\n2. Two doctors, one departed membership, one receptionist");

    const drA = uid();
    const drB = uid();
    const gone = uid();
    const desk = uid();

    for (const [id, name] of [
      [drA, "Dr A"],
      [drB, "Dr B"],
      [gone, "Dr Departed"],
      [desk, "Reception"],
    ]) {
      await tx`insert into auth.users (id, email, encrypted_password, email_confirmed_at,
                                       confirmation_token, recovery_token,
                                       email_change_token_new, email_change)
               values (${id}, ${`bset.${id.slice(0, 8)}@qa.invalid`}, '', now(), '', '', '', '')`;
      await tx`insert into public.profiles (id, full_name) values (${id}, ${name})`;
    }

    const [profA] = await tx`insert into public.doctor_profiles (user_id, patient_number_prefix, profile_visibility, profile_slug)
                             values (${drA}, 'BA', 'PRIVATE', 'dr-bset-a') returning id`;
    const [profB] = await tx`insert into public.doctor_profiles (user_id, patient_number_prefix, profile_visibility)
                             values (${drB}, 'BB', 'PRIVATE') returning id`;
    const [profGone] = await tx`insert into public.doctor_profiles (user_id, patient_number_prefix, profile_visibility)
                                values (${gone}, 'BG', 'PRIVATE') returning id`;

    const [loc] = await tx`insert into public.practice_locations (name, type, district, timezone, created_by)
                           values ('Settings Chamber','CLINIC','Dhaka','Asia/Dhaka',${drA}) returning id`;
    const [locB] = await tx`insert into public.practice_locations (name, type, district, timezone, created_by)
                            values ('Other Chamber','CLINIC','Dhaka','Asia/Dhaka',${drB}) returning id`;

    await tx`insert into public.practice_location_members (practice_location_id, user_id, role, status)
             values (${loc.id}, ${drA}, 'DOCTOR', 'ACTIVE')`;
    await tx`insert into public.practice_location_members (practice_location_id, user_id, role, status)
             values (${loc.id}, ${desk}, 'RECEPTIONIST', 'ACTIVE')`;
    await tx`insert into public.practice_location_members (practice_location_id, user_id, role, status)
             values (${locB.id}, ${drB}, 'DOCTOR', 'ACTIVE')`;
    /*
     * The departed doctor still OWNS the chamber — that is a historical fact
     * and does not expire. What has expired is the membership. `member_status`
     * is INVITED | ACTIVE | SUSPENDED, so SUSPENDED is what "no longer
     * practising here" looks like in this schema.
     */
    const [locGone] = await tx`insert into public.practice_locations (name, type, district, timezone, created_by)
                               values ('Left Chamber','CLINIC','Dhaka','Asia/Dhaka',${gone}) returning id`;
    await tx`insert into public.practice_location_members (practice_location_id, user_id, role, status)
             values (${locGone.id}, ${gone}, 'DOCTOR', 'SUSPENDED')`;

    const [chA] = await tx`insert into public.doctor_chambers (doctor_profile_id, practice_location_id, position)
                           values (${profA.id}, ${loc.id}, 0) returning id`;
    const [chB] = await tx`insert into public.doctor_chambers (doctor_profile_id, practice_location_id, position)
                           values (${profB.id}, ${locB.id}, 0) returning id`;
    const [chGone] = await tx`insert into public.doctor_chambers (doctor_profile_id, practice_location_id, position)
                              values (${profGone.id}, ${locGone.id}, 0) returning id`;

    for (const ch of [chA.id, chB.id, chGone.id]) {
      for (let w = 0; w <= 6; w += 1) {
        await tx`insert into public.doctor_chamber_hours (chamber_id, weekday, starts_at, ends_at)
                 values (${ch}, ${w}, '10:00', '13:00')`;
      }
    }
    check(true, "seeded");

    // -----------------------------------------------------------------
    console.log("\n3. Write authority (1, 2, 3, 4, 5, 8, 9)");

    await refused(tx, "anonymous cannot write settings", "permission denied", async (sp) => {
      await sp`select set_config('role', 'anon', true)`;
      await save(sp, chA.id, true);
    });

    await refused(tx, "a receptionist cannot configure booking", "DOCTOR_REQUIRED", async (sp) => {
      await sp`select set_config('request.jwt.claims', ${JSON.stringify({ sub: desk, role: "authenticated" })}, true)`;
      await sp`select set_config('role', 'authenticated', true)`;
      await save(sp, chA.id, true);
    });

    await refused(tx, "Dr B cannot enable Dr A's chamber", "CHAMBER_NOT_FOUND", async (sp) => {
      await sp`select set_config('request.jwt.claims', ${JSON.stringify({ sub: drB, role: "authenticated" })}, true)`;
      await sp`select set_config('role', 'authenticated', true)`;
      await save(sp, chA.id, true);
    });

    await refused(tx, "an unrelated chamber id is rejected", "CHAMBER_NOT_FOUND", async (sp) => {
      await sp`select set_config('request.jwt.claims', ${JSON.stringify({ sub: drA, role: "authenticated" })}, true)`;
      await sp`select set_config('role', 'authenticated', true)`;
      await save(sp, uid(), true);
    });

    /* GAP A — the hole this file closes. */
    await refused(tx, "GAP A: a departed doctor cannot ENABLE booking", "NOT_ACTIVE_AT_LOCATION", async (sp) => {
      await sp`select set_config('request.jwt.claims', ${JSON.stringify({ sub: gone, role: "authenticated" })}, true)`;
      await sp`select set_config('role', 'authenticated', true)`;
      await save(sp, chGone.id, true);
    });

    const canDisable = await as(tx, gone, async () => {
      const [r] = await save(tx, chGone.id, false);
      return !!r;
    });
    check(canDisable, "…but CAN still disable it — the exit is never locked");

    const savedA = await as(tx, drA, async () => {
      const [r] = await save(tx, chA.id, true);
      return r.save_doctor_booking_settings;
    });
    check(!!savedA, "Dr A enables their own chamber");

    // -----------------------------------------------------------------
    console.log("\n4. Audit (10)");

    /*
     * SELECT BY ACTION, NEVER BY RECENCY. `audit_events.occurred_at` defaults
     * to now(), which is TRANSACTION start — every row this script writes
     * carries an identical timestamp, so `order by occurred_at desc limit 1`
     * returns an arbitrary one. An earlier version of this check did exactly
     * that and reported the wrong row. CLAUDE.md names this trap; it defeats
     * recency assertions silently, passing against right and wrong code alike.
     */
    const [audit] = await tx`select action, actor_id, practice_location_id, resource_type, meta
                             from public.audit_events
                             where resource_id = ${savedA} and action = 'PUBLIC_BOOKING_ENABLED'`;
    check(!!audit, "GAP B: the moment it opened is recorded", audit?.action);
    check(audit?.actor_id === drA, "…by whom");
    check(audit?.practice_location_id === loc.id, "…and where");
    check(audit?.meta?.nowEnabled === true && audit?.meta?.wasEnabled === null, "…with before/after state");

    await as(tx, drA, () => save(tx, chA.id, true, { slot: 20 }));
    const [{ n: tuned }] = await tx`select count(*)::int as n from public.audit_events
                                    where resource_id = ${savedA} and action = 'BOOKING_SETTINGS_UPDATED'`;
    check(tuned === 1, "tuning is distinguished from opening the door", `${tuned} update row(s)`);

    // -----------------------------------------------------------------
    console.log("\n5. Public behaviour (6, 7, 11, 12)");

    const [{ vis: visBefore }] = await tx`select profile_visibility as vis from public.doctor_profiles where id = ${profA.id}`;
    await tx`update public.doctor_profiles set profile_visibility = 'PUBLIC' where id = ${profA.id}`;

    const [{ tomorrow }] = await tx`select ((now() at time zone 'Asia/Dhaka')::date + 1) as tomorrow`;
    const day = tomorrow.toISOString().slice(0, 10);

    await tx`select set_config('role', 'anon', true)`;
    const [{ slots: enabledSlots }] = await tx`
      select public.public_booking_slots('dr-bset-a', ${loc.id}, ${day}) as slots`;
    await tx`select set_config('role', null, true)`;
    check(Array.isArray(enabledSlots) && enabledSlots.length > 0, "enabled → slots are offered", `${enabledSlots?.length}`);

    // A real public appointment, so disabling has something to preserve.
    await tx`select set_config('role', 'anon', true)`;
    const [{ r: booked }] = await tx`select public.create_public_booking(
      'dr-bset-a', ${loc.id}, ${day}, '10:00', 'Booked Before', '01712000000', 'MALE', null) as r`;
    await tx`select set_config('role', null, true)`;
    check(!!booked?.bookingRef, "a patient books while it is open");

    const [appt] = await tx`select id, status, token_number from public.appointments
                            where public_booking_ref = ${booked.bookingRef}`;
    check(appt.token_number === null, "no queue token at booking (11)");

    await as(tx, drA, () => save(tx, chA.id, false));
    await tx`select set_config('role', 'anon', true)`;
    const [{ slots: offSlots }] = await tx`
      select public.public_booking_slots('dr-bset-a', ${loc.id}, ${day}) as slots`;
    await tx`select set_config('role', null, true)`;
    check(Array.isArray(offSlots) && offSlots.length === 0, "disabled → no future availability", `${offSlots?.length}`);

    await refused(tx, "…and a new public booking is refused", "BOOKING_NOT_AVAILABLE", async (sp) => {
      await sp`select set_config('role', 'anon', true)`;
      await sp`select public.create_public_booking('dr-bset-a', ${loc.id}, ${day}, '10:15',
        'After Close', '01712000001', 'MALE', null)`;
    });

    const [survivor] = await tx`select id, status from public.appointments where id = ${appt.id}`;
    check(
      survivor && survivor.status === appt.status,
      "THE INVARIANT: the existing appointment survives disable, unchanged",
      survivor ? survivor.status : "GONE",
    );

    const [{ vis: visAfter }] = await tx`select profile_visibility as vis from public.doctor_profiles where id = ${profA.id}`;
    check(visAfter === "PUBLIC", "visibility is whatever the doctor set — not touched by enable/disable", `${visBefore} → ${visAfter}`);

    // -----------------------------------------------------------------
    console.log("\n6. Capacity, lead time and timezone still apply (10, 11)");

    await as(tx, drA, () => save(tx, chA.id, true, { max: 1, lead: 10080 }));
    await refused(tx, "a seven-day lead time refuses tomorrow", "TOO_SOON", async (sp) => {
      await sp`select set_config('role', 'anon', true)`;
      await sp`select public.create_public_booking('dr-bset-a', ${loc.id}, ${day}, '10:30',
        'Too Soon', '01712000002', 'MALE', null)`;
    });

    /*
     * max_patients is a DAILY cap and only bites in TOKEN mode — TIME_SLOT
     * capacity is per slot, so 10:30 is a different slot and rightly allowed.
     * An earlier version tested this in TIME_SLOT and read the correct answer
     * as a failure. Switch modes to test the setting that is actually a cap.
     */
    await as(tx, drA, () => save(tx, chA.id, true, { mode: "TOKEN", max: 1, lead: 0 }));
    await refused(tx, "TOKEN capacity of 1 is used by the surviving booking", "SESSION_FULL", async (sp) => {
      await sp`select set_config('role', 'anon', true)`;
      await sp`select public.create_public_booking('dr-bset-a', ${loc.id}, ${day}, '10:00',
        'Over Capacity', '01712000003', 'MALE', null)`;
    });

    const [{ tz }] = await tx`select (${appt.id}::uuid is not null) as tz`;
    const [sched] = await tx`select (scheduled_for at time zone 'Asia/Dhaka')::text as local,
                                    session_date::text as day
                             from public.appointments where id = ${appt.id}`;
    check(tz && sched.local.startsWith(`${day} 10:00`), "timezone still correct", sched.local);
    check(sched.day === day, "session_date is the chamber-local day");

    // -----------------------------------------------------------------
    console.log("\n7. No clinical data through settings (7)");

    const cfg = await as(tx, drA, async () => {
      const [r] = await tx`select public.doctor_booking_config() as v`;
      return JSON.stringify(r.v).toLowerCase();
    });
    /*
     * Match identifiers a patient record would carry, not the bare word
     * "patient" — `maxPatients` is a capacity setting and legitimately
     * contains it. A test that cannot tell a cap from a person reports a leak
     * that is not there, and would push someone to rename a correct field.
     */
    for (const term of [
      "patientid",
      "patientname",
      "patient_number",
      "phone",
      "encounter",
      "prescription",
      "diagnos",
      "token_number",
    ]) {
      check(!cfg.includes(term), `config exposes no ${term}`);
    }

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
  select count(*)::int as n from auth.users where email like 'bset.%@qa.invalid'`;
check(strays === 0, "no fixture identity survived", `${strays}`);

console.log(
  failures === 0
    ? "\nBooking settings: all checks passed. Every row rolled back.\n"
    : `\n${failures} CHECK(S) FAILED.\n`,
);

await sql.end();
process.exit(failures === 0 ? 0 : 1);
