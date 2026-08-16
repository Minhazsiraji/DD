/**
 * Encounters (Stage 6A): the clinical boundary, lineage, concurrency and history.
 *
 * Executed as the `authenticated` role inside a transaction that is ALWAYS
 * rolled back, except the concurrency section, which needs two connections that
 * really commit and removes exactly the ids it created.
 *
 *   node --env-file=.env.local scripts/verify-encounters.mjs
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

const CLINICAL_TABLES = [
  "encounters",
  "encounter_diagnoses",
  "encounter_investigations",
  "encounter_events",
];

// ---------------------------------------------------------------------------
// Static posture
// ---------------------------------------------------------------------------
console.log("\nRow Level Security");
for (const table of CLINICAL_TABLES) {
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

const [writePolicies] = await sql`
  select count(*)::int as n from pg_policies
  where schemaname = 'public' and tablename = any(${CLINICAL_TABLES})
    and cmd in ('INSERT','UPDATE','DELETE')`;
check(writePolicies.n === 0, "no write policies advertise a direct path");

console.log("\nWrite RPCs are DEFINER with a pinned search_path");
for (const fn of [
  "open_encounter",
  "save_encounter_sections",
  "add_encounter_diagnosis",
  "remove_encounter_diagnosis",
  "add_encounter_investigation",
  "remove_encounter_investigation",
  "close_encounter",
  "encounter_for_update",
  "owns_encounter",
  "may_open_encounter",
  "encounter_status_for_appointment",
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

const [internal] = await sql`
  select has_function_privilege('authenticated',
    'public.encounter_for_update(uuid, uuid, integer)', 'EXECUTE') as ok`;
check(internal.ok === false, "the internal load-for-update helper is not executable");

/**
 * Clinical history must survive the removal of anything it points at. Cascades
 * here would let one DELETE erase both the fact and the evidence.
 */
console.log("\nClinical history cannot be cascade-deleted");
const cascades = await sql`
  select c.conname, c.confdeltype, t.relname as child
  from pg_constraint c
  join pg_class t on t.oid = c.conrelid
  join pg_namespace n on n.oid = t.relnamespace
  where n.nspname = 'public' and c.contype = 'f'
    and t.relname = any(${CLINICAL_TABLES})`;
const cascading = cascades.filter((c) => c.confdeltype === "c").map((c) => c.conname);
check(cascading.length === 0, "no encounter foreign key cascades on delete",
  cascading.join(", "));

const [draftIdx] = await sql`
  select count(*)::int as n from pg_indexes
  where schemaname = 'public' and tablename = 'encounters'
    and indexname in ('encounters_one_draft_per_appointment','encounters_one_unscheduled_draft')`;
check(draftIdx.n === 2, "partial unique indexes enforce one active draft", `${draftIdx.n}`);

// ---------------------------------------------------------------------------
// Executed
// ---------------------------------------------------------------------------
const uidA = crypto.randomUUID(); // Dr A — hospital + chamber, owns the patient
const uidB = crypto.randomUUID(); // Dr B — colleague at the SAME hospital
const uidR = crypto.randomUUID(); // reception at the hospital
const uidM = crypto.randomUUID(); // location admin at the hospital

