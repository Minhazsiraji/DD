import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");
const migration = read("supabase/policies/0045_prelaunch_sec01b_security_closure.sql");

const DIRECT_CLINICAL_TABLES = [
  "appointment_events",
  "appointments",
  "encounter_diagnoses",
  "encounter_events",
  "encounter_investigations",
  "encounters",
  "patient_alerts",
  "patient_allergies",
  "patient_conditions",
  "patient_contacts",
  "patient_documents",
  "patient_location_links",
  "patient_medications",
  "patient_private_notes",
  "patients",
  "prescription_events",
  "prescription_items",
  "prescriptions",
  "queue_entries",
  "queue_events",
] as const;

const INTENTIONAL_PUBLIC = [
  "public_doctor_profile",
  "public_booking_slots",
  "create_public_booking",
  "public_booking_confirmation",
] as const;

const FIVE_ACCOUNT_RPCS = [
  "cancel_own_subscription()",
  "current_subscription()",
  "ensure_doctor_subscription()",
  "reactivate_own_subscription()",
  "submit_manual_subscription_payment(numeric,text,text)",
] as const;

describe("PRE-LAUNCH-SEC-01B-R1 forward security candidate", () => {
  it("derives AAL2 exclusively from the authenticated JWT", () => {
    expect(migration).toContain("auth.jwt() ->> 'aal'");
    expect(migration).toContain("= 'aal2'");
    expect(migration).not.toMatch(/mfaComplete|profile_metadata|user_metadata/i);
  });

  it("adds a restrictive AAL2 overlay to every direct pilot clinical table", () => {
    expect(migration).toContain("as restrictive for all to authenticated");
    for (const table of DIRECT_CLINICAL_TABLES) {
      expect(migration).toContain(`'${table}'`);
    }
  });

  it("uses structured PostgreSQL metadata instead of regex function-body injection", () => {
    expect(migration).not.toContain("regexp_replace(");
    expect(migration).toContain("pg_get_function_arguments(p.oid)");
    expect(migration).toContain("pg_get_function_result(p.oid)");
    expect(migration).toContain("p.prosrc");
    expect(migration).toContain("p.provolatile");
    expect(migration).toContain("p.proparallel");
    expect(migration).toContain("p.proconfig");
    expect(migration).toContain("create or replace function public.%I");
    expect(migration).toContain("v_expected constant integer := 61");
  });

  it("guards M2, M3 and owner RPC authority without guarding public booking/profile", () => {
    for (const fn of [
      "start_prescription_correction",
      "reuse_finalized_prescription_items",
      "prescription_signed_medicine_history",
      "initiate_prescription_print",
      "confirm_prescription_print",
      "prescription_print_history",
      "owner_pending_claims",
      "owner_pending_payments",
      "owner_decide_doctor_profile_claim",
      "owner_decide_subscription_payment",
    ]) {
      expect(migration).toContain(`'${fn}'`);
    }

    const allowlist = migration.slice(
      migration.indexOf("v_target_names constant text[]"),
      migration.indexOf("v_expected constant integer"),
    );
    for (const fn of INTENTIONAL_PUBLIC) expect(allowlist).not.toContain(`'${fn}'`);
  });

  it("revokes anon from exactly the five subscription/account functions", () => {
    const revokeLines = migration
      .split(/\r?\n/)
      .filter((line) => /revoke execute on function public\..+ from anon;/.test(line));
    expect(revokeLines).toHaveLength(5);
    for (const fn of FIVE_ACCOUNT_RPCS) {
      expect(revokeLines.join("\n")).toContain(`public.${fn} from anon;`);
    }
    for (const fn of INTENTIONAL_PUBLIC) expect(revokeLines.join("\n")).not.toContain(fn);
  });

  it("preserves slug behavior while fixing its search path", () => {
    expect(migration).toContain("create or replace function public.slug_is_reserved(candidate text)");
    expect(migration).toContain("immutable");
    expect(migration).toContain("set search_path = pg_catalog, public");
    for (const slug of ["admin", "api", "auth", "patient", "prescription", "root", "www"]) {
      expect(migration).toContain(`'${slug}'`);
    }
  });

  it("keeps mandatory MFA enrollment and challenge outside the clinical shell", () => {
    const appLayout = read("src/app/(app)/layout.tsx");
    const enroll = read("src/app/(auth)/mfa/enroll/page.tsx");
    expect(appLayout).toContain('currentAal !== "aal2"');
    expect(appLayout).toContain('"/mfa/enroll"');
    expect(appLayout).toContain('"/mfa"');
    expect(enroll).toContain("supabase.auth.mfa.getAuthenticatorAssuranceLevel()");
    expect(enroll).not.toMatch(/\.from\(["'](?:patients|encounters|prescriptions)["']\)/);
  });

  it("centralizes owner route AAL2 enforcement", () => {
    const ownerAuthority = read("src/features/owner/authority.ts");
    const ownerLayout = read("src/app/owner/layout.tsx");
    expect(ownerAuthority).toContain('aal?.currentLevel !== "aal2"');
    expect(ownerAuthority).toContain("isPlatformOwner()");
    expect(ownerLayout).toContain("await requirePlatformOwner()");
  });

  it("documents all new server-only/synthetic environment controls without values", () => {
    const env = read(".env.example");
    for (const name of [
      "DEEPGRAM_API_KEY=",
      "PA1_PROPOSAL_SIGNING_SECRET=",
      "OPENAI_API_KEY=",
      "PA1_SYNTHETIC_AI_EVAL=disabled",
    ]) {
      expect(env).toContain(name);
    }
    expect(env).toContain("SERVER ONLY");
    expect(env).toContain("SYNTHETIC EVALUATION ONLY");
  });

  it("does not log known patient/encounter identifiers or raw errors in scrubbed surfaces", () => {
    const sources = [
      read("src/app/(app)/layout.tsx"),
      read("src/lib/audit/emit.ts"),
      read("src/features/encounters/previous-visit.ts"),
      read("src/features/encounters/queries.ts"),
      read("src/features/patients/queries.ts"),
      read("src/features/doctor/profile-actions.ts"),
      read("src/features/doctor/actions.ts"),
    ].join("\n");

    expect(sources).not.toMatch(/console\.error\([\s\S]*?(?:patientId|encounterId)/);
    expect(sources).not.toMatch(/console\.error\([\s\S]*?(?:error|Error)\.message/);
    expect(sources).not.toMatch(/console\.error\([\s\S]*?(?:previous|path)(?:\s*,|\))/);
  });
});
