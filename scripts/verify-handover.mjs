/**
 * Stage 7C-3C — the handover boundary.
 *
 * Reception and location admins may HAND OVER a finalised prescription. They
 * are not clinicians in this workflow, and every assertion here is about that
 * one sentence: they can find it, read it and print it, and they can do
 * nothing else with it and nothing at all with anything else.
 *
 * Executed as the real `authenticated` role inside a transaction that is ALWAYS
 * rolled back.
 *
 *   node --env-file=.env.local scripts/verify-handover.mjs
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

/** Did this statement get refused? The savepoint keeps a refusal from aborting. */
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

// ---------------------------------------------------------------------------
// Static posture — the two functions this stage touches
// ---------------------------------------------------------------------------
console.log("\nFunction posture");
for (const fn of ["finalized_prescription_detail", "prescription_frozen_signature_path"]) {
  const rows = await sql`
    select p.prosecdef, p.proconfig,
           has_function_privilege('authenticated', p.oid, 'EXECUTE') as granted,
           has_function_privilege('anon', p.oid, 'EXECUTE') as anon
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = ${fn}`;
  check(rows.length === 1, `${fn}: exactly one definition`, `${rows.length}`);
  check(rows[0]?.prosecdef === true, `${fn}: SECURITY DEFINER`);
  check(
    (rows[0]?.proconfig ?? []).some((c) => c.startsWith("search_path=")),
    `${fn}: search_path pinned`,
  );
  check(rows[0]?.granted === true, `${fn}: granted to authenticated`);
  check(rows[0]?.anon === false, `${fn}: not granted to anon`);
}

/**
 * The signature resolver must take ONLY a prescription id.
 *
 * A path parameter — even a defaulted one — would be a path the caller chooses,
 * and the whole control is that they cannot choose one.
 */
{
  const [args] = await sql`
    select pg_get_function_identity_arguments(p.oid) as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'prescription_frozen_signature_path'`;
  check(
    args.sig.trim() === "p_prescription_id uuid",
    "the signature resolver accepts no caller-supplied path",
    args.sig,
  );
}

// ---------------------------------------------------------------------------
// Live boundary
// ---------------------------------------------------------------------------
const uidA = crypto.randomUUID(); // Dr A — owns the prescription
const uidB = crypto.randomUUID(); // Dr B — colleague at the SAME hospital
const uidR = crypto.randomUUID(); // reception at the hospital
const uidM = crypto.randomUUID(); // location admin at the hospital
const uidS = crypto.randomUUID(); // reception at a DIFFERENT clinic

