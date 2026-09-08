import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(path.resolve(file), "utf8");

const CORRECTION = "src/features/prescriptions/components/write-correction.tsx";
const FINALIZED = "src/features/prescriptions/components/finalized-prescription.tsx";
const PRINT = "src/features/prescriptions/components/print-prescription.tsx";

describe("M3-UAT-C1 correction entry layout", () => {
  it("isolates the correction reason in an accessible body-level modal sheet", () => {
    const correction = read(CORRECTION);

    expect(correction).toContain('import { createPortal } from "react-dom"');
    expect(correction).toContain("return createPortal(");
    expect(correction).toContain("document.body");
    expect(correction).toContain('role="dialog"');
    expect(correction).toContain('aria-modal="true"');
    expect(correction).toContain("data-correction-dialog-backdrop");
    expect(correction).toContain("fixed inset-0");
    expect(correction).toContain('document.body.style.overflow = "hidden"');
    expect(correction).toContain("onKeyDown={keepFocusInside}");
  });

  it("keeps textarea, count and actions usable from phone through desktop", () => {
    const correction = read(CORRECTION);

    expect(correction).toContain("max-h-[90dvh] w-full max-w-xl overflow-y-auto");
    expect(correction).toContain("items-end justify-center");
    expect(correction).toContain("sm:items-center sm:p-4");
    expect(correction).toContain("min-h-28 w-full resize-y");
    expect(correction).toContain("{reason.length} / {MAX_REASON}");
    expect(correction).toContain("flex flex-col gap-2 sm:flex-row sm:flex-wrap");
    expect(correction.match(/min-h-11 w-full/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(correction.match(/sm:w-auto/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
  });

  it("does not change correction semantics or copy predecessor medicines", () => {
    const correction = read(CORRECTION);

    expect(correction).toContain("const result = await startCorrectionAction({ prescriptionId, reason });");
    expect(correction).toContain('const trimmed = reason.trim();');
    expect(correction).toContain('disabled={busy || trimmed === ""}');
    expect(correction).toContain("MAX_REASON = 500");
    expect(correction).not.toMatch(/MedicineRow|ReviewBundle|prescription_items|copyMedicines|prefill|prePopulate|initialItems/);
  });
});

describe("M3-UAT-C1 finalized print-history layout", () => {
  it("keeps print controls/history full-width instead of competing with correction", () => {
    const finalized = read(FINALIZED);
    const print = read(PRINT);

    expect(finalized).toContain("data-finalized-rx-actions");
    expect(finalized).toContain('className="flex min-w-0 flex-col items-stretch gap-3"');
    expect(finalized).not.toContain("sm:flex-row sm:items-start sm:gap-3");
    expect(print).toContain('className="w-full max-w-md rounded-xl');
  });

  it("preserves the frozen native print and explicit confirmation boundary", () => {
    const print = read(PRINT);

    expect(print).toContain("initiatePrescriptionPrintAction");
    expect(print).toContain("window.print();");
    expect(print).toContain("setConfirmationOpen(true);");
    expect(print).toContain("confirmPrescriptionPrintAction");
    expect(print).toContain("leaveUnconfirmed");
  });
});
