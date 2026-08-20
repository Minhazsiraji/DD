/**
 * Stage 7A FINAL SECURITY GATE.
 *
 * Two halves, and the distinction matters:
 *
 *   FRESH   a throwaway database built from zero — every migration in journal
 *           order, then every policy file in order — proving the boundary is a
 *           property of the repository and not of one long-lived database that
 *           happens to have been patched into shape. Supabase's `auth` and
 *           `storage` schemas are shimmed there; what is being tested is OUR
 *           migration and policy order, not Supabase.
 *
 *   LIVE    adversarial multi-tenant attacks against the real database, where
 *           auth and storage are genuine, inside a transaction that is always
 *           rolled back.
 *
 *   node --env-file=.env.local scripts/security-gate.mjs
 */
import postgres from "postgres";
import crypto from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error("DIRECT_URL or DATABASE_URL must be set.");
  process.exit(1);
}

const MIGRATIONS = path.resolve("drizzle/migrations");
const POLICIES = path.resolve("supabase/policies");
const PROBE_DB = "dd_security_gate";

const failures = [];
const findings = [];
function check(ok, label, detail = "") {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(label);
}
function section(t) {
  console.log(`\n${t}`);
}

const CLINICAL = [
  "patients", "patient_private_notes", "patient_allergies", "patient_conditions",
  "patient_medications", "patient_alerts", "patient_contacts", "patient_location_links",
  "encounters", "encounter_diagnoses", "encounter_investigations", "encounter_events",
  "prescriptions", "prescription_items", "prescription_events", "prescription_templates",
  "appointments", "appointment_events", "queue_entries", "queue_events", "audit_events",
  "doctor_profiles", "profiles", "practice_locations", "practice_location_members",
];

/** RPC-only tables: no direct write path, and no direct read where a location matters. */
const NO_DIRECT_WRITE = [
  "encounters", "encounter_diagnoses", "encounter_investigations", "encounter_events",
  "prescriptions", "prescription_items", "prescription_events",
  "appointments", "appointment_events", "queue_entries", "queue_events",
];
const NO_DIRECT_READ = ["prescriptions", "prescription_items"];

const PRESCRIPTION_RPCS = [
  "open_prescription", "add_prescription_item", "update_prescription_item",
  "remove_prescription_item", "move_prescription_item", "prescription_review_bundle",
  "finalize_prescription", "prescriptions_for_doctor", "finalized_prescriptions_at",
  "prescription_detail", "owns_prescription", "may_hand_over_prescription",
  "may_read_prescription_asset",
];

function migrationsInOrder() {
  const journal = JSON.parse(readFileSync(path.join(MIGRATIONS, "meta", "_journal.json"), "utf8"));
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql"));
  return journal.entries.map((e) => {
    const file = files.find((f) => f.startsWith(e.tag));
    if (!file) throw new Error(`journal entry ${e.tag} has no .sql file`);
    return { tag: e.tag, sql: readFileSync(path.join(MIGRATIONS, file), "utf8") };
  });
}

const admin = postgres(url, { max: 1, prepare: false, onnotice: () => {} });

// ===========================================================================
// B. FRESH DATABASE — migrations, then policies, from zero
// ===========================================================================
section("B. Fresh database: every migration and policy from zero");

