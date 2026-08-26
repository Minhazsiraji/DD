import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { placeSections, toModularView, type ModularSection } from "./modular-view";
import { toPrescriptionView } from "./prescription-view";
import { RENDERABLE_SCHEMA_VERSIONS, selectRenderer } from "./renderer-version";
import {
  CURRENT_BUNDLE_SCHEMA_VERSION,
  SUPPORTED_BUNDLE_SCHEMA_VERSIONS,
  reviewBundleSchema,
} from "./review-bundle";

/**
 * THE RENDERER BOUNDARY.
 *
 * One question — which renderer prints this snapshot — answered from
 * `schemaVersion` and nothing else. These tests exist because every other way
 * of answering it is a way for a finalised prescription to print differently
 * later than it printed on the day it was signed.
 */

const doctor = {
  fullName: "Dr A",
  qualification: null,
  specialization: null,
  designation: null,
  bmdcRegistrationNo: null,
};
const location = { name: null, address: null, district: null, phone: null };
const patient = {
  fullName: "P",
  patientNumber: null,
  sex: "MALE",
  dob: "1990-01-01",
  dobPrecision: "DAY",
  approxAgeYears: null,
  ageRecordedOn: null,
};
const template = {
  source: "system",
  templateId: null,
  name: null,
  paperSize: "A4",
  marginMm: 15,
  baseFontPt: 11,
  showHeader: true,
  showClinicLogo: false,
  clinicNameOverride: null,
  headerNote: null,
  showQualification: true,
  showSpecialization: true,
  showDesignation: true,
  showBmdc: true,
  showChamberAddress: true,
  showChamberPhone: true,
  showFooter: true,
  footerText: null,
  showSignature: false,
};

const base = {
  prescriptionId: "11111111-2222-4333-8444-555555555555",
  encounterId: "66666666-7777-4888-8999-aaaaaaaaaaaa",
  clinicalDate: "2026-08-21",
  doctor,
  location,
  patient,
  template,
  signature: null,
  items: [],
};

/** A v3 snapshot: two fixed sections, no modules. */
const v3Bundle = {
  ...base,
  schemaVersion: 3,
  investigations: [{ position: 1, name: "CBC", note: null }],
  advice: "Rest",
};

/** A v4 snapshot: the doctor's own modules, and a named arrangement. */
const v4Bundle = {
  ...base,
  schemaVersion: 4,
  layout: "two-column",
  sections: [
    { module: "CHIEF_COMPLAINT", label: "Chief Complaint", kind: "text", text: "Fever 3 days" },
    {
      module: "VITALS",
      label: "Vitals",
      kind: "pairs",
      pairs: [{ label: "BP", value: "120/80" }],
    },
    {
      module: "INVESTIGATIONS",
      label: "Lab Work",
      kind: "list",
      items: [{ text: "CBC", note: "rule out infection" }],
    },
  ],
};

describe("selectRenderer branches on the schema version alone", () => {
  it("2 and 3 print through the v3 document", () => {
    for (const v of [2, 3]) {
      const choice = selectRenderer(v);
      expect(choice.ok).toBe(true);
      if (choice.ok) expect(choice.renderer).toBe("v3-linear");
    }
  });

  it("4 prints through the v4 document", () => {
    const choice = selectRenderer(4);
    expect(choice.ok).toBe(true);
    if (choice.ok) expect(choice.renderer).toBe("v4-modular");
  });

  /**
   * THE TEST THIS FILE EXISTS FOR.
   *
   * `version >= 4 ? v4 : v3` passes every other assertion here and fails this
   * one. A v5 bundle carries something v4 never had; handing it to the v4
   * renderer prints a shorter prescription than the one that was approved, with
   * nothing on screen to say so.
   */
  it("5 is UNSUPPORTED, not 'close enough to 4'", () => {
    const choice = selectRenderer(5);
    expect(choice.ok).toBe(false);
    if (!choice.ok) {
      expect(choice.reason).toBe("unsupported-schema");
      expect(choice.found).toBe(5);
    }
  });

  it("and an older version is not quietly upgraded either", () => {
    // v1 carried no `clinicalDate`, so its printed age came from a clock.
    for (const v of [0, 1, -1]) expect(selectRenderer(v).ok).toBe(false);
  });

  it("a near-miss is a refusal like any other unknown version", () => {
    // Each of these would index the map to `undefined` and, with a `??`
    // fallback anywhere, become "assume the newest renderer".
    for (const v of ["4", 4.5, NaN, Infinity, null, undefined, {}, [4]]) {
      expect(selectRenderer(v).ok, `${String(v)} must not resolve to a renderer`).toBe(false);
    }
  });
});

