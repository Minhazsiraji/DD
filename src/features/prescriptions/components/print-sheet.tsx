import * as React from "react";
import { PAPER_MM } from "@/features/doctor/schema";
import type { ReviewView } from "../review-view";
import { PHYSICAL_UNITS, PrescriptionDocument } from "./prescription-parts";

/**
 * The prescription, on paper.
 *
 * Real millimetres and real points, because paper is actually that size. No
 * container queries: `cqw` resolves against a container's computed width, which
 * on paper is a number we would be inferring rather than stating. No aspect
 * ratio either — that is what makes the screen preview a preview, and it is
 * exactly what content must be able to overflow so we can MEASURE the overflow
 * and refuse rather than clip.
 *
 * `@page` is emitted per prescription because the paper size comes from the
 * approved snapshot. A5 stays A5; nothing here silently promotes it to A4.
 *
 * WHAT WE CONTROL AND WHAT WE DO NOT
 *
 * `@page { size }` sets the page box the browser lays out against, and Chromium
 * honours it in the print preview. It does NOT control the printer's own
 * hardware margins, nor a "fit to page"/scaling option chosen in the print
 * dialog, nor the paper actually loaded in the tray. Those are the driver's,
 * and no CSS reaches them — which is why a physical printer test stays on the
 * pilot checklist.
 *
 * `margin: 0` on the page box on purpose: the template's own margin is applied
 * inside the sheet, so the approved layout owns its whitespace rather than
 * having the browser's default 0.4in added on top of it.
 */
export function PrintSheet({
  view,
  signatureUrl,
}: {
  view: ReviewView;
  signatureUrl?: string | null;
}) {
  const paper = PAPER_MM[view.paperSize];

  return (
    <>
      <style>{`@page { size: ${paper.w}mm ${paper.h}mm; margin: 0; }`}</style>
      <div
        data-print-root
        data-paper={view.paperSize}
        className="bg-white text-ink"
        style={{
          width: `${paper.w}mm`,
          // The page's height, so overflow past one page is measurable rather
          // than merely invisible. 7C-3B replaces this with real pagination.
          height: `${paper.h}mm`,
          padding: `${view.marginMm}mm`,
          fontSize: `${view.baseFontPt}pt`,
          lineHeight: 1.45,
          boxSizing: "border-box",
          overflow: "hidden",
        }}
      >
        <PrescriptionDocument view={view} u={PHYSICAL_UNITS} signatureUrl={signatureUrl} />
      </div>
    </>
  );
}
