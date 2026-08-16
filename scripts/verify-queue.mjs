/**
 * The live queue: visibility, legal actions, ordering and concurrency.
 *
 * Executed as the `authenticated` role inside a transaction that is ALWAYS
 * rolled back, except the concurrency section, which needs two connections that
 * really commit and cleans up after itself.
 *
 *   node --env-file=.env.local scripts/verify-queue.mjs
 */
import postgres from "postgres";
import crypto from "node:crypto";

const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error("DIRECT_URL or DATABASE_URL must be set.");
  process.exit(1);
}

const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
const failures = [];

function check(ok, label, detail = "") {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(label);
}

async function expectDenied(tx, fn) {
  try {
    await tx.savepoint(fn);
    return false;
  } catch {
    return true;
  }
}

async function as(tx, uid, fn) {
  await tx`select set_config('request.jwt.claims', ${JSON.stringify({
    sub: uid,
    role: "authenticated",
  })}, true)`;
  await tx`set local role authenticated`;
  try {
    return await fn();
  } finally {
    await tx`reset role`;
  }
}

// ---------------------------------------------------------------------------
// Static posture
// ---------------------------------------------------------------------------
console.log("\nRow Level Security");
for (const table of ["queue_entries", "queue_events"]) {
  const [r] = await sql`
    select c.relrowsecurity as enabled, c.relforcerowsecurity as forced
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = ${table}`;
  check(Boolean(r?.enabled && r?.forced), `${table}: RLS enabled + forced`);

  const [a] = await sql`
    select count(*)::int as n from information_schema.role_table_grants
    where table_schema = 'public' and table_name = ${table} and grantee = 'anon'`;
  check(a.n === 0, `${table}: anon has no grants`);

  for (const priv of ["INSERT", "UPDATE", "DELETE"]) {
    const [g] = await sql`
      select count(*)::int as n from information_schema.role_table_grants
      where table_schema = 'public' and table_name = ${table}
        and grantee = 'authenticated' and privilege_type = ${priv}`;
    check(g.n === 0, `${table}: no direct ${priv}`);
  }
}

console.log("\nQueue RPCs are DEFINER with a pinned search_path");
for (const fn of [
  "call_patient",
  "skip_patient",
  "set_queue_priority",
  "clear_queue_priority",
  "queue_entry_for",
]) {
  const [f] = await sql`
    select p.prosecdef, p.proconfig from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = ${fn} limit 1`;
  check(f?.prosecdef === true, `${fn}: SECURITY DEFINER`);
  check(
    (f?.proconfig ?? []).some((c) => c.startsWith("search_path=")),
    `${fn}: search_path pinned`,
  );
}

const [helperGrant] = await sql`
  select has_function_privilege('authenticated',
    'public.queue_entry_for(uuid, uuid)', 'EXECUTE') as ok`;
check(helperGrant.ok === false, "the internal queue helper is not executable");

/**
 * Every queue RPC must take the location the caller is working in. The earlier
 * forms took only an appointment id, so they could act on any location the
 * caller happened to be allowed into.
 */
console.log("\nQueue RPCs are bound to a location");
for (const fn of ["call_patient", "skip_patient", "set_queue_priority", "clear_queue_priority"]) {
  const forms = await sql`
    select pg_get_function_arguments(p.oid) as args
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = ${fn}`;
  check(forms.length === 1, `${fn}: exactly one form`, `${forms.length}`);
  check(
    forms.every((f) => f.args.includes("p_practice_location_id")),
    `${fn}: takes the active location`,
  );
}

const [oldHelper] = await sql`
  select count(*)::int as n from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'queue_entry_for'`;
check(oldHelper.n === 1, "no location-blind helper survives", `${oldHelper.n} form(s)`);

/**
 * The queue must not invent a second lifecycle (ADR 0009). If a status column
 * ever appears here, two tables start answering "is the patient with the
 * doctor?" and they will eventually disagree.
 */
console.log("\nThe queue stores no second lifecycle");
const [statusCol] = await sql`
  select count(*)::int as n from information_schema.columns
  where table_schema = 'public' and table_name = 'queue_entries'
    and column_name in ('status', 'queue_status', 'state', 'position')`;
check(statusCol.n === 0, "queue_entries has no status or position column");

