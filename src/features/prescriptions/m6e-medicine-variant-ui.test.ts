import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("M6E staged medicine variant picker", () => {
  it("uses the shared catalogue and doctor library instead of signed-history-only autocomplete", () => {
    const form = read("src/features/prescriptions/components/medicine-form.tsx");
    expect(form).toContain("/api/m6e-medicine-lookup?");
    expect(form).toContain('scope: "all"');
    expect(form).toContain('limit: "10"');
    expect(form).not.toContain("/api/m3-signed-medicine-history?mode=RECENT");
  });

  it("renders medicine variants in document flow instead of an overlapping absolute dropdown", () => {
    const form = read("src/features/prescriptions/components/medicine-form.tsx");
    expect(form).toContain("data-medicine-variant-panel");
    expect(form).toContain("Available medicine variants");
    expect(form).not.toContain("absolute inset-x-0 top-full");
    expect(form).toContain("primaryFields.map(renderField)");
    expect(form).toContain("remainingFields.map(renderField)");
  });

  it("shows catalogue/library provenance and only fills the staged form", () => {
    const form = read("src/features/prescriptions/components/medicine-form.tsx");
    expect(form).toContain('return "Favorite"');
    expect(form).toContain('return "My Medicines"');
    expect(form).toContain('return "Catalogue"');
    expect(form).toContain("onApplySuggestion(match.draft)");
    expect(form).toContain("nothing is added until you press Add medicine");
    expect(form).not.toContain("addMedicineAction");
  });

  it("keeps the catalogue lookup read-only and exposes variant detail", () => {
    const route = read("src/app/api/m6e-medicine-lookup/route.ts");
    expect(route).toContain("searchMedicines");
    expect(route).toContain("listDoctorMedicines");
    expect(route).toContain("manufacturer: row.manufacturer");
    expect(route).toContain("Math.min(Math.trunc(requestedLimit), 12)");
    expect(route).not.toContain("addMedicineAction");
    expect(route).not.toContain("finalizePrescriptionAction");
  });
});
