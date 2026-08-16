/**
 * Migrations describe the real schema — both directions.
 *
 *   FRESH   every migration replayed into a brand-new database produces the
 *           shape the code expects.
 *   UPGRADE the forward migration replaces the old index on a database that
 *           already has data, without losing it.
 *
 * The fresh half runs in a throwaway database that is dropped again. The
 * upgrade half runs inside a transaction that is always rolled back.
 *
 *   node --env-file=.env.local scripts/verify-migrations.mjs
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
const PROBE_DB = "dd_migration_check";

const failures = [];
function check(ok, label, detail = "") {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(label);
}

/** Journal order, not filesystem order — 0010 must not run before 0009. */
function migrationsInOrder() {
  const journal = JSON.parse(
    readFileSync(path.join(MIGRATIONS, "meta", "_journal.json"), "utf8"),
  );
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql"));
  return journal.entries.map((e) => {
    const file = files.find((f) => f.startsWith(e.tag) || f === `${e.tag}.sql`);
    if (!file) throw new Error(`journal entry ${e.tag} has no .sql file`);
    return { tag: e.tag, sql: readFileSync(path.join(MIGRATIONS, file), "utf8") };
  });
}

const admin = postgres(url, { max: 1, prepare: false, onnotice: () => {} });

// ---------------------------------------------------------------------------
// FRESH
// ---------------------------------------------------------------------------
console.log("\nFresh database: replaying every migration from nothing");

let probe;
try {
  await admin.unsafe(`drop database if exists ${PROBE_DB} with (force)`);
  await admin.unsafe(`create database ${PROBE_DB}`);

  const probeUrl = new URL(url);
  probeUrl.pathname = `/${PROBE_DB}`;
  probe = postgres(probeUrl.toString(), { max: 1, prepare: false, onnotice: () => {} });

  /**
   * Supabase owns `auth`, so the migrations reference auth.users but never
   * create it (CLAUDE.md). A fresh database needs a stand-in for the foreign
   * keys to resolve — id is the only column they point at.
   */
  await probe.unsafe(`
    create extension if not exists pgcrypto;
    create schema if not exists auth;
    create table if not exists auth.users (id uuid primary key, email text);
    create or replace function auth.uid() returns uuid language sql stable
      as $$ select null::uuid $$;`);

  const ordered = migrationsInOrder();
  for (const { tag, sql: body } of ordered) {
    const statements = body
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter(Boolean);
    for (const statement of statements) {
      try {
        await probe.unsafe(statement);
      } catch (e) {
        throw new Error(`${tag}: ${e.message}\n${statement.slice(0, 200)}`);
      }
    }
  }
  check(true, `all ${ordered.length} migrations replay cleanly`);

  const indexes = await probe`
    select indexname, indexdef from pg_indexes
    where schemaname = 'public' and tablename = 'encounters'`;
  const byName = Object.fromEntries(indexes.map((i) => [i.indexname, i.indexdef]));

  check(
    !byName.encounters_one_unscheduled_draft,
    "the location-blind index is never created",
  );

  const unscheduled = byName.encounters_one_unscheduled_draft_at_location ?? "";
  check(Boolean(unscheduled), "the location-aware unscheduled index exists");
  check(
    /owner_doctor_id/.test(unscheduled) &&
      /patient_id/.test(unscheduled) &&
      /practice_location_id/.test(unscheduled),
    "…on (doctor, patient, location)",
  );
  check(
    /appointment_id IS NULL/i.test(unscheduled) && /DRAFT/.test(unscheduled),
    "…partial to unscheduled DRAFT encounters only",
    unscheduled,
  );

  const perAppointment = byName.encounters_one_draft_per_appointment ?? "";
  check(
    /appointment_id IS NOT NULL/i.test(perAppointment) && /DRAFT/.test(perAppointment),
    "the per-appointment draft index survives unchanged",
  );

  const checks = await probe`
    select conname from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    where t.relname = 'encounters' and c.contype = 'c' and conname like '%_range'`;
  check(
    checks.length === 8,
    "all eight vital range constraints exist on a fresh database",
    checks.map((c) => c.conname.replace("encounters_", "")).join(", "),
  );
} catch (e) {
  check(false, "fresh database replay", e.message);
} finally {
  await probe?.end().catch(() => {});
  await admin.unsafe(`drop database if exists ${PROBE_DB} with (force)`).catch(() => {});
}

// ---------------------------------------------------------------------------
// UPGRADE
// ---------------------------------------------------------------------------
console.log("\nUpgrade path: an existing database with encounter rows");

const forward = readFileSync(
  path.join(MIGRATIONS, migrationsInOrder().at(-1).tag + ".sql"),
  "utf8",
);

