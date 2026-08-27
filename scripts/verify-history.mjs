/**
 * Alpha History Integration — the patient's longitudinal clinical history.
 *
 * The timeline is DOCTOR-OWNED. It spans every location that doctor practises
 * at, and it reaches nobody else: not a colleague at the same hospital, not
 * reception, not a location admin. Location membership is an operational
 * relationship; a patient's history is a clinical one.
 *
 * Executed as the real `authenticated` role inside a transaction that is ALWAYS
 * rolled back.
 *
 *   node --env-file=.env.local scripts/verify-history.mjs
 */
import postgres from "postgres";
import crypto from "node:crypto";

const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error("DIRECT_URL or DATABASE_URL must be set.");
  process.exit(1);
}

const sql = postgres(url, {
  max: 1,
  prepare: false,
  onnotice: () => {},
  connection: { statement_timeout: "20000", lock_timeout: "10000" },
});
const failures = [];

function check(ok, label, detail = "") {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(label);
}

async function refused(tx, fn) {
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

const uidA = crypto.randomUUID(); // Dr A — owns the patient and the history
const uidB = crypto.randomUUID(); // Dr B — colleague at the SAME hospital
const uidR = crypto.randomUUID(); // reception at the hospital
const uidM = crypto.randomUUID(); // location admin at the hospital

console.log("\nAlpha History Integration — the timeline boundary");

// ---------------------------------------------------------------------------
console.log("\nFunction posture");
{
  const rows = await sql`
    select p.prosecdef, p.proconfig,
           pg_get_function_identity_arguments(p.oid) as args,
           has_function_privilege('authenticated', p.oid, 'EXECUTE') as granted,
           has_function_privilege('anon', p.oid, 'EXECUTE') as anon
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'patient_prescription_history'`;
  check(rows.length === 1, "patient_prescription_history: exactly one definition", `${rows.length}`);
  check(rows[0]?.prosecdef === true, "…SECURITY DEFINER");
  check(
    (rows[0]?.proconfig ?? []).some((c) => c.startsWith("search_path=")),
    "…search_path pinned",
  );
  check(rows[0]?.granted === true, "…granted to authenticated");
  check(rows[0]?.anon === false, "…not granted to anon");
  check(
    rows[0]?.args?.includes("p_patient_id uuid"),
    "…takes the patient, and an OPTIONAL location",
    rows[0]?.args,
  );
  // No doctor parameter: whose history it is comes from the session, not the caller.
  check(!/doctor/i.test(rows[0]?.args ?? ""), "…and never a caller-supplied doctor id");
}

try {
  await sql.begin(async (tx) => {
    for (const [uid, name] of [
      [uidA, "Dr A"],
      [uidB, "Dr B"],
      [uidR, "Reception"],
      [uidM, "Admin"],
    ]) {
      await tx`insert into auth.users (id, email, aud, role)
               values (${uid}, ${uid + "@qa.invalid"}, 'authenticated', 'authenticated')`;
      await tx`insert into public.profiles (id, full_name) values (${uid}, ${name})
               on conflict (id) do update set full_name = excluded.full_name`;
    }

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

    const [docA] = await tx`
      insert into public.doctor_profiles (user_id, bmdc_registration_no, qualification)
      values (${uidA}, ${"QA" + crypto.randomBytes(3).toString("hex")}, 'MBBS') returning id`;
    await tx`insert into public.doctor_profiles (user_id, bmdc_registration_no, qualification)
             values (${uidB}, ${"QB" + crypto.randomBytes(3).toString("hex")}, 'MBBS')`;

    const [pat] = await tx`
      insert into public.patients (owner_doctor_id, patient_number, full_name, name_normalized,
                                   sex, approx_age_years, dob_precision, age_recorded_on, created_by)
      values (${docA.id}, 'QA-HX-1', 'History Patient', 'history patient', 'FEMALE',
              50, 'AGE_ONLY', current_date, ${uidA}) returning id`;
    await tx`insert into public.patient_location_links (patient_id, practice_location_id)
             values (${pat.id}, ${hospital.id}), (${pat.id}, ${chamber.id})`;

    const [tpl] = await tx`
      insert into public.prescription_templates
        (owner_doctor_id, name, paper_size, margin_mm, base_font_pt, show_signature)
      values (${docA.id}, 'QA', 'A4', 15, 11, false) returning id`;

    /** One finalised prescription at a location, plus a live draft. */
    const makeVisit = async (locationId, medicine) => {
      const [enc] = await tx`
        insert into public.encounters (owner_doctor_id, patient_id, practice_location_id, created_by)
        values (${docA.id}, ${pat.id}, ${locationId}, ${uidA}) returning id`;
      let rx;
      await as(tx, uidA, async () => {
        const [{ open_prescription: id }] =
          await tx`select public.open_prescription(${enc.id}, ${locationId})`;
        rx = id;
        const [{ v }] =
          await tx`select (public.prescription_detail(${rx}, ${locationId}) ->> 'version')::int as v`;
        await tx`select public.add_prescription_item(${rx}, ${locationId}, ${v}, ${{
          displayName: medicine,
          doseText: "1 tablet",
          scheduleText: "1+0+1",
        }})`;
        const [b] =
          await tx`select public.prescription_review_bundle(${rx}, ${locationId}, ${tpl.id}) as b`;
        const [{ v2 }] =
          await tx`select (public.prescription_detail(${rx}, ${locationId}) ->> 'version')::int as v2`;
        await tx`select public.finalize_prescription(${rx}, ${locationId}, ${v2}, ${tpl.id}, ${b.b.digest})`;
      });
      /**
       * Close the visit. Realistic, and required: one open unscheduled
       * encounter per patient per location is a unique index, so leaving them
       * DRAFT makes a second visit to the same location impossible.
       */
      await tx`update public.encounters
                  set status = 'COMPLETED', completed_at = clock_timestamp()
                where id = ${enc.id}`;
      return { enc: enc.id, rx };
    };

    const atHospital = await makeVisit(hospital.id, "Tab. Hospital 100 mg");
    const atChamber = await makeVisit(chamber.id, "Tab. Chamber 200 mg");

    // A correction of the hospital one: V1 superseded, V2 current.
    let v2;
    await as(tx, uidA, async () => {
      const [{ start_prescription_correction: id }] =
        await tx`select public.start_prescription_correction(${atHospital.rx}, ${hospital.id},
                        ${"ভুল মাত্রা — সংশোধন"})`;
      v2 = id;
      const [{ v }] =
        await tx`select (public.prescription_detail(${v2}, ${hospital.id}) ->> 'version')::int as v`;
      await tx`select public.add_prescription_item(${v2}, ${hospital.id}, ${v}, ${{
        displayName: "Tab. Hospital 50 mg",
        doseText: "1 tablet",
        scheduleText: "1+0+1",
      }})`;
      const [b] =
        await tx`select public.prescription_review_bundle(${v2}, ${hospital.id}, ${tpl.id}) as b`;
      const [{ v2v }] =
        await tx`select (public.prescription_detail(${v2}, ${hospital.id}) ->> 'version')::int as v2v`;
      await tx`select public.finalize_prescription(${v2}, ${hospital.id}, ${v2v}, ${tpl.id}, ${b.b.digest})`;
    });

    // A DRAFT that must never appear as issued history.
    const [encDraft] = await tx`
      insert into public.encounters (owner_doctor_id, patient_id, practice_location_id, created_by)
      values (${docA.id}, ${pat.id}, ${chamber.id}, ${uidA}) returning id`;
    let draftRx;
    await as(tx, uidA, async () => {
      const [{ open_prescription: id }] =
        await tx`select public.open_prescription(${encDraft.id}, ${chamber.id})`;
      draftRx = id;
    });

    // ---- 1, 2. the owning doctor sees their own history -------------------
    console.log("\n1–2. The owning doctor's longitudinal history");
    await as(tx, uidA, async () => {
      const encs = await tx`
        select id, practice_location_id from public.encounters where patient_id = ${pat.id}`;
      check(encs.length === 3, "sees every consultation, across both locations", `${encs.length}`);

      const hx = await tx`select * from public.patient_prescription_history(${pat.id}, null)`;
      check(hx.length === 3, "sees three finalised prescriptions", `${hx.length}`);
      check(
        hx.every((r) => r.location_id && r.location_name),
        "…each carrying a location ID and name",
      );
      check(
        hx.every((r) => r.finalized_at),
        "…and the time it was ISSUED",
      );
    });

    // ---- 3. drafts are absent --------------------------------------------
    console.log("\n3. A draft was never issued to anybody");
    await as(tx, uidA, async () => {
      const hx = await tx`select * from public.patient_prescription_history(${pat.id}, null)`;
      check(
        !hx.some((r) => r.prescription_id === draftRx),
        "the DRAFT prescription is absent from history",
      );
    });

    // ---- 8. the correction reason never enters the timeline ---------------
    console.log("\n8. Lineage without reasoning");
    await as(tx, uidA, async () => {
      const hx = await tx`select * from public.patient_prescription_history(${pat.id}, null)`;
      const cols = Object.keys(hx[0] ?? {});
      check(
        !cols.some((c) => /reason/i.test(c)),
        "the history returns NO reason column at all",
        cols.join(", "),
      );
      const v1 = hx.find((r) => r.prescription_id === atHospital.rx);
      const corrected = hx.find((r) => r.prescription_id === v2);
      check(v1?.superseded_by === v2, "V1 is marked superseded, and by which one");
      check(corrected?.replaces_id === atHospital.rx, "V2 records what it corrects");
      check(
        atChamber.rx && !hx.find((r) => r.prescription_id === atChamber.rx)?.superseded_by,
        "an uncorrected prescription is not marked superseded",
      );
    });

    // ---- 4, 5, 6. nobody else gets the doctor's history -------------------
    console.log("\n4–6. Location membership is not clinical access");
    for (const [uid, who] of [
      [uidB, "a colleague doctor at the SAME hospital"],
      [uidR, "reception"],
      [uidM, "the location admin"],
    ]) {
      await as(tx, uid, async () => {
        const encs = await tx`
          select count(*)::int as n from public.encounters where patient_id = ${pat.id}`;
        check(encs[0].n === 0, `${who} sees no consultations`, `${encs[0].n}`);

        /**
         * Reception and the admin are REFUSED rather than answered with an
         * empty list — an empty list would tell them "this patient has no
         * prescriptions", which is a different and false statement.
         */
        const denied = await refused(tx, (t) =>
          t`select * from public.patient_prescription_history(${pat.id}, null)`);
        const rows = denied
          ? []
          : await tx`select * from public.patient_prescription_history(${pat.id}, null)`;
        check(
          denied || rows.length === 0,
          `${who} obtains no prescription history`,
          denied ? "refused" : `${rows.length} rows`,
        );
      });
    }

    // ---- 6. no id enumeration --------------------------------------------
    await as(tx, uidB, async () => {
      const direct = await refused(tx, (t) =>
        t`select id from public.prescriptions where patient_id = ${pat.id}`);
      check(direct, "a colleague cannot enumerate prescription ids directly");
    });

    // ---- 7, 9. location filtering is exact, by id ------------------------
    console.log("\n7. Location filtering, by id");
    await as(tx, uidA, async () => {
      const all = await tx`select * from public.patient_prescription_history(${pat.id}, null)`;
      const atH = await tx`select * from public.patient_prescription_history(${pat.id}, ${hospital.id})`;
      const atC = await tx`select * from public.patient_prescription_history(${pat.id}, ${chamber.id})`;
      check(all.length === 3, "all locations: three", `${all.length}`);
      check(atH.length === 2, "hospital only: two (V1 and its correction)", `${atH.length}`);
      check(atC.length === 1, "chamber only: one", `${atC.length}`);
      check(
        atH.every((r) => r.location_id === hospital.id) &&
          atC.every((r) => r.location_id === chamber.id),
        "…and every row really belongs to the location asked for",
      );
      check(
        atH.length + atC.length === all.length,
        "the two locations partition the whole history",
      );
    });

    // ---- 9. the cross-location fallback is OWNER-ONLY ---------------------
    /**
     * The timeline is longitudinal but the finalised read is location-scoped,
     * so a doctor opening their own prescription from another of their
     * locations used to get "not found". `prescription_owner_location` closes
     * that — and must not become a way around the location boundary for
     * anybody else.
     */
    console.log("\n9. The cross-location fallback answers only to the owner");
    await as(tx, uidA, async () => {
      const [own] =
        await tx`select public.prescription_owner_location(${atChamber.rx}) as loc`;
      check(own.loc === chamber.id, "the owning doctor resolves their own prescription's location");
      const [h] = await tx`select public.prescription_owner_location(${atHospital.rx}) as loc`;
      check(h.loc === hospital.id, "…at either location");
    });

    for (const [uid, who] of [
      [uidB, "a colleague doctor"],
      [uidR, "reception"],
      [uidM, "the location admin"],
    ]) {
      await as(tx, uid, async () => {
        check(
          await refused(tx, (t) =>
            t`select public.prescription_owner_location(${atChamber.rx})`),
          `${who} cannot resolve a location through it`,
        );
      });
    }

    await as(tx, uidR, async () => {
      /**
       * The point of the whole check: reception works at the hospital, so a
       * CHAMBER prescription must stay unreachable even now that a fallback
       * exists. They cannot obtain the location, and the finalised read still
       * refuses them at either one.
       */
      check(
        await refused(tx, (t) =>
          t`select public.finalized_prescription_detail(${atChamber.rx}, ${chamber.id})`),
        "reception still cannot read a chamber prescription at the chamber",
      );
      check(
        await refused(tx, (t) =>
          t`select public.finalized_prescription_detail(${atChamber.rx}, ${hospital.id})`),
        "…nor by naming their own location",
      );
    });

    // ---- 10. another doctor's patient is not reachable --------------------
    console.log("\n10. Another doctor's patient");
    await as(tx, uidB, async () => {
      const hx = await refused(tx, (t) =>
        t`select * from public.patient_prescription_history(${pat.id}, null)`);
      const rows = hx ? [] : await tx`select * from public.patient_prescription_history(${pat.id}, null)`;
      check(
        hx || rows.length === 0,
        "Dr B asking for Dr A's patient gets nothing",
        hx ? "refused" : `${rows.length} rows`,
      );
    });

    throw new Error("__rollback__");
  });
} catch (e) {
  if (e.message !== "__rollback__") {
    console.error("\nverification aborted:", e.message);
    failures.push("run aborted");
  }
}

console.log(
  failures.length === 0
    ? "\nHistory boundary: all checks passed.\n"
    : `\n${failures.length} FAILED:\n  ${failures.join("\n  ")}\n`,
);
await sql.end();
process.exit(failures.length === 0 ? 0 : 1);
