import * as React from "react";
import { cn } from "@/lib/utils";
import { PAPER_MM } from "@/features/doctor/schema";
import type { PrescriptionView } from "../prescription-view";
import { PrescriptionDocument } from "./prescription-document";
import { proportionalUnits } from "./prescription-parts";

/**
 * The prescription, on screen.
 *
 * A true-proportion preview: the box holds the paper's aspect ratio and
 * everything inside is sized from the paper's own width, so a 15 mm margin is
 * 15 mm OF THIS PAPER whether it renders on a phone or a desktop column.
 * Sizing in fixed pixels would show the doctor a layout that is not the one
 * that prints.
 *
 * This is a PREVIEW, and its fixed ratio is why it cannot be the print
 * renderer: content longer than one page has nowhere to flow. `PrintSheet`
 * handles paper.
 *
 * The container-query trap this already hit once (Phase 2.6): `cqw` resolves
 * against the nearest ANCESTOR container, so the element carrying
 * `container-type` must not be the one consuming `cqw`. Hence the wrapper.
 *
 * Every clinical mark comes from `PrescriptionDocument`. This file decides
 * nothing about content.
 */
export function ReviewSheet({
  view,
  signatureUrl,
  className,
}: {
  view: PrescriptionView;
  /** Short-lived, never stored. Absent until the signature is frozen. */
  signatureUrl?: string | null;
  className?: string;
}) {
  const paper = PAPER_MM[view.paperSize];
  const u = proportionalUnits(paper.w);

  /**
   * The paper at its TRUE SIZE, centred.
   *
   * It used to take whatever width the column gave it — 1217px for A4 inside
   * the workspace, half again as large as the real sheet. A prescription blown
   * up to 1.5× is not a prescription you can judge: the doctor scrolls a
   * document that will never look like that on paper, and the proportions they
   * are approving are the one thing this preview exists to show.
   *
   * 96dpi is the CSS reference pixel, so this is A4 as A4. `w-full` keeps it
   * responsive below that — narrower is fine and still exact, because every
   * length inside is a share of this width.
   */
  const truePaperWidthPx = (paper.w / 25.4) * 96;

  return (
    <div
      className={cn("@container mx-auto w-full", className)}
      style={{ maxWidth: `${truePaperWidthPx}px` }}
    >
      <div
        data-review-sheet
        /*
          A FLEX COLUMN, exactly like the print sheet.

          The aspect ratio already gave this box a real page's height, but the
          document inside simply stacked from the top — so a three-medicine
          prescription put the signature and footer around the middle of the
          paper with a large dead area beneath, and the review preview was
          therefore NOT the composition that printed. The column lets
          `MedicineList` take the slack, the same way it does on paper.
        */
        className="flex flex-col bg-white text-ink shadow-soft ring-1 ring-hairline"
        style={{
          aspectRatio: `${paper.w} / ${paper.h}`,
          padding: u.mm(view.marginMm),
          fontSize: u.pt(view.baseFontPt),
          lineHeight: 1.45,
        }}
      >
        <PrescriptionDocument view={view} u={u} signatureUrl={signatureUrl} />
      </div>
    </div>
  );
}
