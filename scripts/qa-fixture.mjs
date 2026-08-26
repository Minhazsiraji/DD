/**
 * Throwaway QA accounts for browser verification. DEV ONLY, FAKE DATA ONLY.
 *
 *   npm run qa:create    # doctor + second doctor + receptionist, all signed-in-able
 *   npm run qa:destroy   # removes every account this script created
 *   npm run qa:status    # what currently exists
 *
 * Why this exists: several classes of bug in this project only appear when a
 * real session drives the real UI — a Base UI component that crashes on mount, a
 * layout that reads correctly but renders wrong, a fail-closed branch that never
 * fires. Those need a signed-in browser, and hand-building one every time is
 * where the mistakes creep in.
 *
 * Accounts are created directly in auth.users rather than through GoTrue.
 * GoTrue rejects a password login when its token columns are NULL, so they are
 * seeded to '' — that is a real GoTrue requirement, not a workaround.
 *
 * Storage objects are removed through the Storage API when
 * SUPABASE_SERVICE_ROLE_KEY is available, and skipped with a note when it is
 * not. They cannot be deleted with SQL: `storage.objects` is metadata, and
 * dropping the row would leave the file orphaned in the bucket.
 *
 * Every address, name and number here is invented. `@qa.invalid` is reserved by
 * RFC 2606 and can never be a real mailbox.
 */
import postgres from "postgres";
import crypto from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error("DIRECT_URL or DATABASE_URL must be set.");
  process.exit(1);
}

/** Every QA account shares this suffix, which is how destroy finds them. */
const QA_DOMAIN = "@qa.invalid";
const PASSWORD = "QaFixture12345";

/**
 * A 3×1 transparent PNG, written out byte by byte rather than fetched.
 *
 * It only has to be a VALID image that storage will accept and the renderer
 * will draw — nobody's actual signature belongs in a fixture, and a checked-in
 * binary would be one more thing to explain.
 */
const QA_SIGNATURE_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAMAAAABCAYAAAAxWXB3AAAAFElEQVR4nGP8//8/AzGAiYFIMKoQ" +
    "AJ0nAwPl6TnBAAAAAElFTkSuQmCC",
  "base64",
);

const PEOPLE = {
  doctor: { email: `qa.doctor${QA_DOMAIN}`, name: "Dr Ayesha Rahman" },
  other: { email: `qa.other.doctor${QA_DOMAIN}`, name: "Dr Kamal Uddin" },
  reception: { email: `qa.reception${QA_DOMAIN}`, name: "Nusrat Jahan" },
  /**
   * A LOCATION_ADMIN who is NOT also the doctor.
   *
   * The doctor holds LOCATION_ADMIN at both locations, so "admin" was only
   * ever testable as a hat the owner was already wearing — which proves
   * nothing about an admin who owns none of the clinical records. Every
   * handover and correction rule distinguishes the two.
   */
  admin: { email: `qa.admin${QA_DOMAIN}`, name: "Farhana Islam" },
};

const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });

/**
 * The QA fixture's own record of every account it has ever created.
 *
 * This exists so that deletion is driven by PROOF of provenance. An earlier
 * version inferred it instead — "this folder's uid is not in auth.users, so it
 * must be junk" — which is not a safe rule anywhere and is a dangerous one in
 * a clinical bucket. A real doctor's auth account may be closed long after
 * their prescriptions were signed; the frozen signatures on those
 * prescriptions must outlive the account, because the prescriptions do.
 *
 * Not in git: it names throwaway ids on one developer's machine.
 */
const MANIFEST = new URL("../.qa-fixture-uids.json", import.meta.url);

async function readManifest() {
  try {
    const raw = await readFile(MANIFEST, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v) => typeof v === "string") : [];
  } catch {
    return [];
  }
}

async function rememberQaUsers(userIds) {
  const known = new Set(await readManifest());
  for (const id of userIds) known.add(String(id));
  await writeFile(MANIFEST, JSON.stringify([...known], null, 2));
}

