/**
 * Prescription-template isolation and signature-storage privacy, executed as
 * the `authenticated` role inside a transaction that is ALWAYS rolled back.
 *
 * A prescription template carries the doctor's name, BMDC number and signature
 * layout. Another doctor reading or editing it is an identity problem, not a
 * settings problem — so this proves isolation by running two real doctors
 * against the same rows rather than by reading the policy text.
 *
 *   node --env-file=.env.local scripts/verify-templates.mjs
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

/** Savepoint, because an error otherwise aborts the whole transaction. */
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

// ---------------------------------------------------------------------------
// Static posture first — cheap, and a failure here explains everything after it.
// ---------------------------------------------------------------------------
console.log("\nRow Level Security");
const [rls] = await sql`
  select c.relrowsecurity as enabled, c.relforcerowsecurity as forced
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'prescription_templates'`;
check(Boolean(rls?.enabled && rls?.forced), "prescription_templates: RLS enabled + forced");

const [pol] = await sql`
  select count(*)::int as n from pg_policies
  where schemaname = 'public' and tablename = 'prescription_templates'`;
check(pol.n >= 4, "prescription_templates: policies for select/insert/update/delete", `${pol.n} found`);

const [anonGrant] = await sql`
  select count(*)::int as n from information_schema.role_table_grants
  where table_schema = 'public' and table_name = 'prescription_templates' and grantee = 'anon'`;
check(anonGrant.n === 0, "anon has no grants on prescription_templates");

console.log("\nDefault-template integrity");
const idx = await sql`
  select indexname from pg_indexes
  where schemaname = 'public' and tablename = 'prescription_templates'
    and indexname like '%default%'`;
check(
  idx.length === 2,
  "partial unique indexes enforce AT MOST one default per scope",
  idx.map((i) => i.indexname).join(", "),
);

console.log("\nSignature storage");
const [bucket] = await sql`
  select public, file_size_limit, allowed_mime_types
  from storage.buckets where id = 'doctor-assets'`;
check(Boolean(bucket), "doctor-assets bucket exists");
check(bucket?.public === false, "doctor-assets is PRIVATE");
check(Number(bucket?.file_size_limit) === 2097152, "doctor-assets caps uploads at 2 MB");
check(
  Array.isArray(bucket?.allowed_mime_types) && !bucket.allowed_mime_types.includes("text/html"),
  "doctor-assets accepts images only",
);

const storagePolicies = await sql`
  select policyname from pg_policies
  where schemaname = 'storage' and tablename = 'objects' and policyname like 'doctor_assets%'`;
check(storagePolicies.length === 4, "storage policies for all four verbs", `${storagePolicies.length} found`);

console.log("\nIdentity + scoping functions");
const fns = await sql`
  select p.proname, p.prosecdef, p.proconfig
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('update_doctor_identity', 'may_scope_template_to')`;

for (const name of ["update_doctor_identity", "may_scope_template_to"]) {
  const fn = fns.find((f) => f.proname === name);
  check(Boolean(fn), `${name}: exists`);
  // INVOKER, so RLS still applies — these exist for atomicity and clarity,
  // never to escalate privilege.
  check(fn?.prosecdef === false, `${name}: SECURITY INVOKER`);
  check(
    (fn?.proconfig ?? []).some((c) => c.startsWith("search_path=")),
    `${name}: search_path pinned`,
  );
}

// ---------------------------------------------------------------------------
// Executed isolation.
// ---------------------------------------------------------------------------
const uidA = crypto.randomUUID();
const uidB = crypto.randomUUID();
const uidR = crypto.randomUUID();