let probe;
try {
  await admin.unsafe(`drop database if exists ${PROBE_DB} with (force)`);
  await admin.unsafe(`create database ${PROBE_DB}`);

  const probeUrl = new URL(url);
  probeUrl.pathname = `/${PROBE_DB}`;
  probe = postgres(probeUrl.toString(), { max: 1, prepare: false, onnotice: () => {} });

  /**
   * Supabase owns `auth` and `storage`, so the repository never creates them.
   * A faithful-enough shim lets OUR policies compile and be inspected; the
   * live half below exercises the real thing.
   */
  await probe.unsafe(`
    create extension if not exists pgcrypto;
    -- Supabase installs extensions into their own schema; 0002 expects it.
    create schema if not exists extensions;
    create extension if not exists pg_trgm with schema extensions;
    create schema if not exists auth;
    create table if not exists auth.users (id uuid primary key, email text);
    create or replace function auth.uid() returns uuid language sql stable as $fn$
      select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub','')::uuid
    $fn$;
    create schema if not exists storage;
    create table if not exists storage.buckets (
      id text primary key, name text, public boolean default false,
      file_size_limit bigint, allowed_mime_types text[]);
    create table if not exists storage.objects (
      id uuid primary key default gen_random_uuid(), bucket_id text, name text,
      owner uuid, metadata jsonb);
    create or replace function storage.foldername(name text) returns text[]
      language sql immutable as $fn$ select string_to_array(name, '/') $fn$;
    -- Supabase ships this publication; 0015 adds the queue tables to it.
    create publication supabase_realtime;
    grant usage on schema auth, storage to authenticated, anon;
    grant select on storage.objects to authenticated;
    alter table storage.objects enable row level security;`);

  const migs = migrationsInOrder();
  for (const { tag, sql: body } of migs) {
    for (const stmt of body.split("--> statement-breakpoint").map((x) => x.trim()).filter(Boolean)) {
      try {
        await probe.unsafe(stmt);
      } catch (e) {
        throw new Error(`migration ${tag}: ${e.message}`);
      }
    }
  }
  check(true, `all ${migs.length} migrations replay from zero`);

  const policyFiles = readdirSync(POLICIES).filter((f) => f.endsWith(".sql")).sort();
  for (const f of policyFiles) {
    try {
      await probe.unsafe(readFileSync(path.join(POLICIES, f), "utf8"));
    } catch (e) {
      throw new Error(`policy ${f}: ${e.message}`);
    }
  }
  check(true, `all ${policyFiles.length} policy files apply in order`, policyFiles.at(-1));

  for (const f of ["0018_prescriptions_rls.sql", "0019b_prescription_finalize.sql", "0020_revoke_truncate.sql"]) {
    check(policyFiles.includes(f), `${f} is part of the ordered set`);
  }

  // The gate's whole point: these must hold on a database nobody has patched.
  const freshTrunc = await probe`
    select table_name from information_schema.role_table_grants
    where table_schema='public' and grantee in ('authenticated','anon')
      and privilege_type='TRUNCATE'`;
  check(freshTrunc.length === 0, "fresh DB: no TRUNCATE for authenticated or anon",
    freshTrunc.map((t) => t.table_name).join(", "));

  const freshRead = await probe`
    select table_name from information_schema.role_table_grants
    where table_schema='public' and grantee='authenticated'
      and privilege_type='SELECT' and table_name = any(${NO_DIRECT_READ})`;
  check(freshRead.length === 0, "fresh DB: no direct SELECT on prescriptions or items",
    freshRead.map((t) => t.table_name).join(", "));

  const freshWrite = await probe`
    select table_name, privilege_type from information_schema.role_table_grants
    where table_schema='public' and grantee='authenticated'
      and privilege_type in ('INSERT','UPDATE','DELETE') and table_name = any(${NO_DIRECT_WRITE})`;
  check(freshWrite.length === 0, "fresh DB: no direct writes on RPC-only tables",
    freshWrite.map((t) => `${t.table_name}.${t.privilege_type}`).join(", "));

  const freshFinalize = await probe`
    select pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname='public' and p.proname='finalize_prescription'`;
  check(freshFinalize.length === 1, "fresh DB: exactly one finalize_prescription",
    `${freshFinalize.length}`);
  check(
    freshFinalize.length === 1 && !freshFinalize[0].args.includes("jsonb"),
    "fresh DB: the caller-supplied-snapshot overload does not exist",
    freshFinalize[0]?.args ?? "",
  );

  const freshDefiner = await probe`
    select count(*)::int as n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname='public' and p.prosecdef
      and not exists (select 1 from unnest(coalesce(p.proconfig,'{}')) c where c like 'search_path=%')`;
  check(freshDefiner[0].n === 0, "fresh DB: every SECURITY DEFINER pins search_path",
    `${freshDefiner[0].n} unpinned`);
} catch (e) {
  check(false, "fresh database build", e.message);
} finally {
  await probe?.end().catch(() => {});
  await admin.unsafe(`drop database if exists ${PROBE_DB} with (force)`).catch(() => {});
}

