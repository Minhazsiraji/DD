/**
 * Finishing a consultation.
 *
 * `close_encounter` has existed since Stage 6 and NOTHING CALLED IT. The
 * appointment screen's "Finish consultation" completes the APPOINTMENT — a
 * different record — so a doctor could write the notes, the diagnosis and a
 * signed prescription, print it, and the encounter stayed DRAFT for ever. The
 * patient's timeline then said "Consultation in progress" about a finished
 * visit.
 *
 * Rolled back always.
 *
 *   node --env-file=.env.local scripts/verify-encounter-close.mjs
 */
import postgres from "postgres";
import crypto from "node:crypto";

const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error("DIRECT_URL or DATABASE_URL must be set.");
  process.exit(1);
}
const sql = postgres(url, {
  max: 1, prepare: false, onnotice: () => {},
  connection: { statement_timeout: "20000", lock_timeout: "10000" },
});
const failures = [];
const check = (ok, label, detail = "") => {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(label);
};
const refused = async (tx, fn) => {
  try { await tx.savepoint(fn); return false; } catch { return true; }
};
const as = async (tx, uid, fn) => {
  await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: uid, role: "authenticated" })}, true)`;
  await tx`set local role authenticated`;
  try { return await fn(); } finally { await tx`reset role`; }
};

const uidA = crypto.randomUUID(); // owning doctor
const uidB = crypto.randomUUID(); // colleague at the same hospital
const uidR = crypto.randomUUID(); // reception
const uidM = crypto.randomUUID(); // location admin

console.log("\nFinishing a consultation");

try {
  await sql.begin(async (tx) => {
    for (const [uid, n] of [[uidA, "Dr A"], [uidB, "Dr B"], [uidR, "Reception"], [uidM, "Admin"]]) {
      await tx`insert into auth.users (id, email, aud, role)
               values (${uid}, ${uid + "@qa.invalid"}, 'authenticated', 'authenticated')`;
      await tx`insert into public.profiles (id, full_name) values (${uid}, ${n})`;
    }
    const [hospital] = await tx`
      insert into public.practice_locations (name, type, created_by)
      values ('QA Hospital', 'HOSPITAL', ${uidA}) returning id`;
    await tx`insert into public.practice_location_members (practice_location_id, user_id, role, status)
             values (${hospital.id}, ${uidA}, 'DOCTOR', 'ACTIVE'),
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
      values (${docA.id}, 'QA-FIN-1', 'Finish Test', 'finish test', 'MALE', 44,
              'AGE_ONLY', current_date, ${uidA}) returning id`;
    await tx`insert into public.patient_location_links (patient_id, practice_location_id)
             values (${pat.id}, ${hospital.id})`;
    const [tpl] = await tx`
      insert into public.prescription_templates
        (owner_doctor_id, name, paper_size, margin_mm, base_font_pt, show_signature)
      values (${docA.id}, 'QA', 'A4', 15, 11, false) returning id`;
    const [enc] = await tx`
      insert into public.encounters (owner_doctor_id, patient_id, practice_location_id, created_by)
      values (${docA.id}, ${pat.id}, ${hospital.id}, ${uidA}) returning id`;

    /** A finalised prescription on this visit — it must survive untouched. */
    let rx, digestBefore;
    await as(tx, uidA, async () => {
      const [{ open_prescription: id }] = await tx`select public.open_prescription(${enc.id}, ${hospital.id})`;
      rx = id;
      const [{ v }] = await tx`select (public.prescription_detail(${rx}, ${hospital.id}) ->> 'version')::int as v`;
      await tx`select public.add_prescription_item(${rx}, ${hospital.id}, ${v}, ${{
        displayName: "Tab. Finish 10 mg", doseText: "1 tablet", scheduleText: "1+0+1" }})`;
      const [b] = await tx`select public.prescription_review_bundle(${rx}, ${hospital.id}, ${tpl.id}) as b`;
      const [{ v2 }] = await tx`select (public.prescription_detail(${rx}, ${hospital.id}) ->> 'version')::int as v2`;
      await tx`select public.finalize_prescription(${rx}, ${hospital.id}, ${v2}, ${tpl.id}, ${b.b.digest})`;
      digestBefore = b.b.digest;
    });

    const encVersion = async () => {
      const [r] = await tx`select version, status from public.encounters where id = ${enc.id}`;
      return r;
    };

    // ---- 2, 3. nobody but the owning doctor -------------------------------
    console.log("\n2–3. Only the doctor whose visit it is");
    for (const [uid, who] of [
      [uidR, "reception"],
      [uidM, "the location admin"],
      [uidB, "a colleague doctor at the same hospital"],
    ]) {
      const v = (await encVersion()).version;
      await as(tx, uid, async () => {
        check(
          await refused(tx, (t) =>
            t`select public.close_encounter(${enc.id}, ${hospital.id}, ${v}, 'COMPLETED')`),
          `${who} cannot finish the consultation`,
        );
      });
    }
    check((await encVersion()).status === "DRAFT", "…and it is still open after all of that");

    // ---- 1. the owning doctor ---------------------------------------------
    console.log("\n1. The owning doctor finishes it");
    const before = await encVersion();
    await as(tx, uidA, async () => {
      const [r] = await tx`select public.close_encounter(${enc.id}, ${hospital.id}, ${before.version}, 'COMPLETED') as s`;
      check(r.s === "COMPLETED", "the visit closes", r.s);
    });
    const after = await encVersion();
    check(after.status === "COMPLETED", "…the encounter is COMPLETED", after.status);
    check(after.version === before.version + 1, "…and the version moved once", `${before.version} -> ${after.version}`);
    const [completed] = await tx`select completed_at from public.encounters where id = ${enc.id}`;
    check(Boolean(completed.completed_at), "…with a completion time recorded");

    // ---- 4. a double click cannot close twice -----------------------------
    console.log("\n4. A second click changes nothing");
    await as(tx, uidA, async () => {
      check(
        await refused(tx, (t) =>
          t`select public.close_encounter(${enc.id}, ${hospital.id}, ${before.version}, 'COMPLETED')`),
        "the stale version is refused",
      );
    });
    const twice = await encVersion();
    check(
      twice.version === after.version && twice.status === "COMPLETED",
      "…and neither the version nor the status moved again",
      `v${twice.version} ${twice.status}`,
    );

    // ---- 5. it stays readable ---------------------------------------------
    console.log("\n5–6. History survives");
    await as(tx, uidA, async () => {
      const rows = await tx`select id, status from public.encounters where id = ${enc.id}`;
      check(rows.length === 1, "the completed consultation is still readable by its doctor");
      const [d] = await tx`select public.finalized_prescription_detail(${rx}, ${hospital.id}) as d`;
      check(d.d.reviewDigest === digestBefore, "…and the finalised prescription is unchanged");
      check(d.d.status === "FINALIZED", "…still FINALIZED");
    });

    // ---- 7. the timeline stops saying "in progress" ------------------------
    console.log("\n7. The timeline reflects it");
    await as(tx, uidA, async () => {
      const [row] = await tx`select status from public.encounters where id = ${enc.id}`;
      /**
       * `timeline.ts` titles a DRAFT encounter "Consultation in progress" and
       * anything else "Consultation". The status is what it reads.
       */
      check(row.status !== "DRAFT", "the timeline will no longer call it in progress", row.status);
    });

    // ---- 8, 9. the visit is over, a new one can start ----------------------
    console.log("\n8–9. The patient is no longer with the doctor");
    const openDrafts = await tx`
      select count(*)::int as n from public.encounters
      where patient_id = ${pat.id} and practice_location_id = ${hospital.id} and status = 'DRAFT'`;
    check(openDrafts[0].n === 0, "no open consultation remains for this patient here", `${openDrafts[0].n}`);

    const [next] = await tx`
      insert into public.encounters (owner_doctor_id, patient_id, practice_location_id, created_by)
      values (${docA.id}, ${pat.id}, ${hospital.id}, ${uidA}) returning id`;
    check(Boolean(next.id), "a return visit can open a NEW consultation");
    /**
     * This is the constraint that made it matter: one open unscheduled
     * encounter per patient per location. An encounter that never closes makes
     * the patient's next visit impossible.
     */
    check(
      await refused(tx, (t) =>
        t`insert into public.encounters (owner_doctor_id, patient_id, practice_location_id, created_by)
          values (${docA.id}, ${pat.id}, ${hospital.id}, ${uidA})`),
      "…and only one may be open at a time",
    );

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
    ? "\nConsultation completion: all checks passed.\n"
    : `\n${failures.length} FAILED:\n  ${failures.join("\n  ")}\n`,
);
await sql.end();
process.exit(failures.length === 0 ? 0 : 1);
