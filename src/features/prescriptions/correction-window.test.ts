import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CORRECTION_UI_WINDOW_MS, isCorrectionUiWindowOpen } from "./correction-window";

const read = (file: string) => readFileSync(path.resolve(file), "utf8");

describe("finalized prescription correction presentation window", () => {
  it("offers correction through the first 48 hours only", () => {
    const finalized = "2026-09-04T12:00:00.000Z";
    expect(isCorrectionUiWindowOpen(finalized, new Date("2026-09-06T11:59:59.999Z"))).toBe(true);
    expect(isCorrectionUiWindowOpen(finalized, new Date("2026-09-06T12:00:00.000Z"))).toBe(true);
    expect(isCorrectionUiWindowOpen(finalized, new Date("2026-09-06T12:00:00.001Z"))).toBe(false);
    expect(CORRECTION_UI_WINDOW_MS).toBe(48 * 60 * 60 * 1000);
  });

  it("fails closed for missing, invalid or future finalization timestamps", () => {
    expect(isCorrectionUiWindowOpen(null)).toBe(false);
    expect(isCorrectionUiWindowOpen("not-a-date")).toBe(false);
    expect(
      isCorrectionUiWindowOpen("2026-09-07T00:00:00.000Z", new Date("2026-09-06T00:00:00.000Z")),
    ).toBe(false);
  });

  it("server page derives presentation eligibility from the finalized timestamp", () => {
    const page = read("src/app/(app)/prescription/[prescriptionId]/page.tsx");
    expect(page).toContain("isCorrectionUiWindowOpen(finalized.finalized.finalizedAt)");
    expect(page).toContain("correctionUiEligible={correctionUiEligible}");
  });

  it("hides the normal correction affordance after expiry while keeping print", () => {
    const finalized = read("src/features/prescriptions/components/finalized-prescription.tsx");
    expect(finalized).toContain("showCorrectionAction");
    expect(finalized).toMatch(/showCorrectionAction \? <WriteCorrection/);
    expect(finalized).toContain("Historical prescription.");
    expect(finalized).toContain("no longer offered after 48 hours");
    expect(finalized).toContain("<PrintPrescription");
  });

  it("documents that this is presentation, not the authoritative mutation boundary", () => {
    const helper = read("src/features/prescriptions/correction-window.ts");
    const page = read("src/app/(app)/prescription/[prescriptionId]/page.tsx");
    expect(helper).toMatch(/NOT an authorization boundary/);
    expect(page).toMatch(/MD separately owns authoritative mutation enforcement/);
  });
});
