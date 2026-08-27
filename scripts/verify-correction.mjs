/**
 * Stage 7C-3D — corrections, lineage, and the immutability of the original.
 *
 * The clinical rule under test is one sentence: a FINALIZED prescription is
 * never edited. A correction is a NEW prescription that points back at it, and
 * the original must come out of the whole process byte-identical.
 *
 * Executed as the real `authenticated` role inside a transaction that is ALWAYS
 * rolled back — except the race section, which needs two connections that
 * really commit and removes exactly what it created.
 *
 *   node --env-file=.env.local scripts/verify-correction.mjs
 */
import postgres from "postgres";
import crypto from "node:crypto";

const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error("DIRECT_URL or DATABASE_URL must be set.");
  process.exit(1);
}

const connect = () =>
  postgres(url, {
    max: 1,
    prepare: false,
    onnotice: () => {},
    connection: { statement_timeout: "20000", lock_timeout: "10000" },
  });

const sql = connect();
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

/**
 * Did this write get through? — asked WITHOUT letting it stand.
 *
 * `refused` leaves a successful statement committed inside the transaction,
 * which is wrong for a write we are hoping succeeds: proving "a 500-character
 * reason is accepted" actually CREATED the correction, and the real test a few
 * lines later then resumed that draft and read back the wrong reason. Two
 * assertions failed for a reason that had nothing to do with the code.
 */
