import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(path.resolve(file), "utf8");

describe("M3 responsive prescription workflow", () => {
  it("keeps fast medicine entry touch-safe and phone-first without a medicine table", () => {
    const form = read("src/features/prescriptions/components/medicine-form.tsx");
    const list = read("src/features/prescriptions/components/medicine-list.tsx");
    expect(form).toContain("grid grid-cols-12 gap-3");
    expect(form).toContain("min-h-11");
    expect(form).toContain("sm:flex-row");
    expect(form).toContain("More medicine details");
    expect(list).toContain("<ol");
    expect(list).not.toMatch(/<table|overflow-x-auto/);
    expect(list).toContain("size-11");
  });

  it("lets history and reuse collapse vertically on mobile and expand from tablet upward", () => {
    const history = read("src/features/prescriptions/components/signed-medicine-history.tsx");
    const reuse = read("src/features/prescriptions/components/prescription-reuse.tsx");
    expect(history).toContain("flex flex-col gap-3 sm:flex-row");
    expect(history).toContain("sm:grid-cols-2");
    expect(history).toContain("xl:grid-cols-3");
    expect(reuse).toContain("flex flex-col gap-2 sm:flex-row sm:flex-wrap");
    expect(reuse).toContain("min-h-11");
  });

  it("keeps review/finalize and on-screen paper usable at 360/820/1440 layouts", () => {
    const review = read("src/features/prescriptions/components/review-sheet.tsx");
    const finalize = read("src/features/prescriptions/components/finalize-panel.tsx");
    const print = read("src/features/prescriptions/components/print-prescription.tsx");
    expect(review).toContain("min-w-0 w-full max-w-full overflow-x-auto");
    expect(finalize).toContain("w-full");
    expect(finalize).toContain("sm:w-auto");
    expect(finalize).toContain("min-h-11");
    expect(print).toContain("sm:flex-row");
    expect(print).toContain("min-h-11");
  });
});
