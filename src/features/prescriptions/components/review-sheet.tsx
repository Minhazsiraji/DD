import * as React from "react";
import { cn } from "@/lib/utils";
import { PAPER_MM } from "@/features/doctor/schema";
import type { PrescriptionView } from "../prescription-view";
import { PrescriptionDocument } from "./prescription-document";
import { proportionalUnits } from "./prescription-parts";

export function ReviewSheet({
  view,
  signatureUrl,
  clinicLogoUrl,
  className,
}: {
  view: PrescriptionView;
  signatureUrl?: string | null;
  clinicLogoUrl?: string | null;
  className?: string;
}) {
  const paper = PAPER_MM[view.paperSize];
  const u = proportionalUnits(paper.w);
  const truePaperWidthPx = (paper.w / 25.4) * 96;

  return (
    <div
      data-mobile-prescription-preview
      className={cn("@container mx-auto min-w-0 w-full max-w-full overflow-x-auto overscroll-x-contain", className)}
      style={{ maxWidth: `${truePaperWidthPx}px` }}
    >
      <div
        data-review-sheet
        className="flex flex-col min-w-0 w-full bg-white text-ink shadow-soft ring-1 ring-hairline"
        style={{
          aspectRatio: `${paper.w} / ${paper.h}`,
          padding: u.mm(view.marginMm),
          fontSize: u.pt(view.baseFontPt),
          lineHeight: 1.45,
        }}
      >
        <PrescriptionDocument
          view={view}
          u={u}
          signatureUrl={signatureUrl}
          clinicLogoUrl={clinicLogoUrl}
        />
      </div>
    </div>
  );
}
