/**
 * GATE A — the boundary as the INTERNET sees it.
 *
 * Every other suite in this repo proves the boundary with `SET ROLE
 * authenticated` and `set_config('request.jwt.claims', …)` inside a
 * transaction. That is a faithful model of what the database does, and it is
 * NOT proof of what the deployed system does, because it skips everything
 * between: GoTrue issuing a token, PostgREST reading it, PostgREST deciding
 * which functions and tables it is willing to expose, and the schema cache
 * offering overloads we thought were gone.
 *
 * So this signs in as real users, gets real JWTs, and talks to the real API
 * over HTTPS. A test that passes here has passed through the same doors a
 * browser would.
 *
 *   node --env-file=.env.local scripts/verify-api-auth.mjs
 *
 * Requires the QA fixture (`npm run qa:create`). Creates and removes its own
 * clinical rows; never touches anything it did not make.
 */
import postgres from "postgres";
import crypto from "node:crypto";

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const DB = process.env.DIRECT_URL ?? process.env.DATABASE_URL;

if (!URL_ || !ANON || !DB) {
  console.error("NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and DIRECT_URL are required.");
  process.exit(1);
}

const sql = postgres(DB, { max: 1, prepare: false, onnotice: () => {} });
const failures = [];
const PASSWORD = "QaFixture12345";

function check(ok, label, detail = "") {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(label);
}

