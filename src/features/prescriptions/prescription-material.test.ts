import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(path.resolve(file), "utf8");

describe("M2 finalized prescription material propagation", () => {
  it("uses the frozen pearl panel material for the approved status without losing the safe accent", () => {
    const finalized = read("src/features/prescriptions/components/finalized-prescription.tsx");
    expect(finalized).toContain("dd-material-panel dd-panel-pearl dd-panel-rim");
    expect(finalized).toContain("border-l-success");
    expect(finalized).toContain("text-success");
    expect(finalized).not.toContain(
      'className="clinical-surface flex min-w-0 items-start gap-2 rounded-glass border-l-4 border-l-success',
    );
  });

  it("propagates the shared pearl material and aqua navigation family through every lineage state", () => {
    const lineage = read("src/features/prescriptions/components/correction-banner.tsx");
    expect(lineage.match(/dd-material-panel dd-panel-pearl dd-panel-rim/g)?.length).toBe(3);
    expect(lineage).not.toContain('className="clinical-surface');
    expect(lineage.match(/dd-secondary/g)?.length).toBe(2);
    expect(lineage).toContain("See the original");
    expect(lineage).toContain("Open the current one");
    expect(lineage.match(/data-print-hidden/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("uses canonical primary/secondary actions for the correction workflow without changing the mutation", () => {
    const correction = read("src/features/prescriptions/components/write-correction.tsx");
    expect(correction.match(/dd-primary/g)?.length).toBe(2);
    expect(correction).toContain("dd-secondary");
    expect(correction).toContain('className="dd-panel-pearl dd-panel-rim"');
    expect(correction).toContain("startCorrectionAction({ prescriptionId, reason })");
    expect(correction).not.toMatch(/startCorrectionAction\(\{[^}]*encounterId/);
  });

  it("keeps both on-screen and physical prescription paper white and outside glass styling", () => {
    const review = read("src/features/prescriptions/components/review-sheet.tsx");
    const print = read("src/features/prescriptions/components/print-sheet.tsx");
    expect(review).toContain("data-review-sheet");
    expect(review).toContain("bg-white");
    expect(print).toContain("data-print-root");
    expect(print).toContain("bg-white");
    expect(review).not.toContain("dd-material-panel");
    expect(print).not.toContain("dd-material-panel");
  });
});
