import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { toReviewView } from "./review-view";
import { parseReview, reviewBundleSchema } from "./review-bundle";

/**
 * WHAT THE DOCTOR TYPED IS WHAT PRINTS.
 *
 * A deployed prescription showed "Paracetamol 500g" where milligrams were
 * meant. The database was read: it held exactly "500g" — code points
 * 53,48,48,103, with no "m" and no space — through the item row, the approved
 * snapshot, and the print. Nothing had altered it.
 *
 * So the pipeline was faithful and the value was wrong on the way in. These
 * tests keep the faithful half faithful: no unit is inferred, corrected,
 * reformatted or dropped anywhere between the field and the paper. A
 * transformation that "helpfully" fixed 500g into 500mg would be far more
 * dangerous than the typo, because nobody would ever see it happen.
 */

const STRENGTHS = [
  "500 mg",
  "10 mg",
  "20 mg",
  "5 mL",
  "250 mcg",
  "1 g",
  // Written the way people actually write them.
  "500mg",
  "0.5 mg",
  "1.25 mg/mL",
  "2 × 250 mg",
  "40 IU",
  "0.1%",
  // Bangla digits and a unit in Bangla — the product is Bangladesh-first.
  "৫০০ মিগ্রা",
  // And the value that started this: it must survive UNCHANGED, because
  // silently repairing it is the failure mode nobody can audit.
  "500g",
];

/** A bundle carrying one medicine with the given strength. */
function bundleWith(strength: string) {
  return {
    bundle: {
      schemaVersion: 2,
      // Real v4 shapes: the schema validates the version nibble, and
      // "1111…" is not a version this project ever issues.
      prescriptionId: "3f8c1a2e-5b6d-4c7e-9a1f-2b3c4d5e6f70",
      encounterId: "7a1b2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c5d",
      clinicalDate: "2026-08-20",
      doctor: {
        fullName: "Dr Ayesha Rahman",
        qualification: "MBBS",
        specialization: null,
        designation: null,
        bmdcRegistrationNo: "A-00000",
      },
      location: { name: "Metro Hospital", address: null, district: null, phone: null },
      patient: {
        fullName: "Test Patient",
        patientNumber: "AR-000001",
        sex: "FEMALE",
        dob: null,
        dobPrecision: "AGE_ONLY",
        approxAgeYears: 40,
        ageRecordedOn: "2026-08-20",
      },
      template: {
        source: "system",
        templateId: null,
        name: "Standard (built-in)",
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
      },
      items: [
        {
          position: 1,
          display_name: "Paracetamol",
          brand_name: null,
          generic_name: null,
          strength_text: strength,
          dose_text: "1 tablet",
          dosage_form: null,
          route: null,
          schedule_text: "1+0+1",
          duration_text: null,
          quantity_text: null,
          food_relation: null,
          is_prn: false,
          instructions: null,
          substitution_allowed: true,
        },
      ],
      signature: null,
    },
    digest: "a".repeat(64),
    expectedSignaturePath: "",
    version: 1,
  };
}

describe("the strength a doctor approves is the strength that prints", () => {
  for (const strength of STRENGTHS) {
    it(`${JSON.stringify(strength)} survives the bundle and the view untouched`, () => {
      const parsed = parseReview(bundleWith(strength));
      expect(
        parsed.ok,
        `the bundle must parse: ${JSON.stringify(reviewBundleSchema.safeParse(bundleWith(strength).bundle).error?.issues?.slice(0, 4))}`,
      ).toBe(true);
      if (!parsed.ok) return;

      // 1. The canonical bundle keeps it byte-for-byte.
      expect(parsed.review.bundle.items[0]!.strength_text).toBe(strength);

      // 2. The view model both sheets render from keeps it byte-for-byte.
      const view = toReviewView(parsed.review.bundle);
      expect(view.lines[0]!.strength).toBe(strength);

      // 3. Code point by code point — a lost "m" is exactly what was feared.
      expect([...(view.lines[0]!.strength ?? "")].map((c) => c.codePointAt(0))).toEqual(
        [...strength].map((c) => c.codePointAt(0)),
      );
    });
  }

  it("trims surrounding whitespace and nothing else", () => {
    /**
     * The one permitted change, and it is not a unit change: a trailing space
     * would print as a trailing space. Interior spacing is the doctor's.
     */
    const parsed = parseReview(bundleWith("  500 mg  "));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(toReviewView(parsed.review.bundle).lines[0]!.strength).toBe("500 mg");
  });

  it("an empty strength becomes absent, never a guessed unit", () => {
    const parsed = parseReview(bundleWith(""));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(toReviewView(parsed.review.bundle).lines[0]!.strength).toBeNull();
  });
});

describe("nothing in the renderer rewrites a unit", () => {
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

  it("the shared clinical parts print the strength verbatim", async () => {
    const parts = strip(
      await readFile(
        path.resolve("src/features/prescriptions/components/prescription-parts.tsx"),
        "utf8",
      ),
    );
    // Rendered as-is, with no formatter between the value and the page.
    expect(parts).toMatch(/\{line\.strength\}/);
    expect(parts).not.toMatch(/formatStrength|normalizeUnit|toMg|parseStrength/);
  });

  it("no module in the prescription feature converts units", async () => {
    const files = [
      "review-view.ts",
      "review-bundle.ts",
      "schema.ts",
      "queries.ts",
      "actions.ts",
    ];
    for (const f of files) {
      const src = strip(
        await readFile(path.resolve("src/features/prescriptions", f), "utf8"),
      );
      /**
       * A unit conversion anywhere in this path would change a dose after the
       * doctor approved it. There is no safe version of that.
       */
      expect(src, f).not.toMatch(/\bmilligram|\* 1000|\/ 1000|toMilligram|convertUnit/i);
    }
  });
});
