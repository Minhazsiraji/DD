import * as React from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { BundleItem } from "./review-bundle";
import type { ReviewView } from "./review-view";
import {
  formatDoseForDisplay,
  formatPrescriptionMedicine,
  formatScheduleForDisplay,
} from "./prescription-medicine-format";
import { MedicineLine, PHYSICAL_UNITS, PrescriptionFooter, PrescriptionHeader } from "./components/prescription-parts";
import { ReviewSheet } from "./components/review-sheet";
import { PrintSheet } from "./components/print-sheet";

const FINALIZED = {
  kind: "finalized" as const,
  finalizedAt: "2026-09-27T04:25:00.000Z",
  prescriptionId: "11111111-2222-4333-8444-555555555555",
  timeZone: "Asia/Dhaka",
};

function item(overrides: Partial<BundleItem> = {}): BundleItem {
  return {
    position: 1,
    display_name: "Allaklobe",
    brand_name: "Allaklobe",
    generic_name: "Valaciclovir",
    strength_text: "500 mg",
    dose_text: "1",
    dosage_form: "Tablet",
    route: "Oral",
    schedule_text: "1+0+1",
    duration_text: "5 days",
    quantity_text: "10 tablets",
    food_relation: "After food",
    is_prn: false,
    instructions: "Drink plenty of water.",
    substitution_allowed: true,
    ...overrides,
  };
}

function view(overrides: Partial<ReviewView> = {}): ReviewView {
  return {
    renderer: "v3-linear",
    clinicalDate: "2026-09-27",
    paperSize: "A4",
    marginMm: 15,
    baseFontPt: 11,
    header: {
      clinicName: "Sample Chamber",
      addressLine: "Dhaka",
      phone: "01000000000",
      headerNote: null,
      doctorName: "Dr Sample",
      credentials: ["MBBS"],
      bmdc: "A-12345",
    },
    patient: { fullName: "Sample Patient", patientNumber: "P-1", ageSex: "30y · F" },
    lines: [formatPrescriptionMedicine(item())],
    footerText: null,
    showFooter: false,
    signature: { kind: "hidden" },
    clinicLogo: { kind: "hidden" },
    templateName: null,
    templateSource: "system",
    investigations: [],
    advice: null,
    ...overrides,
  };
}

function medicineMarkup(row = item(), kind: "draft" | "finalized" = "draft"): string {
  return renderToStaticMarkup(
    React.createElement(MedicineLine, {
      line: formatPrescriptionMedicine(row),
      view: view(),
      u: PHYSICAL_UNITS,
      documentState: kind === "draft" ? { kind: "draft" } : FINALIZED,
    }),
  );
}

