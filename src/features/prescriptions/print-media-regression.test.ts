import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(path.resolve(file), "utf8");

describe("prescription native print-media contract", () => {
  it("keeps the proven direct-body printable document and does not add a second print path", () => {
    const action = read("src/features/prescriptions/components/print-prescription.tsx");
    expect(action).toContain("createPortal(");
    expect(action).toContain("document.body");
    expect(action).toContain("data-print-only");
    expect(action).toContain("window.print()");
    expect(action).not.toContain("data-prescription-printing");
    expect(action).not.toContain("requestAnimationFrame");
  });

  it("keeps the screen copy laid out and restores it to normal flow for print", () => {
    const css = read("src/app/globals.css");
    const screenRule = css.match(/\[data-print-only\]\s*\{([\s\S]*?)\}/)?.[1] ?? "";
    expect(screenRule).toContain("position: absolute");
    expect(screenRule).toContain("left: -10000px");
    expect(screenRule).toContain("pointer-events: none");

    const printStart = css.indexOf("@media print");
    const printCss = css.slice(printStart);
    expect(printCss).toContain("body > *:not([data-print-only])");
    expect(printCss).toContain("display: none !important");
    expect(printCss).toMatch(/\[data-print-only\][\s\S]*?position:\s*static\s*!important/);
  });

  it("neutralizes the later DD organ/canvas compositing layer under print media", () => {
    const background = read("src/app/global-background-test.css");
    const printStart = background.indexOf("@media print");
    expect(printStart).toBeGreaterThan(-1);
    const printCss = background.slice(printStart);
    expect(printCss).toMatch(/html,[\s\S]*?body[\s\S]*?background:\s*#ffffff\s*!important/);
    expect(printCss).toMatch(/body\s*\{[\s\S]*?position:\s*static\s*!important/);
    expect(printCss).toMatch(/body\s*\{[\s\S]*?isolation:\s*auto\s*!important/);
    expect(printCss).toMatch(/body::before\s*\{[\s\S]*?content:\s*none\s*!important/);
    expect(printCss).toMatch(/body::before\s*\{[\s\S]*?display:\s*none\s*!important/);
    expect(printCss).toMatch(/body > \[data-print-only\][\s\S]*?z-index:\s*auto\s*!important/);
  });

  it("keeps a real white selectable prescription rather than a raster substitute", () => {
    const sheet = read("src/features/prescriptions/components/print-sheet.tsx");
    expect(sheet).toContain("data-print-root");
    expect(sheet).toContain('className="flex flex-col bg-white text-ink"');
    expect(sheet).toContain("<PrescriptionDocument");
    expect(sheet).not.toMatch(/canvas|toDataURL|screenshot/i);
  });
});