try {
  await sql.begin(async (tx) => {
    for (const [uid, name] of [
      [uidA, "Dr A"],
      [uidB, "Dr B"],
      [uidR, "Reception R"],
      [uidM, "Admin M"],
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
                    (${hospital.id}, ${uidB}, 'DOCTOR', 'ACTIVE'),
                    (${hospital.id}, ${uidR}, 'RECEPTIONIST', 'ACTIVE'),
                    (${hospital.id}, ${uidM}, 'LOCATION_ADMIN', 'ACTIVE')`;

    const [patA] = await tx`
      insert into public.patients (owner_doctor_id, patient_number, full_name,
                                   name_normalized, sex, created_by)
      values (${docA.id}, 'AA-900001', 'Rahim Hossain', 'rahim hossain', 'MALE', ${uidA})
      returning id`;
    await tx`insert into public.patient_location_links (patient_id, practice_location_id)
             values (${patA.id}, ${hospital.id})`;
    const [patB] = await tx`
      insert into public.patients (owner_doctor_id, patient_number, full_name,
                                   name_normalized, sex, created_by)
      values (${docB.id}, 'BB-900001', 'Karim Mia', 'karim mia', 'MALE', ${uidB})
      returning id`;

    const [appt] = await tx`
      insert into public.appointments (owner_doctor_id, practice_location_id, patient_id,
                                       scheduled_for, session_date, status, created_by)
      values (${docA.id}, ${hospital.id}, ${patA.id},
              '2026-09-01T10:00:00+06:00'::timestamptz, '2026-09-01', 'ARRIVED', ${uidA})
      returning id`;

    // ---- 1 & 2. creating drafts -------------------------------------------
    console.log("\nOpening a consultation");
    let apptEncounter, walkInEncounter;

    await as(tx, uidA, async () => {
      [{ open_encounter: apptEncounter }] = await tx`
        select public.open_encounter(${patA.id}, ${hospital.id}, ${appt.id})`;
      check(Boolean(apptEncounter), "the owning doctor opens an appointment-linked draft");

      const [again] = await tx`
        select public.open_encounter(${patA.id}, ${hospital.id}, ${appt.id}) as id`;
      check(again.id === apptEncounter, "opening again RESUMES rather than duplicating");

      [{ open_encounter: walkInEncounter }] = await tx`
        select public.open_encounter(${patA.id}, ${chamber.id}, null)`;
      check(Boolean(walkInEncounter), "…and an unscheduled draft with no appointment");
      check(walkInEncounter !== apptEncounter, "which is a separate encounter");

      const [ev] = await tx`
        select count(*)::int as n from public.encounter_events
        where encounter_id = ${apptEncounter} and event_type = 'CREATED'`;
      check(ev.n === 1, "creation writes its clinical history in the same transaction");
    });

    // ---- 3. lineage cannot be forged --------------------------------------
    console.log("\nLineage cannot be forged");
    await as(tx, uidA, async () => {
      const notMine = await expectDenied(tx, async (t) => {
        await t`select public.open_encounter(${patB.id}, ${hospital.id}, null)`;
      });
      check(notMine, "cannot open a consultation for another doctor's patient");

      const wrongAppointmentPatient = await expectDenied(tx, async (t) => {
        // The appointment belongs to patA; claim it for a different patient.
        const [other] = await t`
          insert into public.patients (owner_doctor_id, patient_number, full_name,
                                       name_normalized, sex, created_by)
          values (${docA.id}, 'AA-900009', 'Other', 'other', 'MALE', ${uidA}) returning id`;
        await t`select public.open_encounter(${other.id}, ${hospital.id}, ${appt.id})`;
      });
      check(wrongAppointmentPatient, "an appointment cannot be linked to a different patient");

      const wrongAppointmentLocation = await expectDenied(tx, async (t) => {
        await t`select public.open_encounter(${patA.id}, ${chamber.id}, ${appt.id})`;
      });
      check(wrongAppointmentLocation, "…nor used from a different location");

      const notPractising = await expectDenied(tx, async (t) => {
        const [elsewhere] = await t`
          insert into public.practice_locations (name, type, created_by)
          values ('QA Elsewhere', 'CLINIC', ${uidB}) returning id`;
        await t`select public.open_encounter(${patA.id}, ${elsewhere.id}, null)`;
      });
      check(notPractising, "cannot open a consultation where the doctor does not practise");
    });

    // ---- 4, 5, 6. who may read and write ----------------------------------
    console.log("\nClinical content is doctor-only");
    for (const [uid, who] of [[uidR, "reception"], [uidM, "the location admin"], [uidB, "a colleague doctor"]]) {
      await as(tx, uid, async () => {
        const [enc] = await tx`select count(*)::int as n from public.encounters`;
        const [dx] = await tx`select count(*)::int as n from public.encounter_diagnoses`;
        const [inv] = await tx`select count(*)::int as n from public.encounter_investigations`;
        const [evt] = await tx`select count(*)::int as n from public.encounter_events`;
        check(
          enc.n === 0 && dx.n === 0 && inv.n === 0 && evt.n === 0,
          `${who} reads NO clinical content at all`,
          `${enc.n}/${dx.n}/${inv.n}/${evt.n}`,
        );

        const cannotWrite = await expectDenied(tx, async (t) => {
          await t`select public.save_encounter_sections(${apptEncounter}, ${hospital.id}, 1,
                    'forged complaint')`;
        });
        check(cannotWrite, `${who} cannot write clinical content`);

        const cannotOpen = await expectDenied(tx, async (t) => {
          await t`select public.open_encounter(${patA.id}, ${hospital.id}, null)`;
        });
        check(cannotOpen, `${who} cannot open a consultation`);
      });
    }

    /**
     * Reception's ONLY legitimate view: the operational fact. It returns a
     * status and timestamps — the clinical columns are not in the result at all,
     * so there is nothing for a UI mistake to reveal.
     */
    console.log("\nReception sees the operational fact only");
    await as(tx, uidR, async () => {
      const rows = await tx`
        select * from public.encounter_status_for_appointment(${appt.id}, ${hospital.id})`;
      check(rows.length === 1, "reception can see THAT a consultation exists");
      check(rows[0].status === "DRAFT", "…and its status", rows[0].status);

      const columns = Object.keys(rows[0]).join(",");
      check(
        !/complaint|illness|history|examination|assessment|advice|diagnos|investigation|note/i.test(columns),
        "…and nothing clinical is even in the result shape",
        columns,
      );

      const wrongLocation = await expectDenied(tx, async (t) => {
        await t`select * from public.encounter_status_for_appointment(${appt.id}, ${chamber.id})`;
      });
      check(wrongLocation, "…and not from a location they do not run");
    });

    // ---- 7. cross-location mutation ---------------------------------------
    console.log("\nActions are bound to the active location");
    await as(tx, uidA, async () => {
      // Dr A legitimately works at BOTH locations — that is the dangerous case.
      const wrongLocation = await expectDenied(tx, async (t) => {
        await t`select public.save_encounter_sections(${apptEncounter}, ${chamber.id}, 1, 'x')`;
      });
      check(wrongLocation, "the hospital encounter cannot be edited from the chamber");

      const [v] = await tx`
        select public.save_encounter_sections(${apptEncounter}, ${hospital.id}, 1,
          'Fever for three days') as v`;
      check(v.v === 2, "…while the correct location succeeds and bumps the version", `v${v.v}`);
    });

    // ---- 8. direct writes --------------------------------------------------
    console.log("\nDirect writes cannot bypass the RPCs");
    await as(tx, uidA, async () => {
      const cases = [
        ["cannot INSERT an encounter directly", async (t) =>
          t`insert into public.encounters (owner_doctor_id, patient_id, practice_location_id)
            values (${docA.id}, ${patA.id}, ${hospital.id})`],
        ["cannot UPDATE clinical text directly", async (t) =>
          t`update public.encounters set chief_complaints = 'tampered'
             where id = ${apptEncounter}`],
        ["cannot DELETE an encounter", async (t) =>
          t`delete from public.encounters where id = ${apptEncounter}`],
        ["cannot INSERT a diagnosis directly", async (t) =>
          t`insert into public.encounter_diagnoses (encounter_id, label)
            values (${apptEncounter}, 'forged')`],
        ["cannot INSERT an investigation directly", async (t) =>
          t`insert into public.encounter_investigations (encounter_id, name)
            values (${apptEncounter}, 'forged')`],
        ["cannot forge clinical history", async (t) =>
          t`insert into public.encounter_events (encounter_id, event_type)
            values (${apptEncounter}, 'SECTIONS_UPDATED')`],
        ["clinical history cannot be rewritten", async (t) =>
          t`update public.encounter_events set detail = '{}'::jsonb`],
        ["clinical history cannot be deleted", async (t) =>
          t`delete from public.encounter_events`],
      ];
      for (const [label, fn] of cases) check(await expectDenied(tx, fn), label);
    });

    // ---- 10. stale save ----------------------------------------------------
    console.log("\nA stale tab cannot overwrite newer work");
    await as(tx, uidA, async () => {
      const [before] = await tx`
        select version, chief_complaints from public.encounters where id = ${apptEncounter}`;

      const stale = await expectDenied(tx, async (t) => {
        // Version 1 was already consumed by the save above.
        await t`select public.save_encounter_sections(${apptEncounter}, ${hospital.id}, 1,
                  'stale tab overwrite')`;
      });
      check(stale, "a save carrying an old version is REJECTED");

      const [after] = await tx`
        select version, chief_complaints from public.encounters where id = ${apptEncounter}`;
      check(
        after.chief_complaints === before.chief_complaints && after.version === before.version,
        "…and the newer clinical text is untouched",
        after.chief_complaints ?? "",
      );
    });

    // ---- 11 & 12. diagnoses and investigations -----------------------------
    console.log("\nDiagnoses and investigations stay ordered");
    let dx1, dx2;
    await as(tx, uidA, async () => {
      const [{ v }] = await tx`select version as v from public.encounters where id = ${apptEncounter}`;
      [{ add_encounter_diagnosis: dx1 }] = await tx`
        select public.add_encounter_diagnosis(${apptEncounter}, ${hospital.id}, ${v},
          'Dengue fever', 'PROVISIONAL'::public.diagnosis_certainty, null)`;
      const [{ v: v2 }] = await tx`select version as v from public.encounters where id = ${apptEncounter}`;
      [{ add_encounter_diagnosis: dx2 }] = await tx`
        select public.add_encounter_diagnosis(${apptEncounter}, ${hospital.id}, ${v2},
          'Anaemia', 'WORKING'::public.diagnosis_certainty, null)`;
      const [{ v: v3 }] = await tx`select version as v from public.encounters where id = ${apptEncounter}`;
      await tx`select public.add_encounter_diagnosis(${apptEncounter}, ${hospital.id}, ${v3},
                 'Dehydration', 'PROVISIONAL'::public.diagnosis_certainty, null)`;

      const rows = await tx`
        select label, position from public.encounter_diagnoses
        where encounter_id = ${apptEncounter} order by position`;
      check(
        rows.map((r) => r.position).join(",") === "1,2,3",
        "diagnoses are appended in order",
        rows.map((r) => `${r.position}:${r.label}`).join(" "),
      );

      const [{ v: v4 }] = await tx`select version as v from public.encounters where id = ${apptEncounter}`;
      await tx`select public.remove_encounter_diagnosis(${apptEncounter}, ${hospital.id}, ${v4}, ${dx2})`;

      const after = await tx`
        select label, position from public.encounter_diagnoses
        where encounter_id = ${apptEncounter} order by position`;
      check(
        after.map((r) => r.position).join(",") === "1,2",
        "removing one closes the gap rather than leaving a hole",
        after.map((r) => `${r.position}:${r.label}`).join(" "),
      );
      check(after.some((r) => r.label === "Dehydration"), "…and the survivors keep their order");

      const foreign = await expectDenied(tx, async (t) => {
        const [{ v: vv }] = await t`select version as v from public.encounters where id = ${apptEncounter}`;
        await t`select public.remove_encounter_diagnosis(${walkInEncounter}, ${chamber.id}, ${vv}, ${dx1})`;
      });
      check(foreign, "a diagnosis id cannot be removed through another encounter");
    });

    await as(tx, uidA, async () => {
      const [{ v }] = await tx`select version as v from public.encounters where id = ${apptEncounter}`;
      await tx`select public.add_encounter_investigation(${apptEncounter}, ${hospital.id}, ${v},
        'CBC', 'Rule out dengue')`;
      const [{ v: v2 }] = await tx`select version as v from public.encounters where id = ${apptEncounter}`;
      const [{ add_encounter_investigation: inv2 }] = await tx`
        select public.add_encounter_investigation(${apptEncounter}, ${hospital.id}, ${v2}, 'NS1', null)`;

      const rows = await tx`
        select name, position from public.encounter_investigations
        where encounter_id = ${apptEncounter} order by position`;
      check(rows.map((r) => r.position).join(",") === "1,2", "investigations are ordered");

      const [{ v: v3 }] = await tx`select version as v from public.encounters where id = ${apptEncounter}`;
      await tx`select public.remove_encounter_investigation(${apptEncounter}, ${hospital.id}, ${v3}, ${inv2})`;
      const after = await tx`
        select name, position from public.encounter_investigations
        where encounter_id = ${apptEncounter} order by position`;
      check(after.length === 1 && after[0].position === 1, "…and stay ordered after a removal");
    });

    // ---- 13. history failure rolls back the clinical change ----------------
    console.log("\nClinical change and its history are atomic");
    const [beforeAtomic] = await tx`
      select version, assessment from public.encounters where id = ${apptEncounter}`;

    /**
     * NOT VALID so the constraint applies to new rows without re-checking the
     * history already written above. The ALTER runs as the owner, outside the
     * `authenticated` role — only the attempted SAVE is done as the doctor.
     */
    await tx`alter table public.encounter_events
             add constraint qa_block_sections
             check (event_type <> 'SECTIONS_UPDATED') not valid`;

    await as(tx, uidA, async () => {
      const rolled = await expectDenied(tx, async (t) => {
        await t`select public.save_encounter_sections(${apptEncounter}, ${hospital.id},
                  ${beforeAtomic.version}, null, null, null, null, 'Likely viral')`;
      });
      check(rolled, "a failing history write aborts the clinical change");
    });

    await tx`alter table public.encounter_events drop constraint qa_block_sections`;

    const [afterAtomic] = await tx`
      select version, assessment from public.encounters where id = ${apptEncounter}`;
    check(
      afterAtomic.version === beforeAtomic.version &&
        afterAtomic.assessment === beforeAtomic.assessment,
      "…and neither the text nor the version advanced",
      `v${beforeAtomic.version} -> v${afterAtomic.version}`,
    );

    // ---- 14. terminal records reject mutation ------------------------------
    console.log("\nA closed encounter is terminal");
    await as(tx, uidA, async () => {
      const [{ v }] = await tx`select version as v from public.encounters where id = ${walkInEncounter}`;
      await tx`select public.close_encounter(${walkInEncounter}, ${chamber.id}, ${v},
        'COMPLETED'::public.encounter_status)`;

      const [closed] = await tx`
        select status, completed_at from public.encounters where id = ${walkInEncounter}`;
      check(closed.status === "COMPLETED" && Boolean(closed.completed_at), "it completes");

      const [{ v: v2 }] = await tx`select version as v from public.encounters where id = ${walkInEncounter}`;
      const attempts = [
        ["sections cannot be edited after completion", async (t) =>
          t`select public.save_encounter_sections(${walkInEncounter}, ${chamber.id}, ${v2}, 'late')`],
        ["a diagnosis cannot be added after completion", async (t) =>
          t`select public.add_encounter_diagnosis(${walkInEncounter}, ${chamber.id}, ${v2}, 'late',
              'PROVISIONAL'::public.diagnosis_certainty, null)`],
        ["an investigation cannot be added after completion", async (t) =>
          t`select public.add_encounter_investigation(${walkInEncounter}, ${chamber.id}, ${v2}, 'late', null)`],
        ["it cannot be closed twice", async (t) =>
          t`select public.close_encounter(${walkInEncounter}, ${chamber.id}, ${v2},
              'CANCELLED'::public.encounter_status)`],
      ];
      for (const [label, fn] of attempts) check(await expectDenied(tx, fn), label);

      // …and a NEW consultation for the same patient is then possible.
      const [{ open_encounter: fresh }] = await tx`
        select public.open_encounter(${patA.id}, ${chamber.id}, null)`;
      check(
        Boolean(fresh) && fresh !== walkInEncounter,
        "a fresh consultation can be opened once the previous one is closed",
      );
    });

    // ---- 15. history survives removal of what it points at -----------------
    /**
     * Run as the OWNER, not as `authenticated`. A delete blocked by RLS removes
     * nothing and raises nothing, so it would pass this check while proving
     * nothing about the constraint. The point here is that RESTRICT itself
     * stops the row going, even for a caller with full privilege.
     */
    console.log("\nClinical history outlives the rows it references");
    for (const [label, fn] of [
      ["a patient with an encounter cannot be deleted", (t) =>
        t`delete from public.patients where id = ${patA.id}`],
      ["an appointment with an encounter cannot be deleted", (t) =>
        t`delete from public.appointments where id = ${appt.id}`],
      ["a location with encounters cannot be deleted", (t) =>
        t`delete from public.practice_locations where id = ${hospital.id}`],
      ["an encounter with clinical history cannot be deleted", (t) =>
        t`delete from public.encounters where id = ${apptEncounter}`],
    ]) {
      check(await expectDenied(tx, fn), label);
    }

    // ---- 16. anon ----------------------------------------------------------
    console.log("\nAnonymous access");
    const anonBlocked = await expectDenied(tx, async (sp) => {
      await sp`set local role anon`;
      await sp`select count(*) from public.encounters`;
    });
    check(anonBlocked, "anon cannot read encounters at all");

    void docB;
    throw new Error("__rollback__");
  });
} catch (e) {
  if (e.message !== "__rollback__") {
    check(false, "encounter verification", e.message);
    if (process.env.QA_TRACE) console.error(e);
  }
}

// ---------------------------------------------------------------------------
// 9. Concurrent creation — needs two connections that really commit.
// ---------------------------------------------------------------------------
console.log("\nConcurrent open (committed, then cleaned up)");

const cUid = crypto.randomUUID();
const createdUsers = [cUid];
let cDoc, cLoc, cPatient, cAppt;

const raceOpts = {
  max: 1,
  prepare: false,
  onnotice: () => {},
  connection: { statement_timeout: "15000", lock_timeout: "10000" },
};
const connA = postgres(url, raceOpts);
const connB = postgres(url, raceOpts);

try {
  await sql`insert into auth.users (id, email) values (${cUid}, ${`${cUid}@qa.invalid`})`;
  await sql`insert into public.profiles (id, full_name) values (${cUid}, 'Dr Concurrent')`;
  [cDoc] = await sql`insert into public.doctor_profiles (user_id, patient_number_prefix)
                     values (${cUid}, 'ZZ') returning id`;
  [cLoc] = await sql`
    insert into public.practice_locations (name, type, created_by)
    values ('QA Encounter Clinic', 'CLINIC', ${cUid}) returning id`;
  await sql`insert into public.practice_location_members
              (practice_location_id, user_id, role, status)
            values (${cLoc.id}, ${cUid}, 'DOCTOR', 'ACTIVE')`;
  [cPatient] = await sql`
    insert into public.patients (owner_doctor_id, patient_number, full_name,
                                 name_normalized, sex, created_by)
    values (${cDoc.id}, 'ZZ-900001', 'Race Patient', 'race patient', 'UNKNOWN', ${cUid})
    returning id`;
  await sql`insert into public.patient_location_links (patient_id, practice_location_id)
            values (${cPatient.id}, ${cLoc.id})`;
  [cAppt] = await sql`
    insert into public.appointments (owner_doctor_id, practice_location_id, patient_id,
                                     scheduled_for, session_date, status, created_by)
    values (${cDoc.id}, ${cLoc.id}, ${cPatient.id},
            '2026-09-01T10:00:00+06:00'::timestamptz, '2026-09-01', 'ARRIVED', ${cUid})
    returning id`;

  const claims = JSON.stringify({ sub: cUid, role: "authenticated" });

  const race = async (fn) => {
    let readyX, readyY;
    const both = Promise.all([
      new Promise((r) => (readyX = r)),
      new Promise((r) => (readyY = r)),
    ]);
    let release;
    const go = new Promise((r) => (release = r));
    const run = (conn, ready) =>
      conn
        .begin(async (t) => {
          await t`select set_config('request.jwt.claims', ${claims}, true)`;
          await t`set local role authenticated`;
          ready();
          await go;
          return fn(t);
        })
        .then((v) => ({ ok: true, v }), (e) => ({ ok: false, e: e.message }));
    const a = run(connA, readyX);
    const b = run(connB, readyY);
    await both;
    release();
    return Promise.all([a, b]);
  };

  await race((t) => t`select public.open_encounter(${cPatient.id}, ${cLoc.id}, ${cAppt.id})`);

  const drafts = await sql`
    select id from public.encounters
    where appointment_id = ${cAppt.id} and status = 'DRAFT'`;
  check(drafts.length === 1, "two simultaneous opens create exactly ONE draft", `${drafts.length}`);

  const encounterId = drafts[0]?.id;

  /**
   * Two tabs saving at once. Both read version N; only one may win, and the
   * loser must be REJECTED rather than silently overwriting.
   */
  const [{ version: v0 }] = await sql`
    select version from public.encounters where id = ${encounterId}`;

  const saves = await race(
    (t) => t`select public.save_encounter_sections(${encounterId}, ${cLoc.id}, ${v0},
               ${`note from ${Math.random()}`})`,
  );
  const won = saves.filter((r) => r.ok).length;
  check(won === 1, "two simultaneous saves on one version: exactly one wins", `${won} won`);
  check(
    saves.some((r) => !r.ok && /VERSION_CONFLICT/.test(r.e ?? "")),
    "…and the loser gets a recognisable conflict, not a silent overwrite",
    saves.map((r) => (r.ok ? "ok" : r.e)).join(" | "),
  );

  const [{ version: vFinal }] = await sql`
    select version from public.encounters where id = ${encounterId}`;
  check(vFinal === v0 + 1, "…so the version advanced exactly once", `v${v0} -> v${vFinal}`);
} catch (e) {
  check(false, "concurrent open", e.message);
  if (process.env.QA_TRACE) console.error(e);
} finally {
  await connA.end().catch(() => {});
  await connB.end().catch(() => {});

  /**
   * Order matters, and that IS the durability guarantee: clinical history
   * RESTRICTs on the encounter, and the encounter on the patient. Only ids this
   * test created are touched.
   */
  if (cLoc) {
    await sql`delete from public.encounter_events
              where encounter_id in (select id from public.encounters
                                     where practice_location_id = ${cLoc.id})`;
    await sql`delete from public.encounter_diagnoses
              where encounter_id in (select id from public.encounters
                                     where practice_location_id = ${cLoc.id})`;
    await sql`delete from public.encounter_investigations
              where encounter_id in (select id from public.encounters
                                     where practice_location_id = ${cLoc.id})`;
    await sql`delete from public.encounters where practice_location_id = ${cLoc.id}`;
    await sql`delete from public.audit_events where practice_location_id = ${cLoc.id}`;
    await sql`delete from public.appointment_events where practice_location_id = ${cLoc.id}`;
    await sql`delete from public.appointments where practice_location_id = ${cLoc.id}`;
    await sql`delete from public.patient_location_links where practice_location_id = ${cLoc.id}`;
  }
  if (cDoc) await sql`delete from public.patients where owner_doctor_id = ${cDoc.id}`;
  await sql`delete from public.practice_locations where created_by = ${cUid}`;
  await sql`delete from auth.users where id in ${sql(createdUsers)}`;

  const [left] = await sql`
    select count(*)::int as n from auth.users where id in ${sql(createdUsers)}`;
  check(left.n === 0, "concurrency fixture cleaned up");
}

await sql.end();

console.log(
  failures.length === 0
    ? "\nAll encounter checks passed.\n"
    : `\n${failures.length} CHECK(S) FAILED:\n  - ${failures.join("\n  - ")}\n`,
);
process.exit(failures.length === 0 ? 0 : 1);
