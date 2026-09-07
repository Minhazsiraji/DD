import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(path.resolve(file), "utf8");

describe("prescription native print-media contract", () => {
  it("keeps the laid-out print portal at page origin instead of an off-page paint layer", () => {
    const css = read("src/app/globals.css");
    const screenRule = css.match(/\[data-print-only\]\s*\{([\s\S]*?)\}/)?.[1] ?? "";
    expect(screenRule).toContain("position: absolute");
    expect(screenRule).toContain("left: 0");
    expect(screenRule).toContain("top: 0");
    expect(screenRule).toContain("visibility: hidden");
    expect(screenRule).not.toMatch(/left:\s*-\d/);
  });

  it("stages the actual prescription as a visible page-origin paint tree before window.print", () => {
    const action = read("src/features/prescriptions/components/print-prescription.tsx");
    expect(action).toContain('data-prescription-printing="true"');
    expect(action).toContain('body[data-prescription-printing="true"] > *:not([data-print-only])');
    expect(action).toMatch(
      /body\[data-prescription-printing="true"\] > \[data-print-only\][\s\S]*?position:\s*static\s*!important/,
    );
    expect(action).toMatch(
      /body\[data-prescription-printing="true"\] > \[data-print-only\][\s\S]*?visibility:\s*visible\s*!important/,
    );
    expect(action).toContain('body.setAttribute("data-prescription-printing", "true")');
    expect(action).toContain("window.requestAnimationFrame(() => {");
    expect(action.match(/window\.requestAnimationFrame\(\(\) => \{/g)).toHaveLength(2);
    expect(action.indexOf('body.setAttribute("data-prescription-printing", "true")')).toBeLessThan(
      action.indexOf("window.print()"),
    );
    expect(action).toContain('window.addEventListener("afterprint", cleanup');
  });

  it("fully restores the portal to printable paint state under print media", () => {
    const css = read("src/app/globals.css");
    expect(css).toContain("body > *:not([data-print-only])");
    expect(css).toContain("display: none !important");
    const printStart = css.indexOf("@media print");
    const printCss = css.slice(printStart);
    expect(printCss).toMatch(/\[data-print-only\][\s\S]*?position:\s*static\s*!important/);
    expect(printCss).toMatch(/\[data-print-only\][\s\S]*?left:\s*auto\s*!important/);
    expect(printCss).toMatch(/\[data-print-only\][\s\S]*?top:\s*auto\s*!important/);
    expect(printCss).toMatch(/\[data-print-only\][\s\S]*?visibility:\s*visible\s*!important/);
  });

  it("keeps a direct-body portal and a real white text document rather than a raster substitute", () => {
    const action = read("src/features/prescriptions/components/print-prescription.tsx");
    const sheet = read("src/features/prescriptions/components/print-sheet.tsx");
    expect(action).toContain("createPortal(");
    expect(action).toContain("document.body");
    expect(action).toContain("data-print-only");
    expect(sheet).toContain("data-print-root");
    expect(sheet).toContain('className="flex flex-col bg-white text-ink"');
    expect(sheet).toContain("<PrescriptionDocument");
    expect(sheet).not.toMatch(/canvas|toDataURL|screenshot/i);
  });
});