async function accepted(tx, fn) {
  let got = false;
  try {
    await tx.savepoint(async (sp) => {
      await fn(sp);
      got = true;
      throw new Error("__undo__");
    });
  } catch (e) {
    if (e.message !== "__undo__") return false;
  }
  return got;
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

const uidA = crypto.randomUUID(); // Dr A — owns everything
const uidB = crypto.randomUUID(); // Dr B — colleague at the same hospital
const uidR = crypto.randomUUID(); // reception
const uidM = crypto.randomUUID(); // location admin

/** Everything the fixture builds, so the race section can reuse it. */
async function seed(tx) {
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
  const [other] = await tx`
    insert into public.practice_locations (name, type, created_by)
    values ('QA Other', 'CLINIC', ${uidA}) returning id`;

  await tx`insert into public.practice_location_members
             (practice_location_id, user_id, role, status)
           values (${hospital.id}, ${uidA}, 'DOCTOR', 'ACTIVE'),
                  (${hospital.id}, ${uidB}, 'DOCTOR', 'ACTIVE'),
                  (${hospital.id}, ${uidR}, 'RECEPTIONIST', 'ACTIVE'),
                  (${hospital.id}, ${uidM}, 'LOCATION_ADMIN', 'ACTIVE'),
                  (${other.id},    ${uidA}, 'DOCTOR', 'ACTIVE')`;

  const [docA] = await tx`
    insert into public.doctor_profiles (user_id, bmdc_registration_no, qualification)
    values (${uidA}, ${"QA" + crypto.randomBytes(3).toString("hex")}, 'MBBS') returning id`;
  await tx`insert into public.doctor_profiles (user_id, bmdc_registration_no, qualification)
           values (${uidB}, ${"QB" + crypto.randomBytes(3).toString("hex")}, 'MBBS')`;

  const [pat] = await tx`
    insert into public.patients (owner_doctor_id, patient_number, full_name, name_normalized,
                                 sex, approx_age_years, dob_precision, age_recorded_on, created_by)
    values (${docA.id}, 'QA-C-1', 'Correction Patient', 'correction patient', 'FEMALE',
            39, 'AGE_ONLY', current_date, ${uidA}) returning id`;
  await tx`insert into public.patient_location_links (patient_id, practice_location_id)
           values (${pat.id}, ${hospital.id})`;

  /**
   * SIGNED, so the correction can be proved not to disturb the original's
   * frozen signature. An unsigned template made that assertion unrunnable.
   */
  const [tpl] = await tx`
    insert into public.prescription_templates
      (owner_doctor_id, name, paper_size, margin_mm, base_font_pt, show_signature)
    values (${docA.id}, 'QA', 'A4', 15, 11, true) returning id`;
  await tx`update public.doctor_profiles set signature_url = ${`${uidA}/signature.png`}
           where id = ${docA.id}`;

  const [enc] = await tx`
    insert into public.encounters (owner_doctor_id, patient_id, practice_location_id, created_by)
    values (${docA.id}, ${pat.id}, ${hospital.id}, ${uidA}) returning id`;

  // V1: two medicines, finalised.
  let v1;
  await as(tx, uidA, async () => {
    const [{ open_prescription: id }] =
      await tx`select public.open_prescription(${enc.id}, ${hospital.id})`;
    v1 = id;
    for (const m of [
      { displayName: "Tab. Alpha 250 mg", doseText: "1 tablet", scheduleText: "1+0+1" },
      { displayName: "Cap. Beta 20 mg", doseText: "1 capsule", scheduleText: "1+0+0" },
    ]) {
      const [{ v }] =
        await tx`select (public.prescription_detail(${id}, ${hospital.id}) ->> 'version')::int as v`;
      await tx`select public.add_prescription_item(${id}, ${hospital.id}, ${v}, ${m})`;
    }
  });

  /**
   * The frozen signature, written outside `authenticated` — the point being
   * that `prescription-assets` has no INSERT policy and only trusted server
   * code creates one. Metadata is enough: every assertion here is about
   * immutability and identity, not bytes. `db:verify:freeze` covers the real
   * Storage round trip, and the whole transaction rolls back.
   */
  const [sig1] = await tx`
    insert into storage.objects (bucket_id, name, owner, metadata)
    values ('prescription-assets', ${`${uidA}/${v1}/signature`}, ${uidA},
            ${{ size: 4096, mimetype: "image/png" }})
    returning id`;

  await as(tx, uidA, async () => {
    const [b] = await tx`select public.prescription_review_bundle(${v1}, ${hospital.id}, ${tpl.id}) as b`;
    const [{ v }] =
      await tx`select (public.prescription_detail(${v1}, ${hospital.id}) ->> 'version')::int as v`;
    await tx`select public.finalize_prescription(${v1}, ${hospital.id}, ${v}, ${tpl.id}, ${b.b.digest})`;
  });

  return {
    hospital: hospital.id, other: other.id, docA: docA.id, pat: pat.id,
    tpl: tpl.id, enc: enc.id, v1, sig1: sig1.id,
  };
}

try {
  await sql.begin(async (tx) => {
    const f = await seed(tx);
    const { hospital, other, tpl, enc, v1 } = f;

    /** V1 exactly as approved, so any later drift is visible. */
    const [before] = await tx`
      select status, review_digest, review_bundle_snapshot, doctor_snapshot, patient_snapshot,
             template_snapshot, signature_snapshot, items_snapshot, finalized_at,
             snapshot_schema_version, replaces_prescription_id, replacement_reason
      from public.prescriptions where id = ${v1}`;
    const [itemsBefore] = await tx`
      select jsonb_agg(to_jsonb(i) order by i.position) as items
      from public.prescription_items i where i.prescription_id = ${v1}`;

    // ---- THE TRUST BOUNDARY ----------------------------------------------
    /**
     * The prescription being corrected is the AUTHORITY, and it is the ONLY
     * identifier a caller supplies.
     *
     * The earlier shape took a prescription id AND an encounter id from the
     * browser: lineage was checked against the first, the write performed
     * against the second. Two halves of one clinical relationship, controlled
     * independently. These assert the shape that makes that impossible.
     */
    console.log("\nTrust boundary: one identifier, derived from the row");
    {
      const [args] = await tx`
        select pg_get_function_identity_arguments(p.oid) as sig
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'start_prescription_correction'`;
      check(
        args.sig.trim() ===
          "p_prescription_id uuid, p_practice_location_id uuid, p_replacement_reason text",
        "the correction RPC takes the PRESCRIPTION id, never an encounter id",
        args.sig,
      );
      check(!/encounter/i.test(args.sig), "…and no encounter parameter of any kind");

      /**
       * The other door. `open_prescription` used to take a replacement reason,
       * and supplying it turned an ordinary open into a correction of whatever
       * it inferred was the newest unreplaced finalised prescription on that
       * encounter. Removed, not defaulted: an unused default is still a
       * parameter a caller may supply.
       */
      const opens = await tx`
        select pg_get_function_identity_arguments(p.oid) as sig
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'open_prescription'`;
      check(opens.length === 1, "open_prescription has exactly ONE definition", `${opens.length}`);
      check(
        opens[0]?.sig.trim() === "p_encounter_id uuid, p_practice_location_id uuid",
        "…and it can no longer be handed a replacement reason",
        opens[0]?.sig,
      );

      // 3. The mismatch is not merely refused — it cannot be expressed.
      check(
        await refused(tx, (t) =>
          t`select public.start_prescription_correction(${v1}, ${hospital}, 'x', ${enc})`),
        "there is no overload that accepts a prescription AND an encounter",
      );
    }

    // ---- 4. the encounter is DERIVED, never supplied ----------------------
    console.log("\n4. The encounter comes from the prescription row");
    // Proved after the correction is created, below.

    // ---- 2, 3, 4, 5. the reason is required, trimmed and bounded ----------
    console.log("\n2–5. A correction needs a reason, and the reason has limits");
    await as(tx, uidA, async () => {
      check(
        await refused(tx, (t) =>
          t`select public.start_prescription_correction(${v1}, ${hospital}, null)`),
        "a correction with NO reason is refused",
      );
      check(
        await refused(tx, (t) =>
          t`select public.start_prescription_correction(${v1}, ${hospital}, '   ')`),
        "a whitespace-only reason is refused",
      );
      check(
        await refused(tx, (t) =>
          t`select public.start_prescription_correction(${v1}, ${hospital}, ${"x".repeat(501)})`),
        "an over-length reason is refused by the database, not just by Zod",
      );
      check(
        await accepted(tx, (t) =>
          t`select public.start_prescription_correction(${v1}, ${hospital}, ${"x".repeat(500)})`),
        "…while exactly 500 characters is accepted",
      );

      /**
       * Opening by ENCOUNTER can no longer produce a correction at all. It
       * refuses with its own token so the screen can say where to go.
       */
      check(
        await refused(tx, (t) => t`select public.open_prescription(${enc}, ${hospital})`),
        "opening by encounter refuses once a prescription is approved",
      );
    });

    // ---- 1, 5, 6, 7, 8, 9. the correction itself -------------------------
    console.log("\n1, 6–9. The corrected prescription starts blank and points back");
    const BANGLA = "ভুল মাত্রা লেখা হয়েছিল — রোগীর অ্যালার্জি ধরা পড়ার পরে সংশোধন করা হলো।";
    let v2;
    await as(tx, uidA, async () => {
      const [{ start_prescription_correction: id }] =
        await tx`select public.start_prescription_correction(${v1}, ${hospital}, ${BANGLA})`;
      v2 = id;
    });

    const [v2row] = await tx`
      select status, replaces_prescription_id, replacement_reason, encounter_id,
             owner_doctor_id, patient_id, practice_location_id
      from public.prescriptions where id = ${v2}`;
    check(v2row.status === "DRAFT", "the correction starts as a DRAFT", v2row.status);
    check(v2row.replaces_prescription_id === v1, "…and points at the prescription it corrects");
    check(v2row.replacement_reason === BANGLA, "…carrying the doctor's Bangla reason verbatim");

    // ---- 4. every field came from the ROW, not from a parameter -----------
    const [v1row] = await tx`
      select encounter_id, owner_doctor_id, patient_id, practice_location_id
      from public.prescriptions where id = ${v1}`;
    check(
      v2row.encounter_id === v1row.encounter_id,
      "the server-derived encounter equals V1's own encounter",
      `${v2row.encounter_id}`,
    );
    check(
      v2row.owner_doctor_id === v1row.owner_doctor_id &&
        v2row.patient_id === v1row.patient_id &&
        v2row.practice_location_id === v1row.practice_location_id,
      "…as do the doctor, the patient and the location",
    );

    const [v2items] = await tx`
      select count(*)::int as n from public.prescription_items where prescription_id = ${v2}`;
    check(v2items.n === 0, "the correction starts with ZERO medicines", `${v2items.n}`);
    /**
     * Not merely "zero" — the ORIGINAL's medicines must not have been copied.
     * Alpha decision: the dose being corrected may be the wrong one, and
     * pre-filling puts the mistake back on screen as a default to accept.
     */
    const copied = await tx`
      select 1 from public.prescription_items i
      join public.prescription_items o on o.display_name = i.display_name
      where i.prescription_id = ${v2} and o.prescription_id = ${v1}`;
    check(copied.length === 0, "…and none of V1's medicines were copied into it");

    // ---- 17, 18, 19. exactly one correction ------------------------------
    console.log("\n17–19. One correction per prescription, and a second attempt finds it");
    await as(tx, uidA, async () => {
      const [{ start_prescription_correction: again }] =
        await tx`select public.start_prescription_correction(${v1}, ${hospital}, ${"another reason"})`;
      check(again === v2, "a second attempt RESUMES the existing draft rather than duplicating");

      // …and a doctor arriving at an existing correction is not asked to
      // justify one that already exists.
      const [{ start_prescription_correction: noReason }] =
        await tx`select public.start_prescription_correction(${v1}, ${hospital}, null)`;
      check(noReason === v2, "…even with no reason, because it is not creating one");
    });
    check(
      await refused(tx, (t) =>
        t`insert into public.prescriptions
            (encounter_id, owner_doctor_id, patient_id, practice_location_id,
             replaces_prescription_id, replacement_reason, created_by)
          values (${enc}, ${f.docA}, ${f.pat}, ${hospital}, ${v1}, 'forced', ${uidA})`),
      "a second replacement of the same prescription is refused by the unique index",
    );

    // ---- 13, 14, 15, 16. who may correct ---------------------------------
    console.log("\n13–16. Only the owning doctor may write a correction");
    for (const [uid, who] of [
      [uidR, "reception"],
      [uidM, "the location admin"],
      [uidB, "a colleague doctor at the same hospital"],
    ]) {
      await as(tx, uid, async () => {
        check(
          await refused(tx, (t) =>
            t`select public.start_prescription_correction(${v1}, ${hospital}, 'x')`),
          `${who} cannot start a correction`,
        );
        check(
          await refused(tx, (t) => t`select public.open_prescription(${enc}, ${hospital})`),
          `${who} cannot open a prescription on this encounter either`,
        );
      });
    }
    await as(tx, uidA, async () => {
      check(
        await refused(tx, (t) =>
          t`select public.start_prescription_correction(${v1}, ${other}, 'x')`),
        "the owning doctor cannot correct it under the wrong active location",
      );
    });

    // ---- 20. the reason never reaches staff ------------------------------
    console.log("\n20. The correction reason is clinical reasoning");
    // Finalise V2 so staff can read it at all. It gets its OWN frozen
    // signature at its OWN deterministic path — the original's is untouched.
    const [sig2] = await tx`
      insert into storage.objects (bucket_id, name, owner, metadata)
      values ('prescription-assets', ${`${uidA}/${v2}/signature`}, ${uidA},
              ${{ size: 8192, mimetype: "image/png" }})
      returning id`;

    await as(tx, uidA, async () => {
      const [{ v }] =
        await tx`select (public.prescription_detail(${v2}, ${hospital}) ->> 'version')::int as v`;
      await tx`select public.add_prescription_item(${v2}, ${hospital}, ${v}, ${{
        displayName: "Tab. Alpha 125 mg",
        doseText: "1 tablet",
        scheduleText: "1+0+1",
      }})`;
      const [b] = await tx`select public.prescription_review_bundle(${v2}, ${hospital}, ${tpl}) as b`;
      const [{ v2v }] =
        await tx`select (public.prescription_detail(${v2}, ${hospital}) ->> 'version')::int as v2v`;
      await tx`select public.finalize_prescription(${v2}, ${hospital}, ${v2v}, ${tpl}, ${b.b.digest})`;
    });

    for (const [uid, who] of [
      [uidR, "reception"],
      [uidM, "the location admin"],
    ]) {
      await as(tx, uid, async () => {
        const [d] = await tx`select public.finalized_prescription_detail(${v2}, ${hospital}) as d`;
        check(d.d.replacementReason === null, `${who}: the finalised read sends no reason`);

        /**
         * The door 7C-3C left open. `prescription_detail` has the same
         * `owns OR may_hand_over` guard and used to return the reason
         * unconditionally — fixing one of two doors is not fixing the door.
         */
        const [pd] = await tx`select public.prescription_detail(${v2}, ${hospital}) as d`;
        check(pd.d.replacementReason === null, `${who}: the COMPOSER read sends no reason either`);

        const [l] = await tx`select public.prescription_lineage(${v2}, ${hospital}) as l`;
        check(l.l.reason === null, `${who}: lineage sends no reason`);
        check(
          l.l.replaces?.id === v1,
          `${who}: …but does say which sheet it replaces`,
          String(l.l.replaces?.id),
        );
      });
    }
    await as(tx, uidA, async () => {
      const [l] = await tx`select public.prescription_lineage(${v2}, ${hospital}) as l`;
      check(l.l.reason === BANGLA, "the owning doctor DOES receive the reason");
      const [l1] = await tx`select public.prescription_lineage(${v1}, ${hospital}) as l`;
      check(l1.l.replacedBy?.id === v2, "…and sees the correction from the original");
      check(l1.l.replacedBy?.reason === BANGLA, "…with the reason it was corrected for");
    });

    // ---- 21. the reason is not operational metadata -----------------------
    console.log("\n21–23. The reason is not audit metadata, and never printable");
    const events = await tx`
      select detail::text as d from public.prescription_events where prescription_id = ${v2}`;
    check(
      !events.some((e) => e.d.includes(BANGLA.slice(0, 12))),
      "no prescription EVENT carries the reason text",
    );
    const audits = await tx`
      select meta::text as m, action from public.audit_events
      where resource_id in (${v1}, ${v2}) or meta::text like ${"%" + v2 + "%"}`;
    check(audits.length > 0, "…and there ARE audit rows to inspect", `${audits.length}`);
    check(
      !audits.some((a) => a.m.includes(BANGLA.slice(0, 12))),
      "no AUDIT event carries the reason text",
      audits.map((a) => a.action).join(", "),
    );

    // ---- 22. …nor the printable canonical bundle -------------------------
    const [v2final] = await tx`
      select review_bundle_snapshot::text as b from public.prescriptions where id = ${v2}`;
    check(
      !v2final.b.includes(BANGLA.slice(0, 12)) && !v2final.b.includes("replacementReason"),
      "the approved printable bundle contains no correction reason",
    );

    // ---- 10, 11, 12. the original is untouched ---------------------------
    console.log("\n10–12. The original comes out of this unchanged");
    const [after] = await tx`
      select status, review_digest, review_bundle_snapshot, doctor_snapshot, patient_snapshot,
             template_snapshot, signature_snapshot, items_snapshot, finalized_at,
             snapshot_schema_version, replaces_prescription_id, replacement_reason
      from public.prescriptions where id = ${v1}`;
    const [itemsAfter] = await tx`
      select jsonb_agg(to_jsonb(i) order by i.position) as items
      from public.prescription_items i where i.prescription_id = ${v1}`;

    check(after.status === "FINALIZED", "V1 is still FINALIZED", after.status);
    for (const field of [
      "review_digest",
      "review_bundle_snapshot",
      "doctor_snapshot",
      "patient_snapshot",
      "template_snapshot",
      "signature_snapshot",
      "items_snapshot",
      "snapshot_schema_version",
      "replaces_prescription_id",
      "replacement_reason",
    ]) {
      check(
        JSON.stringify(before[field]) === JSON.stringify(after[field]),
        `V1 ${field} is byte-identical after the correction`,
      );
    }
    check(
      String(before.finalized_at) === String(after.finalized_at),
      "V1 finalizedAt is unchanged",
    );
    check(
      JSON.stringify(itemsBefore.items) === JSON.stringify(itemsAfter.items),
      "V1's medicines are unchanged",
    );
    check(
      after.review_bundle_snapshot.clinicalDate === before.review_bundle_snapshot.clinicalDate,
      "V1's clinicalDate is unchanged",
    );

    // ---- handover: V1 must not look current ------------------------------
    console.log("\nHandover: the front desk can tell which sheet is current");
    for (const [uid, who] of [
      [uidR, "reception"],
      [uidM, "the location admin"],
      [uidA, "the owning doctor"],
    ]) {
      await as(tx, uid, async () => {
        const rows = await tx`select * from public.finalized_prescriptions_at(${hospital}, null)`;
        const v1row = rows.find((r) => r.prescription_id === v1);
        const v2row2 = rows.find((r) => r.prescription_id === v2);
        check(rows.length === 2, `${who} still sees BOTH — history stays complete`, `${rows.length}`);
        check(v1row?.is_superseded === true, `${who}: the original is marked superseded`);
        check(v1row?.superseded_by === v2, `${who}: …and points at the current one`);
        check(v2row2?.is_superseded === false, `${who}: the correction is NOT marked superseded`);
      });
    }

    // ---- 9. the chain, and every edge explicit ---------------------------
    /**
     * V1 → V2 → V3, all on ONE encounter.
     *
     * The old flow inferred "the newest unreplaced finalised prescription on
     * this encounter", which happens to give the right answer here — and is
     * still the wrong rule, because it is not the answer the doctor gave. They
     * clicked a specific sheet. Correcting V2 must produce V3 replacing V2,
     * and asking to correct V1 again must find V2 rather than create anything.
     */
    console.log("\n9. V1 → V2 → V3, with every edge explicit");
    let v3;
    await as(tx, uidA, async () => {
      const [{ start_prescription_correction: found }] =
        await tx`select public.start_prescription_correction(${v1}, ${hospital}, ${"should not create"})`;
      check(found === v2, "asking to correct V1 again FINDS V2 and creates nothing");

      [{ start_prescription_correction: v3 }] =
        await tx`select public.start_prescription_correction(${v2}, ${hospital}, ${"second correction"})`;

      // Lineage through the RPC — the only read `authenticated` is allowed.
      const [l] = await tx`select public.prescription_lineage(${v1}, ${hospital}) as l`;
      check(l.l.replacedBy?.id === v2, "V1's replacement is still V2, not V3");
      const [l2] = await tx`select public.prescription_lineage(${v2}, ${hospital}) as l`;
      check(l2.l.replaces?.id === v1, "V2 still corrects V1");
      check(l2.l.replacedBy?.id === v3, "…and is itself now corrected by V3");
    });

    /**
     * The stored row, read as the TABLE OWNER. Direct SELECT on `prescriptions`
     * is revoked for `authenticated` — that is the boundary, so an assertion
     * about what was stored has to step outside the role under test. The first
     * draft of this read it as the doctor and was refused, correctly.
     */
    const [v3row] = await tx`
      select replaces_prescription_id, status, encounter_id
      from public.prescriptions where id = ${v3}`;
    check(v3row.replaces_prescription_id === v2, "V3 replaces V2");
    check(
      v3row.replaces_prescription_id !== v1,
      "…and is NOT attached back to V1 merely for sharing an encounter",
    );
    check(v3row.encounter_id === v1row.encounter_id, "…on the same encounter, derived again");
    check(v3row.status === "DRAFT", "…and starts as a draft");
    /**
     * V3 is left in place. This section runs AFTER the handover assertions on
     * purpose, so nothing needs cleaning up — and the first draft of it tried
     * to delete `prescription_events`, which `authenticated` has no DELETE on.
     * The right fix was to stop deleting, not to escalate the role.
     */

    // ---- 24. two signatures, each immutable on its own -------------------
    console.log("\n24. Both frozen signatures stay independently immutable");
    check(f.sig1 !== sig2.id, "the correction has its OWN frozen signature object");
    const [b1] = await tx`select signature_snapshot as s from public.prescriptions where id = ${v1}`;
    const [b2] = await tx`select signature_snapshot as s from public.prescriptions where id = ${v2}`;
    check(b1.s?.objectId === f.sig1, "V1's approved bundle attests V1's signature");
    check(b2.s?.objectId === sig2.id, "V2's approved bundle attests V2's own signature");
    check(b1.s?.objectId !== b2.s?.objectId, "…and they are not the same object");

    /**
     * Immutability is asserted from the ROW, never from the absence of an
     * error: an RLS-blocked storage delete removes nothing and raises nothing.
     * Each attempt gets its own savepoint so a refusal cannot abort the run
     * before the row can be inspected.
     */
    await as(tx, uidA, async () => {
      for (const id of [f.sig1, sig2.id]) {
        await refused(tx, (t) =>
          t`update storage.objects set metadata = ${{ size: 1 }} where id = ${id}`);
        await refused(tx, (t) => t`delete from storage.objects where id = ${id}`);
      }
    });

    const survivors = await tx`
      select id, metadata from storage.objects where id in (${f.sig1}, ${sig2.id}) order by id`;
    check(survivors.length === 2, "both signature objects survive overwrite and delete attempts");
    check(
      survivors.every((o) => Number(o.metadata.size) === (o.id === f.sig1 ? 4096 : 8192)),
      "…with their original bytes unchanged",
      survivors.map((o) => o.metadata.size).join(", "),
    );

    // ---- 25. V2 went through the normal pipeline -------------------------
    console.log("\n25. The correction finalised through the ordinary pipeline");
    const [v2done] = await tx`
      select status, review_digest, review_bundle_snapshot, finalized_at, snapshot_schema_version
      from public.prescriptions where id = ${v2}`;
    check(v2done.status === "FINALIZED", "V2 is FINALIZED");
    check(/^[0-9a-f]{64}$/.test(v2done.review_digest ?? ""), "V2 carries its own review digest");
    check(
      v2done.review_digest !== after.review_digest,
      "…which is its own, not the original's",
    );
    check(
      v2done.review_bundle_snapshot?.clinicalDate != null,
      "V2's snapshot carries clinicalDate, as the CHECK constraint demands",
    );

    throw new Error("__rollback__");
  });
} catch (e) {
  if (e.message !== "__rollback__") {
    console.error("\nverification aborted:", e.message);
    failures.push("run aborted");
  }
}

// ---------------------------------------------------------------------------
// The two-tab race — real concurrency, so it must really commit.
// ---------------------------------------------------------------------------
console.log("\nJ. Two tabs, one correction");
{
  const a = connect();
  const b = connect();
  let created = null;
  /**
   * Declared OUT HERE so `finally` can reach it.
   *
   * This section really commits, so it is the one place in this file that can
   * leave rows behind — and its cleanup used to sit at the end of the `try`,
   * where any earlier assertion failure skipped it. One aborted run then left
   * four `@qa.invalid` users and a doctor profile whose BMDC blocked every
   * later run on a unique index, which is how a single failure turned into a
   * permanently red verifier.
   */
  let fixture = null;
  try {
    await a.begin(async (tx) => {
      fixture = await seed(tx);
    });

    /**
     * Both connections open a correction of the SAME prescription at the same
     * time. `open_prescription` takes an advisory lock on the encounter, so one
     * waits; whichever arrives second must find the first one's draft rather
     * than start a competing correction.
     */
    const claims = JSON.stringify({ sub: uidA, role: "authenticated" });
    const attempt = async (conn, reason) =>
      conn.begin(async (tx) => {
        await tx`select set_config('request.jwt.claims', ${claims}, true)`;
        await tx`set local role authenticated`;
        const [row] = await tx`
          select public.start_prescription_correction(
            ${fixture.v1}, ${fixture.hospital}, ${reason}) as id`;
        await tx`reset role`;
        return row.id;
      });

    const [first, second] = await Promise.all([
      attempt(a, "tab A correction"),
      attempt(b, "tab B correction"),
    ]);
    created = first;

    check(first === second, "both tabs end up on the SAME correction", `${first} / ${second}`);

    const rows = await a`
      select id, replacement_reason from public.prescriptions
      where replaces_prescription_id = ${fixture.v1}`;
    check(rows.length === 1, "exactly one replacement exists", `${rows.length}`);
    check(
      rows[0]?.id === first,
      "…and it is the one both tabs were given",
    );

    created = null;
  } catch (e) {
    console.error("  race section failed:", e.message);
    failures.push("two-tab race");
    if (created) console.error(`  LEFTOVER prescription ${created} — remove it by hand.`);
  } finally {
    /**
     * IN `finally`, so a failed assertion cannot leave the fixture behind.
     * Removes exactly what this section committed, by id, and nothing else —
     * it never matches on `@qa.invalid` or any other pattern, so it cannot
     * reach a row some other run is relying on.
     */
    if (fixture) {
      try {
        await a`delete from public.prescription_events where prescription_id in (
                  select id from public.prescriptions where encounter_id = ${fixture.enc})`;
        await a`delete from public.audit_events where actor_id = ${uidA}`;
        await a`delete from public.prescription_items where prescription_id in (
                  select id from public.prescriptions where encounter_id = ${fixture.enc})`;
        await a`update public.prescriptions set replaces_prescription_id = null
                 where encounter_id = ${fixture.enc}`;
        await a`delete from public.prescriptions where encounter_id = ${fixture.enc}`;
        await a`delete from public.encounters where id = ${fixture.enc}`;
        await a`delete from public.prescription_templates where id = ${fixture.tpl}`;
        await a`delete from public.patient_location_links where patient_id = ${fixture.pat}`;
        await a`delete from public.patients where id = ${fixture.pat}`;
        await a`delete from public.practice_location_members
                 where practice_location_id in (${fixture.hospital}, ${fixture.other})`;
        await a`delete from public.doctor_profiles where user_id in (${uidA}, ${uidB})`;
        await a`delete from public.practice_locations
                 where id in (${fixture.hospital}, ${fixture.other})`;
        await a`delete from public.profiles where id in (${uidA}, ${uidB}, ${uidR}, ${uidM})`;
        await a`delete from auth.users where id in (${uidA}, ${uidB}, ${uidR}, ${uidM})`;
      } catch (cleanupError) {
        // Said out loud rather than swallowed: rows nobody knows about are
        // exactly what caused this.
        console.error("  race cleanup failed:", cleanupError.message);
        console.error(`  LEFTOVER users ${uidA}, ${uidB}, ${uidR}, ${uidM} — remove by hand.`);
        failures.push("race cleanup");
      }
    }
    await a.end();
    await b.end();
  }
}

console.log(
  failures.length === 0
    ? "\nCorrection and lineage: all checks passed.\n"
    : `\n${failures.length} FAILED:\n  ${failures.join("\n  ")}\n`,
);
await sql.end();
process.exit(failures.length === 0 ? 0 : 1);