async function forgetQaUsers(userIds) {
  const gone = new Set(userIds.map(String));
  const left = (await readManifest()).filter((id) => !gone.has(id));
  await writeFile(MANIFEST, JSON.stringify(left, null, 2));
}

/**
 * Delete QA storage objects — and ONLY objects proven to be QA fixtures.
 *
 * Provenance comes from two places, both of which are records of what this
 * script did:
 *
 *   1. the QA accounts being destroyed right now (resolved from `@qa.invalid`);
 *   2. the manifest, for accounts a previous run destroyed before this script
 *      could remove their files.
 *
 * Anything else in these buckets is REPORTED AND LEFT ALONE. If an object
 * cannot be proven to be ours, leaking a few kilobytes in a development bucket
 * is the cheap mistake; deleting an unknown clinical asset is the expensive
 * one, and it is not reversible.
 *
 * Skipped without a service-role key. The clinical bucket has no DELETE policy
 * — that is the control, and a fixture script is not a reason to weaken it.
 *
 * PROVENANCE MUST OUTLIVE THE RESOURCE IT IDENTIFIES.
 *
 * This returns the set of uids whose files are CONFIRMED GONE, and the caller
 * forgets only those. The earlier version returned nothing and the caller
 * forgot everything it had just tried to destroy — so a run without a
 * service-role key silently erased the only record of what the surviving files
 * were, and every later run then correctly refused to touch them forever. The
 * cheap failure (files left behind, still identifiable) had been turned into
 * the expensive one (files left behind, permanently unidentifiable).
 *
 * "Confirmed gone" means listing under the uid afterwards finds nothing, not
 * that `remove()` returned without an error.
 */
async function removeQaStorage(userIds) {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const projectUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!serviceKey || !projectUrl) {
    console.log(
      "STORAGE CLEANUP SKIPPED — no SUPABASE_SERVICE_ROLE_KEY.\n" +
        "  Any QA files stay in the buckets, and their provenance is KEPT so a\n" +
        "  later run can still prove they are ours. Nothing is forgotten.",
    );
    return { ran: false, cleared: new Set(), unknown: new Set() };
  }

  const { createClient } = await import("@supabase/supabase-js");
  const storage = createClient(projectUrl, serviceKey, {
    auth: { persistSession: false },
  }).storage;

  const provenQa = new Set([...userIds.map(String), ...(await readManifest())]);

  let removed = 0;
  const unknown = new Set();
  /** uid -> did anything survive in any bucket? */
  const survived = new Set();
  const touched = new Set();

  for (const bucket of ["doctor-assets", "prescription-assets"]) {
    const { data: folders } = await storage.from(bucket).list("", { limit: 1000 });

    for (const folder of folders ?? []) {
      if (folder.id) continue; // a loose file at the root, not a user folder
      if (!provenQa.has(folder.name)) {
        // Not ours as far as we can prove. Say so; touch nothing.
        unknown.add(folder.name);
        continue;
      }

      const uid = folder.name;
      touched.add(uid);

      // Files sit at <uid>/… and, for frozen signatures, <uid>/<rx>/signature.
      const listAll = async () => {
        const { data: top } = await storage.from(bucket).list(uid, { limit: 1000 });
        const paths = [];
        for (const entry of top ?? []) {
          if (entry.id) {
            paths.push(`${uid}/${entry.name}`);
            continue;
          }
          const { data: inner } = await storage.from(bucket).list(`${uid}/${entry.name}`, {
            limit: 1000,
          });
          for (const file of inner ?? []) paths.push(`${uid}/${entry.name}/${file.name}`);
        }
        return paths;
      };

      const paths = await listAll();
      if (paths.length === 0) continue;

      const { data } = await storage.from(bucket).remove(paths);
      // Counted from the returned rows: a blocked delete removes nothing and
      // raises nothing, so the absence of an error proves nothing.
      removed += (data ?? []).length;

      /**
       * Then LOOK AGAIN. This is what makes "confirmed gone" mean something —
       * `remove()` reporting success is the claim, and the second listing is
       * the evidence.
       */
      if ((await listAll()).length > 0) survived.add(uid);
    }
  }

  const cleared = new Set([...touched].filter((uid) => !survived.has(uid)));

  if (removed > 0) console.log(`removed ${removed} QA storage object(s)`);
  if (survived.size > 0) {
    console.log(
      `CLEANUP INCOMPLETE: ${survived.size} QA folder(s) still hold files.\n` +
        "  Their provenance is KEPT so a later run can finish the job.",
    );
  }
  if (unknown.size > 0) {
    console.log(
      `LEFT ALONE: ${unknown.size} storage folder(s) not provably created by QA.\n` +
        "  They are not deleted, on purpose — a closed doctor account does not\n" +
        "  make its frozen prescription signatures disposable. Remove them by\n" +
        "  hand if you know what they are.",
    );
  }

  return { ran: true, cleared, unknown };
}
const mode = process.argv[2] ?? "status";

