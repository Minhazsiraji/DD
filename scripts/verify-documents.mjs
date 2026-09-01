import postgres from "postgres";
import crypto from "node:crypto";

/**
 * RUNTIME verification for Patient Documents (Module D, Phase D1).
 *
 * Source tests cannot prove RLS. They read the policy file we wrote; they do
 * not ask Postgres what it will actually do for a second doctor holding a real
 * session. So this executes the whole thing under impersonated JWTs inside ONE
 * transaction and rolls it back — nothing survives, and the last check asserts
 * that.
 *
 * The twelve questions from the brief, in order, plus the ones a reviewer would
 * ask next: can a caller forge the owner, the path, or the patient.
 *
 *   npm run db:verify:documents
 *
 * Requires `npm run db:policies` to have been applied.
 */

const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error("DIRECT_URL or DATABASE_URL must be set");
const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });

const failures = [];
const check = (ok, label, detail = "") => {
  console.log(`${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(label);
};

async function as(tx, uid, fn) {
  await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: uid, role: "authenticated" })}, true)`;
  await tx`set local role authenticated`;
  try {
    return await fn();
  } finally {
    await tx`reset role`;
  }
}

async function asAnon(tx, fn) {
  await tx`select set_config('request.jwt.claims', ${JSON.stringify({ role: "anon" })}, true)`;
  await tx`set local role anon`;
  try {
    return await fn();
  } finally {
    await tx`reset role`;
  }
}

/** Returns the error message, or null when the statement unexpectedly succeeded. */
async function refusal(fn) {
  try {
    await fn();
    return null;
  } catch (e) {
    return e.message ?? String(e);
  }
}

const uidA = crypto.randomUUID();
const uidB = crypto.randomUUID();
const uidR = crypto.randomUUID();
const uidM = crypto.randomUUID();

const objectA = crypto.randomUUID();
const objectB = crypto.randomUUID();

try {
  await sql.begin(async (tx) => {
    // ---- fixture: two doctors, reception and an admin at ONE shared hospital --
    for (const [uid, name] of [
      [uidA, "QA Dr A"],
      [uidB, "QA Dr B"],
      [uidR, "QA Reception"],
      [uidM, "QA Admin"],
    ]) {
      await tx`insert into auth.users (id, email) values (${uid}, ${`${uid}@qa.invalid`})`;
      await tx`insert into public.profiles (id, full_name) values (${uid}, ${name})`;
    }

    const [docA] = await tx`insert into public.doctor_profiles
      (user_id, patient_number_prefix, bmdc_registration_no)
      values (${uidA}, 'DA', ${"QD" + crypto.randomBytes(3).toString("hex")}) returning id`;
    const [docB] = await tx`insert into public.doctor_profiles
      (user_id, patient_number_prefix, bmdc_registration_no)
      values (${uidB}, 'DB', ${"QE" + crypto.randomBytes(3).toString("hex")}) returning id`;

    const [loc] = await tx`insert into public.practice_locations (name, type, created_by)
      values ('QA Documents Hospital', 'HOSPITAL', ${uidA}) returning id`;
    await tx`insert into public.practice_location_members
      (practice_location_id, user_id, role, status)
      values (${loc.id}, ${uidA}, 'DOCTOR', 'ACTIVE'),
             (${loc.id}, ${uidB}, 'DOCTOR', 'ACTIVE'),
             (${loc.id}, ${uidR}, 'RECEPTIONIST', 'ACTIVE'),
             (${loc.id}, ${uidM}, 'LOCATION_ADMIN', 'ACTIVE')`;

    const [patA] = await tx`insert into public.patients
      (owner_doctor_id, patient_number, full_name, name_normalized, sex, created_by)
      values (${docA.id}, 'DA-000001', 'QA Patient A', 'qa patient a', 'FEMALE', ${uidA})
      returning id`;
    const [patB] = await tx`insert into public.patients
      (owner_doctor_id, patient_number, full_name, name_normalized, sex, created_by)
      values (${docB.id}, 'DB-000001', 'QA Patient B', 'qa patient b', 'MALE', ${uidB})
      returning id`;
    // Both patients linked to the shared location — the exact shape that made
    // 0039 a leak. Staff reach the patient; nobody reaches the documents.
    await tx`insert into public.patient_location_links (patient_id, practice_location_id)
      values (${patA.id}, ${loc.id}), (${patB.id}, ${loc.id})`;

    const [encA] = await tx`insert into public.encounters
      (owner_doctor_id, patient_id, practice_location_id)
      values (${docA.id}, ${patA.id}, ${loc.id}) returning id`;

    const pathA = `${uidA}/${patA.id}/${objectA}.pdf`;
    const pathB = `${uidB}/${patB.id}/${objectB}.pdf`;

    // ---- 1. Doctor A files a document for their own patient -----------------
    const created = await as(tx, uidA, async () => {
      const [row] = await tx`select public.create_patient_document(
        ${patA.id}, ${loc.id}, ${encA.id}, 'LAB_REPORT', 'QA CBC report',
        current_date, 'QA note', ${pathA}, 'application/pdf', 120000, 'cbc.pdf'
      ) as id`;
      return row.id;
    });
    check(Boolean(created), "1. Dr A files a document for their own patient");

    // Dr B files one of their own, so "global list" has something to leak.
    const createdB = await as(tx, uidB, async () => {
      const [row] = await tx`select public.create_patient_document(
        ${patB.id}, ${loc.id}, null, 'IMAGING_REPORT', 'QA chest x-ray',
        null, null, ${pathB}, 'image/png', 90000, 'xray.png'
      ) as id`;
      return row.id;
    });

    // ---- 2. Doctor A reads it ------------------------------------------------
    const readA = await as(tx, uidA, async () => ({
      byId: (await tx`select id, owner_doctor_id, document_type
                      from public.patient_documents where id = ${created}`),
      byPatient: (await tx`select id from public.patient_documents
                           where patient_id = ${patA.id}`).length,
      all: (await tx`select id from public.patient_documents`).length,
    }));
    check(readA.byId.length === 1, "2. Dr A reads their own document");
    check(
      readA.byId[0]?.owner_doctor_id === docA.id,
      "2b. owner_doctor_id was DERIVED from the patient, not supplied",
    );

    // ---- 9. Patient record shows that patient's own documents ---------------
    check(readA.byPatient === 1, "9. Patient record reader returns the patient's document");

    // ---- 10. Global list returns only the caller's own -----------------------
    check(
      readA.all === 1,
      "10. Dr A's global list contains only their own document",
      `${readA.all} row(s)`,
    );

    // ---- 3/4/5. Doctor B, at the SAME location, reaches nothing --------------
    const drB = await as(tx, uidB, async () => ({
      enumerate: (await tx`select id from public.patient_documents where id = ${created}`).length,
      byPatient: (await tx`select id from public.patient_documents
                           where patient_id = ${patA.id}`).length,
      global: (await tx`select id from public.patient_documents`).length,
      owns: (await tx`select public.owns_patient_document(${created}) as ok`)[0].ok,
      archive: await refusal(
        () => tx`select public.archive_patient_document(${created}, 'QA hostile archive')`,
      ),
      restore: await refusal(() => tx`select public.restore_patient_document(${created})`),
      update: await refusal(
        () => tx`update public.patient_documents set title = 'hijacked' where id = ${created}`,
      ),
      del: await refusal(() => tx`delete from public.patient_documents where id = ${created}`),
      fileForA: await refusal(
        () => tx`select public.create_patient_document(
          ${patA.id}, ${loc.id}, null, 'OTHER', 'QA intrusion', null, null,
          ${`${uidB}/${patA.id}/${crypto.randomUUID()}.pdf`}, 'application/pdf', 1000, 'x.pdf')`,
      ),
    }));

    check(drB.enumerate === 0, "3. Dr B cannot enumerate Dr A's document", `${drB.enumerate} row(s)`);
    check(drB.byPatient === 0, "3b. Dr B cannot list documents by Dr A's patient id");
    check(drB.global === 1, "10b. Dr B's global list contains only their own", `${drB.global} row(s)`);
    check(drB.owns === false, "4. Dr B fails the document ownership predicate");
    check(
      drB.archive !== null && /not found/i.test(drB.archive),
      "5. Dr B cannot archive Dr A's document",
      drB.archive ?? "SUCCEEDED — LEAK",
    );
    check(
      drB.restore !== null,
      "5b. Dr B cannot restore Dr A's document",
      drB.restore ?? "SUCCEEDED — LEAK",
    );
    check(
      drB.update !== null && /permission denied/i.test(drB.update),
      "5c. Direct UPDATE is revoked for authenticated",
      drB.update ?? "SUCCEEDED — LEAK",
    );
    check(
      drB.del !== null && /permission denied/i.test(drB.del),
      "5d. Direct DELETE is revoked for authenticated",
      drB.del ?? "SUCCEEDED — LEAK",
    );
    check(
      drB.fileForA !== null && /not found/i.test(drB.fileForA),
      "5e. Dr B cannot FILE a document against Dr A's patient",
      drB.fileForA ?? "SUCCEEDED — LEAK",
    );

    // ---- Reception and the location admin reach nothing clinical -------------
    for (const [uid, who] of [[uidR, "Reception"], [uidM, "Location admin"]]) {
      const staff = await as(tx, uid, async () => ({
        rows: (await tx`select id from public.patient_documents`).length,
        patientVisible: (await tx`select id from public.patients where id = ${patA.id}`).length,
      }));
      check(staff.rows === 0, `${who} sees no documents at all`, `${staff.rows} row(s)`);
      check(
        staff.patientVisible === 1,
        `${who} keeps the operational patient access they already had`,
      );
    }

    // ---- 6. Anonymous -------------------------------------------------------
    const anon = await asAnon(tx, async () => ({
      select: await refusal(() => tx`select id from public.patient_documents`),
      rpc: await refusal(
        () => tx`select public.create_patient_document(
          ${patA.id}, ${loc.id}, null, 'OTHER', 'QA anon', null, null,
          ${`${uidA}/${patA.id}/${crypto.randomUUID()}.pdf`}, 'application/pdf', 10, 'x.pdf')`,
      ),
      helper: await refusal(() => tx`select public.owns_patient_document(${created})`),
    }));
    check(anon.select !== null, "6. Anonymous cannot select patient_documents", anon.select ?? "SUCCEEDED — LEAK");
    check(anon.rpc !== null, "6b. Anonymous cannot execute create_patient_document", anon.rpc ?? "SUCCEEDED — LEAK");
    check(anon.helper !== null, "6c. Anonymous cannot execute the ownership helper", anon.helper ?? "SUCCEEDED — LEAK");

    // ---- 7/8. Content type and size are refused BY THE DATABASE --------------
    const rejects = await as(tx, uidA, async () => ({
      mime: await refusal(
        () => tx`select public.create_patient_document(
          ${patA.id}, ${loc.id}, null, 'OTHER', 'QA gif', null, null,
          ${`${uidA}/${patA.id}/${crypto.randomUUID()}.pdf`}, 'image/gif', 1000, 'x.gif')`,
      ),
      size: await refusal(
        () => tx`select public.create_patient_document(
          ${patA.id}, ${loc.id}, null, 'OTHER', 'QA huge', null, null,
          ${`${uidA}/${patA.id}/${crypto.randomUUID()}.pdf`}, 'application/pdf', 20000000, 'x.pdf')`,
      ),
      zero: await refusal(
        () => tx`select public.create_patient_document(
          ${patA.id}, ${loc.id}, null, 'OTHER', 'QA empty', null, null,
          ${`${uidA}/${patA.id}/${crypto.randomUUID()}.pdf`}, 'application/pdf', 0, 'x.pdf')`,
      ),
      futureDate: await refusal(
        () => tx`select public.create_patient_document(
          ${patA.id}, ${loc.id}, null, 'OTHER', 'QA future', (current_date + 40), null,
          ${`${uidA}/${patA.id}/${crypto.randomUUID()}.pdf`}, 'application/pdf', 1000, 'x.pdf')`,
      ),
      // The path is re-derived: another doctor's folder, another patient's
      // folder, a traversal and a smuggled filename are each refused.
      foreignFolder: await refusal(
        () => tx`select public.create_patient_document(
          ${patA.id}, ${loc.id}, null, 'OTHER', 'QA forge', null, null,
          ${`${uidB}/${patA.id}/${crypto.randomUUID()}.pdf`}, 'application/pdf', 1000, 'x.pdf')`,
      ),
      foreignPatient: await refusal(
        () => tx`select public.create_patient_document(
          ${patA.id}, ${loc.id}, null, 'OTHER', 'QA forge', null, null,
          ${`${uidA}/${patB.id}/${crypto.randomUUID()}.pdf`}, 'application/pdf', 1000, 'x.pdf')`,
      ),
      traversal: await refusal(
        () => tx`select public.create_patient_document(
          ${patA.id}, ${loc.id}, null, 'OTHER', 'QA forge', null, null,
          ${`${uidA}/${patA.id}/../../etc/passwd.pdf`}, 'application/pdf', 1000, 'x.pdf')`,
      ),
      filenamePath: await refusal(
        () => tx`select public.create_patient_document(
          ${patA.id}, ${loc.id}, null, 'OTHER', 'QA forge', null, null,
          ${`${uidA}/${patA.id}/report.pdf`}, 'application/pdf', 1000, 'x.pdf')`,
      ),
      // An encounter belonging to the caller but to a DIFFERENT patient.
      crossPatientEncounter: await refusal(
        () => tx`select public.create_patient_document(
          ${patB.id}, ${loc.id}, ${encA.id}, 'OTHER', 'QA cross', null, null,
          ${`${uidA}/${patB.id}/${crypto.randomUUID()}.pdf`}, 'application/pdf', 1000, 'x.pdf')`,
      ),
    }));

    check(/DOCUMENT_MIME_REJECTED/.test(rejects.mime ?? ""), "7. Invalid content type refused", rejects.mime ?? "ACCEPTED");
    check(/DOCUMENT_TOO_LARGE/.test(rejects.size ?? ""), "8. Oversized file refused", rejects.size ?? "ACCEPTED");
    check(/DOCUMENT_TOO_LARGE/.test(rejects.zero ?? ""), "8b. Empty file refused", rejects.zero ?? "ACCEPTED");
    check(/DOCUMENT_DATE_INVALID/.test(rejects.futureDate ?? ""), "8c. Impossible document date refused");
    check(/DOCUMENT_PATH_INVALID/.test(rejects.foreignFolder ?? ""), "11a. Another doctor's storage folder refused");
    check(/DOCUMENT_PATH_INVALID/.test(rejects.foreignPatient ?? ""), "11b. Another patient's storage folder refused");
    check(/DOCUMENT_PATH_INVALID/.test(rejects.traversal ?? ""), "11c. Path traversal refused");
    check(/DOCUMENT_PATH_INVALID/.test(rejects.filenamePath ?? ""), "11d. A filename cannot name the stored object");
    check(
      rejects.crossPatientEncounter !== null && /not found/i.test(rejects.crossPatientEncounter),
      "Encounter from another patient refused",
      rejects.crossPatientEncounter ?? "ACCEPTED",
    );

    // ---- 11. Storage: private bucket, owner-pinned policies, no bypass -------
    const [bucket] = await tx`select public, file_size_limit, allowed_mime_types
                              from storage.buckets where id = 'patient-documents'`;
    check(bucket?.public === false, "11e. patient-documents bucket is PRIVATE");
    check(
      Number(bucket?.file_size_limit) === 10485760,
      "11f. Bucket enforces the 10 MB ceiling",
      String(bucket?.file_size_limit),
    );
    check(
      (bucket?.allowed_mime_types ?? []).slice().sort().join(",") ===
        "application/pdf,image/jpeg,image/png",
      "11g. Bucket allows only PDF/JPEG/PNG",
      String(bucket?.allowed_mime_types),
    );

    const storagePolicies = await tx`select policyname, cmd, coalesce(qual, with_check) as predicate
      from pg_policies
      where schemaname = 'storage' and tablename = 'objects'
        and coalesce(qual, with_check) like '%patient-documents%'
      order by cmd`;
    const cmds = storagePolicies.map((p) => p.cmd).sort();
    check(
      cmds.join(",") === "INSERT,SELECT",
      "11h. Storage has SELECT and INSERT policies and NOTHING else",
      cmds.join(",") || "none",
    );
    check(
      storagePolicies.every((p) => (p.predicate ?? "").includes("auth.uid()")),
      "11i. Every storage policy pins the first path segment to auth.uid()",
    );

    // The live object test: a metadata fixture, rolled back with everything else.
    const fixtureError = await refusal(
      () => tx`insert into storage.objects (bucket_id, name, owner_id)
               values ('patient-documents', ${pathA}, ${uidA})`,
    );
    if (fixtureError) {
      check(false, "11j. Storage object fixture could be created", fixtureError);
    } else {
      const objectReads = {
        a: (await as(tx, uidA, () =>
          tx`select name from storage.objects where bucket_id = 'patient-documents' and name = ${pathA}`,
        )).length,
        b: (await as(tx, uidB, () =>
          tx`select name from storage.objects where bucket_id = 'patient-documents' and name = ${pathA}`,
        )).length,
        anon: await asAnon(tx, () =>
          refusal(
            () => tx`select name from storage.objects where bucket_id = 'patient-documents' and name = ${pathA}`,
          ),
        ),
      };
      check(objectReads.a === 1, "11j. Dr A can read their own stored object");
      check(
        objectReads.b === 0,
        "4b. Dr B cannot read the object EVEN GIVEN ITS EXACT PATH",
        `${objectReads.b} row(s)`,
      );
      check(objectReads.anon !== null, "6d. Anonymous cannot read the stored object");
    }

    // ---- Ownership cannot be forged, even from a privileged direct write -----
    const forged = await refusal(
      () => tx`insert into public.patient_documents
        (patient_id, owner_doctor_id, practice_location_id, document_type, title,
         storage_path, mime_type, size_bytes, original_filename)
        values (${patA.id}, ${docB.id}, ${loc.id}, 'OTHER', 'QA forged owner',
                ${`${uidB}/${patA.id}/${crypto.randomUUID()}.pdf`}, 'application/pdf', 10, 'x.pdf')`,
    );
    check(
      forged !== null && /foreign key|patient_documents_patient_owner_fk/i.test(forged),
      "Composite FK refuses an owner that is not the patient's own",
      forged ?? "ACCEPTED — the denormalised owner can drift",
    );

    // ---- Archive is the only removal, and it is auditable --------------------
    const archived = await as(tx, uidA, async () => {
      await tx`select public.archive_patient_document(${created}, 'QA filed against the wrong patient')`;
      const [row] = await tx`select archived_at, archived_by, archive_reason
                             from public.patient_documents where id = ${created}`;
      const twice = await refusal(
        () => tx`select public.archive_patient_document(${created}, 'QA again')`,
      );
      const noReason = await refusal(
        () => tx`select public.archive_patient_document(${createdB}, '')`,
      );
      await tx`select public.restore_patient_document(${created})`;
      const [back] = await tx`select archived_at from public.patient_documents where id = ${created}`;
      return { row, twice, noReason, back };
    });

    check(archived.row.archived_at !== null, "Archive sets the state");
    check(archived.row.archived_by === uidA, "Archive records WHO");
    check(
      archived.row.archive_reason === "QA filed against the wrong patient",
      "Archive records WHY",
    );
    check(
      /DOCUMENT_ALREADY_ARCHIVED/.test(archived.twice ?? ""),
      "Archiving twice is a deterministic refusal",
      archived.twice ?? "ACCEPTED",
    );
    check(
      /DOCUMENT_REASON_REQUIRED/.test(archived.noReason ?? ""),
      "A reason is required, and it is not Dr A's document anyway",
      archived.noReason ?? "ACCEPTED",
    );
    check(archived.back.archived_at === null, "Restore puts it back");

    /**
     * NEVER 40001. `serialization_failure` reads as "transient, retry" all the
     * way up the stack, and PostgREST duly retries it — one refused click
     * becomes a retry storm.
     */
    const [{ code }] = await as(tx, uidA, async () => {
      try {
        await tx`select public.archive_patient_document(${created}, 'ok')`;
        await tx`select public.archive_patient_document(${created}, 'again')`;
        return [{ code: "none" }];
      } catch (e) {
        return [{ code: e.code ?? "unknown" }];
      }
    });
    check(code !== "40001", "Business refusals are not raised as serialization_failure", code);

    // ---- The document row and its audit row are in ONE transaction ----------
    const audit = await tx`select action, resource_type, meta
      from public.audit_events
      where resource_id = ${created} and resource_type = 'patient_document'
      order by created_at`;
    const actions = audit.map((a) => a.action);
    check(
      actions.includes("document.uploaded"),
      "Upload wrote its audit row in the same transaction",
      actions.join(", "),
    );
    check(actions.includes("document.archived"), "Archive wrote its audit row");
    check(actions.includes("document.restored"), "Restore wrote its audit row");

    const leakedMeta = audit.filter((a) => {
      const text = JSON.stringify(a.meta ?? {});
      return /QA CBC report|cbc\.pdf|QA note|LAB_REPORT/.test(text);
    });
    check(
      leakedMeta.length === 0,
      "Audit meta carries NO title, filename, notes or document type",
      leakedMeta.map((a) => JSON.stringify(a.meta)).join(" ") || "clean",
    );

    // ---- Grants ------------------------------------------------------------
    const grants = await tx`select privilege_type from information_schema.role_table_grants
      where table_schema = 'public' and table_name = 'patient_documents' and grantee = 'authenticated'
      order by privilege_type`;
    check(
      grants.map((g) => g.privilege_type).join(",") === "SELECT",
      "authenticated holds SELECT and nothing else",
      grants.map((g) => g.privilege_type).join(",") || "none",
    );

    const anonGrants = await tx`select privilege_type from information_schema.role_table_grants
      where table_schema = 'public' and table_name = 'patient_documents' and grantee = 'anon'`;
    check(anonGrants.length === 0, "anon holds no privilege on patient_documents");

    const [rls] = await tx`select relrowsecurity, relforcerowsecurity
      from pg_class where oid = 'public.patient_documents'::regclass`;
    check(rls.relrowsecurity && rls.relforcerowsecurity, "RLS is enabled AND forced");

    const policies = await tx`select policyname, cmd, qual from pg_policies
      where schemaname = 'public' and tablename = 'patient_documents'`;
    check(
      policies.length === 1 && policies[0].cmd === "SELECT",
      "Exactly one policy, and it is a read policy",
      policies.map((p) => `${p.policyname}:${p.cmd}`).join(", ") || "none",
    );
    check(
      /current_doctor_id\(\)/.test(policies[0]?.qual ?? "") &&
        !/is_active_member|practice_location_members|can_access_patient/.test(
          policies[0]?.qual ?? "",
        ),
      "The read policy is owner-only, with no location-membership branch",
      policies[0]?.qual ?? "none",
    );

    throw new Error("ROLLBACK");
  });
} catch (e) {
  if (e.message !== "ROLLBACK") failures.push(`aborted: ${e.message}`);
}

const [left] = await sql`select count(*)::int as n from auth.users
  where id in (${uidA}, ${uidB}, ${uidR}, ${uidM})`;
check(left.n === 0, "Fixture rolled back completely");

const [orphans] = await sql`select count(*)::int as n from storage.objects
  where bucket_id = 'patient-documents' and name like ${`%${objectA}%`}`;
check(orphans.n === 0, "No storage metadata fixture left behind");

await sql.end();

if (failures.length) {
  console.error(`\n${failures.length} FAILED`);
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("\nPatient documents: all checks passed.\n");
