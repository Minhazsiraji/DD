import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// These assertions match multi-line source fragments with "\n" literals. On a
// CRLF working tree (Windows, core.autocrlf=true) the file bytes use "\r\n" and
// the literals would not match. Canonicalise the line-ending representation at
// the read boundary; content is otherwise untouched, so a real structural
// change still fails the assertion on either checkout.
const read = (file: string) =>
  readFileSync(path.resolve(file), "utf8").replace(/\r\n/g, "\n");

describe("M2 prescription paper hierarchy", () => {
  it("renders the finalized white paper directly on the application page", () => {
    const finalized = read("src/features/prescriptions/components/finalized-prescription.tsx");
    expect(finalized).toContain('<ReviewSheet\n        className="mt-5"');
    expect(finalized).not.toContain(
      "mt-5 min-w-0 overflow-hidden rounded-glass bg-surface-muted px-2 py-4 sm:px-6 sm:py-8",
    );
  });

  it("keeps ReviewSheet responsive without turning its outer wrapper into a card", () => {
    const review = read("src/features/prescriptions/components/review-sheet.tsx");
    const outer = review.slice(review.indexOf("data-mobile-prescription-preview"), review.indexOf("data-review-sheet"));
    expect(outer).toContain("mx-auto");
    expect(outer).not.toMatch(/bg-|rounded|glass|dd-material|dd-panel/);
    expect(review).toContain('data-review-sheet\n        className="flex flex-col min-w-0 w-full bg-white');
  });

  it("leaves the draft review consumer free of decorative paper framing", () => {
    const screen = read("src/features/prescriptions/components/review-screen.tsx");
    const start = screen.indexOf('<div className={cn("transition-opacity"');
    const preview = screen.slice(start, screen.indexOf("</div>", start) + 6);
    expect(preview).toContain("<ReviewSheet");
    expect(preview).not.toMatch(/bg-|rounded|glass|dd-material|dd-panel/);
  });
});
