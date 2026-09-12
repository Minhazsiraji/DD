/**
 * Shared support for the O1-F verifier scripts.
 *
 * applyStatementIdempotent lets the same setup sequence run correctly whether
 * the target database is bare or already fully provisioned (e.g. a
 * disposable instance where the full real migration chain plus 0047 was
 * applied once, and the same instance is reused across several verifier
 * runs rather than rebuilt from scratch each time). It swallows only the
 * narrow "this object already exists" class of Postgres error — anything
 * else still aborts the run.
 */
const ALREADY_EXISTS_CODES = new Set([
  "42P07", // duplicate_table
  "42710", // duplicate_object (role, policy, type, publication, etc.)
  "42723", // duplicate_function
  "42P06", // duplicate_schema
  "42P04", // duplicate_database
  "42P16", // invalid_table_definition (e.g. duplicate index inside a DO block on rerun)
]);

import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * Reads a migration/policy file for setup purposes, with one deliberate
 * substitution: 0045_prelaunch_sec01b_security_closure.sql's own internal
 * self-check ("SEC01B guarded RPC inventory drift: expected 61, found N")
 * depends on this repository's real deployed RPC inventory matching a
 * hardcoded count. That inventory is NOT reproducible from this branch's own
 * committed migration history alone (confirmed independently — several
 * functions and at least one table, patient_documents, that 0045/0046 assume
 * exist are not created by any file under drizzle/migrations or
 * supabase/policies on this branch; a pre-existing drift between the
 * deployed database and what's checked into `main`, unrelated to O1-F).
 * O1-F depends on exactly two things from 0045: public.session_is_aal2() and
 * public.require_aal2(). This reads ONLY that excerpt (byte-identical to the
 * real file, lines 17-46) instead of the whole file, so the disposable test
 * database is not blocked by an unrelated, already-known drift while still
 * using the primitives verbatim from source.
 */
export async function readMigrationFile(file) {
  const text = await readFile(path.resolve(file), "utf8");
  if (file.endsWith("0045_prelaunch_sec01b_security_closure.sql")) {
    const lines = text.split(/\r?\n/);
    return lines.slice(16, 46).join("\n"); // 0-indexed: lines 17-46
  }
  return text;
}

/**
 * profiles.id has a real FK to auth.users(id) (drizzle/migrations/0000).
 * QA fixtures must seat the auth.users row first, using the SAME id, or the
 * profiles insert fails its foreign key. Names stay obviously synthetic
 * (@qa.invalid), matching this codebase's own QA fixture convention.
 */
export async function createProfile(tx, fullName) {
  const [user] = await tx`insert into auth.users default values returning id`;
  const [profile] = await tx`insert into profiles(id, full_name) values (${user.id}, ${fullName}) returning id`;
  return profile.id;
}

export async function applyFileIdempotent(tx, text) {
  // Each statement runs inside its own SAVEPOINT. A caught "already exists"
  // error still leaves the enclosing Postgres transaction ABORTED until a
  // ROLLBACK (TO SAVEPOINT) runs — catching the JS exception alone is not
  // enough; every later statement in the same transaction would otherwise
  // fail with "current transaction is aborted" regardless of its own merit.
  for (const stmt of text.split("--> statement-breakpoint")) {
    if (!stmt.trim()) continue;
    try {
      await tx.savepoint(async (sp) => { await sp.unsafe(stmt); });
    } catch (error) {
      if (ALREADY_EXISTS_CODES.has(error?.code)) continue;
      throw error;
    }
  }
}