/** Sign in through GoTrue exactly as the browser does, and keep the JWT. */
async function signIn(email) {
  const res = await fetch(`${URL_}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "content-type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const body = await res.json();
  if (!res.ok || !body.access_token) {
    throw new Error(`sign-in failed for ${email}: ${body.error_description ?? res.status}`);
  }
  return { token: body.access_token, uid: body.user.id, email };
}

/** A PostgREST RPC call, as an authenticated browser would make it. */
async function rpc(who, fn, args) {
  const res = await fetch(`${URL_}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      apikey: ANON,
      authorization: `Bearer ${who.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(args ?? {}),
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: res.status, ok: res.ok, data };
}

/** A direct table read over PostgREST — the thing the RPC boundary replaces. */
async function select(who, table, query = "select=*") {
  const res = await fetch(`${URL_}/rest/v1/${table}?${query}`, {
    headers: { apikey: ANON, authorization: `Bearer ${who.token}` },
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: res.status, ok: res.ok, data };
}

async function storage(who, method, path, body) {
  const res = await fetch(`${URL_}/storage/v1/${path}`, {
    method,
    headers: {
      apikey: ANON,
      authorization: `Bearer ${who.token}`,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: res.status, ok: res.ok, data };
}

/** Refused = no data came back, whatever the shape of the refusal. */
function refused(r) {
  if (r.status === 401 || r.status === 403 || r.status === 404) return true;
  if (r.status >= 400) return true;
  // A 200 with an empty array is also a refusal to disclose.
  if (Array.isArray(r.data)) return r.data.length === 0;
  return r.data === null;
}

// ---------------------------------------------------------------------------
console.log("\nGate A — real Auth JWTs through PostgREST");
console.log(`  endpoint: ${URL_}`);

let created = { rxDraft: null, rxFinal: null, encs: [], pats: [], tpl: null, sig: [], sigPath: null };

try {
  const doctor = await signIn("qa.doctor@qa.invalid");
  const other = await signIn("qa.other.doctor@qa.invalid");
  const reception = await signIn("qa.reception@qa.invalid");
  check(true, "signed in through GoTrue with real passwords", "doctor, colleague, reception");

  /**
   * The tokens are real JWTs, and PostgREST will read `role` and `sub` from
   * them. Worth asserting: a token whose role were `service_role` would make
   * every check below meaningless.
   */
  const claims = JSON.parse(Buffer.from(doctor.token.split(".")[1], "base64url").toString());
  check(claims.role === "authenticated", "the issued JWT carries role=authenticated", claims.role);
  check(claims.sub === doctor.uid, "…and the subject is the signed-in user");

  // --- fixtures, built through the DB (the API cannot create locations) -----
  const [hospital] =
    await sql`select id from public.practice_locations where name = 'Metro Hospital' limit 1`;
  const [docA] = await sql`select id from public.doctor_profiles where user_id = ${doctor.uid}`;

  const [pat] = await sql`
    insert into public.patients (owner_doctor_id, patient_number, full_name, name_normalized,
                                 sex, approx_age_years, dob_precision, age_recorded_on, created_by)
    values (${docA.id}, ${"QA-API-" + crypto.randomBytes(2).toString("hex")}, 'API Gate Patient',
            'api gate patient', 'FEMALE', 41, 'AGE_ONLY', current_date, ${doctor.uid})
    returning id`;
  created.pats.push(pat.id);
  await sql`insert into public.patient_location_links (patient_id, practice_location_id)
            values (${pat.id}, ${hospital.id}) on conflict do nothing`;

  const [tpl] = await sql`
    insert into public.prescription_templates
      (owner_doctor_id, name, paper_size, margin_mm, base_font_pt, show_signature)
    values (${docA.id}, 'QA API', 'A4', 15, 11, false) returning id`;
  created.tpl = tpl.id;

  const [encDraft] = await sql`
    insert into public.encounters (owner_doctor_id, patient_id, practice_location_id, created_by)
    values (${docA.id}, ${pat.id}, ${hospital.id}, ${doctor.uid}) returning id`;
  created.encs.push(encDraft.id);

  // ---- 1. the doctor's own draft, over the API ---------------------------
  console.log("\n1–2. A doctor's own draft, and nobody else's");
  const opened = await rpc(doctor, "open_prescription", {
    p_encounter_id: encDraft.id,
    p_practice_location_id: hospital.id,
  });
  check(opened.ok && typeof opened.data === "string", "the doctor opens a draft over PostgREST",
    `${opened.status}`);
  created.rxDraft = opened.data;

  const detail = await rpc(doctor, "prescription_detail", {
    p_prescription_id: created.rxDraft,
    p_practice_location_id: hospital.id,
  });
  check(detail.ok && detail.data?.id === created.rxDraft, "…and reads it back");

  const added = await rpc(doctor, "add_prescription_item", {
    p_prescription_id: created.rxDraft,
    p_practice_location_id: hospital.id,
    p_expected_version: detail.data.version,
    p_patch: { displayName: "Tab. API 100 mg", doseText: "1 tablet", scheduleText: "1+0+1" },
  });
  check(added.ok, "…and adds a medicine", `${added.status}`);

  // ---- 2. a colleague doctor at the same location ------------------------
  for (const [fn, args, label] of [
    ["prescription_detail",
      { p_prescription_id: created.rxDraft, p_practice_location_id: hospital.id },
      "read the draft"],
    ["finalized_prescriptions_at",
      { p_practice_location_id: hospital.id, p_patient_id: null },
      "list finalised prescriptions here"],
  ]) {
    const r = await rpc(other, fn, args);
    check(refused(r), `a colleague doctor cannot ${label}`, `${r.status}`);
  }

  // ---- 5, 8, 9, 10. reception and a DRAFT --------------------------------
  console.log("\n5, 8–10. Reception and a draft");
  const recDraft = await rpc(reception, "prescription_detail", {
    p_prescription_id: created.rxDraft,
    p_practice_location_id: hospital.id,
  });
  check(refused(recDraft), "reception cannot read a draft", `${recDraft.status}`);

  const recAdd = await rpc(reception, "add_prescription_item", {
    p_prescription_id: created.rxDraft,
    p_practice_location_id: hospital.id,
    p_expected_version: 1,
    p_patch: { displayName: "Tampered" },
  });
  check(refused(recAdd), "reception cannot add a medicine", `${recAdd.status}`);

  const recFinalize = await rpc(reception, "finalize_prescription", {
    p_prescription_id: created.rxDraft,
    p_practice_location_id: hospital.id,
    p_expected_version: 1,
    p_template_id: tpl.id,
    p_review_digest: "0".repeat(64),
  });
  check(refused(recFinalize), "reception cannot finalize", `${recFinalize.status}`);

  const recCorrect = await rpc(reception, "start_prescription_correction", {
    p_prescription_id: created.rxDraft,
    p_practice_location_id: hospital.id,
    p_replacement_reason: "nope",
  });
  check(refused(recCorrect), "reception cannot start a correction", `${recCorrect.status}`);

  // ---- finalise it, as the doctor, so the handover cases have a subject ---
  const bundle = await rpc(doctor, "prescription_review_bundle", {
    p_prescription_id: created.rxDraft,
    p_practice_location_id: hospital.id,
    p_template_id: tpl.id,
  });
  check(bundle.ok && bundle.data?.digest, "the doctor builds the review bundle over the API");

  const d2 = await rpc(doctor, "prescription_detail", {
    p_prescription_id: created.rxDraft,
    p_practice_location_id: hospital.id,
  });
  const finalized = await rpc(doctor, "finalize_prescription", {
    p_prescription_id: created.rxDraft,
    p_practice_location_id: hospital.id,
    p_expected_version: d2.data.version,
    p_template_id: tpl.id,
    p_review_digest: bundle.data.digest,
  });
  check(finalized.ok, "…and finalizes it", `${finalized.status}`);
  created.rxFinal = created.rxDraft;
  created.rxDraft = null;

  // A correction reason on the record, so its absence for staff is real.
  await sql`update public.prescriptions
               set replacement_reason = 'API gate — allergy discovered'
             where id = ${created.rxFinal}`;

  // ---- 6, 7. reception and the FINALISED prescription --------------------
  console.log("\n6–7. Reception and an approved prescription");
  const recFinal = await rpc(reception, "finalized_prescription_detail", {
    p_prescription_id: created.rxFinal,
    p_practice_location_id: hospital.id,
  });
  check(recFinal.ok && recFinal.data?.id === created.rxFinal,
    "reception CAN read the approved prescription to hand it over", `${recFinal.status}`);
  check(recFinal.data?.replacementReason === null,
    "…and the correction reason is not in the response",
    JSON.stringify(recFinal.data?.replacementReason));
  check(recFinal.data?.viewerIsOwner === false, "…and they are not reported as the owner");

  const recComposer = await rpc(reception, "prescription_detail", {
    p_prescription_id: created.rxFinal,
    p_practice_location_id: hospital.id,
  });
  check(recComposer.data?.replacementReason === null,
    "…nor in the composer read, which they can also reach",
    JSON.stringify(recComposer.data?.replacementReason));

  const recLineage = await rpc(reception, "prescription_lineage", {
    p_prescription_id: created.rxFinal,
    p_practice_location_id: hospital.id,
  });
  check(recLineage.data?.reason === null, "…nor in lineage");

  // ---- 3, 4. the colleague and a FINALISED prescription ------------------
  console.log("\n3–4. A colleague doctor gains nothing from the building");
  const colList = await rpc(other, "finalized_prescriptions_at", {
    p_practice_location_id: hospital.id,
    p_patient_id: null,
  });
  check(refused(colList), "a colleague doctor lists no finalised prescriptions", `${colList.status}`);
  const colOpen = await rpc(other, "finalized_prescription_detail", {
    p_prescription_id: created.rxFinal,
    p_practice_location_id: hospital.id,
  });
  check(refused(colOpen), "…and cannot open one", `${colOpen.status}`);

  // ---- longitudinal patient history, over the API -------------------------
  console.log("\nHistory — the timeline is doctor-owned");
  {
    const own = await rpc(doctor, "patient_prescription_history", {
      p_patient_id: pat.id,
      p_practice_location_id: null,
    });
    check(
      own.ok && Array.isArray(own.data) && own.data.length === 1,
      "the owning doctor reads their patient's prescription history",
      `${own.status} · ${Array.isArray(own.data) ? own.data.length : "?"}`,
    );
    check(
      own.data?.[0]?.location_id === hospital.id && own.data?.[0]?.finalized_at,
      "…with the location id and the time it was issued",
    );
    check(
      !Object.keys(own.data?.[0] ?? {}).some((k) => /reason/i.test(k)),
      "…and no correction reason anywhere in the payload",
      Object.keys(own.data?.[0] ?? {}).join(", "),
    );

    /**
     * Reception is REFUSED, not answered with an empty list. An empty list
     * would tell the front desk "this patient has no prescriptions", which is
     * a different and false statement.
     */
    const recHx = await rpc(reception, "patient_prescription_history", {
      p_patient_id: pat.id,
      p_practice_location_id: null,
    });
    check(refused(recHx), "reception cannot obtain longitudinal history", `${recHx.status}`);

    const colHx = await rpc(other, "patient_prescription_history", {
      p_patient_id: pat.id,
      p_practice_location_id: null,
    });
    check(refused(colHx), "a colleague doctor obtains none of it", `${colHx.status}`);

    // Consultations ride the encounters SELECT policy, so check it directly.
    for (const [who, label, expectEmpty] of [
      [doctor, "the owning doctor", false],
      [other, "a colleague doctor", true],
      [reception, "reception", true],
    ]) {
      const r = await select(who, "encounters", `select=id&patient_id=eq.${pat.id}`);
      const n = Array.isArray(r.data) ? r.data.length : -1;
      check(
        expectEmpty ? n === 0 : n > 0,
        `${label} ${expectEmpty ? "sees no consultations" : "sees their own consultations"}`,
        `${r.status} · ${n}`,
      );
    }
  }

  // ---- 12. wrong location -------------------------------------------------
  console.log("\n12. The location boundary, over the API");
  const [chamber] =
    await sql`select id from public.practice_locations where name = 'Greenview Chamber' limit 1`;
  const wrongLoc = await rpc(reception, "finalized_prescription_detail", {
    p_prescription_id: created.rxFinal,
    p_practice_location_id: chamber.id,
  });
  check(refused(wrongLoc), "reception cannot read it under another location", `${wrongLoc.status}`);

  // ---- 16. revoked direct table reads stay revoked ------------------------
  console.log("\n16. Revoked direct reads are revoked over PostgREST too");
  for (const [who, label] of [
    [doctor, "the owning doctor"],
    [reception, "reception"],
    [other, "a colleague doctor"],
  ]) {
    for (const table of ["prescriptions", "prescription_items"]) {
      const r = await select(who, table, "select=id&limit=1");
      check(refused(r), `${label} cannot SELECT ${table} directly`, `${r.status}`);
    }
  }
  // …while the one table that IS readable stays readable for its owner only.
  const evDoctor = await select(doctor, "prescription_events", "select=id&limit=1");
  const evRec = await select(reception, "prescription_events", "select=id&limit=1");
  check(!refused(evDoctor) || evDoctor.status === 200,
    "the doctor may read prescription_events (doctor-only policy)", `${evDoctor.status}`);
  check(refused(evRec), "reception reads no prescription_events", `${evRec.status}`);

  // ---- 13. the frozen bucket, from a browser JWT --------------------------
  console.log("\n13–15. Storage, from a browser token");
  const sigPath = `${doctor.uid}/${created.rxFinal}/signature`;
  const upload = await fetch(`${URL_}/storage/v1/object/prescription-assets/${sigPath}`, {
    method: "POST",
    headers: { apikey: ANON, authorization: `Bearer ${doctor.token}`, "content-type": "image/png" },
    body: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
  });
  check(upload.status >= 400, "a browser JWT cannot INSERT into prescription-assets",
    `${upload.status}`);

  const del = await storage(reception, "DELETE", `object/prescription-assets/${sigPath}`);
  check(del.status >= 400, "…nor DELETE from it", `${del.status}`);

  // 15. an unrelated prescription's signature path
  const strangerPath = `${other.uid}/${crypto.randomUUID()}/signature`;
  const strangerUrl = await storage(reception, "POST",
    `object/sign/prescription-assets/${strangerPath}`, { expiresIn: 60 });
  check(strangerUrl.status >= 400, "an unrelated frozen signature cannot be signed for",
    `${strangerUrl.status}`);

  // ---- 17, 18. the exposed function surface -------------------------------
  console.log("\n17–18. What PostgREST is willing to expose");
  const stale = await rpc(doctor, "open_prescription", {
    p_encounter_id: encDraft.id,
    p_practice_location_id: hospital.id,
    p_replacement_reason: "stale overload probe",
  });
  check(stale.status >= 400,
    "the dropped 3-argument open_prescription is gone from the API", `${stale.status}`);

  const mismatched = await rpc(doctor, "start_prescription_correction", {
    p_prescription_id: created.rxFinal,
    p_practice_location_id: hospital.id,
    p_replacement_reason: "x",
    p_encounter_id: encDraft.id,
  });
  check(mismatched.status >= 400,
    "…and no correction overload accepts an encounter id", `${mismatched.status}`);

  /**
   * The internal helpers must not be callable at all. `prescription_for_update`
   * and the audit writer are revoked from `authenticated`; PostgREST should
   * answer 404 for a function it may not execute.
   */
  for (const fn of ["log_prescription_audit", "prescription_for_update", "prescription_item_fields"]) {
    const r = await rpc(doctor, fn, {});
    check(r.status >= 400, `the internal ${fn} is not callable over the API`, `${r.status}`);
  }

  // ---- 11. the admin contract --------------------------------------------
  console.log("\n11. The location admin follows the same handover contract");
  /**
   * An admin who is NOT a doctor.
   *
   * The QA doctor also holds LOCATION_ADMIN at this hospital, so an unordered
   * `limit 1` picked THEM — and the suite then reported that "the admin" could
   * read the correction reason and start a correction, which was true and
   * meaningless: they were the owner. A role test that can select the owner is
   * not testing the role.
   */
  const [adminRow] = await sql`
    select u.email from auth.users u
    join public.practice_location_members m on m.user_id = u.id
    where m.practice_location_id = ${hospital.id} and m.role = 'LOCATION_ADMIN'
      and u.email like '%@qa.invalid'
      and not exists (select 1 from public.doctor_profiles d where d.user_id = u.id)
    limit 1`;
  if (!adminRow) {
    check(false, "a QA location admin exists to test with",
      "create one before running this gate");
  } else {
    const admin = await signIn(adminRow.email);
    const aFinal = await rpc(admin, "finalized_prescription_detail", {
      p_prescription_id: created.rxFinal,
      p_practice_location_id: hospital.id,
    });
    check(aFinal.ok, "the admin can read the approved prescription", `${aFinal.status}`);
    check(aFinal.data?.replacementReason === null, "…without the correction reason");
    const aDraftMutate = await rpc(admin, "start_prescription_correction", {
      p_prescription_id: created.rxFinal,
      p_practice_location_id: hospital.id,
      p_replacement_reason: "nope",
    });
    check(refused(aDraftMutate), "…and cannot start a correction", `${aDraftMutate.status}`);
  }

  // ---- 14. the authorised signed URL path --------------------------------
  /**
   * The one storage case that must SUCCEED.
   *
   * A frozen signature is created by trusted server code, so it is planted here
   * through the Storage API with the service-role client — the same path the
   * app uses. NOT by inserting a `storage.objects` row: that produces metadata
   * with no file behind it, which reads as success and prints as a broken
   * image, and Supabase blocks deleting it again anyway.
   *
   * What is under test is whether a BROWSER JWT can then obtain a signed URL
   * for the prescription it is authorised to hand over — and only that one.
   */
  console.log("\n14. The authorised signed-URL path");
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    check(false, "SUPABASE_SERVICE_ROLE_KEY is set so a frozen asset can be planted",
      "set it and re-run; this case cannot be proved without it");
  } else {
    const { createClient } = await import("@supabase/supabase-js");
    const store = createClient(URL_, serviceKey, { auth: { persistSession: false } }).storage;
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    );
    const { error: upErr } = await store
      .from("prescription-assets")
      .upload(sigPath, png, { contentType: "image/png", upsert: true });
    check(!upErr, "trusted server code CAN write a frozen signature", upErr?.message ?? "");
    created.sigPath = sigPath;

    for (const [who, label] of [
      [doctor, "the owning doctor"],
      [reception, "reception"],
    ]) {
      const signed = await storage(who, "POST",
        `object/sign/prescription-assets/${sigPath}`, { expiresIn: 60 });
      check(signed.ok && typeof signed.data?.signedURL === "string",
        `${label} can obtain a signed URL for the prescription they may hand over`,
        `${signed.status}`);

      // …and the URL actually serves the bytes. A signed URL that 400s would
      // print a blank signature on a signed prescription.
      if (signed.ok) {
        const served = await fetch(`${URL_}/storage/v1${signed.data.signedURL}`);
        check(served.ok, `…and it serves the image`, `${served.status}`);
      }
    }
    const colSigned = await storage(other, "POST",
      `object/sign/prescription-assets/${sigPath}`, { expiresIn: 60 });
    check(colSigned.status >= 400,
      "a colleague doctor cannot obtain one", `${colSigned.status}`);
  }
} catch (e) {
  console.error("\ngate aborted:", e.message);
  failures.push(`aborted: ${e.message}`);
} finally {
  // Remove exactly what this gate created, in dependency order.
  try {
    /**
     * Storage objects go through the Storage API, never a DELETE on
     * `storage.objects` — Supabase blocks that with a trigger, and the first
     * version of this cleanup was refused by it. A metadata row deleted behind
     * the API's back would also orphan the file rather than remove it.
     */
    if (created.sigPath) {
      const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (!key) {
        console.error(
          `  NOT REMOVED (no service-role key): prescription-assets/${created.sigPath}`,
        );
        failures.push("planted signature left behind — no service-role key to remove it");
      } else {
        const { createClient } = await import("@supabase/supabase-js");
        const store = createClient(URL_, key, { auth: { persistSession: false } }).storage;
        const { data, error } = await store.from("prescription-assets").remove([created.sigPath]);
        // A delete blocked by policy removes nothing and raises nothing:
        // confirm from the returned rows, never from the absence of an error.
        if (error || !data || data.length === 0) {
          console.error(`  NOT REMOVED: prescription-assets/${created.sigPath}`);
          failures.push("planted signature could not be removed");
        }
      }
    }
    /**
     * Everything on the encounters this run created — not just the ids it
     * remembered. A correction started during a FAILING assertion is a
     * prescription nobody recorded, and it holds a foreign key to one that is
     * being deleted, so a narrow cleanup fails on the constraint and leaves
     * both behind.
     */
    if (created.encs.length) {
      const rows = await sql`
        select id from public.prescriptions where encounter_id = any(${created.encs})`;
      const rxIds = rows.map((r) => r.id);
      if (rxIds.length) {
        await sql`delete from public.prescription_events where prescription_id = any(${rxIds})`;
        await sql`delete from public.prescription_items where prescription_id = any(${rxIds})`;
        // Break the lineage links before removing the rows they point at.
        await sql`update public.prescriptions set replaces_prescription_id = null
                   where id = any(${rxIds})`;
        await sql`delete from public.prescriptions where id = any(${rxIds})`;
      }
    }
    if (created.encs.length) {
      await sql`delete from public.encounters where id = any(${created.encs})`;
    }
    if (created.tpl) {
      await sql`delete from public.prescription_templates where id = ${created.tpl}`;
    }
    if (created.pats.length) {
      await sql`delete from public.patient_location_links where patient_id = any(${created.pats})`;
      await sql`delete from public.patients where id = any(${created.pats})`;
    }
  } catch (e) {
    console.error("  cleanup failed:", e.message);
    failures.push("cleanup failed — inspect by hand");
  }
}

console.log(
  failures.length === 0
    ? "\nGate A: all checks passed against the real API.\n"
    : `\n${failures.length} FAILED:\n  ${failures.join("\n  ")}\n`,
);
await sql.end();
process.exit(failures.length === 0 ? 0 : 1);
