import { describe, it, expect, beforeAll } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * THE CLAIM BOUNDARY, HELD IN PLACE.
 *
 * Behaviour is proven against real Postgres in `scripts/verify-doctor-claim.mjs`.
 * These run with no database and defend the invariants a routine edit could
 * erode without anyone noticing:
 *
 *   1. APPROVED CLAIM ≠ PUBLIC PROFILE — nothing in the claim path may touch
 *      `profile_visibility`. An administrator must never be able to put a
 *      doctor on the public internet.
 *   2. Reviewing a claim reaches no clinical table.
 *   3. No identity — claimant or decider — is ever supplied by a caller.
 *   4. There is one owner authority, not two.
 */
const POLICY = "supabase/policies/0034_doctor_profile_claim.sql";
const OWNER_ACTIONS = "src/features/owner/claim-actions.ts";
const DOCTOR_ACTIONS = "src/features/doctor/claim-actions.ts";
const REVIEW = "src/features/owner/claims.ts";

let policy = "";
let policyCode = "";
let ownerActions = "";
let doctorActions = "";
let review = "";

/** `--` lines and `/* *\/` blocks are prose, not policy. */
function sqlCode(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*--.*$/gm, "");
}

beforeAll(async () => {
  [policy, ownerActions, doctorActions, review] = await Promise.all([
    readFile(path.resolve(POLICY), "utf8"),
    readFile(path.resolve(OWNER_ACTIONS), "utf8"),
    readFile(path.resolve(DOCTOR_ACTIONS), "utf8"),
    readFile(path.resolve(REVIEW), "utf8"),
  ]);
  policyCode = sqlCode(policy);
});

describe("approval verifies an identity; it does not publish a doctor", () => {
  it("never touches profile_visibility anywhere in the claim path", () => {
    expect(policyCode, "0034 must not read or write profile_visibility").not.toContain(
      "profile_visibility",
    );
    for (const [name, src] of Object.entries({ ownerActions, doctorActions, review })) {
      expect(src, `${name} must not touch visibility`).not.toMatch(/profile_visibility|visibility/i);
    }
  });

  it("does not update doctor_profiles at all", () => {
    // Approval records a decision on the CLAIM. The profile is unchanged.
    expect(policyCode).not.toMatch(/update\s+public\.doctor_profiles/i);
  });
});

describe("verification is not an ownership transfer", () => {
  /**
   * THE DISTINCTION THIS STAGE IS NAMED FOR.
   *
   * `doctor_profiles.user_id` is NOT NULL, so the profile already belongs to
   * the requesting account — approval settles whether the professional
   * identity is genuine, and moves nothing. The funnel where a prepared
   * directory listing changes hands is a separate architecture (ADR 0014),
   * and it must not arrive by quietly writing `user_id` here.
   */
  it("never writes doctor_profiles.user_id", () => {
    expect(policyCode, "approval must not move account ownership").not.toMatch(
      /update[\s\S]{0,200}?doctor_profiles[\s\S]{0,200}?set[\s\S]{0,120}?user_id/i,
    );
    // It may READ user_id — that is the ownership-conflict guard.
    expect(policyCode, "the conflict guard reads user_id").toContain("d.user_id into v_profile_owner");
    expect(policyCode).toContain("OWNERSHIP_CONFLICT");
  });

  it("says so where a person can read it", async () => {
    const doctorPage = await readFile(
      path.resolve("src/app/(app)/settings/claim/page.tsx"),
      "utf8",
    );
    expect(doctorPage, "the doctor must be told this is not a transfer").toMatch(
      /does not transfer|already owns/i,
    );
    const ownerPage = await readFile(path.resolve("src/app/owner/claims/page.tsx"), "utf8");
    expect(ownerPage, "the reviewer must be told the same").toMatch(
      /not a transfer of ownership|already.*holding/i,
    );
  });

  it("records the future capability rather than leaving it folklore", async () => {
    const adr = await readFile(
      path.resolve("docs/decisions/0014-doctor-professional-verification.md"),
      "utf8",
    );
    expect(adr).toMatch(/Prepared Directory Profile Claim/i);
    expect(adr, "the ADR must warn against the dangerous shortcut").toMatch(
      /do not make `?doctor_profiles\.user_id`? nullable/i,
    );
  });
});

