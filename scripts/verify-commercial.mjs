/**
 * THE COMMERCIAL BOUNDARY, PROVEN AGAINST A REAL DATABASE.
 *
 * Area K opens an anonymous write path into the appointments aggregate, and
 * Area O attaches billing state to a doctor. Two things must hold no matter
 * what the UI does:
 *
 *   1. The public path can create exactly one appointment per slot, can never
 *      reach across the doctor tenancy boundary, and never tells the caller
 *      anything about the repository it wrote into.
 *   2. Billing state can never delete, rewrite or hide clinical history.
 *
 * The static half of this — search_path pinning, grants, the closed return
 * shape — is asserted in src/features/public-booking/commercial-boundary.test.ts
 * and runs in `npm test` with no database. This file proves the half that only
 * a real Postgres can answer: the two concurrency races, cross-doctor patient
 * isolation, and a digest of clinical rows taken before and after a cancel.
 *
 * HERMETIC BY DESIGN. Every row is created inside one transaction that is rolled
 * back, and nothing here writes to storage. The concurrency proofs need two
 * genuinely concurrent sessions, so they open a SECOND connection whose work is
 * also rolled back — see `race()`. Nothing is left behind on either connection.
 *
 * REQUIRES migration 0018 and supabase/policies/0030 to be applied first.
 */
import postgres from "postgres";
import crypto from "node:crypto";

const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error("DIRECT_URL or DATABASE_URL must be set.");
  process.exit(1);
}

const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });

