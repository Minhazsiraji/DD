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
  "update_encounter_diagnosis",
  "remove_encounter_diagnosis",
  "add_encounter_investigation",
  "update_encounter_investigation",
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

for (const [sig, label] of [
  ["public.encounter_for_update(uuid, uuid, integer)", "load-for-update helper"],
  ["public.assert_patch_shape(jsonb, text[])", "patch validator"],
  ["public.patch_text(jsonb, text, text)", "patch_text"],
  ["public.patch_numeric(jsonb, text, numeric)", "patch_numeric"],
  ["public.patch_int(jsonb, text, integer)", "patch_int"],
]) {
  const [p] = await sql`select has_function_privilege('authenticated', ${sig}, 'EXECUTE') as ok`;
  check(p.ok === false, `the internal ${label} is not executable`);
}

/**
 * Changing a signature with `create or replace` does NOT remove the old one —
 * it creates an OVERLOAD, and the old one keeps whatever grant it had. A caller
 * would still resolve to it by arity, so the seventeen-parameter save with its
 * uncleerable vitals would remain fully reachable.
 */
console.log("\nNo legacy overloads survive the signature changes");
for (const fn of [
  "save_encounter_sections",
  "open_encounter",
  "add_encounter_diagnosis",
  "update_encounter_diagnosis",
  "remove_encounter_diagnosis",
  "add_encounter_investigation",
  "update_encounter_investigation",
  "remove_encounter_investigation",
  "close_encounter",
]) {
  const overloads = await sql`
    select pg_get_function_identity_arguments(p.oid) as args,
           has_function_privilege('authenticated', p.oid, 'EXECUTE') as granted
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = ${fn}`;
  const granted = overloads.filter((o) => o.granted);
  check(
    overloads.length === 1 && granted.length === 1,
    `${fn}: exactly one definition, one grant`,
    overloads.map((o) => `(${o.args})${o.granted ? " granted" : ""}`).join(" | "),
  );
}

const [legacySave] = await sql`
  select count(*)::int as n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'save_encounter_sections'
    and pg_get_function_identity_arguments(p.oid) like '%text, text, text%'`;
