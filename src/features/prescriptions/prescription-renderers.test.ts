import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PAPER_MM } from "@/features/doctor/schema";
import { PHYSICAL_UNITS, proportionalUnits } from "./components/prescription-parts";

/**
 * Two renderers, one document.
 *
 * The screen preview and the print sheet solve different LAYOUT problems and so
 * use different units. What they must never do is interpret the prescription
 * differently — the specific failure being guarded against is print quietly
 * omitting a field the screen shows, on paper a pharmacist reads and the doctor
 * never sees again.
 *
 * The guarantee is structural: every clinical mark is emitted by
 * `prescription-parts.tsx` and nowhere else, so a field cannot exist in one
 * sheet and not the other. These tests hold that structure in place.
 */

const COMPONENTS = path.resolve("src/features/prescriptions/components");

async function source(file: string) {
  return readFile(path.join(COMPONENTS, file), "utf8");
}

/**
 * The file with its comments removed.
 *
 * These tests are about what the code DOES, and the prose in this codebase
 * discusses `cqw`, digests and signed URLs precisely because it explains why
 * they are not used. Scanning raw text made the documentation fail the test —
 * which would have pushed the comments out rather than the behaviour.
 */
async function code(file: string) {
  return (await source(file)).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

/**
 * Reading any of these means a file is deciding what the document says, rather
 * than where it goes. Only the shared parts may.
 */
const CLINICAL_READS = [
  /\bline\.(name|strength|dose|schedule|duration|quantity|foodRelation|instructions|subtitle|administration|isPrn)\b/,
  // `h` is the destructured `view.header` inside the shared parts.
  /\b(view\.header|h)\.(doctorName|credentials|bmdc|clinicName|addressLine|phone|headerNote)\b/,
  /view\.patient\.(fullName|ageSex|patientNumber)\b/,
  /view\.(clinicalDate|footerText|lines)\b/,
];

describe("only the shared parts read clinical fields", () => {
  for (const sheet of ["review-sheet.tsx", "print-sheet.tsx"]) {
    it(`${sheet} decides layout, never content`, async () => {
      const text = await code(sheet);
      const offenders = CLINICAL_READS.filter((re) => re.test(text)).map(String);

      expect(
        offenders,
        `${sheet} reads clinical fields directly; it should delegate to PrescriptionDocument`,
      ).toEqual([]);
    });

    it(`${sheet} renders the shared document`, async () => {
      // Guards the test above: a sheet that rendered nothing would also pass it.
      expect(await source(sheet)).toMatch(/<PrescriptionDocument\b/);
    });
  }

  it("…and the shared parts really do read them", async () => {
    // A scanner that matches nothing is not a control.
    const parts = await code("prescription-parts.tsx");
    for (const re of CLINICAL_READS) {
      expect(re.test(parts), `prescription-parts.tsx should read ${re}`).toBe(true);
    }
  });

  it("every clinical field of a medicine is emitted somewhere", async () => {
    /**
     * Named explicitly so that adding a field to `ReviewLine` without printing
     * it fails here rather than on paper. `position` is rendered as `.` and
     * `substitutionAllowed` is not printed by design.
     */
    const parts = await source("prescription-parts.tsx");
    for (const field of [
      "line.name",
      "line.strength",
      "line.dose",
      "line.schedule",
      "line.duration",
      "line.quantity",
      "line.foodRelation",
      "line.instructions",
      "line.subtitle",
      "line.administration",
      "line.isPrn",
      "line.position",
    ]) {
      expect(parts.includes(field), `${field} is never rendered`).toBe(true);
    }
  });
});

describe("the print sheet is physical", () => {
  it("uses no container-query units", async () => {
    // `cqw` resolves against a container's computed width — a number we would
    // be inferring on paper rather than stating.
    const text = await code("print-sheet.tsx");
    expect(text).not.toMatch(/cqw/);
    expect(text).not.toMatch(/@container/);
  });

  it("does not contain the page with an aspect ratio", async () => {
    // That is what makes the screen sheet a preview, and what would stop
    // overflow being measurable.
    expect(await code("print-sheet.tsx")).not.toMatch(/aspectRatio/);
  });

  it("declares the paper size the prescription was approved on", async () => {
    const text = await source("print-sheet.tsx");
    expect(text).toMatch(/@page \{ size: \$\{paper\.w\}mm \$\{paper\.h\}mm/);
    // Never a literal A4: the snapshot's template decides.
    expect(text).not.toMatch(/size:\s*A4/);
  });

  /**
   * The margin is the DOCTOR's, and 15 mm is only where the control starts.
   *
   * A print renderer that reached for its own default would quietly overrule a
   * template the doctor set, approved and finalised — and the paper would be
   * wrong in a way nothing on screen showed.
   */
  it("takes the margin and the type size from the snapshot, never a constant", async () => {
    const text = await code("print-sheet.tsx");
    /**
     * The margin belongs to `@page`, not to the element.
     *
     * As padding it applied once across the whole flow, so pages 2..n printed
     * edge-to-edge with no top or bottom margin. On the page box it applies to
     * EVERY page.
     */
    expect(text).toMatch(/@page \{[^`]*margin: \$\{view\.marginMm\}mm/);
    expect(text).toMatch(/fontSize: `\$\{view\.baseFontPt\}pt`/);
    // No hard-coded page geometry anywhere in the renderer.
    expect(text).not.toMatch(/15mm|11pt/);
  });

  it("sizes the sheet to the page's content width, from the approved margin", async () => {
    const text = await code("print-sheet.tsx");
    expect(text).toMatch(/paper\.w - view\.marginMm \* 2/);
  });

  it("no longer constrains the document to one page", async () => {
    /**
     * The whole of 7C-3B: a fixed page height is what forced the old refusal.
     * Without it the browser fragments the flow instead.
     */
    const text = await code("print-sheet.tsx");
    expect(text).not.toMatch(/height: `\$\{paper\.h\}mm`/);
    expect(text).not.toMatch(/overflow:\s*["']hidden["']/);
  });

  it("the screen sheet takes them from the same place", async () => {
    const text = await code("review-sheet.tsx");
    expect(text).toMatch(/u\.mm\(view\.marginMm\)/);
    expect(text).toMatch(/u\.pt\(view\.baseFontPt\)/);
    expect(text).not.toMatch(/15mm|11pt/);
  });

  it("keeps A4 and A5 apart", () => {
    expect(PAPER_MM.A4).toEqual({ w: 210, h: 297 });
    expect(PAPER_MM.A5).toEqual({ w: 148, h: 210 });
    expect(PAPER_MM.A4).not.toEqual(PAPER_MM.A5);
  });
});

/**
 * THE SHORT PRESCRIPTION THE OWNER PHOTOGRAPHED.
 *
 * A three-medicine A4 prescription showed its signature and footer around the
 * MIDDLE of the paper with a large empty area beneath — measured in the live
 * preview at 449px of dead space below the footer on a 1123px sheet. It looked
 * unfinished, and worse, the review preview was not the composition that
 * printed: the anchor existed only in the print stylesheet.
 *
 * Two rules hold it, and they must stay together:
 *
 *   the sheets are flex COLUMNS          (both of them, not just print)
 *   the medicine list GROWS              so it absorbs the leftover height
 *
 * and one rule keeps the cure from becoming the old disease:
 *
 *   min-height is one page MINUS 1mm     so a full page never tips into page 2
 */
describe("a short prescription anchors its signature and footer to the foot of the page", () => {
  it("both sheets are flex columns — not print alone", async () => {
    /**
     * The bug was precisely that only print had this. The review preview
     * stacked from the top, so the doctor approved one composition and printed
     * another.
     */
    expect(await code("print-sheet.tsx")).toMatch(/className="flex flex-col/);
    expect(await code("review-sheet.tsx")).toMatch(/className="flex flex-col/);
  });

  /**
   * BOTH documents, not one. The anchor is a property of the composition, and
   * there are two compositions now — a v4 document that stacked from the top
   * would strand its signature mid-sheet exactly as the v3 one used to.
   */
  it("the clinical body takes the slack, in every document", async () => {
    for (const doc of ["document-v3.tsx", "document-v4.tsx"]) {
      const text = await code(doc);
      expect(text, `${doc} must let the body absorb the leftover height`).toMatch(
        /<div className="flex flex-1 flex-col">/,
      );
    }
  });

  it("growing the LIST, not pushing the signature with an auto margin", async () => {
    /**
     * `margin-top: auto` on the signature would also drop it to the bottom —
     * of whatever box it lands in. On a fragmented prescription that is a page
     * it does not belong to. Growing the list keeps the signature attached to
     * the last medicine.
     */
    for (const file of ["prescription-parts.tsx", "document-v3.tsx", "document-v4.tsx"]) {
      expect(await code(file), `${file} must not push the signature with a margin`).not.toMatch(
        /marginTop:\s*["']auto["']/,
      );
    }
  });

  it("the growing body and the signature are siblings in that column", async () => {
    /**
     * The body must be a DIRECT child of the sheet's flex column, and the
     * signature must follow it rather than sit inside it — otherwise the
     * signature grows with the body instead of being pushed down by it, and
     * the anchor stops working with nothing to see in a diff.
     */
    for (const file of ["document-v3.tsx", "document-v4.tsx"]) {
      const doc = await code(file);
      expect(doc, file).toMatch(/<>\s*<PrescriptionHeader/);
      expect(doc, file).toMatch(/<\/div>\s*<SignatureBlock/);
    }
  });

  it("the page-filling minimum is one page LESS 1mm, and lives only in print", async () => {
    /**
     * The 1mm is the whole anti-blank-page margin: exactly one page's content
     * box, plus any rounding in the box model, is what produces a second empty
     * sheet. Verified in real Chromium — 1 to 7 medicines print on one A4 page,
     * 8 tips to two, and no line count produces a blank trailing page.
     */
    const sheet = await code("print-sheet.tsx");
    expect(sheet).toMatch(/paper\.h - view\.marginMm \* 2 - 1/);

    const css = await readFile(path.resolve("src/app/globals.css"), "utf8");
    const print = css.slice(css.indexOf("@media print"));
    expect(print).toMatch(/min-height:\s*var\(--page-content-height/);
  });

  it("the signature and the footer are each rendered exactly once", async () => {
    // Never repeated per page — the one repeated element there ever was
    // (a continuation header) could print on top of a dose.
    for (const file of ["document-v3.tsx", "document-v4.tsx"]) {
      const doc = await code(file);
      expect(doc.match(/<SignatureBlock\b/g), file).toHaveLength(1);
      expect(doc.match(/<PrescriptionFooter\b/g), file).toHaveLength(1);
    }
  });

  it("nothing is shrunk, clipped or absolutely placed to make it fit", async () => {
    const parts = await code("prescription-parts.tsx");
    expect(parts).not.toMatch(/overflow:\s*["']hidden["']/);
    expect(parts).not.toMatch(/position:\s*["'](absolute|fixed)["']/);
    expect(parts).not.toMatch(/transform:\s*["']?scale/);
  });
});

/**
 * THE PAPER CARRIES ALL THREE THINGS THE DOCTOR WROTE.
 *
 * A consultation produces medicines, tests and advice, and the patient carries
 * one sheet. Printing only the medicines meant the tests were written out again
 * by hand and the advice — the part a patient actually follows — was not on the
 * paper at all.
 */
describe("investigations and advice print, without pretending to be more", () => {
  it("both sections come from the same shared parts as everything else", async () => {
    const doc = await source("document-v3.tsx");
    expect(doc).toMatch(/<InvestigationList\b/);
    expect(doc).toMatch(/<AdviceBlock\b/);
  });

  it("in the approved order: medicines, then tests, then advice", async () => {
    const doc = await code("document-v3.tsx");
    const order = ["<MedicineList", "<InvestigationList", "<AdviceBlock", "<SignatureBlock"].map(
      (t) => doc.indexOf(t),
    );
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("an ORDER never reads as a RESULT", async () => {
    /**
     * There is no investigation-results module. A printed line that carried a
     * status, a value or a date would say a test had come back — the most
     * dangerous thing this document could claim.
     */
    const parts = await code("prescription-parts.tsx");
    const section = parts.slice(
      parts.indexOf("export function InvestigationList"),
      parts.indexOf("export function AdviceBlock"),
    );
    expect(section).not.toMatch(/result|status|value|normal|abnormal|completed|pending|\bdone\b/i);
    // Only the two fields an order actually has.
    expect(section).toMatch(/x\.name/);
    expect(section).toMatch(/x\.note/);
  });

  it("an empty section is omitted entirely, never left as a bare heading", async () => {
    const parts = await code("prescription-parts.tsx");
    expect(parts).toMatch(/if \(view\.investigations\.length === 0\) return null/);
    expect(parts).toMatch(/if \(!view\.advice\) return null/);
  });

  it("advice is never clipped, shrunk or collapsed — Bangla included", async () => {
    const parts = await code("prescription-parts.tsx");
    const section = parts.slice(parts.indexOf("export function AdviceBlock"));
    expect(section).toMatch(/whitespace-pre-wrap/);
    expect(section).toMatch(/break-words/);
    expect(section).not.toMatch(/truncate|line-clamp|overflow:\s*["']hidden["']/);
  });

  it("the view model carries them, and never back-fills a snapshot that lacks them", async () => {
    /**
     * A v2 prescription was approved without these sections. Reading today's
     * encounter rows to fill them in would print content the doctor never
     * approved onto a document they signed.
     */
    const view = await readFile(path.resolve("src/features/prescriptions/review-view.ts"), "utf8");
    expect(view).toMatch(/bundle\.investigations \?\? \[\]/);
    expect(view).toMatch(/clean\(bundle\.advice \?\? null\)/);
    // Sorted by the doctor's own arrangement, same rule as the medicines.
    expect(view).toMatch(/\.sort\(\(a, b\) => a\.position - b\.position\)/);
  });
});

describe("the bundle keeps its promise across schema versions", () => {
  it("supports the old version and the new one, and writes the new one", async () => {
    const { SUPPORTED_BUNDLE_SCHEMA_VERSIONS, CURRENT_BUNDLE_SCHEMA_VERSION } = await import(
      "./review-bundle"
    );
    expect([...SUPPORTED_BUNDLE_SCHEMA_VERSIONS]).toEqual([2, 3, 4]);
    expect(CURRENT_BUNDLE_SCHEMA_VERSION).toBe(4);
  });

  it("a v3 bundle missing the new sections is REFUSED, not silently shortened", async () => {
    const { reviewBundleSchema } = await import("./review-bundle");
    const base = {
      schemaVersion: 3,
      prescriptionId: "11111111-2222-4333-8444-555555555555",
      encounterId: "66666666-7777-4888-8999-aaaaaaaaaaaa",
      clinicalDate: "2026-08-21",
      doctor: {
        fullName: "Dr A",
        qualification: null,
        specialization: null,
        designation: null,
        bmdcRegistrationNo: null,
      },
      location: { name: null, address: null, district: null, phone: null },
      patient: {
        fullName: "P",
        patientNumber: null,
        sex: null,
        dob: null,
        dobPrecision: null,
        approxAgeYears: null,
        ageRecordedOn: null,
      },
      template: {
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
        showSignature: true,
      },
      signature: null,
      items: [],
    };

    // Fails closed: printing a v3 prescription without its approved sections
    // would print a shorter document than the one that was signed.
    expect(reviewBundleSchema.safeParse(base).success).toBe(false);
    expect(
      reviewBundleSchema.safeParse({ ...base, investigations: [], advice: null }).success,
    ).toBe(true);
  });

  it("a v2 snapshot still parses untouched — it predates the sections", async () => {
    const { reviewBundleSchema } = await import("./review-bundle");
    const v2 = {
      schemaVersion: 2,
      prescriptionId: "11111111-2222-4333-8444-555555555555",
      encounterId: "66666666-7777-4888-8999-aaaaaaaaaaaa",
      clinicalDate: "2026-08-01",
      doctor: {
        fullName: "Dr A",
        qualification: null,
        specialization: null,
        designation: null,
        bmdcRegistrationNo: null,
      },
      location: { name: null, address: null, district: null, phone: null },
      patient: {
        fullName: "P",
        patientNumber: null,
        sex: null,
        dob: null,
        dobPrecision: null,
        approxAgeYears: null,
        ageRecordedOn: null,
      },
      template: {
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
        showSignature: true,
      },
      signature: null,
      items: [],
    };
    expect(reviewBundleSchema.safeParse(v2).success).toBe(true);
  });

  it("the SQL snapshots only THIS encounter's orders, and today's advice", async () => {
    const sql = (
      await readFile(
        path.resolve("supabase/policies/0026_prescription_orders_and_advice.sql"),
        "utf8",
      )
    ).replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[^\n]*/g, "");

    // Bound to the prescription's own encounter — never a previous visit's.
    expect(sql).toMatch(/from public\.encounter_investigations\s*\n?\s*where encounter_id = v_rx\.encounter_id/);
    // Name and reason only: no status, no value, nothing that reads as a result.
    expect(sql).toMatch(/select position, name, note/);
    expect(sql).toMatch(/'advice', to_jsonb\(nullif\(btrim\(coalesce\(v_enc\.advice/);
    expect(sql).toMatch(/'schemaVersion', 3/);
  });
});

/**
 * THE V3 DOCUMENT IS FROZEN, AND THE V4 ONE IS NEW.
 *
 * Every prescription already signed prints through `document-v3.tsx`. The
 * failure these tests guard is the tempting one: improving the old document to
 * match the new one, and thereby reprinting signed paper differently.
 */
describe("the renderer boundary lives in the component tree too", () => {
  it("the switch is on the explicit discriminant, never on what fields are present", async () => {
    const text = await code("prescription-document.tsx");
    expect(text).toMatch(/switch \(view\.renderer\)/);
    expect(text).toMatch(/case "v3-linear"/);
    expect(text).toMatch(/case "v4-modular"/);
    // Any of these would be a second, weaker version rule.
    expect(text).not.toMatch(/view\.sections|view\.layout|schemaVersion|\?\?|>=\s*4/);
  });

  it("both sheets still render one document, so screen and paper cannot differ", async () => {
    for (const sheet of ["review-sheet.tsx", "print-sheet.tsx"]) {
      expect(await source(sheet), sheet).toMatch(/<PrescriptionDocument\b/);
      // Neither sheet may pick a renderer for itself.
      expect(await code(sheet), sheet).not.toMatch(/LinearDocument|ModularDocument/);
    }
  });

  it("the v3 document has no two-column markup — it must never acquire the new layout", async () => {
    const v3 = await code("document-v3.tsx");
    expect(v3).not.toMatch(/data-rx-column|table-cell|SectionBlock|view\.left|view\.right/);
  });

  it("the v4 document does not render the v3 fixed sections", async () => {
    // At v4 those are modules like any other, and rendering them twice — once
    // as a module, once as a fixed section — would duplicate clinical content.
    const v4 = await code("document-v4.tsx");
    expect(v4).not.toMatch(/<InvestigationList|<AdviceBlock/);
  });
});

describe("the two-column band is built to survive a page break", () => {
  it("is a table row, not column-count and not a flex row", async () => {
    /**
     * `column-count` reflows one column into the other, which would run
     * medicines into the clinical column. A flex row fragments unevenly. A
     * two-cell table row is the construct browsers have paginated reliably
     * since printing existed — each cell continues on the next page in its own
     * column, and nothing is duplicated.
     */
    const v4 = await code("document-v4.tsx");
    expect(v4).toMatch(/display: "table"/);
    expect(v4).toMatch(/display: "table-row"/);
    expect(v4.match(/display: "table-cell"/g)).toHaveLength(2);
    expect(v4).not.toMatch(/columnCount|column-count|columns:/);
  });

  it("the clinical column aligns to the TOP of its cell", async () => {
    // A table cell centres by default, which would float a short complaint into
    // the middle of a long medicine list.
    const v4 = await code("document-v4.tsx");
    expect(v4.match(/verticalAlign: "top"/g)).toHaveLength(2);
  });

  it("the Rx is on the right and the configured modules on the left", async () => {
    const v4 = await code("document-v4.tsx");
    const left = v4.indexOf('data-rx-column="left"');
    const right = v4.indexOf('data-rx-column="right"');
    expect(left).toBeGreaterThan(-1);
    expect(right).toBeGreaterThan(left);
    // The medicines belong to the right cell.
    expect(v4.slice(right)).toMatch(/<MedicineList/);
  });

  it("every module off means NO empty column, not an empty strip with a rule", async () => {
    const v4 = await code("document-v4.tsx");
    expect(v4).toMatch(/const hasColumns =/);
    expect(v4).toMatch(/hasColumns \?/);
  });

  it("nothing is shrunk, clipped or absolutely placed to make two columns fit", async () => {
    for (const file of ["document-v4.tsx", "section-parts.tsx"]) {
      const text = await code(file);
      expect(text, file).not.toMatch(/overflow:\s*["']hidden["']/);
      expect(text, file).not.toMatch(/position:\s*["'](absolute|fixed)["']/);
      expect(text, file).not.toMatch(/transform:\s*["']?scale/);
      expect(text, file).not.toMatch(/truncate|line-clamp/);
    }
  });
});

describe("a frozen section prints what was frozen", () => {
  it("the heading is the doctor's own label, never re-resolved today", async () => {
    /**
     * The specific failure: a doctor renames a module and every prescription
     * they have ever signed reprints with the new wording.
     */
    const parts = await code("section-parts.tsx");
    expect(parts).toMatch(/\{section\.label\}/);
    for (const builtIn of [
      "Chief Complaint",
      "Investigations / Tests",
      "Advice",
      "Next Visit",
      "Vitals",
    ]) {
      expect(parts.includes(builtIn), `section-parts.tsx must not hardcode "${builtIn}"`).toBe(
        false,
      );
    }
  });

  it("nothing chooses what to print from the module NAME", async () => {
    // `section.module` is placement and a harness hook. A renderer that keyed
    // content off it would make an unfamiliar module unprintable.
    const parts = await code("section-parts.tsx");
    expect(parts).not.toMatch(/section\.module ===|switch \(section\.module\)/);
  });

  it("a value is printed verbatim — nothing rounds, rescales or re-units it", async () => {
    const parts = await code("section-parts.tsx");
    expect(parts).toMatch(/\{pair\.value\}/);
    expect(parts).not.toMatch(/toFixed|parseFloat|Number\(|Math\.round|replace\(/);
  });

  it("long text wraps and is never clipped — Bangla included", async () => {
    const parts = await code("section-parts.tsx");
    expect(parts).toMatch(/whitespace-pre-wrap/);
    expect(parts).toMatch(/break-words/);
  });
});

describe("the print harness is development-only and touches nothing", () => {
  it("the route does not exist in a production build — executed, not read", async () => {
    /**
     * Run rather than grepped: the guard is the only thing standing between a
     * production deployment and a page of fabricated prescriptions, and a
     * source scan would pass on a guard that had been commented out or
     * inverted.
     */
    const { default: Page } = await import("@/app/(app)/dev/print-harness/page");
    const original = process.env.NODE_ENV;
    try {
      // @ts-expect-error NODE_ENV is readonly in the types, writable at runtime.
      process.env.NODE_ENV = "production";
      expect(() => Page()).toThrow(/NEXT_HTTP_ERROR_FALLBACK;404|NEXT_NOT_FOUND/);
    } finally {
      // @ts-expect-error restore
      process.env.NODE_ENV = original;
    }
    // And it still renders in development, or the harness would be useless.
    expect(() => Page()).not.toThrow();
  });

  it("it stays behind the ordinary auth shell — no new public path", async () => {
    // A harness is not worth widening the auth surface for.
    const proxy = await readFile(path.resolve("src/proxy.ts"), "utf8");
    expect(proxy).not.toMatch(/dev|harness/i);
  });

  it("no fixture attests a frozen signature, so it can never create a storage object", async () => {
    /**
     * `prescription-assets` deliberately has no DELETE policy. A harness that
     * froze a signature would leave a permanent artefact in the project that
     * also holds real clinical work.
     */
    const fixtures = await readFile(
      path.resolve("src/features/prescriptions/print-fixtures.ts"),
      "utf8",
    );
    const body = fixtures.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    expect(body).not.toMatch(/objectId|signature:\s*\{/);
  });

  it("it reads no database, no server action and no storage", async () => {
    const harness = await code("print-harness.tsx");
    for (const forbidden of ["supabase", "Action(", "fetch(", "createClient", "queries"]) {
      expect(harness.includes(forbidden), `print-harness.tsx must not use ${forbidden}`).toBe(
        false,
      );
    }
  });
});

describe("units", () => {
  it("print emits real millimetres and points", () => {
    expect(PHYSICAL_UNITS.mm(15)).toBe("15mm");
    expect(PHYSICAL_UNITS.pt(11)).toBe("11pt");
  });

  it("screen expresses the same lengths as shares of the paper's width", () => {
    const a4 = proportionalUnits(210);
    // 15mm of a 210mm sheet is 1/14th of its width.
    expect(a4.mm(15)).toBe(`${(15 / 210) * 100}cqw`);
    // A5 is narrower, so the same millimetre is a bigger share of it.
    expect(proportionalUnits(148).mm(15)).not.toBe(a4.mm(15));
  });

  it("scales type against the paper, not the viewport", () => {
    const a4 = proportionalUnits(210);
    const a5 = proportionalUnits(148);
    expect(parseFloat(a5.pt(11))).toBeGreaterThan(parseFloat(a4.pt(11)));
  });
});

describe("the printed page carries the prescription and nothing else", () => {
  it("hides everything by default rather than naming each piece of chrome", async () => {
    /**
     * Still hidden by default — but by REMOVING the boxes, not just the ink.
     *
     * The rule was `visibility: hidden`, which paints nothing and keeps every
     * box. The app shell is `min-h-dvh` with the whole page inside it, so a
     * 167mm prescription sat in a 416mm document and Chromium printed a second,
     * empty sheet. The doctor saw "Total: 2 sheets of paper" for three
     * medicines.
     *
     * `PrintPrescription` now portals the sheet to be a direct child of body,
     * which is what makes `display: none` on its siblings possible.
     */
    const css = await readFile(path.resolve("src/app/globals.css"), "utf8");
    const print = css.slice(css.indexOf("@media print"));

    expect(print).toMatch(/body > \*:not\(\[data-print-only\]\)\s*\{[^}]*display:\s*none/);
    /**
     * The default is still "nothing prints unless it IS the sheet" — and
     * comments are stripped first, because the rule's own explanation names
     * `visibility: hidden` in order to say why it is gone.
     */
    expect(print.replace(/\/\*[\s\S]*?\*\//g, "")).not.toMatch(/visibility:\s*hidden/);
  });

  it("the sheet is a direct child of body, or the rule above hides it too", async () => {
    const src = await readFile(
      path.resolve("src/features/prescriptions/components/print-prescription.tsx"),
      "utf8",
    );
    expect(src).toMatch(/createPortal\(/);
    expect(src).toMatch(/document\.body,/);
  });

  it("nothing else may contribute page height", async () => {
    const css = await readFile(path.resolve("src/app/globals.css"), "utf8");
    const print = css.slice(css.indexOf("@media print"));
    // A viewport minimum on html/body rounds a short prescription onto page 2.
    expect(print).toMatch(/html,\s*\n?\s*body\s*\{[^}]*min-height:\s*0/);
  });

  /**
   * A fixed element reserves no vertical space, so a repeated continuation
   * header could print on top of the doctor's name or a dose. It was removed;
   * this stops it coming back without the reserved-space problem being solved.
   */
  it("has no fixed overlay inside the printed document", async () => {
    const css = await readFile(path.resolve("src/app/globals.css"), "utf8");
    const print = css.slice(css.indexOf("@media print"));

    expect(print).not.toMatch(/\[data-print-continuation\]/);
    // The print root itself is positioned; nothing INSIDE it may be.
    expect(print).not.toMatch(/\[data-print-root\][^{]*\*[^{]*\{[^}]*position:\s*fixed/);
  });

  it("does not estimate a page count from element heights", async () => {
    /**
     * `break-inside`, orphans and widows, font metrics and printer scaling all
     * move the breaks. A number that is usually right is worse than no number,
     * because it gets believed.
     */
    const text = await code("print-prescription.tsx");
    expect(text).not.toMatch(/Math\.ceil\([^)]*height/i);
    expect(text).not.toMatch(/about \{?\w*[Pp]ages/);
  });

  it("keeps the digest and the app chrome off the paper", async () => {
    const finalized = await source("finalized-prescription.tsx");
    // The digest line is pilot diagnostics, not part of the document.
    expect(finalized).toMatch(/data-print-hidden[\s\S]{0,120}\{digest\}/);
  });

  it("never renders an internal id or a signed URL inside the sheet", async () => {
    const parts = await code("prescription-parts.tsx");
    expect(parts).not.toMatch(/prescriptionId|\bdigest\b|signedUrl/);
    /**
     * The signature URL may be passed as a prop and set as an `<img src>` —
     * that is delivery. What it must never be is a TEXT CHILD, which would put
     * a temporary signed link on a permanent prescription.
     */
    expect(parts).not.toMatch(/>[^<]*\{signatureUrl\}/);
  });
});
