import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function source(file: string): string {
  return readFileSync(path.resolve(process.cwd(), file), "utf8");
}

describe("prescription review patient safety context", () => {
  const reviewPage = source(
    "src/app/(app)/prescription/[prescriptionId]/review/page.tsx",
  );

  it("uses the already-authorized prescription patient instead of a second lookup", () => {
    expect(reviewPage).toContain("const patient = detail.prescription.patient;");
    expect(reviewPage).toContain(
      "const allergies = patient.allergies.map((allergy) => allergy.substance);",
    );
    expect(reviewPage).toContain(
      "const conditions = patient.conditions.map((condition) => condition.condition);",
    );
  });

  it("keeps allergy context visible while the doctor scrolls to finalization", () => {
    expect(reviewPage).toContain("data-prescription-review-safety-context");
    expect(reviewPage).toContain("sticky top-2 z-20");
    expect(reviewPage).toContain("Allergy:");
    expect(reviewPage).toContain("{allergies.join(\", \")}");
  });

  it("shows conditions with lower visual priority and retains the no-allergy fallback", () => {
    expect(reviewPage).toContain("Conditions:");
    expect(reviewPage).toContain("{conditions.join(\" · \")}");
    expect(reviewPage).toContain("No known drug allergies recorded");
  });

  it("marks the safety strip as review-only rather than part of the printable digest", () => {
    expect(reviewPage).toContain("Patient safety · review only · not printed");
    expect(reviewPage).toContain("OUTSIDE the canonical review");
    expect(reviewPage.indexOf("data-prescription-review-safety-context")).toBeLessThan(
      reviewPage.indexOf("<ReviewScreen"),
    );
  });
});