check(legacySave.n === 0, "the 17-parameter positional save is gone, not shadowed");

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
    and indexname in ('encounters_one_draft_per_appointment',
                      'encounters_one_unscheduled_draft_at_location')`;
check(draftIdx.n === 2, "partial unique indexes enforce one active draft", `${draftIdx.n}`);

// The location-blind index would silently re-enable cross-location resume.
const [oldIdx] = await sql`
  select count(*)::int as n from pg_indexes
  where schemaname = 'public' and indexname = 'encounters_one_unscheduled_draft'`;
check(oldIdx.n === 0, "the location-blind unscheduled index is gone");

const [idxDef] = await sql`
  select indexdef from pg_indexes
  where schemaname = 'public' and indexname = 'encounters_one_unscheduled_draft_at_location'`;
check(
  /practice_location_id/.test(idxDef?.indexdef ?? ""),
  "…and location is part of the unscheduled draft identity",
);

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

    // IN_CONSULTATION: the doctor has already pressed Start on the queue, which
    // is now the precondition for opening an appointment-linked draft.
    const [appt] = await tx`
      insert into public.appointments (owner_doctor_id, practice_location_id, patient_id,
                                       scheduled_for, session_date, status, created_by)
      values (${docA.id}, ${hospital.id}, ${patA.id},
              '2026-09-01T10:00:00+06:00'::timestamptz, '2026-09-01', 'IN_CONSULTATION', ${uidA})
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

    /**
     * A clinical draft may only be opened once the consultation has actually
     * started. Anything else would record a consultation that operationally
     * never happened — against a cancelled slot, a no-show, or a visit that
     * finished last month.
     */
    console.log("\nAn appointment-linked draft requires IN_CONSULTATION");
    for (const status of [
      "SCHEDULED",
      "CONFIRMED",
      "ARRIVED",
      "CANCELLED",
      "NO_SHOW",
      "COMPLETED",
    ]) {
      const [other] = await tx`
        insert into public.appointments (owner_doctor_id, practice_location_id, patient_id,
                                         scheduled_for, session_date, status, created_by)
        values (${docA.id}, ${hospital.id}, ${patA.id},
                '2026-09-03T10:00:00+06:00'::timestamptz, '2026-09-03',
                ${status}::public.appointment_status, ${uidA})
        returning id`;

      const [beforeEnc] = await tx`select count(*)::int as n from public.encounters`;
      const [beforeEvt] = await tx`select count(*)::int as n from public.encounter_events`;
      const [beforeAud] = await tx`select count(*)::int as n from public.audit_events`;

      let message = "";
      await as(tx, uidA, async () => {
        const denied = await expectDenied(tx, async (t) => {
          await t`select public.open_encounter(${patA.id}, ${hospital.id}, ${other.id})`;
        }).catch(() => true);
        check(denied, `${status} is rejected`);

        // Capture the wording separately — expectDenied swallows it by design.
        try {
          await tx.savepoint(
            (t) => t`select public.open_encounter(${patA.id}, ${hospital.id}, ${other.id})`,
          );
        } catch (e) {
          message = e.message;
        }
      });

      const [afterEnc] = await tx`select count(*)::int as n from public.encounters`;
      const [afterEvt] = await tx`select count(*)::int as n from public.encounter_events`;
      const [afterAud] = await tx`select count(*)::int as n from public.audit_events`;
      check(
        beforeEnc.n === afterEnc.n && beforeEvt.n === afterEvt.n && beforeAud.n === afterAud.n,
        `…writing no encounter, clinical event or audit row (${status})`,
        `${afterEnc.n - beforeEnc.n}/${afterEvt.n - beforeEvt.n}/${afterAud.n - beforeAud.n}`,
      );

      /**
       * The caller already owns this appointment, so naming the STATE problem
       * discloses nothing and tells them what to do. What must never appear is
       * a patient name, a scheduled time, or another party's details.
       */
      check(
        message.includes("APPOINTMENT_NOT_IN_CONSULTATION") &&
          !/Rahim|Hossain|2026-09-03|AA-9000/.test(message),
        `…with an actionable message that discloses nothing (${status})`,
        message,
      );

      await tx`delete from public.appointments where id = ${other.id}`;
    }

    await as(tx, uidA, async () => {
      // …and the encounter RPC did not move the appointment to get there.
      const [a] = await tx`select status from public.appointments where id = ${appt.id}`;
      check(a.status === "IN_CONSULTATION", "opening a draft does not change appointment status");
    });

    /**
     * Location is part of the unscheduled draft's identity. Before the fix,
     * opening at the chamber returned the hospital's draft — and then every
     * chamber write failed the location check, stranding the doctor in a
     * consultation they could not save.
     */
    console.log("\nAn unscheduled draft belongs to ONE location");
    let atHospital, atChamber;
    await as(tx, uidA, async () => {
      [{ open_encounter: atHospital }] = await tx`
        select public.open_encounter(${patA.id}, ${hospital.id}, null)`;
      [{ open_encounter: atChamber }] = await tx`
        select public.open_encounter(${patA.id}, ${chamber.id}, null)`;
      check(atHospital !== atChamber, "opening at B never returns A's draft");

      const [resumeA] = await tx`
        select public.open_encounter(${patA.id}, ${hospital.id}, null) as id`;
      check(resumeA.id === atHospital, "opening again at A resumes A's own draft");

      const [resumeB] = await tx`
        select public.open_encounter(${patA.id}, ${chamber.id}, null) as id`;
      check(resumeB.id === atChamber, "…and at B resumes B's own draft");

      const [rows] = await tx`
        select count(*)::int as n from public.encounters
        where patient_id = ${patA.id} and appointment_id is null and status = 'DRAFT'`;
      check(rows.n === 2, "two locations, two drafts — one occasion each", `${rows.n}`);

      const crossWrite = await expectDenied(tx, async (t) => {
        const [{ v }] = await t`select version as v from public.encounters where id = ${atHospital}`;
        await t`select public.save_encounter_sections(${atHospital}, ${chamber.id}, ${v},
                  '{"chiefComplaints":"written from the wrong location"}'::jsonb)`;
      });
      check(crossWrite, "a location-B mutation cannot alter A's draft");

      const [untouched] = await tx`
        select chief_complaints from public.encounters where id = ${atHospital}`;
      check(untouched.chief_complaints === null, "…and A's draft is unchanged");
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
                    '{"chiefComplaints":"forged complaint"}'::jsonb)`;
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
        await t`select public.save_encounter_sections(${apptEncounter}, ${chamber.id}, 1,
                  '{"chiefComplaints":"x"}'::jsonb)`;
      });
      check(wrongLocation, "the hospital encounter cannot be edited from the chamber");

      const [v] = await tx`
        select public.save_encounter_sections(${apptEncounter}, ${hospital.id}, 1,
          '{"chiefComplaints":"Fever for three days"}'::jsonb) as v`;
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
                  '{"chiefComplaints":"stale tab overwrite"}'::jsonb)`;
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

    /**
     * The patch contract. A doctor who mistyped a blood pressure must be able
     * to REMOVE it — with `coalesce(p_new, existing)` that value was permanent.
     */
    console.log("\nUntouched, set and cleared are three different things");
    const patchVersion = async () => {
      const [{ v }] = await tx`select version as v from public.encounters where id = ${apptEncounter}`;
      return v;
    };
    const savePatch = (patch, version) =>
      tx`select public.save_encounter_sections(${apptEncounter}, ${hospital.id},
           ${version}, ${patch}) as v`;

    await as(tx, uidA, async () => {
      await savePatch(
        {
          presentIllness: "Three days of fever",
          advice: "Rest and fluids",
          vitalSystolic: 120,
          vitalDiastolic: 80,
          vitalTemperatureC: 38.4,
          vitalSpo2: 97,
        },
        await patchVersion(),
      );

      // Touch ONE field; everything else must survive.
      await savePatch({ advice: "Rest, fluids, review in 3 days" }, await patchVersion());
      const [kept] = await tx`
        select chief_complaints, present_illness, advice, vital_systolic
        from public.encounters where id = ${apptEncounter}`;
      check(
        kept.present_illness === "Three days of fever" &&
          kept.chief_complaints === "Fever for three days" &&
          Number(kept.vital_systolic) === 120,
        "a partial save leaves untouched fields alone",
      );
      check(kept.advice === "Rest, fluids, review in 3 days", "…and applies the one supplied");

      // Explicit clear, field by field.
      const before = await patchVersion();
      await savePatch({ presentIllness: null }, before);
      const [clearedText] = await tx`
        select present_illness, version from public.encounters where id = ${apptEncounter}`;
      check(clearedText.present_illness === null, "text can be explicitly cleared");
      check(clearedText.version === before + 1, "…and clearing increments the version");

      for (const [key, column] of [
        ["vitalSystolic", "vital_systolic"],
        ["vitalDiastolic", "vital_diastolic"],
        ["vitalTemperatureC", "vital_temperature_c"],
        ["vitalSpo2", "vital_spo2"],
      ]) {
        await savePatch({ [key]: null }, await patchVersion());
        const [row] = await tx`
          select ${tx(column)} as value from public.encounters where id = ${apptEncounter}`;
        check(row.value === null, `${key} can be explicitly cleared`);
      }

      // An empty string is the same clear a doctor makes by emptying the box.
      await savePatch({ advice: "  " }, await patchVersion());
      const [blanked] = await tx`select advice from public.encounters where id = ${apptEncounter}`;
      check(blanked.advice === null, "an emptied text box clears rather than storing blanks");

      const staleClear = await expectDenied(tx, async (t) => {
        await t`select public.save_encounter_sections(${apptEncounter}, ${hospital.id}, 1,
                  ${{ examination: null }})`;
      });
      check(staleClear, "a stale CLEAR is rejected like any other stale save");

      for (const [label, patch] of [
        ["an unknown field is rejected, not ignored", { chiefComplaint: "typo" }],
        ["an empty patch is rejected", {}],
        ["a string where a vital belongs is rejected", { vitalPulseBpm: "72" }],
        ["a fractional integer vital is rejected rather than rounded", { vitalPulseBpm: 72.4 }],
        ["a number where text belongs is rejected", { advice: 5 }],
      ]) {
        const v = await patchVersion();
        const denied = await expectDenied(tx, async (t) => {
          await t`select public.save_encounter_sections(${apptEncounter}, ${hospital.id}, ${v},
                    ${patch})`;
        });
        check(denied, label);
      }

      /**
       * TECHNICAL bounds, not normal ranges. Every value a real patient can
       * produce must be accepted; only impossible ones are refused.
       */
      const accepted = [
        ["a severe tachycardia is a real reading", { vitalPulseBpm: 220 }],
        ["so is a saturation of 60", { vitalSpo2: 60 }],
        ["so is a fever of 42", { vitalTemperatureC: 42 }],
        ["so is a hypertensive crisis", { vitalSystolic: 250, vitalDiastolic: 140 }],
        ["a newborn's weight", { vitalWeightKg: 2.5 }],
        ["SpO2 at exactly 0", { vitalSpo2: 0 }],
        ["SpO2 at exactly 100", { vitalSpo2: 100 }],
        ["height at exactly 300", { vitalHeightCm: 300 }],
      ];
      for (const [label, patch] of accepted) {
        const v = await patchVersion();
        let ok = true;
        try {
          await tx.savepoint(
            (t) => t`select public.save_encounter_sections(${apptEncounter}, ${hospital.id},
                       ${v}, ${patch})`,
          );
        } catch (e) {
          ok = false;
          check(false, label, e.message);
        }
        if (ok) check(true, label);
      }

      const refused = [
        ["SpO2 of 900 is impossible", { vitalSpo2: 900 }],
        ["a negative pulse is impossible", { vitalPulseBpm: -70 }],
        ["a negative weight is impossible", { vitalWeightKg: -60 }],
        ["a zero pulse is not a measurement", { vitalPulseBpm: 0 }],
        ["a height of 3000 is a unit error", { vitalHeightCm: 3000 }],
        ["a Fahrenheit temperature in the Celsius field", { vitalTemperatureC: 98.6 }],
        ["a diastolic of 5000 is impossible", { vitalDiastolic: 5000 }],
        ["a respiratory rate of 900 is impossible", { vitalRespRate: 900 }],
        ["a weight of 5000 kg is impossible", { vitalWeightKg: 5000 }],
      ];
      for (const [label, patch] of refused) {
        const v = await patchVersion();
        const denied = await expectDenied(tx, async (t) => {
          await t`select public.save_encounter_sections(${apptEncounter}, ${hospital.id}, ${v},
                    ${patch})`;
        });
        check(denied, label);
      }

      // Our own code, not a Postgres constraint string — the UI must never be
      // handed a message written for a database administrator.
      let rangeMessage = "";
      try {
        const v = await patchVersion();
        await tx.savepoint(
          (t) => t`select public.save_encounter_sections(${apptEncounter}, ${hospital.id}, ${v},
                     ${{ vitalSpo2: 900 }})`,
        );
      } catch (e) {
        rangeMessage = e.message;
      }
      check(
        rangeMessage.includes("VITAL_OUT_OF_RANGE") &&
          !/violates check constraint|encounters_spo2_range/.test(rangeMessage),
        "…rejected with our own code, not a constraint violation",
        rangeMessage,
      );

      // Clearing is not a value, so bounds must never stand in the way of
      // removing a wrong reading.
      await savePatch({ vitalPulseBpm: 220 }, await patchVersion());
      await savePatch({ vitalPulseBpm: null }, await patchVersion());
      const [clearedVital] = await tx`
        select vital_pulse_bpm from public.encounters where id = ${apptEncounter}`;
      check(clearedVital.vital_pulse_bpm === null, "an out-of-the-ordinary vital can still be cleared");

      /**
       * The clinical event names the fields; the operational log never sees
       * them at all. Clinical text in an admin-readable audit row is the exact
       * leak the two-trail split exists to prevent.
       */
      const [ev] = await tx`
        select detail from public.encounter_events
        where encounter_id = ${apptEncounter} and event_type = 'SECTIONS_UPDATED'
        order by seq desc limit 1`;
      check(
        JSON.stringify(ev.detail).includes("fields") &&
          !/fever|rest|fluids|review/i.test(JSON.stringify(ev.detail)),
        "the clinical event records field names and version, not values",
        JSON.stringify(ev.detail),
      );

      const auditRows = await tx`
        select meta::text as meta from public.audit_events
        where resource_id = ${apptEncounter}`;
      check(
        auditRows.every((r) => !/fever|rest|fluids|Three days|Rahim/i.test(r.meta)),
        "…and no clinical value reaches the operational audit trail",
        auditRows.map((r) => r.meta).join(" "),
      );
    });

    /**
     * The contract the UI's version coordinator depends on.
     *
     * The add functions return the new row's ID, not the new version, so the
     * caller computes it as expectedVersion + 1. That is only safe if the add
     * increments the version EXACTLY ONCE — no more, no less — so it is
     * asserted here rather than assumed. Re-reading the version from the
     * database instead would absorb another device's increment and mask a real
     * conflict, which is why the arithmetic is preferred to a fetch.
     */
    console.log("\nAn add advances the version by exactly one");
    const versionNow = async () => {
      const [{ v }] = await tx`select version as v from public.encounters where id = ${apptEncounter}`;
      return v;
    };
    await as(tx, uidA, async () => {
      const before = await versionNow();
      const [{ add_encounter_diagnosis: id }] = await tx`
        select public.add_encounter_diagnosis(${apptEncounter}, ${hospital.id}, ${before},
          'Version contract', 'PROVISIONAL'::public.diagnosis_certainty, null)`;
      const afterAdd = await versionNow();
      check(afterAdd === before + 1, "add_encounter_diagnosis: expectedVersion + 1",
        `v${before} -> v${afterAdd}`);

      // …and the caller's arithmetic is immediately usable as the next expected
      // version, which is the whole point.
      const nextVersion = await tx`
        select public.update_encounter_diagnosis(${apptEncounter}, ${hospital.id},
          ${before + 1}, ${id}, ${{ note: "still current" }}) as v`;
      check(nextVersion[0].v === before + 2, "…and that number is accepted by the next mutation");

      const beforeInv = await versionNow();
      await tx`select public.add_encounter_investigation(${apptEncounter}, ${hospital.id},
                 ${beforeInv}, 'Version contract', null)`;
      const afterInv = await versionNow();
      check(afterInv === beforeInv + 1, "add_encounter_investigation: expectedVersion + 1",
        `v${beforeInv} -> v${afterInv}`);

      // Clean up so later ordering assertions still describe what they expect.
      const [{ v: vNow }] = await tx`select version as v from public.encounters where id = ${apptEncounter}`;
      await tx`select public.remove_encounter_diagnosis(${apptEncounter}, ${hospital.id}, ${vNow}, ${id})`;
      const [inv] = await tx`
        select id from public.encounter_investigations
        where encounter_id = ${apptEncounter} and name = 'Version contract'`;
      const [{ v: vNow2 }] = await tx`select version as v from public.encounters where id = ${apptEncounter}`;
      await tx`select public.remove_encounter_investigation(${apptEncounter}, ${hospital.id},
                 ${vNow2}, ${inv.id})`;
    });

    // ---- 11 & 12. diagnoses and investigations -----------------------------
    console.log("\nDiagnoses and investigations stay ordered");
    let dx1, dx2, inv1;
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
        select id, name, position from public.encounter_investigations
        where encounter_id = ${apptEncounter} order by position`;
      check(after.length === 1 && after[0].position === 1, "…and stay ordered after a removal");
      inv1 = after[0].id;
    });

    /**
     * Correcting a finding IN PLACE. Remove-and-re-add is not the same thing:
     * it changes the row id, moves the entry to the end of the list, and reads
     * in the history as one diagnosis withdrawn and another raised. A doctor
     * fixing a typo did neither.
     */
    console.log("\nFindings are corrected in place");
    await as(tx, uidA, async () => {
      const version = async () => {
        const [{ v }] = await tx`select version as v from public.encounters where id = ${apptEncounter}`;
        return v;
      };
      const [before] = await tx`
        select id, label, certainty, position from public.encounter_diagnoses
        where id = ${dx1}`;

      await tx`select public.update_encounter_diagnosis(${apptEncounter}, ${hospital.id},
                 ${await version()}, ${dx1},
                 ${{ label: "Dengue fever with warning signs", certainty: "CONFIRMED",
                     note: "Platelets falling" }})`;

      const [updated] = await tx`
        select id, label, certainty, note, position from public.encounter_diagnoses
        where id = ${dx1}`;
      check(
        updated.label === "Dengue fever with warning signs" &&
          updated.certainty === "CONFIRMED" &&
          updated.note === "Platelets falling",
        "a diagnosis label, certainty and note can all be corrected",
      );
      check(
        updated.id === before.id && updated.position === before.position,
        "…keeping its identity and its place in the list",
        `${before.position} -> ${updated.position}`,
      );

      await tx`select public.update_encounter_diagnosis(${apptEncounter}, ${hospital.id},
                 ${await version()}, ${dx1}, ${{ note: null }})`;
      const [cleared] = await tx`
        select label, certainty, note from public.encounter_diagnoses where id = ${dx1}`;
      check(cleared.note === null, "a diagnosis note can be explicitly cleared");
      check(
        cleared.label === "Dengue fever with warning signs" && cleared.certainty === "CONFIRMED",
        "…without disturbing the fields it did not mention",
      );

      await tx`select public.update_encounter_investigation(${apptEncounter}, ${hospital.id},
                 ${await version()}, ${inv1}, ${{ name: "CBC with platelet count" }})`;
      const [inv] = await tx`
        select name, note, position from public.encounter_investigations where id = ${inv1}`;
      check(
        inv.name === "CBC with platelet count" && inv.note === "Rule out dengue",
        "an investigation name can be corrected without losing its note",
      );

      await tx`select public.update_encounter_investigation(${apptEncounter}, ${hospital.id},
                 ${await version()}, ${inv1}, ${{ note: null }})`;
      const [invCleared] = await tx`
        select name, note from public.encounter_investigations where id = ${inv1}`;
      check(invCleared.note === null, "an investigation note can be explicitly cleared");

      const [bumped] = await tx`
        select version from public.encounters where id = ${apptEncounter}`;
      const [evt] = await tx`
        select event_type, detail from public.encounter_events
        where encounter_id = ${apptEncounter} order by seq desc limit 1`;
      check(
        evt.event_type === "INVESTIGATION_UPDATED" &&
          evt.detail.version === bumped.version &&
          Array.isArray(evt.detail.fields),
        "…each correction bumps the version and writes its own clinical event",
        JSON.stringify(evt.detail),
      );

      const rejections = [
        ["a stale diagnosis update is rejected", (t) =>
          t`select public.update_encounter_diagnosis(${apptEncounter}, ${hospital.id}, 1, ${dx1},
              ${{ label: "stale" }})`],
        ["a stale investigation update is rejected", (t) =>
          t`select public.update_encounter_investigation(${apptEncounter}, ${hospital.id}, 1,
              ${inv1}, ${{ name: "stale" }})`],
        ["a diagnosis cannot be updated through another encounter", async (t) => {
          const [{ v }] = await t`select version as v from public.encounters where id = ${walkInEncounter}`;
          await t`select public.update_encounter_diagnosis(${walkInEncounter}, ${chamber.id}, ${v},
                    ${dx1}, ${{ label: "reached through the wrong encounter" }})`;
        }],
        ["an investigation cannot be updated through another encounter", async (t) => {
          const [{ v }] = await t`select version as v from public.encounters where id = ${walkInEncounter}`;
          await t`select public.update_encounter_investigation(${walkInEncounter}, ${chamber.id},
                    ${v}, ${inv1}, ${{ name: "reached through the wrong encounter" }})`;
        }],
        ["a diagnosis cannot be updated from the wrong location", async (t) => {
          const [{ v }] = await t`select version as v from public.encounters where id = ${apptEncounter}`;
          await t`select public.update_encounter_diagnosis(${apptEncounter}, ${chamber.id}, ${v},
                    ${dx1}, ${{ label: "wrong location" }})`;
        }],
        ["a diagnosis label cannot be cleared", async (t) => {
          const [{ v }] = await t`select version as v from public.encounters where id = ${apptEncounter}`;
          await t`select public.update_encounter_diagnosis(${apptEncounter}, ${hospital.id}, ${v},
                    ${dx1}, ${{ label: null }})`;
        }],
        ["an investigation name cannot be cleared", async (t) => {
          const [{ v }] = await t`select version as v from public.encounters where id = ${apptEncounter}`;
          await t`select public.update_encounter_investigation(${apptEncounter}, ${hospital.id},
                    ${v}, ${inv1}, ${{ name: null }})`;
        }],
        ["an invalid certainty is rejected without a raw enum error", async (t) => {
          const [{ v }] = await t`select version as v from public.encounters where id = ${apptEncounter}`;
          await t`select public.update_encounter_diagnosis(${apptEncounter}, ${hospital.id}, ${v},
                    ${dx1}, ${{ certainty: "PROBABLY" }})`;
        }],
        ["an unknown diagnosis field is rejected", async (t) => {
          const [{ v }] = await t`select version as v from public.encounters where id = ${apptEncounter}`;
          await t`select public.update_encounter_diagnosis(${apptEncounter}, ${hospital.id}, ${v},
                    ${dx1}, ${{ code: "A90" }})`;
        }],
        ["an unknown child id is a safe not-found", async (t) => {
          const [{ v }] = await t`select version as v from public.encounters where id = ${apptEncounter}`;
          await t`select public.update_encounter_diagnosis(${apptEncounter}, ${hospital.id}, ${v},
                    ${crypto.randomUUID()}, ${{ label: "ghost" }})`;
        }],
      ];
      for (const [label, fn] of rejections) check(await expectDenied(tx, fn), label);

      // The wording of the invalid-certainty rejection must not be Postgres's.
      let enumMessage = "";
      try {
        const [{ v }] = await tx`select version as v from public.encounters where id = ${apptEncounter}`;
        await tx.savepoint(
          (t) => t`select public.update_encounter_diagnosis(${apptEncounter}, ${hospital.id}, ${v},
                     ${dx1}, ${{ certainty: "PROBABLY" }})`,
        );
      } catch (e) {
        enumMessage = e.message;
      }
      check(
        enumMessage.includes("PATCH_INVALID") && !/invalid input value for enum/.test(enumMessage),
        "…with our own message, not the database's enum error",
        enumMessage,
      );

      const [survived] = await tx`
        select label, certainty from public.encounter_diagnoses where id = ${dx1}`;
      check(
        survived.label === "Dengue fever with warning signs" && survived.certainty === "CONFIRMED",
        "…and every rejection left the row exactly as it was",
      );
    });

    console.log("\nUpdates obey the same boundaries as every other write");
    for (const [uid, who] of [[uidB, "a colleague doctor"], [uidR, "reception"]]) {
      await as(tx, uid, async () => {
        const denied = await expectDenied(tx, async (t) => {
          await t`select public.update_encounter_diagnosis(${apptEncounter}, ${hospital.id}, 1,
                    ${dx1}, ${{ label: "not theirs" }})`;
        });
        check(denied, `${who} cannot correct a diagnosis`);
      });
    }

    /**
     * The operational contract ADR 0010 §10 now states: ONE audit row per
     * successful mutation, carrying ids, field names and the version — and
     * nothing a receptionist or location administrator must not read.
     */
    console.log("\nEvery successful mutation writes exactly one operational audit row");
    const auditCount = async () => {
      const [r] = await tx`
        select count(*)::int as n from public.audit_events
        where resource_id = ${apptEncounter}`;
      return r.n;
    };
    /**
     * Identify the new row by id, not by timestamp. `occurred_at` defaults to
     * now(), which is TRANSACTION start — every row written inside this test
     * shares one timestamp and "order by occurred_at desc" returns an arbitrary
     * one. Real calls are separate transactions; the test is not.
     */
    const auditIds = async () => {
      const rows = await tx`
        select id from public.audit_events where resource_id = ${apptEncounter}`;
      return rows.map((r) => r.id);
    };
    const encVersion = async () => {
      const [{ v }] = await tx`select version as v from public.encounters where id = ${apptEncounter}`;
      return v;
    };

    await as(tx, uidA, async () => {
      const mutations = [
        ["encounter.sections_updated", async (v) =>
          tx`select public.save_encounter_sections(${apptEncounter}, ${hospital.id}, ${v},
               ${{ examination: "Chest clear" }})`],
        ["encounter.diagnosis_added", async (v) =>
          tx`select public.add_encounter_diagnosis(${apptEncounter}, ${hospital.id}, ${v},
               'Audit trial diagnosis', 'PROVISIONAL'::public.diagnosis_certainty, 'a private note')`],
        ["encounter.diagnosis_updated", async (v) => {
          const [d] = await tx`
            select id from public.encounter_diagnoses where encounter_id = ${apptEncounter}
            order by position desc limit 1`;
          await tx`select public.update_encounter_diagnosis(${apptEncounter}, ${hospital.id}, ${v},
                     ${d.id}, ${{ label: "Audit trial revised" }})`;
        }],
        ["encounter.diagnosis_removed", async (v) => {
          const [d] = await tx`
            select id from public.encounter_diagnoses where encounter_id = ${apptEncounter}
            order by position desc limit 1`;
          await tx`select public.remove_encounter_diagnosis(${apptEncounter}, ${hospital.id}, ${v},
                     ${d.id})`;
        }],
        ["encounter.investigation_added", async (v) =>
          tx`select public.add_encounter_investigation(${apptEncounter}, ${hospital.id}, ${v},
               'Audit trial test', 'a private note')`],
        ["encounter.investigation_updated", async (v) => {
          const [i] = await tx`
            select id from public.encounter_investigations where encounter_id = ${apptEncounter}
            order by position desc limit 1`;
          await tx`select public.update_encounter_investigation(${apptEncounter}, ${hospital.id},
                     ${v}, ${i.id}, ${{ note: null }})`;
        }],
        ["encounter.investigation_removed", async (v) => {
          const [i] = await tx`
            select id from public.encounter_investigations where encounter_id = ${apptEncounter}
            order by position desc limit 1`;
          await tx`select public.remove_encounter_investigation(${apptEncounter}, ${hospital.id},
                     ${v}, ${i.id})`;
        }],
      ];

      for (const [action, run] of mutations) {
        const before = await auditIds();
        await run(await encVersion());
        const fresh = await tx`
          select action, meta, practice_location_id, actor_id, resource_type
          from public.audit_events
          where resource_id = ${apptEncounter} and not (id = any(${before}))`;
        check(
          fresh.length === 1 && fresh[0].action === action,
          `${action} writes exactly one row`,
          `${fresh.length} row(s): ${fresh.map((r) => r.action).join(", ")}`,
        );
        const row = fresh[0] ?? {};
        check(
          row.practice_location_id === hospital.id &&
            row.actor_id === uidA &&
            row.resource_type === "encounter" &&
            typeof row.meta?.version === "number",
          `…carrying location, actor and version (${action})`,
        );
      }

      /**
       * The whole reason the two trails are separate. Every clinical string
       * supplied above, checked against every audit row for this encounter.
       */
      const all = await tx`
        select action, meta::text as meta from public.audit_events
        where resource_id = ${apptEncounter}`;
      const leaked = all.filter((r) =>
        /Audit trial|private note|Chest clear|Fever|Dengue|Anaemia|CBC|NS1|Rahim|Hossain|220|250/i.test(
          r.meta,
        ),
      );
      check(
        leaked.length === 0,
        "no clinical string or vital value appears in any audit row",
        leaked.map((r) => `${r.action}:${r.meta}`).join(" | "),
      );

      const allMeta = all.map((r) => JSON.parse(r.meta));
      check(
        allMeta.every((m) =>
          Object.keys(m).every((k) =>
            ["fields", "version", "diagnosisId", "investigationId", "appointmentLinked", "status"]
              .includes(k),
          ),
        ),
        "…and every meta key is one the ADR lists",
        JSON.stringify([...new Set(allMeta.flatMap((m) => Object.keys(m)))]),
      );

      // Rejected calls of every kind must leave no operational trace either.
      const rejected = [
        ["a stale save", (t) =>
          t`select public.save_encounter_sections(${apptEncounter}, ${hospital.id}, 1,
              ${{ advice: "stale" }})`],
        ["a cross-location save", async (t) => {
          const v = await encVersion();
          await t`select public.save_encounter_sections(${apptEncounter}, ${chamber.id}, ${v},
                    ${{ advice: "wrong place" }})`;
        }],
        ["an out-of-range vital", async (t) => {
          const v = await encVersion();
          await t`select public.save_encounter_sections(${apptEncounter}, ${hospital.id}, ${v},
                    ${{ vitalSpo2: 900 }})`;
        }],
        ["an unknown child id", async (t) => {
          const v = await encVersion();
          await t`select public.update_encounter_diagnosis(${apptEncounter}, ${hospital.id}, ${v},
                    ${crypto.randomUUID()}, ${{ label: "ghost" }})`;
        }],
      ];
      for (const [label, fn] of rejected) {
        const before = await auditCount();
        check(await expectDenied(tx, fn), `${label} is rejected`);
        check((await auditCount()) === before, `…and writes no audit row (${label})`);
      }
    });

    await as(tx, uidB, async () => {
      const before = await auditCount();
      const denied = await expectDenied(tx, async (t) => {
        await t`select public.save_encounter_sections(${apptEncounter}, ${hospital.id}, 1,
                  ${{ advice: "not mine" }})`;
      });
      check(denied, "an unauthorised save is rejected");
      check((await auditCount()) === before, "…and writes no audit row");
    });

    /**
     * The operational trail is REQUIRED, not best-effort (ADR 0010 §10). If it
     * cannot be stored, the clinical change must not happen either — otherwise
     * the record and its trail can disagree, which is worse than either alone.
     */
    console.log("\nA failed operational audit rolls the clinical change back");
    const [beforeAudit] = await tx`
      select version, advice from public.encounters where id = ${apptEncounter}`;

    await tx`alter table public.audit_events
             add constraint qa_block_encounter_audit
             check (action <> 'encounter.sections_updated') not valid`;

    await as(tx, uidA, async () => {
      const rolled = await expectDenied(tx, async (t) => {
        await t`select public.save_encounter_sections(${apptEncounter}, ${hospital.id},
                  ${beforeAudit.version}, ${{ advice: "should not survive" }})`;
      });
      check(rolled, "a failing audit write aborts the clinical change");
    });

    await tx`alter table public.audit_events drop constraint qa_block_encounter_audit`;

    const [afterAudit] = await tx`
      select version, advice from public.encounters where id = ${apptEncounter}`;
    check(
      afterAudit.version === beforeAudit.version && afterAudit.advice === beforeAudit.advice,
      "…and neither the text nor the version advanced",
      `v${beforeAudit.version} -> v${afterAudit.version}`,
    );

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
                  ${beforeAtomic.version}, '{"assessment":"Likely viral"}'::jsonb)`;
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
          t`select public.save_encounter_sections(${walkInEncounter}, ${chamber.id}, ${v2},
              '{"advice":"late"}'::jsonb)`],
        ["a diagnosis cannot be added after completion", async (t) =>
          t`select public.add_encounter_diagnosis(${walkInEncounter}, ${chamber.id}, ${v2}, 'late',
              'PROVISIONAL'::public.diagnosis_certainty, null)`],
        ["an investigation cannot be added after completion", async (t) =>
          t`select public.add_encounter_investigation(${walkInEncounter}, ${chamber.id}, ${v2}, 'late', null)`],
        ["a diagnosis cannot be corrected after completion", async (t) => {
          const [d] = await t`
            select id from public.encounter_diagnoses where encounter_id = ${walkInEncounter} limit 1`;
          await t`select public.update_encounter_diagnosis(${walkInEncounter}, ${chamber.id}, ${v2},
                    ${d?.id ?? crypto.randomUUID()}, ${{ label: "late correction" }})`;
        }],
        ["an investigation cannot be corrected after completion", async (t) => {
          const [i] = await t`
            select id from public.encounter_investigations where encounter_id = ${walkInEncounter} limit 1`;
          await t`select public.update_encounter_investigation(${walkInEncounter}, ${chamber.id},
                    ${v2}, ${i?.id ?? crypto.randomUUID()}, ${{ name: "late correction" }})`;
        }],
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
    /**
     * The RPC's range check is manners; the constraint is the boundary. Run as
     * the OWNER, with the RPC entirely out of the picture — this is what holds
     * if anything ever reaches the table another way.
     */
    console.log("\nVital ranges hold at the table, not just in the RPC");
    for (const [label, column, value] of [
      ["SpO2 of 900", "vital_spo2", 900],
      ["a negative pulse", "vital_pulse_bpm", -70],
      ["a negative weight", "vital_weight_kg", -60],
      ["a height of 3000", "vital_height_cm", 3000],
      ["a respiratory rate of 900", "vital_resp_rate", 900],
      ["a diastolic of 900", "vital_diastolic", 900],
      ["a systolic of 900", "vital_systolic", 900],
      ["a temperature of 98.6", "vital_temperature_c", 98.6],
    ]) {
      const denied = await expectDenied(tx, async (t) => {
        await t.unsafe(
          `update public.encounters set ${column} = ${value} where id = '${apptEncounter}'`,
        );
      });
      check(denied, `${label} is refused by the database itself`);
    }

    const stillClearable = await expectDenied(tx, async (t) => {
      await t`update public.encounters set vital_spo2 = null where id = ${apptEncounter}`;
    });
    check(!stillClearable, "…while null passes every constraint");

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
            '2026-09-01T10:00:00+06:00'::timestamptz, '2026-09-01', 'IN_CONSULTATION', ${cUid})
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
               ${{ chiefComplaints: `note from ${Math.random()}` }})`,
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
