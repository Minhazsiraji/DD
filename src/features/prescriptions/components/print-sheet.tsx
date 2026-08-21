import * as React from "react";
import { PAPER_MM } from "@/features/doctor/schema";
import type { ReviewView } from "../review-view";
import { PHYSICAL_UNITS, PrescriptionDocument } from "./prescription-parts";

/**
 * The prescription, on paper — across as many pages as it takes.
 *
 * Stage 7C-3A made this physical; 7C-3B makes it FLOW. The change is small and
 * the reasoning is not: the sheet no longer has a page's height, so content
 * longer than one page is fragmented by the browser instead of being measured
 * and refused. Nothing shrinks, nothing is dropped.
 *
 * WHERE THE MARGIN LIVES, AND WHY IT MOVED
 *
 * It used to be padding on this element. That is correct for one page and
 * wrong for several: padding applies once, at the start and end of the whole
 * flow, so pages 2..n would have printed edge-to-edge with no top or bottom
 * margin at all. The margin now belongs to `@page`, which applies it to EVERY
 * page, and this element is sized to exactly the resulting content width.
 *
 * The doctor's approved margin is still the only margin. A prescription
 * approved on A5 at 40 mm paginates into more pages rather than quietly
 * printing at 20 mm to save one — the output adapts around the approved
 * document, never the other way round.
 *
 * WHAT WE CONTROL AND WHAT WE DO NOT
 *
 * `@page` sets the page box the browser lays out against. It does not control
 * the printer's hardware margins, a "fit to page" scaling chosen in the print
 * dialog, or the paper actually in the tray. A physical printer test stays on
 * the pilot checklist.
 */
export function PrintSheet({
  view,
  signatureUrl,
}: {
  view: ReviewView;
  signatureUrl?: string | null;
}) {
  const paper = PAPER_MM[view.paperSize];
  /** The page's content box, once the approved margin is taken off both sides. */
  const contentWidthMm = paper.w - view.marginMm * 2;
  /**
   * The height of ONE page's content box.
   *
   * Used only to let a short prescription fill the page so the signature can
   * settle near the bottom, the way a prescription pad looks. A hair under the
   * true height on purpose: exactly one page's worth, plus any rounding
   * anywhere in the box model, is what produces a second, empty sheet — and a
   * blank page is a worse fault than a signature sitting high.
   */
  const pageContentHeightMm = paper.h - view.marginMm * 2 - 1;

  return (
    <>
      <style>{`@page { size: ${paper.w}mm ${paper.h}mm; margin: ${view.marginMm}mm; }`}</style>
      <div
        data-print-root
        data-paper={view.paperSize}
        data-margin-mm={view.marginMm}
        /*
          The flex column that lets `MedicineList` absorb a short prescription's
          leftover height, settling signature and footer at the foot of the
          page. Declared HERE rather than in the print stylesheet so the review
          preview composes identically — the rule being print-only is precisely
          why review and paper disagreed.
        */
        className="flex flex-col bg-white text-ink"
        style={
          {
            width: `${contentWidthMm}mm`,
            // No height and no overflow rule: the flow is the point.
            fontSize: `${view.baseFontPt}pt`,
            lineHeight: 1.45,
            // Read by the print stylesheet; ignored entirely on screen.
            "--page-content-height": `${pageContentHeightMm}mm`,
          } as React.CSSProperties
        }
      >
        <PrescriptionDocument view={view} u={PHYSICAL_UNITS} signatureUrl={signatureUrl} />
      </div>
    </>
  );
}

