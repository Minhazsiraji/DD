import { describe, it, expect, beforeAll } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * THE OWNER BOUNDARY, HELD IN PLACE.
 *
 * The behavioural proof — who is an owner, and that an owner cannot read a
 * clinical row — lives in `scripts/verify-owner-authority.mjs`, which needs a
 * real Postgres. These tests run with no database and defend the two things
 * that are easy to erode in an ordinary edit:
 *
 *   1. the route guard runs BEFORE anything renders, and answers 404 not 403
 *   2. no clinical policy ever learns about `is_platform_owner()`
 *
 * The second is enforced by absence, and absence is exactly what a future
 * "quick fix" adds to by accident.
 */
const POLICY = "supabase/policies/0033_platform_owner_authority.sql";
const AUTHORITY = "src/features/owner/authority.ts";
const PAGE = "src/app/owner/page.tsx";

let policy = "";
let policyCode = "";
let authority = "";
let authorityCode = "";
let page = "";
let pageCode = "";

/**
 * Strip comments before asserting on CODE.
 *
 * A comment explaining why the guard answers 404 and not 403 necessarily
 * contains the word "forbidden", and a test that cannot tell prose from a
 * branch would force the explanation out of the file — losing the reason the
 * rule exists in order to satisfy a regex.
 */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/**
 * Same idea for SQL. The policy file's header explains why an
 * `is_platform_owner(user_id uuid)` overload would be dangerous — naming the
 * very shape the next assertion forbids. Prose is not policy.
 */
function sqlCode(source: string): string {
  // The policy file uses BOTH `--` lines and `/** */` blocks.
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*--.*$/gm, "");
}

beforeAll(async () => {
  [policy, authority, page] = await Promise.all([
    readFile(path.resolve(POLICY), "utf8"),
    readFile(path.resolve(AUTHORITY), "utf8"),
    readFile(path.resolve(PAGE), "utf8"),
  ]);
  policyCode = sqlCode(policy);
  authorityCode = code(authority);
  pageCode = code(page);
});

describe("the helper cannot be told who to answer about", () => {
  it("takes no argument", () => {
    expect(policy).toMatch(/create or replace function public\.is_platform_owner\(\)/);
    expect(policyCode, "an id-taking overload would let a caller ask about someone else")
      .not.toMatch(/is_platform_owner\(\s*\w+\s+uuid/);
  });

  it("resolves identity from auth.uid() and nothing else", () => {
    const body = policy.slice(
      policy.indexOf("create or replace function public.is_platform_owner()"),
      policy.indexOf("revoke all on function public.is_platform_owner()"),
    );
    expect(body).toContain("auth.uid()");
    expect(body).toContain("security definer");
    expect(body).toContain("set search_path = public, pg_temp");
    expect(body, "an inactive owner must lose authority").toContain("o.is_active = true");
  });

  it("is revoked from public and anon, and granted only to authenticated", () => {
    expect(policy).toContain("revoke all on function public.is_platform_owner() from public, anon;");
    const grant = policy.match(/grant execute on function public\.is_platform_owner\(\) to ([^;]+);/);
    expect(grant).not.toBeNull();
    expect(grant![1]).toBe("authenticated");
  });

  it("does not create the table it protects", () => {
    /*
     * Migration 0019 is the sole authority for the table's shape. A
     * `create table if not exists` here would, on an unmigrated database,
     * quietly conjure a table with none of the migration's constraints — and
     * the skipped `db:migrate` would never surface.
     */
    expect(policyCode, "0033 must not create platform_owners").not.toMatch(
      /create table[^;]*platform_owners/i,
    );
    expect(policyCode, "0033 must not create its index either").not.toMatch(
      /create index[^;]*platform_owners/i,
    );
    expect(policyCode, "it assumes the migration has run").toMatch(
      /alter table public\.platform_owners enable row level security/i,
    );
  });

  it("leaves the owner table unreachable from the app", () => {
    expect(policy).toContain("revoke all on public.platform_owners from anon, authenticated;");
    // No self-service INSERT policy: the governed must not edit the governors.
    expect(policy).not.toMatch(/create policy[^;]*platform_owners for insert/i);
  });
});

describe("the route boundary", () => {
  it("checks authority on the server, never in the client", () => {
    expect(authority).toContain('import "server-only"');
    expect(authority).toContain('supabase.rpc("is_platform_owner")');
    // No user id is passed in either direction.
    expect(authorityCode, "an id argument would be a client-supplied value").not.toMatch(
      /rpc\(\s*["']is_platform_owner["']\s*,/,
    );
  });

  it("fails closed when the check errors", () => {
    expect(authority).toMatch(/if \(error\) return false;/);
    expect(authority).toMatch(/return data === true;/);
  });

  it("answers 404, not 403", () => {
    // A 403 confirms the surface exists; that is a map for a prober.
    expect(authority).toContain("notFound()");
    expect(authorityCode).not.toMatch(/\b403\b|forbidden/i);
  });

  it("guards before it renders", () => {
    const guardAt = page.indexOf("await requirePlatformOwner()");
    const returnAt = page.indexOf("return (");
    expect(guardAt, "the page must call the guard").toBeGreaterThan(-1);
    expect(guardAt, "the guard must run before any markup").toBeLessThan(returnAt);
  });

  it("renders no clinical data", () => {
    for (const term of ["patient", "encounter", "prescription", "diagnosis", "medicine"]) {
      // Prose about NOT having access is fine; a data read is not.
      expect(pageCode).not.toMatch(new RegExp(`from\\(["']${term}`, "i"));
      expect(pageCode).not.toMatch(new RegExp(`rpc\\(["'][^"']*${term}`, "i"));
    }
  });
});

describe("platform authority stays out of the clinical record", () => {
  it("never appears in a clinical policy file", async () => {
    const clinical = [
      "0002_patients_rls.sql",
      "0016_encounters_rls.sql",
      "0018_prescriptions_rls.sql",
      "0013_queue_rls.sql",
    ];
    for (const file of clinical) {
      const sql = await readFile(path.resolve("supabase/policies", file), "utf8");
      expect(sql, `${file} must not know about platform ownership`).not.toContain(
        "is_platform_owner",
      );
    }
  });

  it("grants no clinical access in its own file", () => {
    for (const table of [
      "patients",
      "encounters",
      "prescriptions",
      "prescription_items",
      "appointments",
      "queue_entries",
    ]) {
      expect(policy, `0033 must not create a policy on ${table}`).not.toMatch(
        new RegExp(`create policy[^;]*on public\\.${table}`, "i"),
      );
      expect(policy, `0033 must not grant on ${table}`).not.toMatch(
        new RegExp(`grant[^;]*on public\\.${table}`, "i"),
      );
    }
  });

  it("does not extend location_role", () => {
    // Adding OWNER to the enum would put a business role inside every clinical
    // policy that reads it.
    expect(policy).not.toMatch(/alter type[^;]*location_role/i);
  });
});