// ---------------------------------------------------------------------------
// Executed
// ---------------------------------------------------------------------------
const uidA = crypto.randomUUID(); // Dr A — hospital + chamber
const uidB = crypto.randomUUID(); // Dr B — unrelated
const uidR = crypto.randomUUID(); // reception at the hospital

try {
  await sql.begin(async (tx) => {
    for (const [uid, name] of [
      [uidA, "Dr A"],
      [uidB, "Dr B"],
      [uidR, "Reception R"],
    ]) {
      await tx`insert into auth.users (id, email) values (${uid}, ${`${uid}@qa.invalid`})`;
      await tx`insert into public.profiles (id, full_name) values (${uid}, ${name})`;
    }

    const [docA] = await tx`insert into public.doctor_profiles (user_id, patient_number_prefix)
                            values (${uidA}, 'AA') returning id`;
    const [docB] = await tx`insert into public.doctor_profiles (user_id, patient_number_prefix)
                            values (${uidB}, 'BB') returning id`;

    const [hospital] = await tx`
      insert into public.practice_locations (name, type, created_by)
      values ('QA Hospital', 'HOSPITAL', ${uidA}) returning id`;
    const [chamber] = await tx`
      insert into public.practice_locations (name, type, created_by)
      values ('QA Chamber', 'PERSONAL_CHAMBER', ${uidA}) returning id`;

    await tx`insert into public.practice_location_members
               (practice_location_id, user_id, role, status)
             values (${hospital.id}, ${uidA}, 'DOCTOR', 'ACTIVE'),
                    (${chamber.id},  ${uidA}, 'DOCTOR', 'ACTIVE'),
                    (${hospital.id}, ${uidR}, 'RECEPTIONIST', 'ACTIVE')`;

    const session = "2026-09-01";
    const made = [];

    // Three patients arrive in order, taking tokens 1..3.
    for (let i = 1; i <= 3; i++) {
      const [p] = await tx`
        insert into public.patients (owner_doctor_id, patient_number, full_name,
                                     name_normalized, sex, created_by)
        values (${docA.id}, ${`AA-90000${i}`}, ${`Patient ${i}`},
                ${`patient ${i}`}, 'UNKNOWN', ${uidA}) returning id`;
      await tx`insert into public.patient_location_links (patient_id, practice_location_id)
               values (${p.id}, ${hospital.id})`;
      const [a] = await tx`
        insert into public.appointments (owner_doctor_id, practice_location_id, patient_id,
                                         scheduled_for, session_date, token_number,
                                         status, created_by)
        values (${docA.id}, ${hospital.id}, ${p.id},
                ${`${session}T10:0${i}:00+06:00`}::timestamptz, ${session}, ${i},
                'ARRIVED', ${uidA}) returning id`;
      await tx`insert into public.appointment_events
                 (appointment_id, practice_location_id, event_type, to_status, actor_id)
               values (${a.id}, ${hospital.id}, 'ARRIVED', 'ARRIVED', ${uidA})`;
      made.push(a.id);
    }

    // ---- visibility -------------------------------------------------------
    console.log("\nVisibility");
    await as(tx, uidR, async () => {
      const q = await tx`select * from public.get_queue(${hospital.id}, ${session}::date)`;
      check(q.length === 3, "reception sees the whole room", `${q.length}`);
      check(
        q.map((r) => r.token_number).join(",") === "1,2,3",
        "in token order",
        q.map((r) => r.token_number).join(","),
      );
      check(
        q.every((r) => r.call_count === 0 && r.priority === 0),
        "with no queue row required just to appear",
      );
    });

    await as(tx, uidB, async () => {
      const q = await tx`select * from public.get_queue(${hospital.id}, ${session}::date)`;
      check(q.length === 0, "an unrelated doctor sees nothing");
    });

    await as(tx, uidA, async () => {
      const q = await tx`select * from public.get_queue(${hospital.id}, ${session}::date)`;
      check(q.length === 3, "the owning doctor sees their room");
    });

    // ---- calling, skipping, recalling -------------------------------------
    console.log("\nCalling and skipping");
    await as(tx, uidR, async () => {
      const [c1] = await tx`select public.call_patient(${made[0]}, ${hospital.id}, null) as n`;
      check(c1.n === 1, "calling records the first announcement");

      const [c2] = await tx`select public.call_patient(${made[0]}, ${hospital.id}, null) as n`;
      check(c2.n === 2, "calling again increments — being called twice is normal");

      const [status] = await tx`select status from public.appointments where id = ${made[0]}`;
      check(
        status.status === "ARRIVED",
        "…and does NOT change the appointment: a call is an announcement",
        status.status,
      );

      const [s1] = await tx`select public.skip_patient(${made[0]}, ${hospital.id}, 'no answer') as n`;
      check(s1.n === 1, "skipping records why they left the front");

      const [s2] = await tx`select public.skip_patient(${made[0]}, ${hospital.id}, null) as n`;
      check(s2.n === 1, "skipping twice is idempotent", `${s2.n}`);

      const [stillHere] = await tx`select status from public.appointments where id = ${made[0]}`;
      check(
        stillHere.status === "ARRIVED",
        "a skipped patient is still ARRIVED — they are here and still owed a visit",
        stillHere.status,
      );

      const q = await tx`select * from public.get_queue(${hospital.id}, ${session}::date)`;
      check(
        q[0].token_number === 2,
        "the skipped patient drops out of the front of the line",
        q.map((r) => r.token_number).join(","),
      );
      check(
        q[q.length - 1].token_number === 1,
        "…and sits at the end until recalled",
        q.map((r) => r.token_number).join(","),
      );

      await tx`select public.call_patient(${made[0]}, ${hospital.id}, null)`;
      const [recalled] = await tx`
        select event_type from public.queue_events
        where appointment_id = ${made[0]} order by seq desc limit 1`;
      check(recalled.event_type === "RECALLED", "calling a skipped patient is a RECALL");

      const q2 = await tx`select * from public.get_queue(${hospital.id}, ${session}::date)`;
      check(
        q2[0].token_number === 1,
        "…and returns them to their place",
        q2.map((r) => r.token_number).join(","),
      );
    });

    // ---- priority ---------------------------------------------------------
    console.log("\nPriority");
    await as(tx, uidR, async () => {
      const noReason = await expectDenied(tx, async (t) => {
        await t`select public.set_queue_priority(${made[2]}, ${hospital.id}, null, null)`;
      });
      check(noReason, "moving someone up REQUIRES a reason");

      await tx`select public.set_queue_priority(${made[2]}, ${hospital.id},
                 'ELDERLY'::public.priority_reason, 'Struggling to stand')`;
      const q = await tx`select * from public.get_queue(${hospital.id}, ${session}::date)`;
      check(q[0].token_number === 3, "a prioritised patient goes first", `${q[0].token_number}`);
      check(q[0].priority_reason === "ELDERLY", "with the reason recorded");
      check(q[0].priority_note === "Struggling to stand", "and the note kept");

      const [ev] = await tx`
        select event_type, reason from public.queue_events
        where appointment_id = ${made[2]} order by seq desc limit 1`;
      check(
        ev.event_type === "PRIORITY_SET" && ev.reason === "ELDERLY",
        "the jump is in the history, with its justification",
      );

      await tx`select public.clear_queue_priority(${made[2]}, ${hospital.id})`;
      const q2 = await tx`select * from public.get_queue(${hospital.id}, ${session}::date)`;
      check(q2[0].token_number === 1, "clearing priority restores ordinary order");

      const [after] = await tx`
        select count(*)::int as n from public.queue_events
        where appointment_id = ${made[2]} and event_type = 'PRIORITY_SET'`;
      check(after.n === 1, "…but the record of why they jumped survives");
    });

    /**
     * A queue mutation and its event are ATOMIC (ADR 0009).
     *
     * Forced by making the event insert fail. If the entry could advance while
     * its event did not, queue_entries and queue_events would disagree — the
     * same row-versus-history split that cost the most to fix in Stage 4.
     *
     * Runs on made[0], which is ARRIVED and already has a queue row from the
     * calling tests; a terminal appointment would be rejected earlier and the
     * test would pass for the wrong reason.
     */
    console.log("\nMutation and event are atomic");
    {
      const [was] = await tx`
        select call_count from public.queue_entries where appointment_id = ${made[0]}`;
      const priorCount = was.call_count;
      const [eventsWas] = await tx`
        select count(*)::int as n from public.queue_events where appointment_id = ${made[0]}`;

      // NOT VALID: earlier CALLED events already exist, and a validating
      // constraint would fail on them instead of on the write under test.
      await tx`alter table public.queue_events
               add constraint qa_block_calls check (event_type <> 'CALLED') not valid`;

      const rolled = await as(tx, uidR, async () =>
        expectDenied(tx, async (t) => {
          await t`select public.call_patient(${made[0]}, ${hospital.id}, null)`;
        }),
      );
      check(rolled, "a failing queue-event write aborts the call");

      await tx`alter table public.queue_events drop constraint qa_block_calls`;

      const [now] = await tx`
        select call_count from public.queue_entries where appointment_id = ${made[0]}`;
      const [eventsNow] = await tx`
        select count(*)::int as n from public.queue_events where appointment_id = ${made[0]}`;
      check(
        now.call_count === priorCount,
        "…and the call count did NOT advance",
        `${priorCount} -> ${now.call_count}`,
      );
      check(eventsNow.n === eventsWas.n, "…and no event survived either");
    }

    /**
     * A patient with the doctor is VISIBLE in the queue but not MUTABLE.
     *
     * Skipping someone sitting in the room would show them as passed over while
     * they are being seen. The boundary has to be in the RPC: every front-desk
     * user can call it directly, so hiding the button controls nothing.
     */
    console.log("\nQueue actions require ARRIVED");
    {
      // Give made[1] a queue row first, so "nothing changed" has something to
      // measure — then move them into the consultation.
      await as(tx, uidR, async () => {
        await tx`select public.call_patient(${made[1]}, ${hospital.id}, null)`;
      });
      await as(tx, uidA, async () => {
        await tx`select public.set_appointment_status(${made[1]},
                   'IN_CONSULTATION'::public.appointment_status, null, null)`;
      });

      const [before] = await tx`
        select call_count, skip_count, priority, priority_reason, skipped_at
        from public.queue_entries where appointment_id = ${made[1]}`;
      const [eventsBefore] = await tx`
        select count(*)::int as n from public.queue_events where appointment_id = ${made[1]}`;

      await as(tx, uidR, async () => {
        const attempts = [
          ["call_patient rejects a patient with the doctor", async (t) =>
            t`select public.call_patient(${made[1]}, ${hospital.id}, null)`],
          ["skip_patient rejects a patient with the doctor", async (t) =>
            t`select public.skip_patient(${made[1]}, ${hospital.id}, null)`],
          ["set_queue_priority rejects a patient with the doctor", async (t) =>
            t`select public.set_queue_priority(${made[1]}, ${hospital.id},
                'EMERGENCY'::public.priority_reason, null)`],
          ["clear_queue_priority rejects a patient with the doctor", async (t) =>
            t`select public.clear_queue_priority(${made[1]}, ${hospital.id})`],
        ];
        for (const [label, fn] of attempts) check(await expectDenied(tx, fn), label);
      });

      const [after] = await tx`
        select call_count, skip_count, priority, priority_reason, skipped_at
        from public.queue_entries where appointment_id = ${made[1]}`;
      const [eventsAfter] = await tx`
        select count(*)::int as n from public.queue_events where appointment_id = ${made[1]}`;

      check(
        JSON.stringify(before) === JSON.stringify(after),
        "…and none of them changed the queue row",
        JSON.stringify(after),
      );
      check(
        eventsBefore.n === eventsAfter.n,
        "…nor wrote a queue event",
        `${eventsBefore.n} -> ${eventsAfter.n}`,
      );

      await as(tx, uidR, async () => {
        const q = await tx`select * from public.get_queue(${hospital.id}, ${session}::date)`;
        const current = q.find((r) => r.appointment_id === made[1]);
        check(
          Boolean(current) && current.status === "IN_CONSULTATION",
          "…while remaining visible as the current patient",
        );
      });
    }

    // ---- the queue follows the appointment, never the other way -----------
    console.log("\nThe queue is a projection");
    await as(tx, uidA, async () => {
      await tx`select public.set_appointment_status(${made[1]},
                 'IN_CONSULTATION'::public.appointment_status, null, null)`;
      const q = await tx`select * from public.get_queue(${hospital.id}, ${session}::date)`;
      check(
        q[0].token_number === 2 && q[0].status === "IN_CONSULTATION",
        "the patient with the doctor is first on the screen",
      );

      await tx`select public.set_appointment_status(${made[1]},
                 'COMPLETED'::public.appointment_status, null, null)`;
      const q2 = await tx`select * from public.get_queue(${hospital.id}, ${session}::date)`;
      check(
        !q2.some((r) => r.appointment_id === made[1]),
        "finishing removes them from the queue with no second write",
      );

      await tx`select public.set_appointment_status(${made[2]},
                 'CANCELLED'::public.appointment_status,
                 'PATIENT_REQUEST'::public.cancellation_reason, null)`;
      const q3 = await tx`select * from public.get_queue(${hospital.id}, ${session}::date)`;
      check(
        !q3.some((r) => r.appointment_id === made[2]),
        "so does cancelling",
      );

      const gone = await expectDenied(tx, async (t) => {
        await t`select public.call_patient(${made[2]}, ${hospital.id}, null)`;
      });
      check(gone, "and someone who has left the queue cannot be called");
    });

    /**
     * Actions are bound to the location the caller is WORKING IN.
     *
     * Doctor A runs both the hospital and their own chamber, so both are
     * legitimately theirs. That is exactly the dangerous case: acting on a
     * chamber patient while the screen — and the audit event the application
     * writes afterwards — say hospital would put the wrong place in the record.
     */
    console.log("\nActions are bound to the active location");
    {
      const [chamberPatient] = await tx`
        insert into public.patients (owner_doctor_id, patient_number, full_name,
                                     name_normalized, sex, created_by)
        values (${docA.id}, 'AA-990001', 'Chamber Patient', 'chamber patient',
                'UNKNOWN', ${uidA}) returning id`;
      await tx`insert into public.patient_location_links (patient_id, practice_location_id)
               values (${chamberPatient.id}, ${chamber.id})`;
      const [chamberAppt] = await tx`
        insert into public.appointments (owner_doctor_id, practice_location_id, patient_id,
                                         scheduled_for, session_date, token_number,
                                         status, created_by)
        values (${docA.id}, ${chamber.id}, ${chamberPatient.id},
                ${`${session}T09:00:00+06:00`}::timestamptz, ${session}, 1,
                'ARRIVED', ${uidA}) returning id`;

      const beforeEntries = await tx`
        select count(*)::int as n from public.queue_entries
        where appointment_id = ${chamberAppt.id}`;
      const beforeEvents = await tx`
        select count(*)::int as n from public.queue_events
        where appointment_id = ${chamberAppt.id}`;

      await as(tx, uidA, async () => {
        const attempts = [
          ["call from the wrong location is refused", async (t) =>
            t`select public.call_patient(${chamberAppt.id}, ${hospital.id}, null)`],
          ["skip from the wrong location is refused", async (t) =>
            t`select public.skip_patient(${chamberAppt.id}, ${hospital.id}, null)`],
          ["priority from the wrong location is refused", async (t) =>
            t`select public.set_queue_priority(${chamberAppt.id}, ${hospital.id},
                'ELDERLY'::public.priority_reason, null)`],
          ["clearing priority from the wrong location is refused", async (t) =>
            t`select public.clear_queue_priority(${chamberAppt.id}, ${hospital.id})`],
        ];
        for (const [label, fn] of attempts) check(await expectDenied(tx, fn), label);

        // …while the SAME action at the right location works, so the refusal is
        // about location and not about something else being broken.
        const [ok] = await tx`
          select public.call_patient(${chamberAppt.id}, ${chamber.id}, null) as n`;
        check(ok.n === 1, "the same action at the correct location succeeds");
      });

      const afterEntries = await tx`
        select count(*)::int as n, coalesce(max(call_count), 0) as calls
        from public.queue_entries where appointment_id = ${chamberAppt.id}`;
      const afterEvents = await tx`
        select count(*)::int as n from public.queue_events
        where appointment_id = ${chamberAppt.id}`;

      check(
        afterEntries[0].calls === 1,
        "only the correctly-located call was recorded",
        `${afterEntries[0].calls} call(s)`,
      );
      check(
        afterEvents[0].n === beforeEvents[0].n + 1,
        "exactly one queue event, from the correct location",
        `${beforeEvents[0].n} -> ${afterEvents[0].n}`,
      );
      void beforeEntries;
    }

    // ---- direct writes ----------------------------------------------------
    console.log("\nBypass attempts");
    await as(tx, uidA, async () => {
      const cases = [
        ["cannot INSERT a queue row directly", async (t) =>
          t`insert into public.queue_entries (appointment_id, practice_location_id, session_date)
            values (${made[0]}, ${hospital.id}, ${session})`],
        ["cannot UPDATE a queue row directly", async (t) =>
          t`update public.queue_entries set priority = 99`],
        ["cannot DELETE a queue row", async (t) =>
          t`delete from public.queue_entries`],
        ["cannot forge a queue event", async (t) =>
          t`insert into public.queue_events (appointment_id, practice_location_id, event_type)
            values (${made[0]}, ${hospital.id}, 'CALLED')`],
        ["queue events cannot be rewritten", async (t) =>
          t`update public.queue_events set note = 'tampered'`],
        ["queue events cannot be deleted", async (t) =>
          t`delete from public.queue_events`],
      ];
      for (const [label, fn] of cases) check(await expectDenied(tx, fn), label);
    });

    // A doctor may not reach into another doctor's queue.
    await as(tx, uidB, async () => {
      const denied = await expectDenied(tx, async (t) => {
        await t`select public.call_patient(${made[0]}, ${hospital.id}, null)`;
      });
      check(denied, "an unrelated doctor cannot call another doctor's patient");

      const [seen] = await tx`select count(*)::int as n from public.queue_entries`;
      check(seen.n === 0, "…and sees no queue rows at all");
    });

    void docB;
    throw new Error("__rollback__");
  });
} catch (e) {
  if (e.message !== "__rollback__") {
    check(false, "queue verification", e.message);
    if (process.env.QA_TRACE) console.error(e);
  }
}