try {
  await sql.begin(async (tx) => {
    // --- fixtures ----------------------------------------------------------
    for (const [uid, name] of [
      [uidA, "Dr A"],
      [uidB, "Dr B"],
      [uidR, "Reception"],
      [uidM, "Admin"],
      [uidS, "Other reception"],
    ]) {
      await tx`insert into auth.users (id, email, aud, role)
               values (${uid}, ${uid + "@qa.invalid"}, 'authenticated', 'authenticated')`;
      await tx`insert into public.profiles (id, full_name) values (${uid}, ${name})
               on conflict (id) do update set full_name = excluded.full_name`;
    }

    const [hospital] = await tx`
      insert into public.practice_locations (name, type, created_by)
      values ('QA Hospital', 'HOSPITAL', ${uidA}) returning id`;
    const [other] = await tx`
      insert into public.practice_locations (name, type, created_by)
      values ('QA Other Clinic', 'CLINIC', ${uidS}) returning id`;

    await tx`insert into public.practice_location_members
               (practice_location_id, user_id, role, status)
             values (${hospital.id}, ${uidA}, 'DOCTOR', 'ACTIVE'),
                    (${hospital.id}, ${uidB}, 'DOCTOR', 'ACTIVE'),
                    (${hospital.id}, ${uidR}, 'RECEPTIONIST', 'ACTIVE'),
                    (${hospital.id}, ${uidM}, 'LOCATION_ADMIN', 'ACTIVE'),
                    (${other.id},    ${uidS}, 'RECEPTIONIST', 'ACTIVE')`;

    const [docA] = await tx`
      insert into public.doctor_profiles (user_id, bmdc_registration_no, qualification)
      values (${uidA}, 'QA-A-1', 'MBBS') returning id`;
    await tx`insert into public.doctor_profiles (user_id, bmdc_registration_no, qualification)
             values (${uidB}, 'QA-B-1', 'MBBS')`;

    const [patA] = await tx`
      insert into public.patients (owner_doctor_id, patient_number, full_name, name_normalized,
                                   sex, approx_age_years, dob_precision, age_recorded_on, created_by)
      values (${docA.id}, 'QA-H-1', 'Handover Patient', 'handover patient', 'FEMALE',
              44, 'AGE_ONLY', current_date, ${uidA}) returning id`;
    await tx`insert into public.patient_location_links (patient_id, practice_location_id)
             values (${patA.id}, ${hospital.id})`;

    /**
     * `show_signature: true`, and a real frozen object below.
     *
     * An earlier version of this script used an unsigned template, so "the
     * resolved path is the prescription's own" compared null against null and
     * "reception enumerates nothing" counted an empty bucket. Both passed
     * against an implementation that could have been anything. A check that
     * cannot fail is not a check.
     */
    const [tpl] = await tx`
      insert into public.prescription_templates
        (owner_doctor_id, name, paper_size, margin_mm, base_font_pt, show_signature)
      values (${docA.id}, 'QA', 'A4', 15, 11, true) returning id`;
    await tx`update public.doctor_profiles
                set signature_url = ${`${uidA}/signature.png`} where id = ${docA.id}`;

    const [enc] = await tx`
      insert into public.encounters (owner_doctor_id, patient_id, practice_location_id, created_by)
      values (${docA.id}, ${patA.id}, ${hospital.id}, ${uidA}) returning id`;

    // A finalised prescription, and a draft that must stay invisible to staff.
    let rx, draft;
    await as(tx, uidA, async () => {
      const [{ open_prescription: id }] =
        await tx`select public.open_prescription(${enc.id}, ${hospital.id})`;
      rx = id;
      const [{ v }] =
        await tx`select (public.prescription_detail(${rx}, ${hospital.id}) ->> 'version')::int as v`;
      await tx`select public.add_prescription_item(${rx}, ${hospital.id}, ${v}, ${{
        displayName: "Tab. Handover 10 mg",
        doseText: "1 tablet",
        scheduleText: "1+0+1",
      }})`;
    });

    /**
     * The frozen signature, written outside `authenticated` — which is the
     * point: `prescription-assets` has no INSERT policy, so only trusted
     * server code creates one. A metadata row is enough here because every
     * assertion below is about AUTHORISATION, not about bytes; the real
     * Storage-API round trip is `db:verify:freeze`. The whole transaction
     * rolls back, so no object outlives the run.
     */
    const [sigObj] = await tx`
      insert into storage.objects (bucket_id, name, owner, metadata)
      values ('prescription-assets', ${`${uidA}/${rx}/signature`}, ${uidA},
              ${{ size: 4096, mimetype: "image/png" }})
      returning id`;

    /**
     * A SECOND doctor's frozen signature, for a prescription reception has no
     * business with. Without it, "reception enumerates nothing beyond their
     * own" is satisfied by an empty bucket.
     */
    const strangerRxId = crypto.randomUUID();
    await tx`insert into storage.objects (bucket_id, name, owner, metadata)
             values ('prescription-assets', ${`${uidB}/${strangerRxId}/signature`}, ${uidB},
                     ${{ size: 4096, mimetype: "image/png" }})`;

    await as(tx, uidA, async () => {
      const [b] =
        await tx`select public.prescription_review_bundle(${rx}, ${hospital.id}, ${tpl.id}) as b`;
      check(
        b.b.bundle.signature?.objectId === sigObj.id,
        "the approved bundle attests the frozen signature object",
      );
      const [{ v2 }] =
        await tx`select (public.prescription_detail(${rx}, ${hospital.id}) ->> 'version')::int as v2`;
      await tx`select public.finalize_prescription(${rx}, ${hospital.id}, ${v2}, ${tpl.id}, ${b.b.digest})`;
    });

    // A correction reason on the record, so its absence for staff is a real
    // omission rather than a null that was never populated.
    await tx`update public.prescriptions
                set replacement_reason = 'wrong dose — allergy discovered after the blood report'
              where id = ${rx}`;

    // A SECOND patient: one open unscheduled encounter per patient per
    // location is a real constraint, and reusing patA here trips it.
    const [patB] = await tx`
      insert into public.patients (owner_doctor_id, patient_number, full_name, name_normalized,
                                   sex, approx_age_years, dob_precision, age_recorded_on, created_by)
      values (${docA.id}, 'QA-H-2', 'Draft Patient', 'draft patient', 'MALE',
              31, 'AGE_ONLY', current_date, ${uidA}) returning id`;
    await tx`insert into public.patient_location_links (patient_id, practice_location_id)
             values (${patB.id}, ${hospital.id})`;

    const [enc2] = await tx`
      insert into public.encounters (owner_doctor_id, patient_id, practice_location_id, created_by)
      values (${docA.id}, ${patB.id}, ${hospital.id}, ${uidA}) returning id`;
    await as(tx, uidA, async () => {
      const [{ open_prescription: id }] =
        await tx`select public.open_prescription(${enc2.id}, ${hospital.id})`;
      draft = id;
    });

    // ---- 1. the owning doctor reads it -----------------------------------
    console.log("\n1–3. Who may read a finalised prescription");
    await as(tx, uidA, async () => {
      const [d] =
        await tx`select public.finalized_prescription_detail(${rx}, ${hospital.id}) as d`;
      check(d.d.id === rx, "the owning doctor reads it");
      check(d.d.viewerIsOwner === true, "…and the database says they are the owner");
      check(d.d.bundle?.items?.length === 1, "…with the approved document attached");
    });

    // ---- 2 & 3. reception and the location admin -------------------------
    for (const [uid, who] of [
      [uidR, "reception"],
      [uidM, "the location admin"],
    ]) {
      await as(tx, uid, async () => {
        const [d] =
          await tx`select public.finalized_prescription_detail(${rx}, ${hospital.id}) as d`;
        check(d.d.id === rx, `${who} at the authorised location reads it`);
        check(d.d.viewerIsOwner === false, `…and is NOT reported as the owner`);

        // ---- 14. the correction reason never reaches them ----------------
        check(
          d.d.replacementReason === null,
          `${who} does NOT receive the correction reason`,
          JSON.stringify(d.d.replacementReason),
        );
        check(
          d.d.finalizedBy === null,
          `${who} does NOT receive who approved it`,
          JSON.stringify(d.d.finalizedBy),
        );
        // Lineage EXISTENCE is allowed; only the reasoning is withheld.
        check(
          "replacesPrescriptionId" in d.d,
          `${who} still sees whether it replaces an earlier sheet`,
        );
      });
    }

    // The owner does get it — otherwise the check above proves nothing.
    await as(tx, uidA, async () => {
      const [d] =
        await tx`select public.finalized_prescription_detail(${rx}, ${hospital.id}) as d`;
      check(
        typeof d.d.replacementReason === "string" && d.d.replacementReason.includes("allergy"),
        "the owning doctor DOES receive the correction reason",
      );
      check(d.d.finalizedBy === uidA, "…and who approved it");
    });

    // ---- 4. a colleague at the same hospital -----------------------------
    console.log("\n4. Sharing a building is not a clinical relationship");
    await as(tx, uidB, async () => {
      check(
        await refused(tx, (t) =>
          t`select public.finalized_prescription_detail(${rx}, ${hospital.id})`),
        "a colleague doctor at the SAME hospital is refused",
      );
      check(
        await refused(tx, (t) => t`select public.prescription_frozen_signature_path(${rx})`),
        "…and cannot resolve its signature path",
      );

      /**
       * The LIST, not just the detail — this is where it actually leaked.
       *
       * `finalized_prescriptions_at` used to admit any row where
       * `may_see_patient` was true, and that is true for every ACTIVE member of
       * a location the patient is linked to. A second doctor at the same
       * hospital therefore listed another doctor's prescription ids and patient
       * ids, which join to names through the ordinary patients policy.
       * Reproduced through the RPC with no UI involved.
       */
      const listed = await tx`select * from public.finalized_prescriptions_at(${hospital.id}, null)`;
      check(
        listed.length === 0,
        "a colleague doctor LISTS none of another doctor's prescriptions",
        `${listed.length}`,
      );
    });

    /**
     * The list and the detail must agree exactly: everything listed can be
     * opened, and nothing that cannot be opened is listed. A list that shows
     * more than it will open is a disclosure with extra steps.
     */
    console.log("\n4b. The list shows exactly what the reader may open");
    for (const [uid, who, expected] of [
      [uidA, "the owning doctor", 1],
      [uidR, "reception", 1],
      [uidM, "the location admin", 1],
      [uidB, "a colleague doctor", 0],
    ]) {
      await as(tx, uid, async () => {
        const listed = await tx`select * from public.finalized_prescriptions_at(${hospital.id}, null)`;
        check(listed.length === expected, `${who} lists ${expected}`, `${listed.length}`);
        for (const row of listed) {
          const openable = !(await refused(tx, (t) =>
            t`select public.finalized_prescription_detail(${row.prescription_id}, ${hospital.id})`));
          check(openable, `…and ${who} can open everything listed`);
        }
      });
    }

    // ---- 5 & 6. staff and drafts -----------------------------------------
    console.log("\n5–6. A draft is not paperwork");
    for (const [uid, who] of [
      [uidR, "reception"],
      [uidM, "the location admin"],
    ]) {
      await as(tx, uid, async () => {
        check(
          await refused(tx, (t) =>
            t`select public.finalized_prescription_detail(${draft}, ${hospital.id})`),
          `${who} cannot read a DRAFT through the finalised read`,
        );
        check(
          await refused(tx, (t) => t`select public.prescription_detail(${draft}, ${hospital.id})`),
          `${who} cannot read a DRAFT through the composer read either`,
        );
        check(
          await refused(tx, (t) => t`select public.prescription_frozen_signature_path(${draft})`),
          `${who} cannot resolve a DRAFT's signature path`,
        );
        const list = await tx`select * from public.finalized_prescriptions_at(${hospital.id}, null)`;
        check(
          list.length === 1 && list[0].prescription_id === rx,
          `${who} sees the finalised one and only that one`,
          `${list.length}`,
        );
      });
    }

    // ---- 7 & 8. another location -----------------------------------------
    console.log("\n7–8. The location boundary holds");
    for (const [uid, who] of [
      [uidR, "reception"],
      [uidM, "the location admin"],
    ]) {
      await as(tx, uid, async () => {
        check(
          await refused(tx, (t) =>
            t`select public.finalized_prescription_detail(${rx}, ${other.id})`),
          `${who} cannot read it under a location it does not belong to`,
        );
        check(
          await refused(tx, (t) => t`select * from public.finalized_prescriptions_at(${other.id}, null)`),
          `${who} cannot list from a location they do not work at`,
        );
      });
    }

    // ---- 9. a patient they may not see -----------------------------------
    console.log("\n9. Reception elsewhere sees nothing of this patient");
    await as(tx, uidS, async () => {
      check(
        await refused(tx, (t) =>
          t`select public.finalized_prescription_detail(${rx}, ${hospital.id})`),
        "reception at another clinic is refused the prescription",
      );
      check(
        await refused(tx, (t) => t`select public.prescription_frozen_signature_path(${rx})`),
        "…and its signature path",
      );
      const seen = await tx`select count(*)::int as n from public.patients where id = ${patA.id}`;
      check(seen[0].n === 0, "…and cannot even see the patient row");
    });

    // ---- 10. prescription events -----------------------------------------
    console.log("\n10. The clinical audit trail is not operational data");
    for (const [uid, who] of [
      [uidR, "reception"],
      [uidM, "the location admin"],
    ]) {
      await as(tx, uid, async () => {
        const rows = await tx`
          select count(*)::int as n from public.prescription_events where prescription_id = ${rx}`;
        check(rows[0].n === 0, `${who} sees no prescription events`, `${rows[0].n}`);
      });
    }
    await as(tx, uidA, async () => {
      const rows = await tx`
        select count(*)::int as n from public.prescription_events where prescription_id = ${rx}`;
      check(rows[0].n > 0, "…while the owning doctor does", `${rows[0].n}`);
    });

    // ---- 11, 12, 13. staff cannot author ---------------------------------
    console.log("\n11–13. Handover is not authorship");
    for (const [uid, who] of [
      [uidR, "reception"],
      [uidM, "the location admin"],
    ]) {
      await as(tx, uid, async () => {
        check(
          await refused(tx, (t) =>
            t`select public.finalize_prescription(${draft}, ${hospital.id}, 1, ${tpl.id}, ${"0".repeat(64)})`),
          `${who} cannot finalize`,
        );
        check(
          await refused(tx, (t) =>
            t`select public.add_prescription_item(${draft}, ${hospital.id}, 1, ${{ displayName: "X" }})`),
          `${who} cannot add a medicine`,
        );
        check(
          await refused(tx, (t) =>
            t`update public.prescriptions set status = 'DRAFT' where id = ${rx}`),
          `${who} cannot mutate the prescription row`,
        );
        check(
          await refused(tx, (t) =>
            t`update public.prescription_items set dose_text = 'tampered' where prescription_id = ${rx}`),
          `${who} cannot mutate a medicine`,
        );
        /**
         * Through the CORRECTION function, which is where corrections live
         * since 7C-3D. This used to call `open_prescription` with a third
         * argument; once that overload was dropped the call would have been
         * "refused" because the function did not exist — a green tick for the
         * wrong reason, which is worse than a red one.
         */
        check(
          await refused(tx, (t) =>
            t`select public.start_prescription_correction(${rx}, ${hospital.id}, 'x')`),
          `${who} cannot start a correction/replacement`,
        );
        check(
          await refused(tx, (t) =>
            t`update public.prescriptions set replacement_reason = 'x' where id = ${rx}`),
          `${who} cannot write a correction reason`,
        );
      });
    }

    // ---- 15, 16, 17. the frozen signature --------------------------------
    console.log("\n15–17. Staff reach exactly one signature, and only through the id");
    const sigPath = `${uidA}/${rx}/signature`;

    await as(tx, uidR, async () => {
      // The path they DO get is resolved by the database from the row — the
      // object that was approved, not a computed guess at where one might be.
      const [p] = await tx`select public.prescription_frozen_signature_path(${rx}) as p`;
      check(p.p === sigPath, "reception's resolved path is the prescription's own", String(p.p));

      // 15/17: an id that is not theirs — and one that does not exist — refuse
      // identically, so the id space cannot be probed.
      check(
        await refused(tx, (t) =>
          t`select public.prescription_frozen_signature_path(${strangerRxId})`),
        "an unrelated prescription id is refused a signature path",
      );
      check(
        await refused(tx, (t) => t`select public.prescription_frozen_signature_path(${draft})`),
        "…as is a draft they may not hand over",
      );

      /**
       * 16: the bucket is not enumerable. `may_read_prescription_asset` decides
       * object by object, so a listing shows only what is theirs to hand over —
       * one of the two objects that exist, never the other doctor's.
       */
      const objects = await tx`
        select name from storage.objects
        where bucket_id = 'prescription-assets'
          and (name like ${uidA + "/%"} or name like ${uidB + "/%"})
        order by name`;
      check(
        objects.length === 1 && objects[0].name === sigPath,
        "reception enumerates only the asset they may hand over",
        objects.map((o) => o.name).join(", ") || "none",
      );
      check(
        await refused(tx, (t) =>
          t`insert into storage.objects (bucket_id, name, owner)
            values ('prescription-assets', ${`${uidR}/x/signature`}, ${uidR})`),
        "reception cannot create an object in the frozen bucket",
      );
    });

    /**
     * …and that is only meaningful because BOTH objects are there.
     *
     * Scoped to this run's two doctors: the bucket may also hold live QA
     * fixtures, and an assertion that assumed an empty bucket failed the
     * moment browser fixtures existed — reporting a real count as a defect.
     */
    const [allAssets] = await tx`
      select count(*)::int as n from storage.objects
      where bucket_id = 'prescription-assets'
        and (name like ${uidA + "/%"} or name like ${uidB + "/%"})`;
    check(allAssets.n === 2, "…out of two this run created", `${allAssets.n}`);

    // The doctor's LIVE profile signature stays out of reach.
    await as(tx, uidR, async () => {
      const own = await tx`
        select count(*)::int as n from storage.objects
        where bucket_id = 'doctor-assets' and name like ${uidA + "/%"}`;
      check(own[0].n === 0, "reception cannot read the doctor's profile signature");
    });

    // ---- 18. an unsupported snapshot fails closed for everyone ------------
    console.log("\n18. A newer snapshot refuses, identically, for both");
    await tx`update public.prescriptions
                set review_bundle_snapshot = jsonb_set(review_bundle_snapshot,
                                                       '{schemaVersion}', '99'::jsonb)
              where id = ${rx}`;
    for (const [uid, who] of [
      [uidA, "the owning doctor"],
      [uidR, "reception"],
    ]) {
      await as(tx, uid, async () => {
        const [d] =
          await tx`select public.finalized_prescription_detail(${rx}, ${hospital.id}) as d`;
        check(
          Number(d.d.bundle.schemaVersion) === 99,
          `${who} receives the raw snapshot version, unmodified`,
          String(d.d.bundle?.schemaVersion),
        );
      });
    }
    /**
     * The refusal itself is the PARSER's, and it is one parser: `parseReview`
     * in `review-bundle.ts`, asserted by the unit tests. What matters here is
     * that the database hands both readers the SAME unsupported bundle, so
     * neither can be given a weaker one to render.
     */

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
    ? "\nHandover boundary: all checks passed.\n"
    : `\n${failures.length} FAILED:\n  ${failures.join("\n  ")}\n`,
);
await sql.end();
process.exit(failures.length === 0 ? 0 : 1);