const [{ nspname: ext }] = await sql`
  select n.nspname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where p.proname = 'crypt' limit 1`;

async function createUser(tx, email, fullName) {
  const id = crypto.randomUUID();

  await tx.unsafe(
    `insert into auth.users (
       instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
       created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
       confirmation_token, recovery_token, email_change, email_change_token_new,
       email_change_token_current, phone_change, phone_change_token,
       reauthentication_token
     ) values (
       '00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated',
       $2, ${ext}.crypt($3, ${ext}.gen_salt('bf')), now(), now(), now(),
       '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
       '', '', '', '', '', '', '', ''
     )`,
    [id, email, PASSWORD],
  );

  await tx`
    insert into auth.identities (id, user_id, provider_id, identity_data, provider,
                                 last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), ${id}, ${id},
            ${sql.json({ sub: id, email, email_verified: true })}, 'email',
            now(), now(), now())`;

  await tx`insert into public.profiles (id, full_name, onboarded_at)
           values (${id}, ${fullName}, now())`;

  return id;
}

if (mode === "destroy") {
  const rows = await sql`select id, email from auth.users where email like ${"%" + QA_DOMAIN}`;
  const ids = rows.map((r) => r.id);

  /**
   * Order matters, and that is the point.
   *
   * Appointments RESTRICT on their doctor and patient, and appointment_events
   * RESTRICT on the appointment, so clinical history cannot be swept away by
   * deleting a person. Cleanup has to unwind it deliberately — if this ever
   * stops being necessary, the durability guarantee has been weakened.
   */
  if (ids.length > 0) {
    const locations = await sql`
      select id from public.practice_locations where created_by in ${sql(ids)}`;
    const locationIds = locations.map((l) => l.id);

    if (locationIds.length > 0) {
      /**
       * Encounters first of all. They RESTRICT on the appointment, the patient
       * and the location, and their own children RESTRICT on them — a
       * consultation cannot be erased as a side effect of tidying up, which is
       * the whole point of Stage 6A's foreign keys.
       */
      /**
       * Prescriptions before encounters. `prescriptions.encounter_id`
       * RESTRICTS, so an encounter that was prescribed from cannot be tidied
       * away until its prescription is — and the replacement chain has to
       * unwind newest-first for the same reason.
       */
      const prescriptions = await sql`
        select id from public.prescriptions
        where practice_location_id in ${sql(locationIds)}`;
      if (prescriptions.length > 0) {
        const rxIds = prescriptions.map((r) => r.id);
        await sql`delete from public.prescription_events where prescription_id in ${sql(rxIds)}`;
        await sql`delete from public.prescription_items where prescription_id in ${sql(rxIds)}`;
        await sql`update public.prescriptions set replaces_prescription_id = null
                  where id in ${sql(rxIds)}`;
        await sql`delete from public.prescriptions where id in ${sql(rxIds)}`;
      }

      const encounters = await sql`
        select id from public.encounters
        where practice_location_id in ${sql(locationIds)}`;
      if (encounters.length > 0) {
        const encounterIds = encounters.map((e) => e.id);
        await sql`delete from public.encounter_events
                  where encounter_id in ${sql(encounterIds)}`;
        await sql`delete from public.encounter_diagnoses
                  where encounter_id in ${sql(encounterIds)}`;
        await sql`delete from public.encounter_investigations
                  where encounter_id in ${sql(encounterIds)}`;
        await sql`delete from public.encounters where id in ${sql(encounterIds)}`;
      }

      // Queue history next: queue_events and queue_entries RESTRICT on the
      // appointment, so the appointment cannot go until they have.
      await sql`delete from public.queue_events
                where practice_location_id in ${sql(locationIds)}`;
      await sql`delete from public.queue_entries
                where practice_location_id in ${sql(locationIds)}`;
      await sql`delete from public.appointment_events
                where practice_location_id in ${sql(locationIds)}`;
      await sql`delete from public.appointments
                where practice_location_id in ${sql(locationIds)}`;
      await sql`delete from public.appointment_token_counters
                where practice_location_id in ${sql(locationIds)}`;
    }

    const doctors = await sql`
      select id from public.doctor_profiles where user_id in ${sql(ids)}`;
    if (doctors.length > 0) {
      await sql`delete from public.patients
                where owner_doctor_id in ${sql(doctors.map((d) => d.id))}`;
    }
  }

  /**
   * Storage objects, through the Storage API.
   *
   * They cannot go with SQL: `storage.objects` is metadata, and deleting the
   * row would leave the file itself orphaned in the bucket. Removing the QA
   * users first would also strand these under a uid nobody can look up, so the
   * files go BEFORE the accounts they belong to.
   *
   * This is the one place allowed to delete from `prescription-assets`, and
   * only ever for fixtures: the bucket has no DELETE policy precisely so that
   * a finalised prescription's signature can never be removed by the app.
   */
  const storageResult = await removeQaStorage(rows.map((r) => r.id));

  for (const r of rows) {
    await sql`delete from public.practice_locations where created_by = ${r.id}`;
    await sql`delete from auth.users where id = ${r.id}`;
  }
  console.log(`removed ${rows.length} QA account(s): ${rows.map((r) => r.email).join(", ") || "none"}`);

  /**
   * Forget ONLY the identities whose files are confirmed gone.
   *
   * PROVENANCE MUST OUTLIVE THE RESOURCE IT IDENTIFIES. Dropping the record
   * while objects survive leaves them with no remaining proof of what they
   * were — and this script would then, correctly, refuse to ever touch them
   * again. That is how the four currently-orphaned prescription assets came
   * to exist: a run without a service-role key skipped the files and forgot
   * them anyway.
   *
   * A uid whose files survived stays in the manifest, so a later run with the
   * key can finish the job with proof rather than a guess.
   */
  /**
   * The rule, derived from what is actually TRUE rather than from what this run
   * happened to touch: a QA identity may be forgotten when its account is gone
   * AND it holds no files in either bucket.
   *
   * Both halves matter. Forgetting one that still holds files is the original
   * defect. Forgetting one whose account still exists would strand a live
   * fixture. And it must consider the WHOLE manifest, not just the accounts
   * destroyed in this run — the second destroy after a key-less first one has
   * no accounts left to iterate, and that is precisely the run that finally
   * removes the files.
   */
  const stillHeld = new Set(
    (
      await sql`
        select distinct split_part(name, '/', 1) as uid from storage.objects
        where bucket_id in ('doctor-assets', 'prescription-assets')`
    ).map((r) => r.uid),
  );
  const stillAccounts = new Set(
    (await sql`select id from auth.users where email like ${"%" + QA_DOMAIN}`).map((r) =>
      String(r.id),
    ),
  );

  const known = await readManifest();
  const toForget = known.filter((id) => !stillHeld.has(id) && !stillAccounts.has(id));
  const kept = known.filter((id) => !toForget.includes(id));

  await forgetQaUsers(toForget);
  if (kept.length > 0) {
    console.log(
      `PROVENANCE KEPT for ${kept.length} QA identity(ies) whose files are still present.\n` +
        "  Re-run destroy with SUPABASE_SERVICE_ROLE_KEY set to finish removing them.",
    );
  }
  if (!storageResult.ran && kept.length === 0) {
    console.log("  (nothing was left in storage, so nothing needed keeping)");
  }

  const [left] = await sql`
    select
      (select count(*)::int from auth.users where email like ${"%" + QA_DOMAIN}) as users,
      (select count(*)::int from public.patients)             as patients,
      (select count(*)::int from public.prescription_templates) as templates,
      (select count(*)::int from storage.objects where bucket_id = 'doctor-assets') as signatures`;
  console.log("remaining:", left);
  if (left.signatures > 0) {
    /**
     * Says what is true. This previously read "set SUPABASE_SERVICE_ROLE_KEY to
     * clear leftover storage objects", which is printed whenever ANY object
     * remains — including the ones deliberately kept — so it accused the
     * operator of a missing key that was in fact configured, and cost real time
     * chasing it.
     */
    console.log(
      `NOTE: ${left.signatures} object(s) remain in doctor-assets.\n` +
        "  Objects not provably created by this fixture are LEFT ALONE on purpose —\n" +
        "  a closed account does not make frozen prescription signatures disposable.",
    );
  }
  await sql.end();
  process.exit(0);
}