describe("accepting a bundle and being able to print it are the same statement", () => {
  it("every supported version has a renderer", () => {
    for (const v of SUPPORTED_BUNDLE_SCHEMA_VERSIONS) {
      expect(selectRenderer(v).ok, `schema ${v} parses but has no renderer`).toBe(true);
    }
  });

  it("and every renderable version is accepted — the lists are one list", () => {
    expect([...SUPPORTED_BUNDLE_SCHEMA_VERSIONS]).toEqual([...RENDERABLE_SCHEMA_VERSIONS]);
  });

  it("what this build writes is what this build can print", () => {
    expect(selectRenderer(CURRENT_BUNDLE_SCHEMA_VERSION).ok).toBe(true);
  });
});

describe("the version and the shape must agree, so neither can be inferred from the other", () => {
  it("a v3 bundle carrying modular sections is refused", () => {
    // Otherwise the v3 renderer would be handed sections it cannot read, and
    // approved content would be absent from the paper with no error anywhere.
    const parsed = reviewBundleSchema.safeParse({ ...v4Bundle, schemaVersion: 3 });
    expect(parsed.success).toBe(false);
  });

  it("a v4 bundle carrying the old top-level sections is refused", () => {
    // The mirror: the v4 renderer reads `sections`, so a top-level
    // `investigations` would be approved and then silently unprinted.
    const parsed = reviewBundleSchema.safeParse({
      ...v4Bundle,
      investigations: [{ position: 1, name: "CBC", note: null }],
      advice: "Rest",
    });
    expect(parsed.success).toBe(false);
  });

  it("a v4 bundle without a layout is refused", () => {
    const noLayout: Record<string, unknown> = { ...v4Bundle };
    delete noLayout.layout;
    expect(reviewBundleSchema.safeParse(noLayout).success).toBe(false);
  });

  it("a layout token this build does not know is refused, never guessed at", () => {
    // Placement is precisely what we would be guessing.
    expect(
      reviewBundleSchema.safeParse({ ...v4Bundle, layout: "three-column" }).success,
    ).toBe(false);
  });

  it("both well-formed shapes parse", () => {
    expect(reviewBundleSchema.safeParse(v3Bundle).success).toBe(true);
    expect(reviewBundleSchema.safeParse(v4Bundle).success).toBe(true);
  });
});

describe("toPrescriptionView hands each snapshot to its own renderer", () => {
  it("a v3 snapshot becomes the v3 document, with its two fixed sections", () => {
    const parsed = reviewBundleSchema.parse(v3Bundle);
    const render = toPrescriptionView(parsed);
    expect(render.ok).toBe(true);
    if (!render.ok) return;
    expect(render.view.renderer).toBe("v3-linear");
    if (render.view.renderer !== "v3-linear") return;
    expect(render.view.investigations.map((i) => i.name)).toEqual(["CBC"]);
    expect(render.view.advice).toBe("Rest");
  });

  it("a v4 snapshot becomes the v4 document, with the doctor's own modules", () => {
    const parsed = reviewBundleSchema.parse(v4Bundle);
    const render = toPrescriptionView(parsed);
    expect(render.ok).toBe(true);
    if (!render.ok) return;
    expect(render.view.renderer).toBe("v4-modular");
    if (render.view.renderer !== "v4-modular") return;
    expect(render.view.left.map((s) => s.module)).toEqual([
      "CHIEF_COMPLAINT",
      "VITALS",
      "INVESTIGATIONS",
    ]);
  });

  it("the doctor's own label is what prints — never this build's default", () => {
    const parsed = reviewBundleSchema.parse(v4Bundle);
    const render = toPrescriptionView(parsed);
    if (!render.ok || render.view.renderer !== "v4-modular") throw new Error("expected v4");
    const investigations = render.view.left.find((s) => s.module === "INVESTIGATIONS");
    // "Lab Work", as frozen — not "Investigations / Tests", the built-in.
    expect(investigations?.label).toBe("Lab Work");
  });

  it("sections keep the approved ORDER, never a re-sort by module name", () => {
    const reordered = reviewBundleSchema.parse({
      ...v4Bundle,
      sections: [...v4Bundle.sections].reverse(),
    });
    const render = toPrescriptionView(reordered);
    if (!render.ok || render.view.renderer !== "v4-modular") throw new Error("expected v4");
    expect(render.view.left.map((s) => s.module)).toEqual([
      "INVESTIGATIONS",
      "VITALS",
      "CHIEF_COMPLAINT",
    ]);
  });

  it("an unrecognised module still prints, under its own label", () => {
    /**
     * A section carries its heading and its shape, so a module added by a newer
     * server is fully printable. Dropping it — or refusing the whole
     * prescription over it — would both be worse than printing it.
     */
    const withUnknown = reviewBundleSchema.parse({
      ...v4Bundle,
      sections: [
        ...v4Bundle.sections,
        { module: "SOMETHING_NEW", label: "Something New", kind: "text", text: "kept" },
      ],
    });
    const render = toPrescriptionView(withUnknown);
    if (!render.ok || render.view.renderer !== "v4-modular") throw new Error("expected v4");
    const found = render.view.left.find((s) => s.module === "SOMETHING_NEW");
    expect(found?.label).toBe("Something New");
  });

  it("a snapshot from a newer build is refused, not rendered by the older document", () => {
    const render = toPrescriptionView({ ...v3Bundle, schemaVersion: 5 } as never);
    expect(render.ok).toBe(false);
    if (!render.ok) expect(render.found).toBe(5);
  });
});

