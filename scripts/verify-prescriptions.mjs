/**
 * Prescriptions (Stage 7A): identity, the read boundary, immutability and the
 * finalisation contract.
 *
 * Executed as the `authenticated` role inside a transaction that is ALWAYS
 * rolled back, except the concurrency section, which needs two connections that
 * really commit and removes exactly the ids it created.
 *
 *   node --env-file=.env.local scripts/verify-prescriptions.mjs
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

const RX_TABLES = ["prescriptions", "prescription_items", "prescription_events"];

const SNAP = {
  schema: 1,
  doctor: { fullName: "Dr A", qualification: "MBBS", bmdc: "A-12345" },
  location: { name: "QA Hospital", address: "12 Test Road" },
  patient: { fullName: "Rahim Hossain", patientNumber: "AA-900001", ageYears: 40 },
  template: { paperSize: "A4", marginMm: 15, showSignature: true },
};

// ---------------------------------------------------------------------------
// Static posture
// ---------------------------------------------------------------------------
console.log("\nRow Level Security");
for (const table of RX_TABLES) {
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
  where schemaname = 'public' and tablename = any(${RX_TABLES})
    and cmd in ('INSERT','UPDATE','DELETE')`;
check(writePolicies.n === 0, "no write policies advertise a direct path");

// ---- 18. one granted definition per RPC ------------------------------------
console.log("\nOne definition, one grant, per function");
for (const fn of [
  "open_prescription",
  "add_prescription_item",
  "update_prescription_item",
  "remove_prescription_item",
  "move_prescription_item",
  "finalize_prescription",
  "finalized_prescriptions_at",
  "owns_prescription",
  "may_hand_over_prescription",
]) {
  const rows = await sql`
    select p.prosecdef, p.proconfig,
           has_function_privilege('authenticated', p.oid, 'EXECUTE') as granted
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = ${fn}`;
  check(rows.length === 1, `${fn}: exactly one definition`, `${rows.length}`);
  check(rows[0]?.prosecdef === true, `${fn}: SECURITY DEFINER`);
  check(
    (rows[0]?.proconfig ?? []).some((c) => c.startsWith("search_path=")),
    `${fn}: search_path pinned`,
  );
  check(rows[0]?.granted === true, `${fn}: granted to authenticated`);
}

for (const [sig, label] of [
  ["public.prescription_for_update(uuid, uuid, integer)", "load-for-update helper"],
  ["public.log_prescription_audit(uuid, uuid, text, jsonb)", "audit writer"],
  ["public.prescription_item_fields()", "field whitelist"],
]) {
  const [p] = await sql`select has_function_privilege('authenticated', ${sig}, 'EXECUTE') as ok`;
  check(p.ok === false, `the internal ${label} is not executable`);
}

// ---- 17. no cascade can erase history --------------------------------------
console.log("\nHistory cannot be cascade-deleted");
const cascades = await sql`
  select c.conname, c.confdeltype from pg_constraint c
  join pg_class t on t.oid = c.conrelid
  join pg_namespace n on n.oid = t.relnamespace
  where n.nspname = 'public' and c.contype = 'f' and t.relname = any(${RX_TABLES})`;
const cascading = cascades.filter((c) => c.confdeltype === "c").map((c) => c.conname);
check(cascading.length === 0, "no prescription foreign key cascades on delete",
  cascading.join(", "));

const [draftIdx] = await sql`
  select count(*)::int as n from pg_indexes
  where schemaname = 'public'
    and indexname in ('prescriptions_one_draft_per_encounter', 'prescriptions_one_replacement')`;
check(draftIdx.n === 2, "partial unique indexes guard the draft and the chain", `${draftIdx.n}`);

// Write-once assets: nothing may update or delete a finalised signature.
const assetPolicies = await sql`
  select cmd from pg_policies
  where schemaname = 'storage' and tablename = 'objects' and policyname like 'prescription_assets%'`;
const cmds = assetPolicies.map((p) => p.cmd).sort();
check(
  !cmds.includes("UPDATE") && !cmds.includes("DELETE"),
  "finalised assets have no update or delete policy",
  cmds.join(", "),
);

// ---------------------------------------------------------------------------
// Executed
// ---------------------------------------------------------------------------
const uidA = crypto.randomUUID(); // Dr A — owns the encounter and prescription
const uidB = crypto.randomUUID(); // Dr B — colleague at the SAME hospital
const uidR = crypto.randomUUID(); // reception at the hospital
const uidM = crypto.randomUUID(); // location admin at the hospital

try {
  await sql.begin(async (tx) => {
    for (const [uid, name] of [
      [uidA, "Dr A"], [uidB, "Dr B"], [uidR, "Reception R"], [uidM, "Admin M"],
    ]) {
      await tx`insert into auth.users (id, email) values (${uid}, ${`${uid}@qa.invalid`})`;
      await tx`insert into public.profiles (id, full_name) values (${uid}, ${name})`;
    }

    const [docA] = await tx`insert into public.doctor_profiles (user_id, patient_number_prefix)
                            values (${uidA}, 'AA') returning id`;
    const [docB] = await tx`insert into public.doctor_profiles (user_id, patient_number_prefix)
                            values (${uidB}, 'BB') returning id`;

    const [hospital] = await tx`insert into public.practice_locations (name, type, created_by)
                                values ('QA Hospital', 'HOSPITAL', ${uidA}) returning id`;
    const [chamber] = await tx`insert into public.practice_locations (name, type, created_by)
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

    const [apptA] = await tx`
      insert into public.appointments (owner_doctor_id, practice_location_id, patient_id,
                                       scheduled_for, session_date, status, created_by)
      values (${docA.id}, ${hospital.id}, ${patA.id},
              '2026-09-01T10:00:00+06:00'::timestamptz, '2026-09-01', 'IN_CONSULTATION', ${uidA})
      returning id`;

    const [encA] = await tx`
      insert into public.encounters (owner_doctor_id, patient_id, practice_location_id,
                                     appointment_id, created_by)
      values (${docA.id}, ${patA.id}, ${hospital.id}, ${apptA.id}, ${uidA}) returning id`;
    const [encB] = await tx`
      insert into public.encounters (owner_doctor_id, patient_id, practice_location_id, created_by)
      values (${docB.id}, ${patB.id}, ${hospital.id}, ${uidB}) returning id`;

    const version = async (id) => {
      const [{ v }] = await tx`select version as v from public.prescriptions where id = ${id}`;
      return v;
    };

    // ---- 2. identity always matches the encounter --------------------------
    console.log("\nIdentity is derived from the encounter, never supplied");
    let rx;
    await as(tx, uidA, async () => {
      [{ open_prescription: rx }] = await tx`
        select public.open_prescription(${encA.id}, ${hospital.id}, null)`;
      check(Boolean(rx), "the owning doctor opens a prescription");

      const [row] = await tx`
        select owner_doctor_id, patient_id, practice_location_id, encounter_id, status, version
        from public.prescriptions where id = ${rx}`;
      check(
        row.owner_doctor_id === docA.id &&
          row.patient_id === patA.id &&
          row.practice_location_id === hospital.id &&
          row.encounter_id === encA.id,
        "doctor, patient and location come from the encounter",
      );
      check(row.status === "DRAFT" && row.version === 1, "…and it starts as DRAFT v1");

      const [again] = await tx`
        select public.open_prescription(${encA.id}, ${hospital.id}, null) as id`;
      check(again.id === rx, "opening again RESUMES rather than duplicating");
    });

    // ---- 6. wrong doctor / encounter / location ----------------------------
    console.log("\nLineage cannot be forged");
    await as(tx, uidA, async () => {
      const notMine = await expectDenied(tx, async (t) => {
        await t`select public.open_prescription(${encB.id}, ${hospital.id}, null)`;
      });
      check(notMine, "cannot open a prescription on another doctor's encounter");

      const wrongLocation = await expectDenied(tx, async (t) => {
        await t`select public.open_prescription(${encA.id}, ${chamber.id}, null)`;
      });
      check(wrongLocation, "…nor from a location the encounter does not belong to");
    });

    await as(tx, uidB, async () => {
      const colleague = await expectDenied(tx, async (t) => {
        const v = await version(rx);
        await t`select public.add_prescription_item(${rx}, ${hospital.id}, ${v},
                  ${{ displayName: "Forged" }})`;
      });
      check(colleague, "a colleague doctor cannot write to it");
    });

    // ---- 4. items are transactional ----------------------------------------
    console.log("\nMedicine lines");
    let item1, item2;
    await as(tx, uidA, async () => {
      [{ add_prescription_item: item1 }] = await tx`
        select public.add_prescription_item(${rx}, ${hospital.id}, ${await version(rx)},
          ${{
            displayName: "Napa 500",
            brandName: "Napa",
            genericName: "Paracetamol",
            strengthText: "500 mg",
            doseText: "1 tablet",
            dosageForm: "Tablet",
            route: "Oral",
            scheduleText: "1+0+1",
            durationText: "5 days",
            quantityText: "10 tablets",
            foodRelation: "After food",
            instructions: "খাবারের পরে",
          }})`;
      check(Boolean(item1), "a line is added with dose SEPARATE from strength");

      const [row] = await tx`
        select strength_text, dose_text, schedule_text, instructions, position
        from public.prescription_items where id = ${item1}`;
      check(
        row.strength_text === "500 mg" && row.dose_text === "1 tablet",
        "…strength is the product, dose is what the patient takes",
      );
      check(row.schedule_text === "1+0+1", "…the schedule is stored once, as written");
      check(row.instructions === "খাবারের পরে", "…and Bangla instructions survive");

      [{ add_prescription_item: item2 }] = await tx`
        select public.add_prescription_item(${rx}, ${hospital.id}, ${await version(rx)},
          ${{ displayName: "Omeprazole 20", doseText: "1 capsule", scheduleText: "1+0+0" }})`;

      const rows = await tx`
        select position from public.prescription_items where prescription_id = ${rx} order by position`;
      check(rows.map((r) => r.position).join(",") === "1,2", "lines are appended in order");

      // No parallel structured schedule exists to disagree with the text.
      const cols = await tx`
        select column_name from information_schema.columns
        where table_schema = 'public' and table_name = 'prescription_items'`;
      const names = cols.map((c) => c.column_name);
      check(
        !names.includes("frequency_struct") && !names.includes("frequency_code"),
        "there is no second schedule representation to drift",
      );
      check(
        !names.includes("generic_id") && !names.includes("brand_id"),
        "no catalogue foreign keys were invented ahead of a catalogue",
      );
    });

    await as(tx, uidA, async () => {
      const v = await version(rx);
      await tx`select public.update_prescription_item(${rx}, ${hospital.id}, ${v}, ${item1},
                 ${{ doseText: "2 tablets", instructions: null }})`;
      const [row] = await tx`
        select dose_text, instructions, position from public.prescription_items where id = ${item1}`;
      check(row.dose_text === "2 tablets", "a line can be corrected in place");
      check(row.instructions === null, "…and its instructions explicitly cleared");
      check(row.position === 1, "…keeping its place in the list");

      const v2 = await version(rx);
      await tx`select public.move_prescription_item(${rx}, ${hospital.id}, ${v2}, ${item2}, 1)`;
      const order = await tx`
        select id, position from public.prescription_items where prescription_id = ${rx} order by position`;
      check(order[0].id === item2 && order[1].id === item1, "lines can be reordered");

      const v3 = await version(rx);
      await tx`select public.remove_prescription_item(${rx}, ${hospital.id}, ${v3}, ${item2})`;
      const after = await tx`
        select position from public.prescription_items where prescription_id = ${rx} order by position`;
      check(after.length === 1 && after[0].position === 1, "removing one closes the gap");

      const foreign = await expectDenied(tx, async (t) => {
        const v4 = await version(rx);
        const [other] = await t`select public.open_prescription(${encA.id}, ${hospital.id}, null) as id`;
        void other;
        await t`select public.update_prescription_item(${rx}, ${hospital.id}, ${v4},
                  ${crypto.randomUUID()}, ${{ doseText: "ghost" }})`;
      });
      check(foreign, "an unknown line id is a safe not-found");
    });

    // ---- 3. version CAS ----------------------------------------------------
    console.log("\nThe prescription carries its own version");
    await as(tx, uidA, async () => {
      const [enc] = await tx`select version from public.encounters where id = ${encA.id}`;
      check(enc.version === 1, "encounter version untouched by prescription work", `v${enc.version}`);

      const stale = await expectDenied(tx, async (t) => {
        await t`select public.add_prescription_item(${rx}, ${hospital.id}, 1,
                  ${{ displayName: "Stale" }})`;
      });
      check(stale, "a stale version is REJECTED");

      const [{ n }] = await tx`
        select count(*)::int as n from public.prescription_items where prescription_id = ${rx}`;
      check(n === 1, "…and nothing was written", `${n} line(s)`);
    });

    // ---- 5. direct writes --------------------------------------------------
    console.log("\nDirect writes cannot bypass the RPCs");
    await as(tx, uidA, async () => {
      const cases = [
        ["cannot INSERT a prescription directly", (t) =>
          t`insert into public.prescriptions (encounter_id, owner_doctor_id, patient_id, practice_location_id)
            values (${encA.id}, ${docA.id}, ${patA.id}, ${hospital.id})`],
        ["cannot UPDATE a prescription directly", (t) =>
          t`update public.prescriptions set status = 'FINALIZED' where id = ${rx}`],
        ["cannot DELETE a prescription", (t) =>
          t`delete from public.prescriptions where id = ${rx}`],
        ["cannot INSERT a line directly", (t) =>
          t`insert into public.prescription_items (prescription_id, display_name, position)
            values (${rx}, 'Forged', 9)`],
        ["cannot UPDATE a line directly", (t) =>
          t`update public.prescription_items set display_name = 'Tampered' where id = ${item1}`],
        ["cannot forge clinical history", (t) =>
          t`insert into public.prescription_events (prescription_id, event_type)
            values (${rx}, 'FINALIZED')`],
        ["clinical history cannot be rewritten", (t) =>
          t`update public.prescription_events set detail = '{}'::jsonb`],
        ["clinical history cannot be deleted", (t) =>
          t`delete from public.prescription_events`],
      ];
      for (const [label, fn] of cases) check(await expectDenied(tx, fn), label);
    });

    // ---- 8 & 9 & 7. who may read what --------------------------------------
    console.log("\nA DRAFT is doctor-only");
    for (const [uid, who] of [[uidR, "reception"], [uidM, "the location admin"], [uidB, "a colleague doctor"]]) {
      await as(tx, uid, async () => {
        const [p] = await tx`select count(*)::int as n from public.prescriptions`;
        const [i] = await tx`select count(*)::int as n from public.prescription_items`;
        const [e] = await tx`select count(*)::int as n from public.prescription_events`;
        check(
          p.n === 0 && i.n === 0 && e.n === 0,
          `${who} sees no draft prescription at all`,
          `${p.n}/${i.n}/${e.n}`,
        );

        const cannotFinalize = await expectDenied(tx, async (t) => {
          await t`select public.finalize_prescription(${rx}, ${hospital.id}, 2, null, 1,
                    ${SNAP.doctor}, ${SNAP.location}, ${SNAP.patient}, ${SNAP.template}, null)`;
        });
        check(cannotFinalize, `${who} cannot finalise it`);
      });
    }

    // ---- 10 & 11. finalisation ---------------------------------------------
    console.log("\nFinalisation");
    await as(tx, uidA, async () => {
      const empty = await expectDenied(tx, async (t) => {
        const [blank] = await t`select public.open_prescription(${encB.id}, ${hospital.id}, null) as id`;
        void blank;
      });
      check(empty, "…(cannot even open one on someone else's encounter)");

      const badTemplate = await expectDenied(tx, async (t) => {
        await t`select public.finalize_prescription(${rx}, ${hospital.id}, ${await version(rx)},
                  ${crypto.randomUUID()}, 1, ${SNAP.doctor}, ${SNAP.location},
                  ${SNAP.patient}, ${SNAP.template}, null)`;
      });
      check(badTemplate, "a template that is not the doctor's is refused");

      const noSnapshot = await expectDenied(tx, async (t) => {
        await t`select public.finalize_prescription(${rx}, ${hospital.id}, ${await version(rx)},
                  null, null, null, null, null, null, null)`;
      });
      check(noSnapshot, "finalising without snapshots is refused");

      const v = await version(rx);
      const [{ finalize_prescription: nextVersion }] = await tx`
        select public.finalize_prescription(${rx}, ${hospital.id}, ${v}, null,
          ${SNAP.schema}, ${SNAP.doctor}, ${SNAP.location}, ${SNAP.patient}, ${SNAP.template},
          ${"prescription-assets/" + uidA + "/" + rx + "/signature.png"})`;
      check(nextVersion === v + 1, "the owning doctor finalises it", `v${v} -> v${nextVersion}`);

      const [row] = await tx`
        select status, finalized_at, finalized_by, snapshot_schema_version,
               doctor_snapshot, patient_snapshot, signature_asset_path
        from public.prescriptions where id = ${rx}`;
      check(row.status === "FINALIZED" && Boolean(row.finalized_at), "…and it is marked finalised");
      check(row.finalized_by === uidA, "…by the doctor who approved it");
      check(
        row.snapshot_schema_version === 1 && row.doctor_snapshot.bmdc === "A-12345",
        "…with a versioned snapshot of what was approved",
      );
      check(
        !String(row.signature_asset_path).startsWith("http"),
        "…and a storage PATH, never a signed URL",
        row.signature_asset_path,
      );

      const [ev] = await tx`
        select count(*)::int as n from public.prescription_events
        where prescription_id = ${rx} and event_type = 'FINALIZED'`;
      const [au] = await tx`
        select count(*)::int as n from public.audit_events
        where resource_id = ${rx} and action = 'prescription.finalized'`;
      check(ev.n === 1 && au.n === 1, "one clinical event and one audit row", `${ev.n}/${au.n}`);
    });

    // ---- 12. finalised content is immutable --------------------------------
    console.log("\nA finalised prescription is immutable");
    await as(tx, uidA, async () => {
      const v = await version(rx);
      const attempts = [
        ["cannot add a line after finalising", (t) =>
          t`select public.add_prescription_item(${rx}, ${hospital.id}, ${v}, ${{ displayName: "Late" }})`],
        ["cannot edit a line after finalising", (t) =>
          t`select public.update_prescription_item(${rx}, ${hospital.id}, ${v}, ${item1},
              ${{ doseText: "late" }})`],
        ["cannot remove a line after finalising", (t) =>
          t`select public.remove_prescription_item(${rx}, ${hospital.id}, ${v}, ${item1})`],
        ["cannot reorder after finalising", (t) =>
          t`select public.move_prescription_item(${rx}, ${hospital.id}, ${v}, ${item1}, 1)`],
        ["cannot finalise twice", (t) =>
          t`select public.finalize_prescription(${rx}, ${hospital.id}, ${v}, null, 1,
              ${SNAP.doctor}, ${SNAP.location}, ${SNAP.patient}, ${SNAP.template}, null)`],
        ["cannot rewrite the finalised row directly", (t) =>
          t`update public.prescriptions set status = 'DRAFT' where id = ${rx}`],
        ["cannot delete a finalised line directly", (t) =>
          t`delete from public.prescription_items where id = ${item1}`],
      ];
      for (const [label, fn] of attempts) check(await expectDenied(tx, fn), label);
    });

    // ---- 9 & 7. finalised visibility ---------------------------------------
    console.log("\nFinalised paperwork reaches the front desk, and no further");
    for (const [uid, who] of [[uidR, "reception"], [uidM, "the location admin"]]) {
      await as(tx, uid, async () => {
        const [p] = await tx`select count(*)::int as n from public.prescriptions`;
        const [i] = await tx`select count(*)::int as n from public.prescription_items`;
        check(p.n === 1 && i.n === 1, `${who} can read the finalised prescription`, `${p.n}/${i.n}`);

        const [e] = await tx`select count(*)::int as n from public.prescription_events`;
        check(e.n === 0, `${who} still sees no clinical history`);

        const rows = await tx`
          select * from public.finalized_prescriptions_at(${hospital.id}, null)`;
        check(rows.length === 1, `${who} can list it for handover`);

        const elsewhere = await expectDenied(tx, async (t) => {
          await t`select * from public.finalized_prescriptions_at(${chamber.id}, null)`;
        });
        check(elsewhere, `${who} cannot list from a location they do not work at`);

        const cannotWrite = await expectDenied(tx, async (t) => {
          await t`select public.add_prescription_item(${rx}, ${hospital.id}, 3,
                    ${{ displayName: "Front desk" }})`;
        });
        check(cannotWrite, `${who} cannot add a medicine`);
      });
    }

    await as(tx, uidB, async () => {
      const [p] = await tx`select count(*)::int as n from public.prescriptions`;
      check(p.n === 0, "a colleague doctor sees nothing, finalised or not");
    });

    // ---- 13 & 14. snapshots outlive their sources ---------------------------
    console.log("\nSnapshots outlive the records they were taken from");
    await tx`update public.profiles set full_name = 'Dr A (renamed)' where id = ${uidA}`;
    await tx`update public.doctor_profiles set bmdc_registration_no = 'CHANGED', signature_url = null
             where id = ${docA.id}`;
    await tx`update public.practice_locations set name = 'Renamed Hospital' where id = ${hospital.id}`;
    await tx`update public.patients set full_name = 'Corrected Name' where id = ${patA.id}`;

    const [after] = await tx`
      select doctor_snapshot, location_snapshot, patient_snapshot, signature_asset_path
      from public.prescriptions where id = ${rx}`;
    check(after.doctor_snapshot.fullName === "Dr A", "the doctor snapshot is unchanged");
    check(after.doctor_snapshot.bmdc === "A-12345", "…including the BMDC number");
    check(after.location_snapshot.name === "QA Hospital", "the location snapshot is unchanged");
    check(after.patient_snapshot.fullName === "Rahim Hossain", "the patient snapshot is unchanged");
    check(
      after.signature_asset_path.includes(rx),
      "the signature reference survives the profile signature being cleared",
    );

    // ---- 15. replacement lineage -------------------------------------------
    console.log("\nCorrections are a new prescription, not an edit");
    let replacement;
    await as(tx, uidA, async () => {
      const needsReason = await expectDenied(tx, async (t) => {
        await t`select public.open_prescription(${encA.id}, ${hospital.id}, null)`;
      });
      check(needsReason, "a replacement without a reason is refused");

      [{ open_prescription: replacement }] = await tx`
        select public.open_prescription(${encA.id}, ${hospital.id}, ${"Wrong dose issued"})`;
      const [row] = await tx`
        select replaces_prescription_id, replacement_reason, status, patient_id,
               owner_doctor_id, practice_location_id, encounter_id
        from public.prescriptions where id = ${replacement}`;
      check(row.replaces_prescription_id === rx, "the replacement points at what it replaces");
      check(row.replacement_reason === "Wrong dose issued", "…and carries the reason");
      check(row.status === "DRAFT", "…and starts as a fresh draft");
      check(
        row.owner_doctor_id === docA.id && row.patient_id === patA.id &&
          row.practice_location_id === hospital.id && row.encounter_id === encA.id,
        "…and cannot cross doctor, patient, encounter or location",
      );

      const [original] = await tx`select status from public.prescriptions where id = ${rx}`;
      check(original.status === "FINALIZED", "…while the original stays finalised and untouched");
    });

    const twoReplacements = await expectDenied(tx, async (t) => {
      await t`insert into public.prescriptions
                (encounter_id, owner_doctor_id, patient_id, practice_location_id,
                 replaces_prescription_id, replacement_reason)
              values (${encA.id}, ${docA.id}, ${patA.id}, ${hospital.id}, ${rx}, 'second')`;
    });
    check(twoReplacements, "one prescription cannot have two direct replacements");

    // ---- 16. clinical text stays out of the operational log ----------------
    console.log("\nNo medicine name reaches the operational audit trail");
    const auditRows = await tx`
      select action, meta::text as meta from public.audit_events
      where resource_type = 'prescription'`;
    const leaked = auditRows.filter((r) =>
      /Napa|Paracetamol|Omeprazole|500 mg|1\+0\+1|tablet|খাবারের/i.test(r.meta),
    );
    check(
      leaked.length === 0,
      "no medicine, dose, schedule or instruction in audit meta",
      leaked.map((r) => `${r.action}:${r.meta}`).join(" | "),
    );
    check(auditRows.length >= 6, "…while the operational trail is still complete",
      `${auditRows.length} rows`);

    const [clinical] = await tx`
      select detail::text as d from public.prescription_events
      where prescription_id = ${rx} and event_type = 'ITEM_ADDED' limit 1`;
    check(/Napa/.test(clinical.d), "the clinical history DOES name the medicine");

    // ---- 17. history survives deletion attempts ----------------------------
    console.log("\nHistory cannot be erased by deleting a parent");
    for (const [label, fn] of [
      ["a patient with a prescription cannot be deleted", (t) =>
        t`delete from public.patients where id = ${patA.id}`],
      ["an encounter with a prescription cannot be deleted", (t) =>
        t`delete from public.encounters where id = ${encA.id}`],
      ["a location with prescriptions cannot be deleted", (t) =>
        t`delete from public.practice_locations where id = ${hospital.id}`],
      ["a prescription with history cannot be deleted", (t) =>
        t`delete from public.prescriptions where id = ${rx}`],
    ]) {
      check(await expectDenied(tx, fn), label);
    }

    console.log("\nAnonymous access");
    const anonBlocked = await expectDenied(tx, async (sp) => {
      await sp`set local role anon`;
      await sp`select count(*) from public.prescriptions`;
    });
    check(anonBlocked, "anon cannot read prescriptions at all");

    void replacement;
    throw new Error("__rollback__");
  });
} catch (e) {
  if (e.message !== "__rollback__") {
    check(false, "prescription verification", e.message);
    if (process.env.QA_TRACE) console.error(e);
  }
}

// ---------------------------------------------------------------------------
// 1. Concurrent open — needs two connections that really commit.
// ---------------------------------------------------------------------------
console.log("\nConcurrent open (committed, then cleaned up)");

const cUid = crypto.randomUUID();
let cDoc, cLoc, cPatient, cEnc;

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
                     values (${cUid}, 'ZR') returning id`;
  [cLoc] = await sql`insert into public.practice_locations (name, type, created_by)
                     values ('QA Rx Clinic', 'CLINIC', ${cUid}) returning id`;
  await sql`insert into public.practice_location_members
              (practice_location_id, user_id, role, status)
            values (${cLoc.id}, ${cUid}, 'DOCTOR', 'ACTIVE')`;
  [cPatient] = await sql`
    insert into public.patients (owner_doctor_id, patient_number, full_name,
                                 name_normalized, sex, created_by)
    values (${cDoc.id}, 'ZR-900001', 'Race Patient', 'race patient', 'UNKNOWN', ${cUid})
    returning id`;
  [cEnc] = await sql`
    insert into public.encounters (owner_doctor_id, patient_id, practice_location_id, created_by)
    values (${cDoc.id}, ${cPatient.id}, ${cLoc.id}, ${cUid}) returning id`;

  const claims = JSON.stringify({ sub: cUid, role: "authenticated" });
  const race = async (fn) => {
    let rx1, ry1;
    const both = Promise.all([
      new Promise((r) => (rx1 = r)),
      new Promise((r) => (ry1 = r)),
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
    const a = run(connA, rx1);
    const b = run(connB, ry1);
    await both;
    release();
    return Promise.all([a, b]);
  };

  await race((t) => t`select public.open_prescription(${cEnc.id}, ${cLoc.id}, null)`);
  const drafts = await sql`
    select id from public.prescriptions where encounter_id = ${cEnc.id} and status = 'DRAFT'`;
  check(drafts.length === 1, "two simultaneous opens create exactly ONE draft", `${drafts.length}`);

  const target = drafts[0]?.id;
  const [{ version: v0 }] = await sql`select version from public.prescriptions where id = ${target}`;

  const adds = await race(
    (t) => t`select public.add_prescription_item(${target}, ${cLoc.id}, ${v0},
               ${{ displayName: "Race " + Math.random().toString(36).slice(2, 6) }})`,
  );
  const won = adds.filter((r) => r.ok).length;
  check(won === 1, "two simultaneous adds on one version: exactly one wins", `${won} won`);
  check(
    adds.some((r) => !r.ok && /PRESCRIPTION_VERSION_CONFLICT/.test(r.e ?? "")),
    "…and the loser gets a recognisable conflict, not a silent overwrite",
    adds.map((r) => (r.ok ? "ok" : r.e)).join(" | "),
  );

  const [{ version: vFinal }] = await sql`
    select version from public.prescriptions where id = ${target}`;
  check(vFinal === v0 + 1, "…so the version advanced exactly once", `v${v0} -> v${vFinal}`);
} catch (e) {
  check(false, "concurrent open", e.message);
  if (process.env.QA_TRACE) console.error(e);
} finally {
  await connA.end().catch(() => {});
  await connB.end().catch(() => {});

  // RESTRICT everywhere, so this unwinds deliberately — if it ever stops being
  // necessary, the durability guarantee has been weakened.
  if (cLoc) {
    const rxIds = await sql`select id from public.prescriptions where practice_location_id = ${cLoc.id}`;
    if (rxIds.length > 0) {
      const ids = rxIds.map((r) => r.id);
      await sql`delete from public.prescription_events where prescription_id in ${sql(ids)}`;
      await sql`delete from public.prescription_items where prescription_id in ${sql(ids)}`;
      await sql`delete from public.prescriptions where id in ${sql(ids)}`;
    }
    await sql`delete from public.encounter_events
              where encounter_id in (select id from public.encounters
                                     where practice_location_id = ${cLoc.id})`;
    await sql`delete from public.encounters where practice_location_id = ${cLoc.id}`;
    await sql`delete from public.audit_events where practice_location_id = ${cLoc.id}`;
    await sql`delete from public.patient_location_links where practice_location_id = ${cLoc.id}`;
  }
  if (cDoc) await sql`delete from public.patients where owner_doctor_id = ${cDoc.id}`;
  await sql`delete from public.practice_locations where created_by = ${cUid}`;
  await sql`delete from auth.users where id = ${cUid}`;

  const [left] = await sql`select count(*)::int as n from auth.users where id = ${cUid}`;
  check(left.n === 0, "concurrency fixture cleaned up");
}

await sql.end();

console.log(
  failures.length === 0
    ? "\nAll prescription checks passed.\n"
    : `\n${failures.length} CHECK(S) FAILED:\n  - ${failures.join("\n  - ")}\n`,
);
process.exit(failures.length === 0 ? 0 : 1);