// ===========================================================================
// C. Effective privilege matrix (live database)
// ===========================================================================
section("C. Effective privileges on the live database");

const matrix = await admin`
  select table_name, grantee, string_agg(privilege_type, ',' order by privilege_type) as privs
  from information_schema.role_table_grants
  where table_schema='public' and table_name = any(${CLINICAL})
    and grantee in ('PUBLIC','anon','authenticated')
    and privilege_type in ('SELECT','INSERT','UPDATE','DELETE','TRUNCATE')
  group by 1,2 order by 1,2`;

const anonOrPublic = matrix.filter((r) => r.grantee !== "authenticated");
check(anonOrPublic.length === 0, "no clinical table is reachable by PUBLIC or anon",
  anonOrPublic.map((r) => `${r.grantee}:${r.table_name}`).join(", "));

const trunc = await admin`
  select table_name from information_schema.role_table_grants
  where table_schema='public' and grantee in ('PUBLIC','anon','authenticated')
    and privilege_type='TRUNCATE'`;
check(trunc.length === 0, "live: TRUNCATE revoked from every user-facing role",
  trunc.map((t) => t.table_name).join(", "));

const badRead = matrix.filter(
  (r) => NO_DIRECT_READ.includes(r.table_name) && r.privs.includes("SELECT"),
);
check(badRead.length === 0, "live: no direct SELECT on prescriptions or items");

const badWrite = matrix.filter(
  (r) => NO_DIRECT_WRITE.includes(r.table_name) && /INSERT|UPDATE|DELETE/.test(r.privs),
);
check(badWrite.length === 0, "live: no direct writes on RPC-only tables",
  badWrite.map((r) => `${r.table_name}=${r.privs}`).join(", "));

console.log("\n  authenticated, by table:");
for (const t of CLINICAL) {
  const row = matrix.find((r) => r.table_name === t && r.grantee === "authenticated");
  console.log(`    ${t.padEnd(28)} ${row ? row.privs : "(none)"}`);
}

// ===========================================================================
// D. SECURITY DEFINER inventory
// ===========================================================================
section("D. SECURITY DEFINER inventory");

const definers = await admin`
  select p.proname, pg_get_function_identity_arguments(p.oid) as args,
         has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_exec,
         has_function_privilege('anon', p.oid, 'EXECUTE') as anon_exec,
         has_function_privilege('public', p.oid, 'EXECUTE') as public_exec,
         array_to_string(p.proconfig, ',') as config
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname='public' and p.prosecdef order by p.proname`;

check(
  definers.every((d) => (d.config ?? "").includes("search_path=")),
  `all ${definers.length} SECURITY DEFINER functions pin search_path`,
);
check(
  definers.every((d) => !d.public_exec),
  "no SECURITY DEFINER function is executable by PUBLIC",
  definers.filter((d) => d.public_exec).map((d) => d.proname).join(", "),
);
check(
  definers.every((d) => !d.anon_exec),
  "no SECURITY DEFINER function is executable by anon",
  definers.filter((d) => d.anon_exec).map((d) => d.proname).join(", "),
);

const grantedDefiners = definers.filter((d) => d.auth_exec);
console.log(`\n  ${definers.length} DEFINER functions, ${grantedDefiners.length} granted to authenticated:`);
for (const d of grantedDefiners) console.log(`    ${d.proname}(${d.args})`);
console.log(`  ${definers.length - grantedDefiners.length} internal (ungranted):`);
for (const d of definers.filter((d) => !d.auth_exec)) console.log(`    ${d.proname}(${d.args})`);