describe("reviewing a claim reaches no clinical data", () => {
  it("names no clinical table in the policy", () => {
    for (const table of [
      "patients",
      "encounters",
      "prescriptions",
      "prescription_items",
      "queue_entries",
      "appointments",
      "encounter_diagnoses",
    ]) {
      expect(policyCode, `0034 must not reference ${table}`).not.toContain(`public.${table}`);
    }
  });

  it("exposes only professional evidence in the review shape", () => {
    const shape = policy.slice(
      policy.indexOf("create or replace function public.owner_pending_claims"),
      policy.indexOf("revoke all on function public.owner_pending_claims"),
    );
    const keys = [...shape.matchAll(/'(\w+)',/g)].map((m) => m[1]!);
    for (const key of keys) {
      expect(key, `review payload leaks ${key}`).not.toMatch(
        /patient|encounter|prescription|diagnos|queue|token/i,
      );
    }
    expect(keys).toContain("registrationNumber");
    expect(keys).toContain("regulatorName");
  });
});

describe("no caller ever supplies an identity", () => {
  it("submit takes no claimant or target id", () => {
    /*
     * The PARAMETER LIST only, and matched without depending on line endings —
     * an earlier version sliced on ")\nreturns uuid" and broke the moment a
     * rebase normalised the file to CRLF. `returns uuid` is the function's own
     * return type and must not be mistaken for an argument.
     */
    const start = policy.indexOf("create or replace function public.submit_doctor_profile_claim(");
    const params = policy.slice(
      policy.indexOf("(", start) + 1,
      policy.indexOf(")", start),
    );
    expect(params, "a uuid parameter here would be a caller-supplied identity").not.toContain("uuid");
    expect(policy).toMatch(/v_user uuid := auth\.uid\(\)/);
    expect(policy).toMatch(/v_doctor uuid := public\.current_doctor_id\(\)/);
  });

  it("the decider comes from auth.uid(), never the form", () => {
    expect(policy).toMatch(/v_owner uuid := auth\.uid\(\)/);
    expect(ownerActions, "no decider id may be sent from the server action").not.toMatch(
      /p_(owner|decider|user)_id/,
    );
  });

  it("reads are scoped by the caller, not by an id argument", () => {
    expect(policy).toMatch(/create or replace function public\.my_doctor_profile_claims\(\)/);
    expect(policy).toMatch(/where c\.claimant_user_id = v_user/);
    // Acting on a claim scopes ownership INTO the lookup, so a foreign id is simply not found.
    expect(policy).toMatch(/where c\.id = p_claim_id and c\.claimant_user_id = v_user/);
  });
});

describe("one owner authority, and one decision path", () => {
  it("reuses is_platform_owner() rather than inventing a second check", () => {
    expect(policyCode).toContain("public.is_platform_owner()");
    expect(policyCode, "no ad-hoc admin table").not.toMatch(/admin_users|is_admin|superuser/i);
  });

  it("gives the claimant no route to APPROVED", () => {
    const respond = policy.slice(
      policy.indexOf("create or replace function public.respond_to_doctor_profile_claim"),
      policy.indexOf("revoke all on function public.respond_to_doctor_profile_claim"),
    );
    expect(respond).toContain("'RESUBMIT', 'CANCEL'");
    expect(respond, "a claimant must not be able to reach APPROVED").not.toContain("'APPROVED'");
  });

  it("refuses to overwrite a settled decision", () => {
    expect(policyCode).toContain("CLAIM_ALREADY_DECIDED");
    expect(policyCode, "idempotent repeat, not a silent rewrite").toMatch(
      /if v_status = v_target then[\s\S]*?'changed', false/,
    );
  });

  it("revokes default table grants and creates no write policy", () => {
    expect(policy).toContain("revoke all on public.doctor_profile_claims from anon, authenticated;");
    expect(policy).toContain(
      "revoke all on public.doctor_profile_claim_events from anon, authenticated;",
    );
    expect(policyCode, "writes go through functions only").not.toMatch(
      /create policy[^;]*for (insert|update|delete)/i,
    );
  });

  it("creates no table — the migration owns the shape", () => {
    expect(policyCode).not.toMatch(/create table[^;]*doctor_profile_claim/i);
    expect(policyCode).toMatch(/alter table public\.doctor_profile_claims enable row level security/i);
  });
});

describe("international by construction", () => {
  it("keeps evidence generic rather than BMDC-shaped", () => {
    expect(policyCode).toContain("country_code");
    expect(policyCode).toContain("regulator_name");
    expect(policyCode).toContain("registration_number");
    // The doctor_profiles column is read for comparison, but the CLAIM's own
    // evidence must not be a BMDC-specific field.
    const submit = policy.slice(
      policy.indexOf("create or replace function public.submit_doctor_profile_claim"),
      policy.indexOf("revoke all on function public.submit_doctor_profile_claim"),
    );
    expect(submit).not.toContain("bmdc");
  });
});