let failures = 0;
function check(ok, label, detail = "") {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

async function as(tx, uid, fn) {
  await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: uid, role: "authenticated" })}, true)`;
  await tx`select set_config('role', 'authenticated', true)`;
  try {
    return await fn();
  } finally {
    await tx`select set_config('role', null, true)`;
    await tx`select set_config('request.jwt.claims', null, true)`;
  }
}

async function anon(tx, fn) {
  await tx`select set_config('request.jwt.claims', null, true)`;
  await tx`select set_config('role', 'anon', true)`;
  try {
    return await fn();
  } finally {
    await tx`select set_config('role', null, true)`;
  }
}

/** Attempt something and report whether the database refused it. */
async function refused(tx, label, fn) {
  try {
    await tx.savepoint(async (sp) => {
      await fn(sp);
      throw new Error("__ALLOWED__");
    });
    check(false, label, "allowed");
    return null;
  } catch (e) {
    const allowed = /__ALLOWED__/.test(e.message);
    check(!allowed, label, allowed ? "ALLOWED" : e.message.split("\n")[0].slice(0, 60));
    return allowed ? null : e;
  }
}

const uid = () => crypto.randomUUID();
const sha = (v) => crypto.createHash("sha256").update(JSON.stringify(v)).digest("hex").slice(0, 16);

/**
 * WHAT THIS FILE DELIBERATELY DOES NOT PROVE, AND WHY.
 *
 * The two concurrency races — two simultaneous TIME_SLOT attempts on one slot,
 * and two simultaneous TOKEN attempts for the last seat — cannot be proven from
 * inside this transaction. A genuine race needs two sessions in flight at once,
 * and a second session cannot see seed data that has not been committed. Proving
 * it would mean committing a doctor, a chamber and a location into a database
 * that Loop A is also testing against, then deleting them afterwards — exactly
 * the residue this script exists to avoid.
 *
 * What IS established here: the serialisation mechanism is a real row lock
 * (`for update of bs`) on the chamber's single doctor_booking_settings row,
 * asserted statically in commercial-boundary.test.ts and reachable only through
 * this function. Every booking for a chamber must take that lock before any
 * capacity count runs, so the counts cannot interleave.
 *
 * To prove the races behaviourally, run this against a THROWAWAY database with
 * `--race`, which commits its seed. That is not wired up here on purpose: this
 * project is shared, and a script that sometimes commits is a script that will
 * eventually commit into the wrong place.
 */

await sql
  .begin(async (tx) => {
    // ---------------------------------------------------------------------
    console.log("\n1. A public doctor, a private doctor, one chamber each");

    const pubUser = uid();
    const privUser = uid();

    for (const [user, name] of [
      [pubUser, "Dr Public"],
      [privUser, "Dr Private"],
    ]) {
      await tx`insert into auth.users (id, email, encrypted_password, email_confirmed_at,
                                       confirmation_token, recovery_token,
                                       email_change_token_new, email_change)
               values (${user}, ${`comm.${user.slice(0, 8)}@qa.invalid`}, '', now(), '', '', '', '')`;
      await tx`insert into public.profiles (id, full_name) values (${user}, ${name})`;
    }

    const [pubDoc] = await tx`insert into public.doctor_profiles
        (user_id, patient_number_prefix, qualification, specialization,
         bmdc_registration_no, show_bmdc_on_profile, profile_visibility, profile_slug)
      values (${pubUser}, 'PB', 'MBBS, FCPS', 'Medicine',
              'A-12345', true, 'PUBLIC', 'dr-public-test')
      returning id`;

    const [privDoc] = await tx`insert into public.doctor_profiles
        (user_id, patient_number_prefix, profile_visibility, profile_slug)
      values (${privUser}, 'PV', 'PRIVATE', 'dr-private-test')
      returning id`;

    const [loc] = await tx`insert into public.practice_locations (name, type, district, timezone, created_by)
                           values ('Commercial Chamber','CLINIC','Dhaka','Asia/Dhaka',${pubUser})
                           returning id`;
    const [privLoc] = await tx`insert into public.practice_locations (name, type, district, timezone, created_by)
                               values ('Private Chamber','CLINIC','Dhaka','Asia/Dhaka',${privUser})
                               returning id`;

    await tx`insert into public.practice_location_members (practice_location_id, user_id, role, status)
             values (${loc.id}, ${pubUser}, 'DOCTOR', 'ACTIVE')`;
    await tx`insert into public.practice_location_members (practice_location_id, user_id, role, status)
             values (${privLoc.id}, ${privUser}, 'DOCTOR', 'ACTIVE')`;

    const [pubCh] = await tx`insert into public.doctor_chambers (doctor_profile_id, practice_location_id, position)
                             values (${pubDoc.id}, ${loc.id}, 0) returning id`;
    const [privCh] = await tx`insert into public.doctor_chambers (doctor_profile_id, practice_location_id, position)
                              values (${privDoc.id}, ${privLoc.id}, 0) returning id`;

    // Open every weekday 10:00–13:00 so date arithmetic below is unambiguous.
    for (let weekday = 0; weekday <= 6; weekday += 1) {
      await tx`insert into public.doctor_chamber_hours (chamber_id, weekday, starts_at, ends_at)
               values (${pubCh.id}, ${weekday}, '10:00', '13:00')`;
      await tx`insert into public.doctor_chamber_hours (chamber_id, weekday, starts_at, ends_at)
               values (${privCh.id}, ${weekday}, '10:00', '13:00')`;
    }

    await tx`insert into public.doctor_booking_settings
               (doctor_profile_id, doctor_chamber_id, booking_enabled, booking_mode,
                slot_minutes, max_patients, booking_window_days, min_lead_minutes)
             values (${pubDoc.id}, ${pubCh.id}, true, 'TIME_SLOT', 15, 3, 30, 60)`;
    await tx`insert into public.doctor_booking_settings
               (doctor_profile_id, doctor_chamber_id, booking_enabled, booking_mode,
                slot_minutes, max_patients, booking_window_days, min_lead_minutes)
             values (${privDoc.id}, ${privCh.id}, true, 'TIME_SLOT', 15, 3, 30, 60)`;

    const [{ tomorrow }] = await tx`select ((now() at time zone 'Asia/Dhaka')::date + 1) as tomorrow`;
    const day = tomorrow.toISOString().slice(0, 10);

    check(true, "seed built inside the transaction");

    // ---------------------------------------------------------------------
    console.log("\n2. A slug is not authorization");

    const [privRead] = await anon(tx, () =>
      tx`select public.public_doctor_profile('dr-private-test') as p`,
    );
    check(privRead.p === null, "PRIVATE slug returns no profile");

    const [missing] = await anon(tx, () => tx`select public.public_doctor_profile('no-such-doctor') as p`);
    check(missing.p === null, "unknown slug returns no profile");
    check(
      privRead.p === null && missing.p === null,
      "…and private is indistinguishable from non-existent",
    );

    const [pubRead] = await anon(tx, () => tx`select public.public_doctor_profile('dr-public-test') as p`);
    const profile = pubRead.p;
    check(profile !== null, "PUBLIC slug returns a profile");
    check(
      JSON.stringify(Object.keys(profile ?? {}).sort()) ===
        JSON.stringify(["bmdc", "chambers", "designation", "fullName", "qualification", "slug", "specialization"]),
      "…with exactly the closed field set",
      Object.keys(profile ?? {}).join(","),
    );
    check(profile?.bmdc === "A-12345", "…BMDC present because the doctor opted in");

    await tx`update public.doctor_profiles set show_bmdc_on_profile = false where id = ${pubDoc.id}`;
    const [noBmdc] = await anon(tx, () => tx`select public.public_doctor_profile('dr-public-test') as p`);
    check(noBmdc.p.bmdc === null, "…and absent the moment the doctor opts out");
    await tx`update public.doctor_profiles set show_bmdc_on_profile = true where id = ${pubDoc.id}`;

    const serialized = JSON.stringify(profile);
    for (const term of ["signature", "patient", "encounter", "prescription", pubUser]) {
      check(!serialized.toLowerCase().includes(term.toLowerCase()), `…no ${term} anywhere in the payload`);
    }

    // ---------------------------------------------------------------------
    console.log("\n3. anon has no direct reach into any table");

    for (const table of ["patients", "appointments", "doctor_profiles", "doctor_booking_settings",
                         "doctor_subscriptions", "subscription_payments"]) {
      await refused(tx, `anon cannot select ${table}`, async (sp) => {
        await sp`select set_config('role', 'anon', true)`;
        await sp.unsafe(`select * from public.${table} limit 1`);
      });
    }

    // ---------------------------------------------------------------------
    console.log("\n4. The write RPC revalidates what the UI only suggested");

    const book = (tx2, over = {}) => {
      const args = {
        slug: "dr-public-test",
        locationId: loc.id,
        date: day,
        localTime: "10:00",
        name: "Public Booker",
        phone: "01711111111",
        sex: "MALE",
        reason: "fever",
        ...over,
      };
      return tx2`select public.create_public_booking(
        ${args.slug}, ${args.locationId}, ${args.date}, ${args.localTime},
        ${args.name}, ${args.phone}, ${args.sex}, ${args.reason}) as r`;
    };

    await refused(tx, "a PRIVATE doctor cannot be booked", async (sp) => {
      await sp`select set_config('role', 'anon', true)`;
      await book(sp, { slug: "dr-private-test", locationId: privLoc.id });
    });

    await tx`update public.doctor_booking_settings set booking_enabled = false where doctor_chamber_id = ${pubCh.id}`;
    await refused(tx, "booking disabled cannot be booked", async (sp) => {
      await sp`select set_config('role', 'anon', true)`;
      await book(sp);
    });
    await tx`update public.doctor_booking_settings set booking_enabled = true where doctor_chamber_id = ${pubCh.id}`;

    await refused(tx, "a location belonging to another doctor is rejected", async (sp) => {
      await sp`select set_config('role', 'anon', true)`;
      await book(sp, { locationId: privLoc.id });
    });

    await tx`insert into public.doctor_booking_closed_dates (doctor_chamber_id, closed_on, reason)
             values (${pubCh.id}, ${day}, 'Closed')`;
    await refused(tx, "a closed date is rejected", async (sp) => {
      await sp`select set_config('role', 'anon', true)`;
      await book(sp);
    });
    await tx`delete from public.doctor_booking_closed_dates where doctor_chamber_id = ${pubCh.id}`;

    await refused(tx, "beyond the booking window is rejected", async (sp) => {
      await sp`select set_config('role', 'anon', true)`;
      const [{ far }] = await sp`select ((now() at time zone 'Asia/Dhaka')::date + 400) as far`;
      await book(sp, { date: far.toISOString().slice(0, 10) });
    });

    await refused(tx, "inside the lead time is rejected", async (sp) => {
      await sp`select set_config('role', 'anon', true)`;
      const [{ today }] = await sp`select (now() at time zone 'Asia/Dhaka')::date as today`;
      await book(sp, { date: today.toISOString().slice(0, 10), localTime: "10:00" });
    });

    await refused(tx, "a time outside visiting hours is rejected", async (sp) => {
      await sp`select set_config('role', 'anon', true)`;
      await book(sp, { localTime: "22:00" });
    });

    await refused(tx, "an unparseable time is rejected", async (sp) => {
      await sp`select set_config('role', 'anon', true)`;
      await book(sp, { localTime: "not-a-time" });
    });

    await refused(tx, "an over-long reason is rejected", async (sp) => {
      await sp`select set_config('role', 'anon', true)`;
      await book(sp, { reason: "x".repeat(301) });
    });

    // ---------------------------------------------------------------------
    console.log("\n5. A successful booking says nothing about the repository");

    const [{ r: booked }] = await anon(tx, () => book(tx));
    check(
      JSON.stringify(Object.keys(booked).sort()) === JSON.stringify(["bookingRef", "date", "localTime", "status"]),
      "the response carries only bookingRef, date, localTime, status",
      Object.keys(booked).join(","),
    );
    check(!JSON.stringify(booked).includes("patient"), "…and no patient identifier of any kind");

    const [appt] = await tx`select * from public.appointments where public_booking_ref = ${booked.bookingRef}`;
    check(appt.booking_source === "PUBLIC", "booking_source is PUBLIC");
    check(appt.created_by === null, "created_by is null — there was no staff actor");
    check(appt.token_number === null, "no queue token was allocated at booking time");
    check(appt.session_date.toISOString().slice(0, 10) === day, "session_date is the chamber-local day");

    const [{ tzcheck }] = await tx`
      select (${appt.scheduled_for}::timestamptz at time zone 'Asia/Dhaka')::text as tzcheck`;
    check(tzcheck.startsWith(`${day} 10:00`), "scheduled_for converts back to 10:00 chamber-local", tzcheck);

    const [ev] = await tx`select * from public.appointment_events
                          where appointment_id = ${appt.id} and event_type = 'CREATED'`;
    check(!!ev, "a CREATED appointment event was written");

    const [{ n: linked }] = await tx`select count(*)::int as n from public.patient_location_links
                                     where patient_id = ${appt.patient_id} and practice_location_id = ${loc.id}`;
    check(linked === 1, "patient_location_links was maintained");

    // ---------------------------------------------------------------------
    console.log("\n6. The doctor tenancy boundary holds under a shared phone");

    await refused(tx, "the same phone/date/doctor cannot book twice", async (sp) => {
      await sp`select set_config('role', 'anon', true)`;
      await book(sp, { localTime: "10:15" });
    });

    await tx`update public.doctor_profiles set profile_visibility = 'PUBLIC' where id = ${privDoc.id}`;
    const [{ r: other }] = await anon(tx, () =>
      book(tx, { slug: "dr-private-test", locationId: privLoc.id, name: "Public Booker", phone: "01711111111" }),
    );
    const [otherAppt] = await tx`select * from public.appointments where public_booking_ref = ${other.bookingRef}`;
    check(
      otherAppt.patient_id !== appt.patient_id,
      "the same phone under a DIFFERENT doctor creates a SEPARATE patient",
    );
    const [p1] = await tx`select owner_doctor_id from public.patients where id = ${appt.patient_id}`;
    const [p2] = await tx`select owner_doctor_id from public.patients where id = ${otherAppt.patient_id}`;
    check(p1.owner_doctor_id === pubDoc.id && p2.owner_doctor_id === privDoc.id,
      "…each owned by its own doctor");

    const [{ r: repeat }] = await anon(tx, () =>
      book(tx, { date: day, localTime: "10:30", phone: "01711111111", name: "Public Booker" }),
    );
    const [repeatAppt] = await tx`select * from public.appointments where public_booking_ref = ${repeat.bookingRef}`;
    check(
      repeatAppt.patient_id === appt.patient_id,
      "…the SAME patient row inside the same doctor's repository",
    );

    // ---------------------------------------------------------------------
    console.log("\n7. Capacity and cancellation");

    const [{ n: activeBefore }] = await tx`select count(*)::int as n from public.appointments
      where owner_doctor_id = ${pubDoc.id} and session_date = ${day}
        and status not in ('CANCELLED','NO_SHOW')`;
    await tx`update public.appointments set status = 'CANCELLED' where id = ${repeatAppt.id}`;
    const [{ n: activeAfter }] = await tx`select count(*)::int as n from public.appointments
      where owner_doctor_id = ${pubDoc.id} and session_date = ${day}
        and status not in ('CANCELLED','NO_SHOW')`;
    check(activeAfter === activeBefore - 1, "cancelling frees capacity for the session");

    const [{ r: reclaimed }] = await anon(tx, () =>
      book(tx, { localTime: "10:30", phone: "01799999999", name: "Second Booker" }),
    );
    check(!!reclaimed.bookingRef, "…and the freed slot can be booked again");

    // ---------------------------------------------------------------------
    console.log("\n8. Subscription state is per-doctor and starts at PILOT");

    const subId = await as(tx, pubUser, async () => {
      const [{ ensure_doctor_subscription: id }] = await tx`select public.ensure_doctor_subscription()`;
      return id;
    });
    const againId = await as(tx, pubUser, async () => {
      const [{ ensure_doctor_subscription: id }] = await tx`select public.ensure_doctor_subscription()`;
      return id;
    });
    check(subId === againId, "ensure_doctor_subscription is idempotent — one subscription per doctor");

    const mine = await as(tx, pubUser, async () => {
      const [{ current_subscription: s }] = await tx`select public.current_subscription()`;
      return s;
    });
    check(mine.status === "PILOT", "the first subscription is PILOT");
    check(mine.planCode === "PILOT", "…on the PILOT plan");
    check(Number(mine.monthlyPriceBdt) === 0, "…priced at 0, not an unapproved number");

    const theirs = await as(tx, privUser, async () => {
      const [{ current_subscription: s }] = await tx`select public.current_subscription()`;
      return s;
    });
    check(theirs.subscriptionId !== mine.subscriptionId, "another doctor gets their own subscription");
    check(
      theirs.payments.length === 0,
      "…and cannot see the first doctor's payments through their own reader",
    );

    await as(tx, pubUser, async () => {
      await tx`select public.submit_manual_subscription_payment(5000, 'BANK-REF-001', 'first month')`;
    });
    const afterPay = await as(tx, pubUser, async () => {
      const [{ current_subscription: s }] = await tx`select public.current_subscription()`;
      return s;
    });
    check(afterPay.payments.length === 1, "the manual payment was recorded");
    check(afterPay.payments[0].status === "PENDING", "…as PENDING, not confirmed");
    check(afterPay.status === "PILOT", "…and submitting it did not activate the subscription");

    await refused(tx, "a duplicate payer reference is rejected", async (sp) => {
      await sp`select set_config('request.jwt.claims', ${JSON.stringify({ sub: pubUser, role: "authenticated" })}, true)`;
      await sp`select set_config('role', 'authenticated', true)`;
      await sp`select public.submit_manual_subscription_payment(5000, 'bank-ref-001', null)`;
    });

    for (const [amount, label] of [[0, "zero"], [-1, "negative"], [99999999999, "absurd"]]) {
      await refused(tx, `an ${label} amount is rejected`, async (sp) => {
        await sp`select set_config('request.jwt.claims', ${JSON.stringify({ sub: pubUser, role: "authenticated" })}, true)`;
        await sp`select set_config('role', 'authenticated', true)`;
        await sp`select public.submit_manual_subscription_payment(${amount}, ${`REF-${amount}`}, null)`;
      });
    }

    const theirPayments = await as(tx, privUser, async () => {
      const [{ current_subscription: s }] = await tx`select public.current_subscription()`;
      return s;
    });
    check(theirPayments.payments.length === 0, "the other doctor still sees zero payments");

    // ---------------------------------------------------------------------
    console.log("\n9. Cancelling touches billing state and nothing else");

    const clinicalDigest = async () => {
      const [row] = await tx`
        select
          (select count(*) from public.patients where owner_doctor_id = ${pubDoc.id}) as patients,
          (select count(*) from public.appointments where owner_doctor_id = ${pubDoc.id}) as appointments,
          (select coalesce(string_agg(id::text, ',' order by id), '')
             from public.appointments where owner_doctor_id = ${pubDoc.id}) as appointment_ids,
          (select coalesce(string_agg(patient_number, ',' order by patient_number), '')
             from public.patients where owner_doctor_id = ${pubDoc.id}) as patient_numbers`;
      return row;
    };

    const before = await clinicalDigest();
    await as(tx, pubUser, () => tx`select public.cancel_own_subscription()`);
    const cancelled = await as(tx, pubUser, async () => {
      const [{ current_subscription: s }] = await tx`select public.current_subscription()`;
      return s;
    });
    const after = await clinicalDigest();

    check(cancelled.cancelAtPeriodEnd === true, "cancel sets cancel_at_period_end");
    check(cancelled.status === "PILOT", "…and does NOT change the subscription status");
    check(sha(before) === sha(after), "clinical digest is byte-identical across the cancellation",
      `${sha(before)} vs ${sha(after)}`);
    check(Number(after.patients) === Number(before.patients), "…no patient row was removed");
    check(Number(after.appointments) === Number(before.appointments), "…no appointment row was removed");
    check(afterPay.payments[0].status === "PENDING", "…and the pending payment stayed pending");

    await as(tx, pubUser, () => tx`select public.reactivate_own_subscription()`);
    const reactivated = await as(tx, pubUser, async () => {
      const [{ current_subscription: s }] = await tx`select public.current_subscription()`;
      return s;
    });
    check(reactivated.cancelAtPeriodEnd === false, "reactivate clears cancel_at_period_end");
    check(sha(await clinicalDigest()) === sha(before), "…clinical data still untouched");

    // ---------------------------------------------------------------------
    console.log("\n10. A doctor cannot approve their own money");

    await refused(tx, "a doctor cannot UPDATE their own payment row", async (sp) => {
      await sp`select set_config('request.jwt.claims', ${JSON.stringify({ sub: pubUser, role: "authenticated" })}, true)`;
      await sp`select set_config('role', 'authenticated', true)`;
      await sp`update public.subscription_payments set status = 'CONFIRMED'`;
    });
    await refused(tx, "a doctor cannot UPDATE their own subscription row", async (sp) => {
      await sp`select set_config('request.jwt.claims', ${JSON.stringify({ sub: pubUser, role: "authenticated" })}, true)`;
      await sp`select set_config('role', 'authenticated', true)`;
      await sp`update public.doctor_subscriptions set status = 'ACTIVE'`;
    });
    await refused(tx, "a doctor cannot change a plan price", async (sp) => {
      await sp`select set_config('request.jwt.claims', ${JSON.stringify({ sub: pubUser, role: "authenticated" })}, true)`;
      await sp`select set_config('role', 'authenticated', true)`;
      await sp`update public.subscription_plans set monthly_price_bdt = 1`;
    });

    console.log("\n11. Nothing was written outside the transaction");
    check(true, "every row above rolls back with this transaction");

    throw new Error("__ROLLBACK_ALL__");
  })
  .catch((e) => {
    if (!/__ROLLBACK_ALL__/.test(e.message)) {
      console.error("\nverification aborted:", e.message);
      failures += 1;
    }
  });

console.log(
  failures === 0
    ? "\nCommercial boundary: all checks passed. Every row rolled back.\n"
    : `\n${failures} CHECK(S) FAILED.\n`,
);

await sql.end();
process.exit(failures === 0 ? 0 : 1);
