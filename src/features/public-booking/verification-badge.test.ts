import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const source = (relative: string) => readFileSync(path.join(root, relative), "utf8");

describe("public professional verification badge", () => {
  it("publishes only an approved boolean from the reviewed claim", () => {
    const sql = source("supabase/policies/0054_public_professional_verification_badge.sql");
    expect(sql).toContain("c.doctor_profile_id = v_doctor.id");
    expect(sql).toContain("c.status = 'APPROVED'");
    expect(sql).toContain("'verified', v_verified");
    expect(sql).not.toContain("evidence_note");
    expect(sql).not.toContain("decision_note");
  });

  it("renders truthful verified and not-verified states", () => {
    const profile = source("src/features/public-booking/components/public-doctor-profile.tsx");
    expect(profile).toContain("doctor.verified");
    expect(profile).toContain("Verified");
    expect(profile).toContain("Not verified");
  });

  it("keeps a compact directory card that opens the canonical full profile", () => {
    const card = source("src/features/public-booking/components/compact-doctor-card.tsx");
    expect(card).toContain("doctor.specialization");
    expect(card).toContain("doctor.qualification");
    expect(card).toContain("View full profile");
    expect(card).toContain("/dr/${encodeURIComponent(doctor.slug)}");
  });
});
