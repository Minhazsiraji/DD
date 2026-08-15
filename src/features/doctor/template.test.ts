import { describe, it, expect } from "vitest";
import {
  resolveTemplateForLocation,
  doctorProfileSchema,
  templateSchema,
  DEFAULT_TEMPLATE,
  PAPER_MM,
} from "./schema";
import type { TemplateSettings } from "./schema";

const make = (over: Partial<TemplateSettings>): TemplateSettings => ({
  ...DEFAULT_TEMPLATE,
  isDefault: false,
  ...over,
});

const CHAMBER = "11111111-1111-4111-8111-111111111111";
const HOSPITAL = "22222222-2222-4222-8222-222222222222";

describe("resolveTemplateForLocation", () => {
  it("prefers a template scoped to the location over the global one", () => {
    const templates = [
      make({ id: "g", name: "General", practiceLocationId: null, isDefault: true }),
      make({ id: "h", name: "Hospital", practiceLocationId: HOSPITAL, isDefault: true }),
    ];
    expect(resolveTemplateForLocation(templates, HOSPITAL)?.id).toBe("h");
  });

  it("falls back to the global default where no location template exists", () => {
    const templates = [
      make({ id: "g", name: "General", practiceLocationId: null, isDefault: true }),
      make({ id: "h", name: "Hospital", practiceLocationId: HOSPITAL, isDefault: true }),
    ];
    expect(resolveTemplateForLocation(templates, CHAMBER)?.id).toBe("g");
  });

  it("ignores non-default templates at the location", () => {
    const templates = [
      make({ id: "g", name: "General", practiceLocationId: null, isDefault: true }),
      make({ id: "x", name: "Draft", practiceLocationId: HOSPITAL, isDefault: false }),
    ];
    expect(resolveTemplateForLocation(templates, HOSPITAL)?.id).toBe("g");
  });

  it("returns null rather than guessing when nothing is marked default", () => {
    expect(resolveTemplateForLocation([make({ id: "a", name: "A" })], CHAMBER)).toBeNull();
  });

  it("does not treat a null location as matching a location-scoped template", () => {
    const templates = [make({ id: "h", name: "Hospital", practiceLocationId: HOSPITAL, isDefault: true })];
    expect(resolveTemplateForLocation(templates, null)).toBeNull();
  });
});

describe("doctorProfileSchema", () => {
  const base = { fullName: "A Rahman", patientNumberPrefix: "ar" };

  it("upper-cases the patient number prefix so numbering stays consistent", () => {
    expect(doctorProfileSchema.parse(base).patientNumberPrefix).toBe("AR");
  });

  it("rejects a prefix with digits or punctuation", () => {
    for (const bad of ["A1", "A-R", "A R", ""]) {
      expect(doctorProfileSchema.safeParse({ ...base, patientNumberPrefix: bad }).success).toBe(false);
    }
  });

  it("accepts optional professional fields left blank", () => {
    const parsed = doctorProfileSchema.safeParse({
      ...base,
      qualification: "",
      bmdcRegistrationNo: "",
    });
    expect(parsed.success).toBe(true);
  });
});

describe("templateSchema", () => {
  const base = { name: "Chamber pad" };

  it("keeps a margin printers can actually reach", () => {
    expect(templateSchema.safeParse({ ...base, marginMm: 2 }).success).toBe(false);
    expect(templateSchema.safeParse({ ...base, marginMm: 60 }).success).toBe(false);
    expect(templateSchema.safeParse({ ...base, marginMm: 15 }).success).toBe(true);
  });

  it("keeps the text size legible", () => {
    expect(templateSchema.safeParse({ ...base, baseFontPt: 4 }).success).toBe(false);
    expect(templateSchema.safeParse({ ...base, baseFontPt: 40 }).success).toBe(false);
  });

  it("treats an empty location as 'everywhere' rather than invalid", () => {
    expect(templateSchema.safeParse({ ...base, practiceLocationId: "" }).success).toBe(true);
  });

  it("rejects a location that is not a uuid", () => {
    expect(templateSchema.safeParse({ ...base, practiceLocationId: "chamber" }).success).toBe(false);
  });

  it("requires a name", () => {
    expect(templateSchema.safeParse({ name: "" }).success).toBe(false);
  });
});

describe("paper dimensions", () => {
  it("uses real ISO sizes — the preview claims to be to scale", () => {
    expect(PAPER_MM.A4).toEqual({ w: 210, h: 297 });
    expect(PAPER_MM.A5).toEqual({ w: 148, h: 210 });
  });
});
