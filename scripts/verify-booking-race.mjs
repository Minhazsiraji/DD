/**
 * THE BOOKING RACE, PROVEN WITH TWO REAL CONNECTIONS.
 *
 * Everything else about Area K can be proven inside a rolled-back transaction.
 * This cannot. A race needs two sessions in flight at the same instant, and a
 * second session cannot see seed data that has not been committed — so this
 * script COMMITS its fixture, races against it, and then removes it.
 *
 * That makes it the one script here that can leave residue, so it is built
 * around that risk rather than ignoring it:
 *
 *   • Every row it creates carries one run id, printed at startup.
 *   • Cleanup runs in `finally`, and again on SIGINT/SIGTERM.
 *   • `--cleanup <runId>` removes an abandoned run without racing anything.
 *   • Accounts use `@qa.invalid`, the same provenance db:gate asserts against,
 *     so an orphan is loud rather than quiet.
 *
 * If this script is killed between COMMIT and cleanup — a command timeout, a
 * closed laptop — run `--cleanup <runId>` with the id it printed. That is not a
 * theoretical concern: it is exactly how the last stray fixture in this project
 * came to exist.
 *
 * REQUIRES migration 0018 and supabase/policies/0030 applied.
 */
import postgres from "postgres";
import crypto from "node:crypto";

const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error("DIRECT_URL or DATABASE_URL must be set.");
  process.exit(1);
}

const cleanupFlag = process.argv.indexOf("--cleanup");
const cleanupOnly = cleanupFlag !== -1 ? process.argv[cleanupFlag + 1] : null;
const RUN = cleanupOnly ?? `race-${crypto.randomUUID().slice(0, 8)}`;

const sql = postgres(url, { max: 4, prepare: false, onnotice: () => {} });

let failures = 0;
function check(ok, label, detail = "") {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

/**
 * Remove everything this run created, deepest first.
 *
 * Matches on the run id stamped into the doctors' patient_number_prefix and the
 * locations' name, never on "recent rows" — a time window would sweep up work
 * belonging to whoever else is using this project.
 */
async function cleanup(runId) {
  const doctors = await sql`
    select d.id, d.user_id from public.doctor_profiles d
    where d.patient_number_prefix = ${runId.slice(0, 10)}`;
  const locations = await sql`
    select id from public.practice_locations where name = ${`Race ${runId}`}`;

  const docIds = doctors.map((d) => d.id);
  const userIds = doctors.map((d) => d.user_id);
  const locIds = locations.map((l) => l.id);

  if (docIds.length) {
    await sql`delete from public.appointment_events where appointment_id in (
                select id from public.appointments where owner_doctor_id in ${sql(docIds)})`;
    await sql`delete from public.appointments where owner_doctor_id in ${sql(docIds)}`;
    await sql`delete from public.patient_location_links where patient_id in (
                select id from public.patients where owner_doctor_id in ${sql(docIds)})`;
    await sql`delete from public.patients where owner_doctor_id in ${sql(docIds)}`;
    await sql`delete from public.subscription_payments where subscription_id in (
                select id from public.doctor_subscriptions where doctor_profile_id in ${sql(docIds)})`;
    await sql`delete from public.doctor_subscriptions where doctor_profile_id in ${sql(docIds)}`;
    await sql`delete from public.doctor_booking_closed_dates where doctor_chamber_id in (
                select id from public.doctor_chambers where doctor_profile_id in ${sql(docIds)})`;
    await sql`delete from public.doctor_booking_settings where doctor_profile_id in ${sql(docIds)}`;
    await sql`delete from public.doctor_chamber_hours where chamber_id in (
                select id from public.doctor_chambers where doctor_profile_id in ${sql(docIds)})`;
    await sql`delete from public.doctor_chambers where doctor_profile_id in ${sql(docIds)}`;
  }
  if (locIds.length) {
    await sql`delete from public.practice_location_members where practice_location_id in ${sql(locIds)}`;
    await sql`delete from public.practice_locations where id in ${sql(locIds)}`;
  }
  if (docIds.length) {
    await sql`delete from public.doctor_profiles where id in ${sql(docIds)}`;
  }
  if (userIds.length) {
    await sql`delete from public.profiles where id in ${sql(userIds)}`;
    await sql`delete from auth.users where id in ${sql(userIds)}`;
  }

  const [{ n }] = await sql`select count(*)::int as n from auth.users where email like ${`%${runId}%`}`;
  return { doctors: docIds.length, locations: locIds.length, strays: n };
}

if (cleanupOnly) {
  console.log(`\nCleaning up run ${cleanupOnly}\n`);
  const removed = await cleanup(cleanupOnly);
  console.log(`  removed ${removed.doctors} doctor(s), ${removed.locations} location(s)`);
  check(removed.strays === 0, "no stray identities remain");
  await sql.end();
  process.exit(failures === 0 ? 0 : 1);
}

console.log(`\nRun id: ${RUN}`);
console.log(`If this is interrupted, run:  npm run db:verify:race -- --cleanup ${RUN}\n`);

let interrupted = false;
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    if (interrupted) return;
    interrupted = true;
    console.log(`\nInterrupted — cleaning up ${RUN}`);
    try {
      await cleanup(RUN);
    } finally {
      await sql.end();
      process.exit(130);
    }
  });
}

