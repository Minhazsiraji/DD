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
    const query = read("src/features/dashboard/d1-queries.ts");
    const activity = read("src/features/dashboard/components/d1-pilot-activity.tsx");
    expect(query).not.toMatch(/\.insert\(|\.update\(|\.delete\(|open_prescription|open_encounter|confirm_encounter_investigations/);
    expect(activity).not.toMatch(/openPrescriptionAction|confirmInvestigationsAction|openEncounterAction|startConsultationAction/);
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

  it("provides an always-safe patient-selection fallback for both clinical shortcuts", () => {
    const source = read("src/features/dashboard/components/d1-pilot-activity.tsx");
    expect(source).toContain("Prescription · choose patient");
    expect(source).toContain("Investigation · choose patient");
    expect(source).toContain("Choose the patient first");
    expect(source.match(/href="\/patients"/g)).toHaveLength(2);
  });

  it("links finalized and draft prescriptions only by authoritative prescription id", () => {
    const source = read("src/features/dashboard/components/d1-pilot-activity.tsx");
    expect(source).toContain("`/prescription/${row.prescriptionId}`");
  });

  it("makes the existing queue path explicit for start or resume without a new workflow", () => {
    const source = read("src/features/dashboard/components/work-now.tsx");
    expect(source).toContain("Resume the patient already with you");
    expect(source).toContain("start the next waiting patient");
    expect(source).toContain("<OpenConsultation");
    expect(source).toContain("<StartConsultation");
  });

  it("keeps a coherent 360px mobile flow with touch-safe contextual controls", () => {
    const page = read("src/app/(app)/dashboard/page.tsx");
    const activity = read("src/features/dashboard/components/d1-pilot-activity.tsx");
    expect(page).toContain("w-full min-w-0 space-y-4");
    expect(activity).toContain("min-h-11");
    expect(activity).toContain("flex-wrap");
    expect(activity).toContain("grid-cols-1");
    expect(activity).not.toMatch(/w-\[(?:[4-9]\d\d|\d{4,})px\]/);
  });

  it("keeps the 820px tablet flow single-column until the existing XL breakpoint", () => {
    const page = read("src/app/(app)/dashboard/page.tsx");
    expect(page).toContain("xl:grid-cols-3");
    expect(page).not.toMatch(/md:grid-cols-3|lg:grid-cols-3/);
  });

  it("preserves the existing 1440px desktop overview composition", () => {
    const page = read("src/app/(app)/dashboard/page.tsx");
    expect(page).toContain("xl:grid-cols-3");
    expect(page).toContain("xl:col-span-2");
    expect(page).toContain("<QuickActions />");
    expect(page).toContain("<DashboardPilotActivity");
  });

  it("keeps frozen M3 and Investigation anchors byte-identical", () => {
    expect(gitBlobSha("supabase/policies/0046_investigation_v1_foundation.sql")).toBe("5e105f3015f1251279e3ba94b5c3b745998b8e22");
    expect(gitBlobSha("supabase/policies/0042_m3_prescription_reuse.sql")).toBe("f0d61c8ba472a57513eb0065a294a2ff65a09b69");
    expect(gitBlobSha("supabase/policies/0043_m3_signed_medicine_history.sql")).toBe("16b417bf3117d4e19bb9c52383af5e8608f59a91");
    expect(gitBlobSha("supabase/policies/0044_m3_prescription_print_audit.sql")).toBe("139684e77ef6fa2c5414611c32dfd8c6b9113524");
    expect(gitBlobSha("src/features/prescriptions/components/print-sheet.tsx")).toBe("0b8afc336ff27faa0a33eaf22f6a8eac1b236c36");
  });
});
