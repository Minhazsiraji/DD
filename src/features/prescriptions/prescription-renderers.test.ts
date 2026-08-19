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
     * The previous rule listed the elements to hide, so every new banner or
     * button was one forgotten attribute away from being printed on a clinical
     * document — and the sidebar already was.
     */
    const css = await readFile(path.resolve("src/app/globals.css"), "utf8");
    const print = css.slice(css.indexOf("@media print"));

    expect(print).toMatch(/body \*\s*\{[^}]*visibility:\s*hidden/);
    expect(print).toMatch(/\[data-print-only\][^{]*\{[^}]*visibility:\s*visible/);
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
