import { describe, it, expect } from "vitest";
import {
  resolveTemplateForLocation,
  doctorProfileSchema,
  templateSchema,
  DEFAULT_TEMPLATE,
  SYSTEM_TEMPLATE,
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

/**
 * The fallback chain: location default -> global default -> built-in.
 *
 * The database enforces AT MOST one default per scope, never "exactly one", so
 * zero defaults is a state these tests must cover rather than assume away.
 */
describe("resolveTemplateForLocation", () => {
  const GLOBAL = make({ id: "g", name: "General", practiceLocationId: null, isDefault: true });
  const AT_HOSPITAL = make({
    id: "h",
    name: "Hospital",
    practiceLocationId: HOSPITAL,
    isDefault: true,
  });

  it("prefers a template scoped to the location over the global one", () => {
    const r = resolveTemplateForLocation([GLOBAL, AT_HOSPITAL], HOSPITAL);
    expect(r.template.id).toBe("h");
    expect(r.source).toBe("location");
  });

  it("falls back to the global default where no location template exists", () => {
    const r = resolveTemplateForLocation([GLOBAL, AT_HOSPITAL], CHAMBER);
    expect(r.template.id).toBe("g");
    expect(r.source).toBe("global");
  });

  it("ignores non-default templates at the location", () => {
    const draft = make({ id: "x", name: "Draft", practiceLocationId: HOSPITAL });
    const r = resolveTemplateForLocation([GLOBAL, draft], HOSPITAL);
    expect(r.template.id).toBe("g");
    expect(r.source).toBe("global");
  });

  it("does not treat a null location as matching a location-scoped template", () => {
    const r = resolveTemplateForLocation([AT_HOSPITAL], null);
    expect(r.source).toBe("system");
  });

  describe("after the default is deleted", () => {
    it("falls back to the built-in rather than promoting a survivor", () => {
      // Deleting the global default leaves a non-default template behind. It
      // must NOT be silently promoted — that would change what prints without
      // the doctor asking.
      const survivor = make({ id: "s", name: "Old draft", practiceLocationId: null });
      const r = resolveTemplateForLocation([survivor], CHAMBER);
      expect(r.source).toBe("system");
      expect(r.template.name).toBe(SYSTEM_TEMPLATE.name);
    });

    it("still uses the location default when only the global one was deleted", () => {
      const r = resolveTemplateForLocation([AT_HOSPITAL], HOSPITAL);
      expect(r.template.id).toBe("h");
      expect(r.source).toBe("location");
    });

    it("drops to the global default when the location default was deleted", () => {
      const r = resolveTemplateForLocation([GLOBAL], HOSPITAL);
      expect(r.template.id).toBe("g");
      expect(r.source).toBe("global");
    });

    it("resolves to the built-in when every template is gone", () => {
      const r = resolveTemplateForLocation([], HOSPITAL);
      expect(r.source).toBe("system");
      expect(r.template.paperSize).toBe("A4");
    });
  });

  it("always resolves to something — a prescription always has paper", () => {
    for (const templates of [[], [GLOBAL], [AT_HOSPITAL], [GLOBAL, AT_HOSPITAL]]) {
      for (const loc of [null, CHAMBER, HOSPITAL]) {
        expect(resolveTemplateForLocation(templates, loc).template).toBeTruthy();
      }
    }
  });

  it("never presents the built-in as one of the doctor's own defaults", () => {
    expect(SYSTEM_TEMPLATE.isDefault).toBe(false);
    expect(SYSTEM_TEMPLATE.id).toBeUndefined();
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