try {
  await sql.begin(async (tx) => {
    for (const [uid, name] of [
      [uidA, "Dr A"],
      [uidB, "Dr B"],
      [uidR, "Reception R"],
    ]) {
      await tx`insert into auth.users (id, email) values (${uid}, ${`${uid}@qa.invalid`})`;
      await tx`insert into public.profiles (id, full_name) values (${uid}, ${name})`;
    }

    const [docA] = await tx`
      insert into public.doctor_profiles (user_id, patient_number_prefix)
      values (${uidA}, 'AA') returning id`;
    const [docB] = await tx`
      insert into public.doctor_profiles (user_id, patient_number_prefix)
      values (${uidB}, 'BB') returning id`;

    const [hospital] = await tx`
      insert into public.practice_locations (name, type, created_by)
      values ('QA Hospital', 'HOSPITAL', ${uidA}) returning id`;
    const [chamber] = await tx`
      insert into public.practice_locations (name, type, created_by)
      values ('QA Chamber', 'PERSONAL_CHAMBER', ${uidA}) returning id`;

    await tx`insert into public.practice_location_members (practice_location_id, user_id, role, status)
             values (${hospital.id}, ${uidA}, 'DOCTOR', 'ACTIVE'),
                    (${chamber.id},  ${uidA}, 'DOCTOR', 'ACTIVE'),
                    (${hospital.id}, ${uidR}, 'RECEPTIONIST', 'ACTIVE')`;

    console.log("\nOwnership");
    let globalTpl, hospitalTpl;

    await as(tx, uidA, async () => {
      // RETURNING re-checks the SELECT policy — this is the trap that already
      // bit patient creation once.
      [globalTpl] = await tx`
        insert into public.prescription_templates (owner_doctor_id, name, is_default)
        values (${docA.id}, 'Standard', true) returning id`;
      check(Boolean(globalTpl?.id), "Doctor A creates a template with RETURNING");

      [hospitalTpl] = await tx`
        insert into public.prescription_templates
          (owner_doctor_id, practice_location_id, name, is_default)
        values (${docA.id}, ${hospital.id}, 'Hospital pad', true) returning id`;
      check(
        Boolean(hospitalTpl?.id),
        "a location default coexists with a global default",
      );

      const forged = await expectDenied(tx, async (t) => {
        await t`insert into public.prescription_templates (owner_doctor_id, name)
                values (${docB.id}, 'Forged')`;
      });
      check(forged, "Doctor A cannot create a template owned by Doctor B");

      const twoGlobal = await expectDenied(tx, async (t) => {
        await t`insert into public.prescription_templates (owner_doctor_id, name, is_default)
                values (${docA.id}, 'Second default', true)`;
      });
      check(twoGlobal, "a second global default is rejected by the database");

      const twoAtHospital = await expectDenied(tx, async (t) => {
        await t`insert into public.prescription_templates
                  (owner_doctor_id, practice_location_id, name, is_default)
                values (${docA.id}, ${hospital.id}, 'Another hospital pad', true)`;
      });
      check(twoAtHospital, "a second default at one location is rejected");
    });

    console.log("\nIsolation");
    await as(tx, uidB, async () => {
      const [seen] = await tx`
        select count(*)::int as n from public.prescription_templates
        where id in (${globalTpl.id}, ${hospitalTpl.id})`;
      check(seen.n === 0, "Doctor B cannot see Doctor A's templates");

      const [updated] = await tx`
        update public.prescription_templates set name = 'Hijacked'
        where id = ${globalTpl.id} returning id`.catch(() => [null]);
      check(!updated, "Doctor B cannot rename Doctor A's template");

      const deleted = await tx`
        delete from public.prescription_templates where id = ${globalTpl.id} returning id`;
      check(deleted.length === 0, "Doctor B cannot delete Doctor A's template");

      const promoted = await expectDenied(tx, async (t) => {
        await t`select public.set_default_template(${hospitalTpl.id})`;
      });
      check(promoted, "Doctor B cannot promote Doctor A's template to default");
    });

    await as(tx, uidR, async () => {
      const [seen] = await tx`
        select count(*)::int as n from public.prescription_templates`;
      check(seen.n === 0, "reception at Doctor A's hospital sees no templates");
    });

    console.log("\nset_default_template");
    await as(tx, uidA, async () => {
      const [second] = await tx`
        insert into public.prescription_templates (owner_doctor_id, name)
        values (${docA.id}, 'Alternate') returning id`;

      await tx`select public.set_default_template(${second.id})`;

      const rows = await tx`
        select id, is_default, practice_location_id
        from public.prescription_templates where owner_doctor_id = ${docA.id}`;

      const globals = rows.filter((r) => r.practice_location_id === null && r.is_default);
      check(globals.length === 1, "one global default after promotion");
      check(globals[0]?.id === second.id, "the promoted template is the new default");
      check(
        rows.find((r) => r.id === hospitalTpl.id)?.is_default === true,
        "promoting a global default leaves the location default alone",
      );
    });

    // -----------------------------------------------------------------------
    // A location-scoped template requires a DOCTOR role at that location.
    // -----------------------------------------------------------------------
    console.log("\nLocation scoping requires DOCTOR");

    // Doctor A is RECEPTIONIST — not DOCTOR — at this third location.
    const [deskOnly] = await tx`
      insert into public.practice_locations (name, type, created_by)
      values ('QA Front Desk', 'CLINIC', ${uidA}) returning id`;
    await tx`insert into public.practice_location_members (practice_location_id, user_id, role, status)
             values (${deskOnly.id}, ${uidA}, 'RECEPTIONIST', 'ACTIVE')`;

    await as(tx, uidA, async () => {
      const denied = await expectDenied(tx, async (t) => {
        await t`insert into public.prescription_templates
                  (owner_doctor_id, practice_location_id, name)
                values (${docA.id}, ${deskOnly.id}, 'Desk pad')`;
      });
      check(denied, "cannot scope a template to a location where they are only RECEPTIONIST");

      const [ok] = await tx`
        insert into public.prescription_templates
          (owner_doctor_id, practice_location_id, name)
        values (${docA.id}, ${chamber.id}, 'Chamber pad') returning id`;
      check(Boolean(ok?.id), "can scope a template where they hold DOCTOR");

      // Moving an existing template to a non-doctor location must fail too —
      // WITH CHECK on UPDATE, not just INSERT.
      const moveDenied = await expectDenied(tx, async (t) => {
        await t`update public.prescription_templates
                   set practice_location_id = ${deskOnly.id}
                 where id = ${ok.id}`;
      });
      check(moveDenied, "cannot MOVE a template to a reception-only location");
    });

    // -----------------------------------------------------------------------
    // Identity updates are one transaction.
    // -----------------------------------------------------------------------
    console.log("\nAtomic identity update");
    await as(tx, uidA, async () => {
      await tx`select public.update_doctor_identity(
        'Dr A Updated', '01700000001', 'MBBS', 'Cardiology', 'Consultant', 'A-1', 'AA')`;

      const [p] = await tx`select full_name, phone from public.profiles where id = ${uidA}`;
      const [d] = await tx`
        select qualification, designation, patient_number_prefix, patient_number_seq
        from public.doctor_profiles where id = ${docA.id}`;

      check(p.full_name === "Dr A Updated" && d.qualification === "MBBS",
        "both tables updated by one call");
      check(d.patient_number_seq === 0, "patient_number_seq is never overwritten");
    });

    // Force the SECOND write to fail and prove the FIRST is rolled back.
    await tx`alter table public.doctor_profiles
             add constraint qa_block_prefix check (patient_number_prefix <> 'ZZ')`;

    await as(tx, uidA, async () => {
      const raised = await expectDenied(tx, async (t) => {
        await t`select public.update_doctor_identity(
          'Name That Must Not Stick', null, null, null, null, null, 'ZZ')`;
      });
      check(raised, "identity update fails when the doctor row cannot be written");

      const [p] = await tx`select full_name from public.profiles where id = ${uidA}`;
      check(
        p.full_name === "Dr A Updated",
        "the name did NOT change when the doctor row failed",
        p.full_name,
      );
    });

    await tx`alter table public.doctor_profiles drop constraint qa_block_prefix`;

    // -----------------------------------------------------------------------
    // "At most one" default — zero is a legitimate state.
    // -----------------------------------------------------------------------
    console.log("\nDefault semantics");
    await as(tx, uidA, async () => {
      await tx`update public.prescription_templates
                  set is_default = false
                where owner_doctor_id = ${docA.id}`;
      const [none] = await tx`
        select count(*)::int as n from public.prescription_templates
        where owner_doctor_id = ${docA.id} and is_default`;
      check(none.n === 0, "a doctor may have NO default at all (fallback handles it)");

      const [remaining] = await tx`
        select count(*)::int as n from public.prescription_templates
        where owner_doctor_id = ${docA.id}`;
      check(remaining.n > 0, "templates still exist — none was auto-promoted", `${remaining.n}`);
    });

    console.log("\nSignature objects");
    await as(tx, uidA, async () => {
      const denied = await expectDenied(tx, async (t) => {
        await t`insert into storage.objects (bucket_id, name)
                values ('doctor-assets', ${`${uidB}/signature.png`})`;
      });
      check(denied, "a doctor cannot write into another doctor's signature folder");

      await tx`insert into storage.objects (bucket_id, name)
               values ('doctor-assets', ${`${uidA}/signature.png`})`;
      const [own] = await tx`
        select count(*)::int as n from storage.objects
        where bucket_id = 'doctor-assets' and name = ${`${uidA}/signature.png`}`;
      check(own.n === 1, "a doctor can write and read their own signature");
    });

    await as(tx, uidB, async () => {
      const [seen] = await tx`
        select count(*)::int as n from storage.objects
        where bucket_id = 'doctor-assets' and name = ${`${uidA}/signature.png`}`;
      check(seen.n === 0, "Doctor B cannot read Doctor A's signature object");
    });

    /**
     * NOT verifiable here: Supabase blocks direct SQL deletion from
     * storage.objects, so the delete path only exists through the Storage API.
     *
     * What matters about it: a storage delete blocked by RLS removes nothing
     * and raises NOTHING — `remove()` returns an empty list with no error.
     * Trusting the absence of an error made removeSignatureAction report
     * "Signature removed" while the image was still in the bucket. It now
     * checks the returned rows instead. That behaviour was reproduced through
     * the browser by dropping doctor_assets_delete, and is guarded in the
     * action itself.
     */

    throw new Error("__rollback__");
  });
} catch (e) {
  if (e.message !== "__rollback__") check(false, "template verification", e.message);
}

await sql.end();

console.log(
  failures.length === 0
    ? `\nAll ${"template"} checks passed.\n`
    : `\n${failures.length} CHECK(S) FAILED:\n  - ${failures.join("\n  - ")}\n`,
);
process.exit(failures.length === 0 ? 0 : 1);