let doctorId;
let locationId;
let day;

try {
  // -----------------------------------------------------------------------
  console.log("1. Committing a fixture two connections can both see");

  const user = crypto.randomUUID();
  await sql`insert into auth.users (id, email, encrypted_password, email_confirmed_at,
                                    confirmation_token, recovery_token,
                                    email_change_token_new, email_change)
            values (${user}, ${`${RUN}@qa.invalid`}, '', now(), '', '', '', '')`;
  await sql`insert into public.profiles (id, full_name) values (${user}, 'Dr Race')`;

  const [doc] = await sql`insert into public.doctor_profiles
      (user_id, patient_number_prefix, profile_visibility, profile_slug)
    values (${user}, ${RUN.slice(0, 10)}, 'PUBLIC', ${RUN}) returning id`;
  doctorId = doc.id;

  const [loc] = await sql`insert into public.practice_locations (name, type, district, timezone, created_by)
    values (${`Race ${RUN}`}, 'CLINIC', 'Dhaka', 'Asia/Dhaka', ${user}) returning id`;
  locationId = loc.id;

  await sql`insert into public.practice_location_members (practice_location_id, user_id, role, status)
            values (${loc.id}, ${user}, 'DOCTOR', 'ACTIVE')`;

  const [ch] = await sql`insert into public.doctor_chambers (doctor_profile_id, practice_location_id, position)
                         values (${doc.id}, ${loc.id}, 0) returning id`;
  for (let weekday = 0; weekday <= 6; weekday += 1) {
    await sql`insert into public.doctor_chamber_hours (chamber_id, weekday, starts_at, ends_at)
              values (${ch.id}, ${weekday}, '10:00', '13:00')`;
  }

  const [{ tomorrow }] = await sql`select ((now() at time zone 'Asia/Dhaka')::date + 1) as tomorrow`;
  day = tomorrow.toISOString().slice(0, 10);
  check(true, "fixture committed", RUN);

  /** Fire N bookings simultaneously, each on its own connection. */
  async function stampede(n, argsFor) {
    const conns = Array.from({ length: n }, () =>
      postgres(url, { max: 1, prepare: false, onnotice: () => {} }),
    );
    try {
      // Build every promise BEFORE awaiting any, so they overlap for real.
      const inFlight = conns.map((c, i) => {
        const a = argsFor(i);
        return c`select set_config('role', 'anon', true)`.then(() =>
          c`select public.create_public_booking(
              ${RUN}, ${locationId}, ${day}, ${a.time},
              ${a.name}, ${a.phone}, 'UNKNOWN', null) as r`,
        );
      });
      return await Promise.allSettled(inFlight);
    } finally {
      await Promise.all(conns.map((c) => c.end()));
    }
  }

  const won = (results) => results.filter((r) => r.status === "fulfilled").length;
  const lost = (results) => results.filter((r) => r.status === "rejected").length;

  // -----------------------------------------------------------------------
  console.log("\n2. TIME_SLOT — two callers, one slot, same instant");

  await sql`insert into public.doctor_booking_settings
              (doctor_profile_id, doctor_chamber_id, booking_enabled, booking_mode,
               slot_minutes, max_patients, booking_window_days, min_lead_minutes)
            values (${doc.id}, ${ch.id}, true, 'TIME_SLOT', 15, 100, 30, 0)`;

  const slotRace = await stampede(2, (i) => ({
    time: "10:00",
    name: `Slot Racer ${i}`,
    phone: `0171000000${i}`,
  }));
  check(won(slotRace) === 1, "exactly one caller won", `${won(slotRace)} won / ${lost(slotRace)} refused`);

  const [{ n: slotRows }] = await sql`
    select count(*)::int as n from public.appointments
    where owner_doctor_id = ${doc.id} and session_date = ${day}
      and status not in ('CANCELLED','NO_SHOW')`;
  check(slotRows === 1, "exactly one appointment exists for that slot", `${slotRows} rows`);

  const reasons = slotRace.filter((r) => r.status === "rejected").map((r) => String(r.reason?.message ?? ""));
  check(
    reasons.every((m) => /SLOT_TAKEN|DUPLICATE_BOOKING|deadlock/i.test(m)),
    "the loser was refused by the capacity check, not by a crash",
    reasons.join(" | ").slice(0, 70),
  );

  // -----------------------------------------------------------------------
  console.log("\n3. TOKEN — five callers, one remaining seat, same instant");

  await sql`delete from public.appointment_events where appointment_id in (
              select id from public.appointments where owner_doctor_id = ${doc.id})`;
  await sql`delete from public.appointments where owner_doctor_id = ${doc.id}`;
  await sql`update public.doctor_booking_settings
            set booking_mode = 'TOKEN', max_patients = 3
            where doctor_chamber_id = ${ch.id}`;

  // Fill two of three seats, sequentially, so exactly one seat is left.
  for (let i = 0; i < 2; i += 1) {
    await sql`select set_config('role', 'anon', true)`;
    await sql`select public.create_public_booking(
      ${RUN}, ${locationId}, ${day}, '10:00',
      ${`Filler ${i}`}, ${`0172000000${i}`}, 'UNKNOWN', null)`;
    await sql`select set_config('role', null, true)`;
  }
  const [{ n: filled }] = await sql`
    select count(*)::int as n from public.appointments
    where owner_doctor_id = ${doc.id} and session_date = ${day}
      and status not in ('CANCELLED','NO_SHOW')`;
  check(filled === 2, "two of three seats taken", `${filled}`);

  const tokenRace = await stampede(5, (i) => ({
    time: "10:00",
    name: `Token Racer ${i}`,
    phone: `0173000000${i}`,
  }));
  check(
    won(tokenRace) === 1,
    "exactly one of five concurrent callers took the last seat",
    `${won(tokenRace)} won / ${lost(tokenRace)} refused`,
  );

  const [{ n: total }] = await sql`
    select count(*)::int as n from public.appointments
    where owner_doctor_id = ${doc.id} and session_date = ${day}
      and status not in ('CANCELLED','NO_SHOW')`;
  check(total === 3, "capacity was never exceeded", `${total} of max 3`);

  const tokenReasons = tokenRace
    .filter((r) => r.status === "rejected")
    .map((r) => String(r.reason?.message ?? ""));
  check(
    tokenReasons.every((m) => /SESSION_FULL|deadlock/i.test(m)),
    "every loser was refused as SESSION_FULL",
    tokenReasons[0]?.slice(0, 50) ?? "",
  );

  // -----------------------------------------------------------------------
  console.log("\n4. Cancelling frees the seat, and the freed seat is bookable");

  const [oneAppt] = await sql`select id from public.appointments
                              where owner_doctor_id = ${doc.id} limit 1`;
  await sql`update public.appointments set status = 'CANCELLED' where id = ${oneAppt.id}`;

  await sql`select set_config('role', 'anon', true)`;
  const [{ r: reclaimed }] = await sql`select public.create_public_booking(
    ${RUN}, ${locationId}, ${day}, '10:00',
    'After Cancel', '01749999999', 'UNKNOWN', null) as r`;
  await sql`select set_config('role', null, true)`;
  check(!!reclaimed?.bookingRef, "the freed seat was bookable again");
} catch (e) {
  console.error("\nverification aborted:", e.message);
  failures += 1;
} finally {
  if (!interrupted) {
    console.log("\n5. Removing the fixture");
    try {
      const removed = await cleanup(RUN);
      check(removed.strays === 0, "no stray @qa.invalid identity remains", `run ${RUN}`);
      const [{ n: leftAppt }] = doctorId
        ? await sql`select count(*)::int as n from public.appointments where owner_doctor_id = ${doctorId}`
        : [{ n: 0 }];
      check(leftAppt === 0, "no appointment row survived");
    } catch (e) {
      failures += 1;
      console.error(`  ✗ CLEANUP FAILED — run: npm run db:verify:race -- --cleanup ${RUN}`);
      console.error(`    ${e.message}`);
    }
  }
}

console.log(
  failures === 0
    ? "\nBooking races: all checks passed. Fixture removed.\n"
    : `\n${failures} CHECK(S) FAILED. Run id ${RUN}.\n`,
);

await sql.end();
process.exit(failures === 0 ? 0 : 1);
