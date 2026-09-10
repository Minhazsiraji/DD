import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(path.resolve(file), "utf8");
function gitBlobSha(file: string): string {
  const content = readFileSync(path.resolve(file));
  return createHash("sha1").update(Buffer.from(`blob ${content.length}\0`)).update(content).digest("hex");
}

describe("D1 Doctor Dashboard pilot delta", () => {
  it("reuses authoritative Doctor-owned encounter and prescription reads", () => {
    const source = read("src/features/dashboard/d1-queries.ts");
    expect(source).toContain('.from("encounters")');
    expect(source).toContain('.eq("owner_doctor_id", doctorId)');
    expect(source).toContain('.eq("practice_location_id", locationId)');
    expect(source).toContain('rpc("prescriptions_for_doctor"');
    expect(source).toContain("p_practice_location_id: locationId");
  });

  it("does not add a Dashboard clinical write path", () => {
    const source = read("src/features/dashboard/d1-queries.ts");
    expect(source).not.toMatch(/\.insert\(|\.update\(|\.delete\(|open_prescription|open_encounter|confirm_encounter_investigations/);
  });

  it("classifies pending work only as DRAFT encounter or DRAFT prescription", () => {
    const source = read("src/features/dashboard/d1-queries.ts");
    expect(source).toContain('.eq("status", "DRAFT")');
    expect(source).toContain('row.status === "DRAFT"');
    expect(source).toContain('row.status === "FINALIZED"');
  });

  it("keeps quick Prescription and Investigation navigation encounter-contextual", () => {
    const source = read("src/features/dashboard/components/d1-pilot-activity.tsx");
    expect(source).toContain("Prescription via consultation");
    expect(source).toContain("Investigation via consultation");
    expect(source).toContain("`/consultation/${row.encounterId}`");
    expect(source).not.toMatch(/prescription\/new|investigation\/new|patientless/i);
  });

  it("links finalized and draft prescriptions only by authoritative prescription id", () => {
    const source = read("src/features/dashboard/components/d1-pilot-activity.tsx");
    expect(source).toContain("`/prescription/${row.prescriptionId}`");
  });

  it("keeps frozen M3 and Investigation anchors byte-identical", () => {
    expect(gitBlobSha("supabase/policies/0046_investigation_v1_foundation.sql")).toBe("5e105f3015f1251279e3ba94b5c3b745998b8e22");
    expect(gitBlobSha("supabase/policies/0042_m3_prescription_reuse.sql")).toBe("f0d61c8ba472a57513eb0065a294a2ff65a09b69");
    expect(gitBlobSha("supabase/policies/0043_m3_signed_medicine_history.sql")).toBe("16b417bf3117d4e19bb9c52383af5e8608f59a91");
    expect(gitBlobSha("supabase/policies/0044_m3_prescription_print_audit.sql")).toBe("139684e77ef6fa2c5414611c32dfd8c6b9113524");
    expect(gitBlobSha("src/features/prescriptions/components/print-sheet.tsx")).toBe("0b8afc336ff27faa0a33eaf22f6a8eac1b236c36");
  });
});