describe("prescription medicine presentation standard", () => {
  it("1. renders brand/display identity with strength", () => {
    const line = formatPrescriptionMedicine(item());
    expect(`${line.name} ${line.strength}`).toBe("Allaklobe 500 mg");
  });

  it("2. builds the generic, form and route secondary line", () => {
    const line = formatPrescriptionMedicine(item());
    expect([line.subtitle, line.administration].filter(Boolean).join(" · ")).toBe(
      "Valaciclovir · Tablet · Oral",
    );
  });

  it("3. deduplicates only an exact trailing strength", () => {
    const line = formatPrescriptionMedicine(
      item({ display_name: "Paracetamol 500 mg", strength_text: "500 mg" }),
    );
    expect(line.name).toBe("Paracetamol 500 mg");
    expect(line.strength).toBeNull();
  });

  it("4. does not fuzzily strip a non-equivalent strength", () => {
    const line = formatPrescriptionMedicine(
      item({ display_name: "Acyvir 250 mg/vial", strength_text: "250 mg" }),
    );
    expect(line.strength).toBe("250 mg");
  });

  it("5. preserves explicit dose units and derives only a countable form unit", () => {
    expect(formatDoseForDisplay("5 mL", "Syrup")).toBe("5 mL");
    expect(formatDoseForDisplay("1", "Tablet")).toBe("1 tablet");
    expect(formatDoseForDisplay("2", "Capsule")).toBe("2 capsules");
  });

  it("6. labels a numeric dose when no safe unit exists", () => {
    expect(formatDoseForDisplay("1", null)).toBe("Dose: 1");
    expect(formatDoseForDisplay("1", "Syrup")).toBe("Dose: 1");
  });

  it("7. interprets 1+0+0 as Morning", () => {
    expect(formatScheduleForDisplay("1+0+0")).toEqual({ schedule: "1+0+0", interpretation: "Morning" });
  });

  it("8. interprets 0+1+0 as Noon", () => {
    expect(formatScheduleForDisplay("0+1+0").interpretation).toBe("Noon");
  });

  it("9. interprets 0+0+1 as Night", () => {
    expect(formatScheduleForDisplay("0+0+1").interpretation).toBe("Night");
  });

  it("10. interprets 1+0+1 as Morning & evening", () => {
    expect(formatScheduleForDisplay("1 + 0 + 1")).toEqual({
      schedule: "1+0+1",
      interpretation: "Morning & evening",
    });
  });

  it("11. interprets 1+1+1 without clock-time inference", () => {
    expect(formatScheduleForDisplay("1+1+1").interpretation).toBe("Morning, noon & night");
  });

  it("12. interprets 1+1+1+1 as 4 times daily", () => {
    expect(formatScheduleForDisplay("1+1+1+1").interpretation).toBe("4 times daily");
  });

  it("13. passes Every 6 hours through without interpretation", () => {
    expect(formatScheduleForDisplay("Every 6 hours")).toEqual({
      schedule: "Every 6 hours",
      interpretation: null,
    });
  });

  it("14. passes Every 8 hours, Once weekly and STAT through", () => {
    for (const schedule of ["Every 8 hours", "Once weekly", "STAT"]) {
      expect(formatScheduleForDisplay(schedule)).toEqual({ schedule, interpretation: null });
    }
  });

  it("15. renders the explicit duration in the regimen", () => {
    expect(medicineMarkup()).toContain("1 tablet · 1+0+1 · Morning &amp; evening · 5 days");
  });

  it("16. shows a draft-only missing-duration warning", () => {
    const missing = item({ duration_text: null });
    expect(medicineMarkup(missing, "draft")).toContain("Duration not specified");
    expect(medicineMarkup(missing, "finalized")).not.toContain("Duration not specified");
  });

  it("17. renders food relation once", () => {
    const markup = medicineMarkup();
    expect(markup.match(/After food/g)).toHaveLength(1);
  });

  it("18. labels an explicit quantity without calculating it", () => {
    expect(formatPrescriptionMedicine(item()).quantity).toBe("Qty: 10 tablets");
    expect(formatPrescriptionMedicine(item({ quantity_text: "Qty: 14 capsules" })).quantity).toBe(
      "Qty: 14 capsules",
    );
  });

  it("19. preserves patient instructions exactly, including Bangla", () => {
    const instruction = "খাবারের পরে খাবেন।";
    expect(medicineMarkup(item({ instructions: instruction }))).toContain(instruction);
  });

  it("20. renders the existing frozen BM&DC value", () => {
    const markup = renderToStaticMarkup(
      React.createElement(PrescriptionHeader, { view: view(), u: PHYSICAL_UNITS }),
    );
    expect(markup).toContain("BM&amp;DC Reg: A-12345");
  });

  it("21. safely omits BM&DC when the frozen bundle has none", () => {
    const markup = renderToStaticMarkup(
      React.createElement(PrescriptionHeader, {
        view: view({ header: { ...view().header!, bmdc: null } }),
        u: PHYSICAL_UNITS,
      }),
    );
    expect(markup).not.toContain("BM&amp;DC Reg:");
  });

  it("22. renders the authoritative finalized timestamp in chamber time", () => {
    const markup = renderToStaticMarkup(
      React.createElement(PrescriptionFooter, {
        view: view(),
        u: PHYSICAL_UNITS,
        documentState: FINALIZED,
      }),
    );
    expect(markup).toContain("Digitally finalized: 27 Sep 2026, 10:25 AM");
  });

  it("23. never claims that a draft is finalized", () => {
    const markup = renderToStaticMarkup(
      React.createElement(PrescriptionFooter, {
        view: view(),
        u: PHYSICAL_UNITS,
        documentState: { kind: "draft" },
      }),
    );
    expect(markup).not.toContain("Digitally finalized");
  });

  it("24. renders the existing stable prescription id only when finalized", () => {
    const markup = renderToStaticMarkup(
      React.createElement(PrescriptionFooter, {
        view: view(),
        u: PHYSICAL_UNITS,
        documentState: FINALIZED,
      }),
    );
    expect(markup).toContain(`Prescription ID: ${FINALIZED.prescriptionId}`);
  });

  it("25. gives Review and print the same shared medicine presentation", () => {
    const review = renderToStaticMarkup(
      React.createElement(ReviewSheet, { view: view(), documentState: FINALIZED }),
    );
    const print = renderToStaticMarkup(
      React.createElement(PrintSheet, { view: view(), documentState: FINALIZED }),
    );
    for (const text of [
      "Allaklobe",
      "500 mg",
      "Valaciclovir · Tablet · Oral",
      "1 tablet · 1+0+1 · Morning &amp; evening · 5 days",
      "After food · Qty: 10 tablets",
    ]) {
      expect(review).toContain(text);
      expect(print).toContain(text);
    }
  });

  it("26. keeps mobile review and physical print overflow-safe", () => {
    const review = readFileSync("src/features/prescriptions/components/review-sheet.tsx", "utf8");
    const parts = readFileSync("src/features/prescriptions/components/prescription-parts.tsx", "utf8");
    const print = readFileSync("src/features/prescriptions/components/print-sheet.tsx", "utf8");
    expect(review).toContain("min-w-0 w-full max-w-full overflow-x-auto");
    expect(parts).toContain('className="min-w-0 flex-1 break-words"');
    expect(parts).toContain('breakInside: "avoid"');
    expect(print).toContain("paper.w - view.marginMm * 2");
    expect(print).not.toMatch(/overflow:\s*["']hidden["']/);
  });
});