const uid = crypto.randomUUID();

try {
  await admin.begin(async (tx) => {
    // Put the database back into its pre-correction shape.
    await tx`drop index if exists public.encounters_one_unscheduled_draft_at_location`;
    await tx`create unique index encounters_one_unscheduled_draft
             on public.encounters (owner_doctor_id, patient_id)
             where status = 'DRAFT' and appointment_id is null`;
    for (const name of [
      "height", "weight", "temperature", "pulse",
      "systolic", "diastolic", "resp_rate", "spo2",
    ]) {
      await tx.unsafe(
        `alter table public.encounters drop constraint if exists encounters_${name}_range`,
      );
    }

    await tx`insert into auth.users (id, email) values (${uid}, ${`${uid}@qa.invalid`})`;
    await tx`insert into public.profiles (id, full_name) values (${uid}, 'Dr Upgrade')`;
    const [doc] = await tx`insert into public.doctor_profiles (user_id, patient_number_prefix)
                           values (${uid}, 'UP') returning id`;
    const [hospital] = await tx`insert into public.practice_locations (name, type, created_by)
                                values ('QA Upgrade Hospital', 'HOSPITAL', ${uid}) returning id`;
    const [chamber] = await tx`insert into public.practice_locations (name, type, created_by)
                               values ('QA Upgrade Chamber', 'PERSONAL_CHAMBER', ${uid}) returning id`;
    const [patient] = await tx`
      insert into public.patients (owner_doctor_id, patient_number, full_name,
                                   name_normalized, sex, created_by)
      values (${doc.id}, 'UP-900001', 'Upgrade Patient', 'upgrade patient', 'UNKNOWN', ${uid})
      returning id`;

    const [existing] = await tx`
      insert into public.encounters (owner_doctor_id, patient_id, practice_location_id,
                                     chief_complaints, vital_pulse_bpm, created_by)
      values (${doc.id}, ${patient.id}, ${hospital.id}, 'Fever', 88, ${uid})
      returning id`;

    // Under the old index the same patient could not have a second unscheduled
    // draft anywhere — that was the bug.
    let blockedBefore = false;
    try {
      await tx.savepoint(
        (t) => t`insert into public.encounters (owner_doctor_id, patient_id, practice_location_id)
                 values (${doc.id}, ${patient.id}, ${chamber.id})`,
      );
    } catch {
      blockedBefore = true;
    }
    check(blockedBefore, "before: the chamber draft is blocked by the location-blind index");

    for (const statement of forward
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter(Boolean)) {
      await tx.unsafe(statement);
    }
    check(true, "the forward migration applies to a database that has data");

    const [kept] = await tx`
      select chief_complaints, vital_pulse_bpm from public.encounters where id = ${existing.id}`;
    check(
      kept?.chief_complaints === "Fever" && kept?.vital_pulse_bpm === 88,
      "the existing encounter and its clinical content survive",
    );

    const [gone] = await tx`
      select count(*)::int as n from pg_indexes
      where schemaname = 'public' and indexname = 'encounters_one_unscheduled_draft'`;
    check(gone.n === 0, "the old index is dropped, not left alongside");

    const [second] = await tx`
      insert into public.encounters (owner_doctor_id, patient_id, practice_location_id)
      values (${doc.id}, ${patient.id}, ${chamber.id}) returning id`;
    check(Boolean(second?.id), "after: the same patient can now have a draft at the chamber");

    let stillOnePerLocation = false;
    try {
      await tx.savepoint(
        (t) => t`insert into public.encounters (owner_doctor_id, patient_id, practice_location_id)
                 values (${doc.id}, ${patient.id}, ${chamber.id})`,
      );
    } catch {
      stillOnePerLocation = true;
    }
    check(stillOnePerLocation, "…but still only one draft per location");

    let rangeEnforced = false;
    try {
      await tx.savepoint(
        (t) => t`update public.encounters set vital_spo2 = 900 where id = ${existing.id}`,
      );
    } catch {
      rangeEnforced = true;
    }
    check(rangeEnforced, "the vital range constraints are live immediately after the upgrade");

    throw new Error("__rollback__");
  });
} catch (e) {
  if (e.message !== "__rollback__") check(false, "upgrade path", e.message);
}

const [leftover] = await admin`
  select count(*)::int as n from auth.users where id = ${uid}`;
check(leftover.n === 0, "upgrade fixture rolled back");

await admin.end();

console.log(
  failures.length === 0
    ? "\nMigrations describe the real schema.\n"
    : `\n${failures.length} CHECK(S) FAILED:\n  - ${failures.join("\n  - ")}\n`,
);
process.exit(failures.length === 0 ? 0 : 1);
