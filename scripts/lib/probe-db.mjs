/**
 * Build a THROWAWAY database from the repository, and hand back a connection.
 *
 * Why a verification script wants this rather than the shared project:
 *
 *   - it proves the boundary is a property of the REPOSITORY — every migration
 *     in journal order, then every policy file in order — and not of one
 *     long-lived database that happens to have been patched into shape;
 *   - it leaves no residue anywhere near real data;
 *   - and it does not queue behind whatever another worktree is doing. A
 *     verification run that blocks on someone else's stuck transaction proves
 *     nothing and looks like a failure of the thing under test.
 *
 * `scripts/security-gate.mjs` builds its own probe the same way. That file is
 * an accepted Stage 7A artifact and is deliberately left untouched; this is the
 * reusable form for scripts written afterwards.
 *
 * Supabase owns `auth` and `storage`, so the repository never creates them. The
 * shim below is faithful enough for OUR policies to compile and be exercised;
 * anything that genuinely depends on Supabase's own behaviour has to be checked
 * against the live project instead.
 */
import postgres from "postgres";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const MIGRATIONS = path.resolve("drizzle/migrations");
const POLICIES = path.resolve("supabase/policies");

/** Migrations in journal order — the same order the migrator uses. */
function migrationsInOrder() {
  const journal = JSON.parse(
    readFileSync(path.join(MIGRATIONS, "meta", "_journal.json"), "utf8"),
  );
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql"));
  return journal.entries.map((e) => {
    const file = files.find((f) => f.startsWith(e.tag));
    if (!file) throw new Error(`journal entry ${e.tag} has no .sql file`);
    return { tag: e.tag, sql: readFileSync(path.join(MIGRATIONS, file), "utf8") };
  });
}

/**
 * Create `dbName`, replay the repository into it, and return
 * `{ probe, close, migrations, policies }`.
 *
 * ALWAYS call `close()` from a `finally`. A run that throws must still drop the
 * database and end both pools, or the next run finds a stale probe and the
 * pooler keeps a session pinned.
 */
export async function buildProbeDatabase(dbName) {
  const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error("DIRECT_URL or DATABASE_URL must be set.");

  const admin = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
  let probe;

  const close = async () => {
    await probe?.end({ timeout: 5 }).catch(() => {});
    await admin
      .unsafe(`drop database if exists ${dbName} with (force)`)
      .catch(() => {});
    await admin.end({ timeout: 5 }).catch(() => {});
  };

  try {
    await admin.unsafe(`drop database if exists ${dbName} with (force)`);
    await admin.unsafe(`create database ${dbName}`);

    const probeUrl = new URL(url);
    probeUrl.pathname = `/${dbName}`;
    probe = postgres(probeUrl.toString(), {
      max: 1,
      prepare: false,
      onnotice: () => {},
    });

    await probe.unsafe(`
      create extension if not exists pgcrypto;
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
      create publication supabase_realtime;
      grant usage on schema auth, storage to authenticated, anon;
      grant select on storage.objects to authenticated;
      alter table storage.objects enable row level security;`);

    const migs = migrationsInOrder();
    for (const { tag, sql: body } of migs) {
      for (const stmt of body
        .split("--> statement-breakpoint")
        .map((x) => x.trim())
        .filter(Boolean)) {
        try {
          await probe.unsafe(stmt);
        } catch (e) {
          throw new Error(`migration ${tag}: ${e.message}`);
        }
      }
    }

    const policyFiles = readdirSync(POLICIES)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    for (const f of policyFiles) {
      try {
        await probe.unsafe(readFileSync(path.join(POLICIES, f), "utf8"));
      } catch (e) {
        throw new Error(`policy ${f}: ${e.message}`);
      }
    }

    return { probe, close, migrations: migs.length, policies: policyFiles.length };
  } catch (e) {
    await close();
    throw e;
  }
}