if (mode === "status") {
  const rows = await sql`
    select u.email, p.full_name from auth.users u
    join public.profiles p on p.id = u.id
    where u.email like ${"%" + QA_DOMAIN} order by u.email`;
  console.log(rows.length ? rows : "no QA accounts");
  await sql.end();
  process.exit(0);
}

if (mode !== "create") {
  console.error(`unknown mode "${mode}" — use create | destroy | status`);
  await sql.end();
  process.exit(1);
}

const existing = await sql`select email from auth.users where email like ${"%" + QA_DOMAIN}`;
if (existing.length > 0) {
  console.log("QA accounts already exist. Run `npm run qa:destroy` first.");
  console.log(existing.map((r) => r.email).join("\n"));
  await sql.end();
  process.exit(0);
}

await sql.begin(async (tx) => {
  const doctorUser = await createUser(tx, PEOPLE.doctor.email, PEOPLE.doctor.name);
  const otherUser = await createUser(tx, PEOPLE.other.email, PEOPLE.other.name);
  const deskUser = await createUser(tx, PEOPLE.reception.email, PEOPLE.reception.name);
  const adminUser = await createUser(tx, PEOPLE.admin.email, PEOPLE.admin.name);

  /**
   * Recorded now, while we still know these ids are ours.
   *
   * `destroy` deletes storage only under ids it can PROVE this script created.
   * If a later destroy runs after the accounts are gone — or without a
   * service-role key, so the files outlive them — this is the only remaining
   * evidence of provenance.
   */
  await rememberQaUsers([doctorUser, otherUser, deskUser, adminUser]);

  await tx`insert into public.doctor_profiles (user_id, qualification, specialization,
             designation, bmdc_registration_no, patient_number_prefix)
           values (${doctorUser}, 'MBBS, FCPS (Medicine)', 'Internal Medicine',
                   'Associate Professor', 'A-00000', 'AR')`;
  await tx`insert into public.doctor_profiles (user_id, patient_number_prefix)
           values (${otherUser}, 'KU')`;

  // A private chamber (doctor alone) and a hospital (shared with reception).
  const [chamber] = await tx`
    insert into public.practice_locations (name, type, address, district, phone, created_by)
    values ('Greenview Chamber', 'PERSONAL_CHAMBER', '12 Green Road', 'Dhaka',
            '01700000000', ${doctorUser}) returning id`;
  const [hospital] = await tx`
    insert into public.practice_locations (name, type, address, district, phone, created_by)
    values ('Metro Hospital', 'HOSPITAL', '9 Airport Road', 'Dhaka',
            '01800000000', ${doctorUser}) returning id`;

  await tx`insert into public.practice_location_members
             (practice_location_id, user_id, role, status)
           values
             (${chamber.id},  ${doctorUser}, 'DOCTOR', 'ACTIVE'),
             (${chamber.id},  ${doctorUser}, 'LOCATION_ADMIN', 'ACTIVE'),
             (${hospital.id}, ${doctorUser}, 'DOCTOR', 'ACTIVE'),
             (${hospital.id}, ${doctorUser}, 'LOCATION_ADMIN', 'ACTIVE'),
             (${hospital.id}, ${deskUser},   'RECEPTIONIST', 'ACTIVE'),
             (${hospital.id}, ${adminUser},  'LOCATION_ADMIN', 'ACTIVE'),
             (${hospital.id}, ${otherUser},  'DOCTOR', 'ACTIVE')`;
});