describe("placement is a frozen contract, pinned", () => {
  const sections: ModularSection[] = [
    { module: "DIAGNOSIS", label: "Diagnosis", kind: "text", text: "x" },
    { module: "ADVICE", label: "Advice", kind: "text", text: "y" },
  ];

  /**
   * `two-column` NAMES this arrangement. Changing it here would reprint every
   * already-signed v4 prescription differently, so a different arrangement has
   * to be a different token.
   */
  it("two-column puts every configured module left and keeps the Rx alone on the right", () => {
    const placed = placeSections("two-column", sections);
    expect(placed.left).toEqual(sections);
    expect(placed.right).toEqual([]);
  });

  it("no section is ever dropped by placement", () => {
    const placed = placeSections("two-column", sections);
    expect(placed.left.length + placed.right.length).toBe(sections.length);
  });
});

describe("the v4 view reads the snapshot and nothing else", () => {
  it("never reaches for today's module configuration", async () => {
    /**
     * The specific failure: a doctor renames a module or turns one off, and
     * every prescription they have ever signed reprints with the new wording.
     * The frozen sections are the only source.
     */
    const src = await readFile(path.resolve("src/features/prescriptions/modular-view.ts"), "utf8");
    const body = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    for (const forbidden of [
      "doctor_rx_modules",
      "doctorPrescriptionModules",
      "rx_module_label",
      "default_rx_modules",
      "fetch",
      "supabase",
    ]) {
      expect(body.includes(forbidden), `modular-view.ts must not read ${forbidden}`).toBe(false);
    }
  });

  it("keeps every printable value exactly as frozen — 500g stays 500g", () => {
    const withQuantities = reviewBundleSchema.parse({
      ...v4Bundle,
      sections: [
        {
          module: "ADVICE",
          label: "Advice",
          kind: "list",
          items: [{ text: "Sugar 500g per week", note: "10g salt maximum" }],
        },
        {
          module: "VITALS",
          label: "Vitals",
          kind: "pairs",
          pairs: [
            { label: "Wt", value: "100 kg" },
            { label: "Ht", value: "160 cm" },
            { label: "T", value: "38.4°C" },
          ],
        },
      ],
    });
    const view = toModularView(withQuantities);
    const advice = view.left[0];
    expect(advice?.kind).toBe("list");
    if (advice?.kind !== "list") return;
    expect(advice.items[0]!.text).toBe("Sugar 500g per week");
    expect(advice.items[0]!.note).toBe("10g salt maximum");

    const vitals = view.left[1];
    expect(vitals?.kind).toBe("pairs");
    if (vitals?.kind !== "pairs") return;
    // Nothing rounded, rescaled, re-united or trimmed on the way to the page.
    expect(vitals.pairs.map((p) => p.value)).toEqual(["100 kg", "160 cm", "38.4°C"]);
  });
});