// Every intended prescription RPC: exactly one definition, exactly one grant.
for (const fn of PRESCRIPTION_RPCS) {
  const rows = await admin`
    select has_function_privilege('authenticated', p.oid, 'EXECUTE') as granted
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname='public' and p.proname = ${fn}`;
  check(
    rows.length === 1 && rows[0].granted,
    `${fn}: one definition, one grant`,
    `${rows.length} definition(s)`,
  );
}

const legacy = await admin`
  select count(*)::int as n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname='public' and p.proname='finalize_prescription'
    and pg_get_function_identity_arguments(p.oid) like '%jsonb%'`;
check(legacy[0].n === 0, "the legacy caller-supplied finalize overload is absent");

// ===========================================================================
// E-H. Adversarial, multi-tenant, on the live database
// ===========================================================================
const ids = {
  docA: crypto.randomUUID(), docB: crypto.randomUUID(),
  recA: crypto.randomUUID(), admA: crypto.randomUUID(),
};

async function expectDenied(tx, fn) {
  try {
    await tx.savepoint(fn);
    return false;
  } catch {
    return true;
  }
}
async function as(tx, uid, fn) {
  await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: uid, role: "authenticated" })}, true)`;
  await tx`set local role authenticated`;
  try {
    return await fn();
  } finally {
    await tx`reset role`;
  }
}
async function asOwner(tx, fn) {
  const [{ u }] = await tx`select current_user as u`;
  const wasAuth = u === "authenticated";
  if (wasAuth) await tx`reset role`;
  try {
    return await fn();
  } finally {
    if (wasAuth) await tx`set local role authenticated`;
  }
}

try {
  await admin.begin(async (tx) => {
    for (const [uid, name] of [
      [ids.docA, "Dr A"], [ids.docB, "Dr B"], [ids.recA, "Reception A"], [ids.admA, "Admin A"],
    ]) {
      await tx`insert into auth.users (id, email) values (${uid}, ${`${uid}@qa.invalid`})`;
      await tx`insert into public.profiles (id, full_name) values (${uid}, ${name})`;
    }

    const [dA] = await tx`insert into public.doctor_profiles (user_id, patient_number_prefix)
                          values (${ids.docA}, 'GA') returning id`;
    const [dB] = await tx`insert into public.doctor_profiles (user_id, patient_number_prefix)
                          values (${ids.docB}, 'GB') returning id`;

    // Clinic A with TWO locations; Clinic B entirely separate.
    const [a1] = await tx`insert into public.practice_locations (name, type, created_by)
                          values ('QA Clinic A – Main', 'CLINIC', ${ids.docA}) returning id`;
    const [a2] = await tx`insert into public.practice_locations (name, type, created_by)
                          values ('QA Clinic A – Annexe', 'CLINIC', ${ids.docA}) returning id`;
    const [b1] = await tx`insert into public.practice_locations (name, type, created_by)
                          values ('QA Clinic B', 'CLINIC', ${ids.docB}) returning id`;

    await tx`insert into public.practice_location_members
               (practice_location_id, user_id, role, status)
             values (${a1.id}, ${ids.docA}, 'DOCTOR', 'ACTIVE'),
                    (${a2.id}, ${ids.docA}, 'DOCTOR', 'ACTIVE'),
                    (${b1.id}, ${ids.docB}, 'DOCTOR', 'ACTIVE'),
                    (${a1.id}, ${ids.recA}, 'RECEPTIONIST', 'ACTIVE'),
                    (${a2.id}, ${ids.recA}, 'RECEPTIONIST', 'ACTIVE'),
                    (${a1.id}, ${ids.admA}, 'LOCATION_ADMIN', 'ACTIVE')`;

    const [pA] = await tx`
      insert into public.patients (owner_doctor_id, patient_number, full_name,
                                   name_normalized, sex, created_by)
      values (${dA.id}, 'GA-1', 'Patient A', 'patient a', 'MALE', ${ids.docA}) returning id`;
    const [pB] = await tx`
      insert into public.patients (owner_doctor_id, patient_number, full_name,
                                   name_normalized, sex, created_by)
      values (${dB.id}, 'GB-1', 'Patient B', 'patient b', 'MALE', ${ids.docB}) returning id`;
    await tx`insert into public.patient_location_links (patient_id, practice_location_id)
             values (${pA.id}, ${a1.id}), (${pB.id}, ${b1.id})`;

    const [eA] = await tx`
      insert into public.encounters (owner_doctor_id, patient_id, practice_location_id, created_by)
      values (${dA.id}, ${pA.id}, ${a1.id}, ${ids.docA}) returning id`;
    const [eB] = await tx`
      insert into public.encounters (owner_doctor_id, patient_id, practice_location_id, created_by)
      values (${dB.id}, ${pB.id}, ${b1.id}, ${ids.docB}) returning id`;

    const version = (id) =>
      asOwner(tx, async () => {
        const [{ v }] = await tx`select version as v from public.prescriptions where id = ${id}`;
        return v;
      });

    // Dr A: a draft at Clinic A main, finalised with a frozen signature.
    let rxA;
    await as(tx, ids.docA, async () => {
      [{ open_prescription: rxA }] = await tx`
        select public.open_prescription(${eA.id}, ${a1.id})`;
      await tx`select public.add_prescription_item(${rxA}, ${a1.id}, ${await version(rxA)},
                 ${{ displayName: "Napa 500", doseText: "1 tablet", scheduleText: "1+0+1" }})`;
    });

    // Dr B: a draft in Clinic B.
    let rxB;
    await as(tx, ids.docB, async () => {
      [{ open_prescription: rxB }] = await tx`
        select public.open_prescription(${eB.id}, ${b1.id})`;
      await tx`select public.add_prescription_item(${rxB}, ${b1.id}, ${await version(rxB)},
                 ${{ displayName: "Secret medicine" }})`;
    });

    section("E. Cross-tenant attacks");

    await as(tx, ids.docB, async () => {
      for (const [label, fn] of [
        ["Dr B cannot read Dr A's draft", (t) => t`select public.prescription_detail(${rxA}, ${a1.id})`],
        ["Dr B cannot open a prescription on Dr A's encounter", (t) =>
          t`select public.open_prescription(${eA.id}, ${a1.id})`],
        ["Dr B cannot add a medicine to Dr A's prescription", async (t) => {
          const v = await version(rxA);
          await t`select public.add_prescription_item(${rxA}, ${a1.id}, ${v}, ${{ displayName: "Injected" }})`;
        }],
        ["Dr B cannot finalise Dr A's prescription", async (t) => {
          const v = await version(rxA);
          await t`select public.finalize_prescription(${rxA}, ${a1.id}, ${v}, null, 'x')`;
        }],
        ["Dr B cannot build a review bundle for it", (t) =>
          t`select public.prescription_review_bundle(${rxA}, ${a1.id}, null)`],
        ["Dr B cannot list Clinic A's finalised paperwork", (t) =>
          t`select * from public.finalized_prescriptions_at(${a1.id}, null)`],
        ["Dr B cannot select the prescriptions table", (t) =>
          t`select count(*) from public.prescriptions`],
        ["Dr B cannot select prescription items", (t) =>
          t`select count(*) from public.prescription_items`],
      ]) {
        check(await expectDenied(tx, fn), label);
      }

      const [ev] = await tx`
        select count(*)::int as n from public.prescription_events where prescription_id = ${rxA}`;
      check(ev.n === 0, "Dr B cannot read Dr A's prescription events", `${ev.n}`);

      const mine = await tx`select * from public.prescriptions_for_doctor(null, null)`;
      check(
        mine.length === 1 && mine[0].prescription_id === rxB,
        "Dr B's own listing returns only Dr B's prescription",
        `${mine.length}`,
      );
    });

    section("F. Finalisation attacks");

    // A template belonging to Dr B, and one of Dr A's scoped to the OTHER location.
    const [tplB] = await tx`
      insert into public.prescription_templates (owner_doctor_id, practice_location_id, name)
      values (${dB.id}, null, 'Dr B template') returning id`;
    const [tplAnnexe] = await tx`
      insert into public.prescription_templates (owner_doctor_id, practice_location_id, name)
      values (${dA.id}, ${a2.id}, 'Annexe pad') returning id`;
    const [tplGlobalA] = await tx`
      insert into public.prescription_templates (owner_doctor_id, practice_location_id, name)
      values (${dA.id}, null, 'Dr A global') returning id`;

    await tx`update public.doctor_profiles set signature_url = 'doctor-assets/sig.png'
             where id = ${dA.id}`;

    let goodDigest;
    await as(tx, ids.docA, async () => {
      const otherDoctorTpl = await expectDenied(tx, (t) =>
        t`select public.prescription_review_bundle(${rxA}, ${a1.id}, ${tplB.id})`);
      check(otherDoctorTpl, "another doctor's template is refused");

      const otherLocationTpl = await expectDenied(tx, (t) =>
        t`select public.prescription_review_bundle(${rxA}, ${a1.id}, ${tplAnnexe.id})`);
      check(otherLocationTpl, "the same doctor's template scoped to another location is refused");

      const [review] = await tx`
        select public.prescription_review_bundle(${rxA}, ${a1.id}, ${tplGlobalA.id}) as r`;
      goodDigest = review.r.digest;
      check(review.r.bundle.signature === null, "an unfrozen signature is absent from the bundle");

      const noSig = await expectDenied(tx, async (t) => {
        await t`select public.finalize_prescription(${rxA}, ${a1.id}, ${await version(rxA)},
                  ${tplGlobalA.id}, ${goodDigest})`;
      });
      check(noSig, "finalising without the frozen signature object is refused");
    });

    // Freeze the signature at the computed path, then finalise honestly.
    const [sigPath] = await tx`select public.prescription_signature_path(${ids.docA}, ${rxA}) as p`;
    const [sigObj] = await tx`
      insert into storage.objects (bucket_id, name, owner, metadata)
      values ('prescription-assets', ${sigPath.p}, ${ids.docA}, ${{ size: 2048, mimetype: "image/png" }})
      returning id`;

    await as(tx, ids.docA, async () => {
      const [review] = await tx`
        select public.prescription_review_bundle(${rxA}, ${a1.id}, ${tplGlobalA.id}) as r`;
      const digest = review.r.digest;

      const staleDigest = await expectDenied(tx, async (t) => {
        await t`select public.finalize_prescription(${rxA}, ${a1.id}, ${await version(rxA)},
                  ${tplGlobalA.id}, ${"0".repeat(64)})`;
      });
      check(staleDigest, "a fabricated digest is refused");

      // Alter the bundle's content, then present the OLD digest.
      await tx`reset role`;
      await tx`update public.patients set full_name = 'Altered Name' where id = ${pA.id}`;
      await tx`set local role authenticated`;

      const altered = await expectDenied(tx, async (t) => {
        await t`select public.finalize_prescription(${rxA}, ${a1.id}, ${await version(rxA)},
                  ${tplGlobalA.id}, ${digest})`;
      });
      check(altered, "an altered review bundle with the old digest is refused");

      await tx`reset role`;
      await tx`update public.patients set full_name = 'Patient A' where id = ${pA.id}`;
      await tx`set local role authenticated`;

      const [fresh] = await tx`
        select public.prescription_review_bundle(${rxA}, ${a1.id}, ${tplGlobalA.id}) as r`;
      const [{ finalize_prescription: v }] = await tx`
        select public.finalize_prescription(${rxA}, ${a1.id}, ${await version(rxA)},
          ${tplGlobalA.id}, ${fresh.r.digest})`;
      check(Number.isInteger(v), "an honest finalisation succeeds", `v${v}`);

      const [row] = await asOwner(tx, () => tx`
        select doctor_snapshot, patient_snapshot, location_snapshot, signature_snapshot
        from public.prescriptions where id = ${rxA}`);
      check(
        row.doctor_snapshot.fullName === "Dr A" &&
          row.patient_snapshot.fullName === "Patient A" &&
          row.location_snapshot.name === "QA Clinic A – Main",
        "the stored snapshots match the authoritative rows",
      );
      check(row.signature_snapshot.objectId === sigObj.id,
        "…and the signature is the frozen object's identity");
    });

    section("F. Finalised immutability, through every public RPC");
    await as(tx, ids.docA, async () => {
      const v = await version(rxA);
      for (const [label, fn] of [
        ["add_prescription_item", (t) =>
          t`select public.add_prescription_item(${rxA}, ${a1.id}, ${v}, ${{ displayName: "Late" }})`],
        ["update_prescription_item", async (t) => {
          const [i] = await asOwner(tx, () => tx`
            select id from public.prescription_items where prescription_id = ${rxA} limit 1`);
          await t`select public.update_prescription_item(${rxA}, ${a1.id}, ${v}, ${i.id},
                    ${{ doseText: "changed" }})`;
        }],
        ["remove_prescription_item", async (t) => {
          const [i] = await asOwner(tx, () => tx`
            select id from public.prescription_items where prescription_id = ${rxA} limit 1`);
          await t`select public.remove_prescription_item(${rxA}, ${a1.id}, ${v}, ${i.id})`;
        }],
        ["move_prescription_item", async (t) => {
          const [i] = await asOwner(tx, () => tx`
            select id from public.prescription_items where prescription_id = ${rxA} limit 1`);
          await t`select public.move_prescription_item(${rxA}, ${a1.id}, ${v}, ${i.id}, 1)`;
        }],
        ["finalize_prescription again", (t) =>
          t`select public.finalize_prescription(${rxA}, ${a1.id}, ${v}, ${tplGlobalA.id}, ${goodDigest})`],
      ]) {
        check(await expectDenied(tx, fn), `finalised: ${label} is refused`);
      }
    });

    section("G. Storage and signature attacks");
    await as(tx, ids.docB, async () => {
      const [seen] = await tx`
        select count(*)::int as n from storage.objects
        where bucket_id = 'prescription-assets' and id = ${sigObj.id}`;
      check(seen.n === 0, "Dr B cannot see Dr A's frozen signature object", `${seen.n}`);

      const forge = await expectDenied(tx, (t) =>
        t`insert into storage.objects (bucket_id, name, owner)
          values ('prescription-assets', ${`${ids.docA}/${rxA}/signature2`}, ${ids.docB})`);
      check(forge, "Dr B cannot write into Dr A's asset folder");
    });

    await as(tx, ids.docA, async () => {
      await expectDenied(tx, (t) =>
        t`update storage.objects set metadata = ${{ size: 1 }} where id = ${sigObj.id}`);
      await expectDenied(tx, (t) => t`delete from storage.objects where id = ${sigObj.id}`);
      const [still] = await asOwner(tx, () => tx`
        select metadata from storage.objects where id = ${sigObj.id}`);
      check(
        still && Number(still.metadata.size) === 2048,
        "the frozen signature survives overwrite and delete attempts by its own owner",
        still ? String(still.metadata.size) : "gone",
      );
    });

    await as(tx, ids.recA, async () => {
      const [visible] = await tx`
        select count(*)::int as n from storage.objects
        where bucket_id = 'prescription-assets' and id = ${sigObj.id}`;
      check(visible.n === 1, "reception CAN fetch the signature of a prescription it may hand over");
    });

    section("E. Reception and admin, across two locations");
    await as(tx, ids.recA, async () => {
      const main = await tx`select * from public.finalized_prescriptions_at(${a1.id}, null)`;
      const annexe = await tx`select * from public.finalized_prescriptions_at(${a2.id}, null)`;
      check(main.length === 1 && main[0].prescription_id === rxA, "location A1 returns only A1's");
      check(annexe.length === 0, "location A2 returns nothing of A1's", `${annexe.length}`);

      const otherClinic = await expectDenied(tx, (t) =>
        t`select * from public.finalized_prescriptions_at(${b1.id}, null)`);
      check(otherClinic, "reception cannot reach Clinic B at all");

      const direct = await expectDenied(tx, (t) => t`select count(*) from public.prescriptions`);
      check(direct, "reception cannot select the table to see both at once");

      const wrongLoc = await expectDenied(tx, (t) =>
        t`select public.prescription_detail(${rxA}, ${a2.id})`);
      check(wrongLoc, "reception cannot read a prescription under the wrong location");

      const [ev] = await tx`select count(*)::int as n from public.prescription_events`;
      check(ev.n === 0, "reception sees no prescription events");
    });

    await as(tx, ids.admA, async () => {
      const listed = await tx`select * from public.finalized_prescriptions_at(${a1.id}, null)`;
      check(listed.length === 1, "the location admin can list finalised paperwork");
      const mutate = await expectDenied(tx, async (t) => {
        const v = await version(rxA);
        await t`select public.add_prescription_item(${rxA}, ${a1.id}, ${v}, ${{ displayName: "Admin" }})`;
      });
      check(mutate, "…but cannot mutate it");
    });

    section("H. Audit and event tampering");
    await as(tx, ids.docA, async () => {
      for (const [label, fn] of [
        ["update an audit row", (t) => t`update public.audit_events set action = 'forged'`],
        ["delete an audit row", (t) => t`delete from public.audit_events`],
        ["truncate audit_events", (t) => t`truncate table public.audit_events cascade`],
        ["update a prescription event", (t) => t`update public.prescription_events set detail = '{}'::jsonb`],
        ["delete a prescription event", (t) => t`delete from public.prescription_events`],
        ["forge a prescription event", (t) =>
          t`insert into public.prescription_events (prescription_id, event_type)
            values (${rxA}, 'FINALIZED')`],
      ]) {
        check(await expectDenied(tx, fn), `a doctor cannot ${label}`);
      }

      const forgedActor = await expectDenied(tx, (t) =>
        t`insert into public.audit_events (actor_id, action, resource_type)
          values (${ids.docB}, 'prescription.finalized', 'prescription')`);
      check(forgedActor, "…nor write an audit row in someone else's name");
    });

    const [auditIntact] = await tx`
      select count(*)::int as n from public.audit_events
      where resource_id = ${rxA} and action = 'prescription.finalized'`;
    check(auditIntact.n === 1, "the finalisation audit row survived every attempt", `${auditIntact.n}`);

    throw new Error("__rollback__");
  });
} catch (e) {
  if (e.message !== "__rollback__") {
    check(false, "adversarial suite", e.message);
    if (process.env.QA_TRACE) console.error(e);
  }
}

const [leftover] = await admin`
  select count(*)::int as n from auth.users where email like '%@qa.invalid'`;
check(leftover.n === 0, "adversarial fixture rolled back", `${leftover.n}`);

await admin.end();

section("Result");
if (failures.length === 0) {
  console.log("  All security gate checks passed.\n");
} else {
  console.log(`  ${failures.length} CHECK(S) FAILED:\n    - ${failures.join("\n    - ")}\n`);
}
if (findings.length) console.log(`  Findings: ${findings.join("; ")}\n`);
process.exit(failures.length === 0 ? 0 : 1);