/**
 * Give the QA doctor a real signature, through the Storage API.
 *
 * WITHOUT THIS, FINALISATION CANNOT BE TESTED AT ALL. A layout that prints a
 * signature refuses to finalise while the doctor has none — correctly, since a
 * prescription is a signed document — so every immutability test that depends
 * on a finalised snapshot was unrunnable against this fixture.
 *
 * NOT a `storage.objects` INSERT. Supabase treats that schema as read-only
 * metadata: a direct row creates an entry with no object behind it, which reads
 * as success and prints as a broken image on a prescription. The bytes go
 * through the Storage API like any other upload, and `signature_url` is set to
 * the path afterwards — the same two steps the app itself performs.
 *
 * The image is a tiny generated PNG, not a real person's signature.
 */
async function signQaDoctor() {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const projectUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

  if (!serviceKey || !projectUrl) {
    console.log(
      "\nSIGNATURE SKIPPED — no SUPABASE_SERVICE_ROLE_KEY.\n" +
        "  Finalisation tests need a signed doctor; set the key and re-run.",
    );
    return;
  }

  const [row] = await sql`
    select d.id, d.user_id from public.doctor_profiles d
    join auth.users u on u.id = d.user_id
    where u.email = ${PEOPLE.doctor.email}`;
  if (!row) return;

  const { createClient } = await import("@supabase/supabase-js");
  const storage = createClient(projectUrl, serviceKey, {
    auth: { persistSession: false },
  }).storage;

  const path = `${row.user_id}/signature-qa.png`;
  const { error: uploadError } = await storage
    .from("doctor-assets")
    .upload(path, QA_SIGNATURE_PNG, { contentType: "image/png", upsert: true });

  if (uploadError) {
    console.log(`\nSIGNATURE UPLOAD FAILED — ${uploadError.message}`);
    return;
  }

  /**
   * Confirmed from the object itself, not from the absence of an error. A
   * signature the database points at but storage does not hold prints as a
   * broken image on a clinical document.
   */
  const { data: info, error: infoError } = await storage.from("doctor-assets").info(path);
  if (infoError || !info) {
    console.log("\nSIGNATURE NOT CONFIRMED IN STORAGE — leaving the profile unsigned.");
    return;
  }

  await sql`update public.doctor_profiles
               set signature_url = ${path}, updated_at = now()
             where id = ${row.id}`;

  console.log(`\n  signature   ${PEOPLE.doctor.email} is signed and can finalise`);
}

await signQaDoctor();

console.log(`created (password for all: ${PASSWORD})\n`);
for (const [role, p] of Object.entries(PEOPLE)) {
  console.log(`  ${role.padEnd(10)} ${p.email}`);
}
console.log(`
  Greenview Chamber  doctor only
  Metro Hospital     doctor + reception + a location admin + a second doctor
`);

await sql.end();