// ---------------------------------------------------------------------------
// Concurrency: two assistants acting on the same patient at once.
// ---------------------------------------------------------------------------
console.log("\nConcurrent queue actions (committed, then cleaned up)");

const cDoc = crypto.randomUUID();
const cDeskA = crypto.randomUUID();
const cDeskB = crypto.randomUUID();
const users = [cDoc, cDeskA, cDeskB];
let cLoc, cDoctorId, cAppt;

const raceOpts = {
  max: 1,
  prepare: false,
  onnotice: () => {},
  connection: { statement_timeout: "15000", lock_timeout: "10000" },
};
const connA = postgres(url, raceOpts);
const connB = postgres(url, raceOpts);

try {
  for (const [uid, name] of [
    [cDoc, "Dr Concurrent"],
    [cDeskA, "Desk One"],
    [cDeskB, "Desk Two"],
  ]) {
    await sql`insert into auth.users (id, email) values (${uid}, ${`${uid}@qa.invalid`})`;
    await sql`insert into public.profiles (id, full_name) values (${uid}, ${name})`;
  }

  [cDoctorId] = await sql`insert into public.doctor_profiles (user_id, patient_number_prefix)
                          values (${cDoc}, 'QQ') returning id`;
  [cLoc] = await sql`
    insert into public.practice_locations (name, type, created_by)
    values ('QA Queue Clinic', 'CLINIC', ${cDoc}) returning id`;
  await sql`insert into public.practice_location_members
              (practice_location_id, user_id, role, status)
            values (${cLoc.id}, ${cDoc},   'DOCTOR', 'ACTIVE'),
                   (${cLoc.id}, ${cDeskA}, 'RECEPTIONIST', 'ACTIVE'),
                   (${cLoc.id}, ${cDeskB}, 'RECEPTIONIST', 'ACTIVE')`;

  const [p] = await sql`
    insert into public.patients (owner_doctor_id, patient_number, full_name,
                                 name_normalized, sex, created_by)
    values (${cDoctorId.id}, 'QQ-900001', 'Queue Racer', 'queue racer', 'UNKNOWN', ${cDoc})
    returning id`;
  await sql`insert into public.patient_location_links (patient_id, practice_location_id)
            values (${p.id}, ${cLoc.id})`;
  [cAppt] = await sql`
    insert into public.appointments (owner_doctor_id, practice_location_id, patient_id,
                                     scheduled_for, session_date, token_number, status, created_by)
    values (${cDoctorId.id}, ${cLoc.id}, ${p.id},
            '2026-09-01T10:00:00+06:00'::timestamptz, '2026-09-01', 1, 'ARRIVED', ${cDoc})
    returning id`;

  const run = (conn, uid, fn, ready, go) =>
    conn
      .begin(async (t) => {
        await t`select set_config('request.jwt.claims', ${JSON.stringify({
          sub: uid,
          role: "authenticated",
        })}, true)`;
        await t`set local role authenticated`;
        ready();
        await go;
        await fn(t);
      })
      .then(
        () => "ok",
        (e) => e.message,
      );

  const race = async (fnA, fnB) => {
    let readyX, readyY;
    const both = Promise.all([
      new Promise((r) => (readyX = r)),
      new Promise((r) => (readyY = r)),
    ]);
    let release;
    const go = new Promise((r) => (release = r));
    const a = run(connA, cDeskA, fnA, readyX, go);
    const b = run(connB, cDeskB, fnB, readyY, go);
    await both;
    release();
    return Promise.all([a, b]);
  };

  // Two assistants calling the same patient simultaneously.
  await race(
    (t) => t`select public.call_patient(${cAppt.id}, ${cLoc.id}, null)`,
    (t) => t`select public.call_patient(${cAppt.id}, ${cLoc.id}, null)`,
  );

  const [entry] = await sql`
    select call_count from public.queue_entries where appointment_id = ${cAppt.id}`;
  const [events] = await sql`
    select count(*)::int as n from public.queue_events
    where appointment_id = ${cAppt.id} and event_type in ('CALLED','RECALLED')`;

  check(
    entry.call_count === 2,
    "two simultaneous calls both count — neither is lost to the other",
    `${entry.call_count}`,
  );
  check(events.n === 2, "…and each leaves its own event", `${events.n}`);

  const [rows] = await sql`
    select count(*)::int as n from public.queue_entries where appointment_id = ${cAppt.id}`;
  check(rows.n === 1, "the lazily-created queue row is created exactly once", `${rows.n}`);

  // Skip and prioritise at the same instant: both must land, neither may vanish.
  await race(
    (t) => t`select public.skip_patient(${cAppt.id}, ${cLoc.id}, null)`,
    (t) => t`select public.set_queue_priority(${cAppt.id}, ${cLoc.id},
               'EMERGENCY'::public.priority_reason, null)`,
  );

  const [after] = await sql`
    select skipped_at, priority, priority_reason from public.queue_entries
    where appointment_id = ${cAppt.id}`;
  check(
    after.skipped_at !== null && after.priority === 1 && after.priority_reason === "EMERGENCY",
    "a simultaneous skip and priority both apply — one does not silently undo the other",
    JSON.stringify(after),
  );
} catch (e) {
  check(false, "concurrent queue actions", e.message);
  if (process.env.QA_TRACE) console.error(e);
} finally {
  await connA.end().catch(() => {});
  await connB.end().catch(() => {});
  if (cLoc) {
    await sql`delete from public.queue_events    where practice_location_id = ${cLoc.id}`;
    await sql`delete from public.queue_entries   where practice_location_id = ${cLoc.id}`;
    await sql`delete from public.appointment_events where practice_location_id = ${cLoc.id}`;
    await sql`delete from public.appointments    where practice_location_id = ${cLoc.id}`;
    await sql`delete from public.patient_location_links where practice_location_id = ${cLoc.id}`;
  }
  if (cDoctorId) await sql`delete from public.patients where owner_doctor_id = ${cDoctorId.id}`;
  await sql`delete from public.practice_locations where created_by = ${cDoc}`;
  // Exactly this test's users — a broader match would collide with the shared
  // qa-fixture accounts and fail on their RESTRICT foreign keys.
  await sql`delete from auth.users where id in ${sql(users)}`;

  const [left] = await sql`
    select count(*)::int as n from auth.users where id in ${sql(users)}`;
  check(left.n === 0, "concurrency fixture cleaned up");
}

await sql.end();

console.log(
  failures.length === 0
    ? "\nAll queue checks passed.\n"
    : `\n${failures.length} CHECK(S) FAILED:\n  - ${failures.join("\n  - ")}\n`,
);
process.exit(failures.length === 0 ? 0 : 1);
