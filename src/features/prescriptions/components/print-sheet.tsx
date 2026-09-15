import * as React from "react";
import { PAPER_MM } from "@/features/doctor/schema";
import type { PrescriptionView } from "../prescription-view";
import { PrescriptionDocument } from "./prescription-document";
import { PHYSICAL_UNITS } from "./prescription-parts";

/**
 * The prescription, on paper — across as many pages as it takes.
 *
 * Physical units remain authoritative. `clinicLogoUrl` and `signatureUrl` are
 * short-lived URLs for assets whose immutable paths are already attested by the
 * approved bundle; URLs themselves are never stored in the prescription.
 */
export function PrintSheet({
  view,
  signatureUrl,
  clinicLogoUrl,
}: {
  view: PrescriptionView;
  signatureUrl?: string | null;
  clinicLogoUrl?: string | null;
}) {
  const paper = PAPER_MM[view.paperSize];
  const contentWidthMm = paper.w - view.marginMm * 2;
  const pageContentHeightMm = paper.h - view.marginMm * 2 - 1;

  return (
    <>
      <style>{`@page { size: ${paper.w}mm ${paper.h}mm; margin: ${view.marginMm}mm; }`}</style>
      <div
        data-print-root
        data-paper={view.paperSize}
        data-margin-mm={view.marginMm}
        className="flex flex-col bg-white text-ink"
        style={
          {
            width: `${contentWidthMm}mm`,
            fontSize: `${view.baseFontPt}pt`,
            lineHeight: 1.45,
            "--page-content-height": `${pageContentHeightMm}mm`,
          } as React.CSSProperties
        }
      >
        <PrescriptionDocument
          view={view}
          u={PHYSICAL_UNITS}
          signatureUrl={signatureUrl}
          clinicLogoUrl={clinicLogoUrl}
        />
      </div>
    </>
  );
}
