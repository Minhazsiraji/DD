"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, Lock } from "lucide-react";
import { formatDate } from "@/lib/format";
import { frozenSignatureUrlAction } from "../actions";
import type { PrescriptionLineage } from "../queries";
import type { ReviewBundle } from "../review-bundle";
import { toPrescriptionView } from "../prescription-view";
import { CorrectionLineage } from "./correction-banner";
import { PrintPrescription } from "./print-prescription";
import { ReviewSheet } from "./review-sheet";
import { UnsupportedSnapshot } from "./unsupported-snapshot";
import { WriteCorrection } from "./write-correction";

export function FinalizedPrescription({
  prescriptionId,
  encounterId,
  viewerIsOwner,
  finalizedAt,
  digest,
  bundle,
  lineage,
  lineageUnavailable,
  returnTo,
}: {
  prescriptionId: string;
  encounterId: string;
  viewerIsOwner: boolean;
  finalizedAt: string | null;
  digest: string;
  bundle: ReviewBundle;
  lineage: PrescriptionLineage | null;
  lineageUnavailable: boolean;
  returnTo?: string | null;
}) {
  const render = React.useMemo(() => toPrescriptionView(bundle), [bundle]);
  const view = render.ok ? render.view : null;
  const [signatureUrl, setSignatureUrl] = React.useState<string | null>(null);
  const frozen = view?.signature.kind === "frozen";
  const digestClass = "mx-auto mt-4 min-w-0 max-w-[820px] break-all font-mono text-[10px] text-ink-muted";

  React.useEffect(() => {
    if (!frozen) return;
    let cancelled = false;
    void frozenSignatureUrlAction(prescriptionId).then((r) => {
      if (!cancelled) setSignatureUrl(r.ok ? r.url : null);
    });
    return () => { cancelled = true; };
  }, [frozen, prescriptionId]);

  if (!render.ok) {
    return <div className="min-w-0 pb-2"><UnsupportedSnapshot found={render.found} /></div>;
  }

  const doc = render.view;
  const backHref = returnTo ?? (viewerIsOwner ? `/consultation/${encounterId}` : "/queue");
  const backLabel = returnTo ? "Return to current consultation" : viewerIsOwner ? "Back to the consultation" : "Back to the queue";

  return (
    <div className="min-w-0 overflow-x-clip pb-2">
      <div className="mx-auto flex min-w-0 max-w-[820px] flex-col gap-3">
        <Link href={backHref} className="dd-secondary inline-flex h-9 items-center gap-1.5 self-start rounded-full px-3 text-[11.5px] font-semibold text-ink-secondary focus-visible:focus-ring">
          <ArrowLeft className="size-3.5" aria-hidden="true" />
          {backLabel}
        </Link>

        <p role="status" className="clinical-surface flex min-w-0 items-start gap-2 rounded-[16px] border-l-4 border-l-success px-3.5 py-2.5 text-[12px] text-ink-secondary">
          <Lock className="mt-px size-3.5 shrink-0 text-success" aria-hidden="true" />
          <span className="min-w-0 break-words">
            <strong className="font-semibold text-ink">Finalized · Locked.</strong>{" "}
            {viewerIsOwner ? (
              <>This prescription is part of the patient&rsquo;s clinical record{finalizedAt ? ` as of ${formatDate(finalizedAt.slice(0, 10))}` : ""} and cannot be edited. A correction is a new prescription.</>
            ) : (
              <>Signed by the doctor{finalizedAt ? ` on ${formatDate(finalizedAt.slice(0, 10))}` : ""}{lineage?.replacedBy ? ". It cannot be edited here — see the note below before giving the patient anything." : " and ready to give to the patient. It cannot be edited here."}</>
            )}
          </span>
        </p>

        <CorrectionLineage lineage={lineage} unavailable={lineageUnavailable} />

        <div className="flex min-w-0 flex-col items-stretch gap-2 sm:flex-row sm:items-start sm:gap-3">
          <PrintPrescription prescriptionId={prescriptionId} view={doc} />
          {viewerIsOwner && !lineage?.replacedBy ? <WriteCorrection prescriptionId={prescriptionId} /> : null}
        </div>
      </div>

      <div className="dd-finalized-sheet mx-auto mt-5 min-w-0 max-w-[920px] overflow-hidden rounded-[18px] px-2 py-4 sm:px-5 sm:py-6">
        <ReviewSheet view={doc} signatureUrl={frozen ? signatureUrl : null} />
      </div>

      {viewerIsOwner ? <p data-print-hidden className={digestClass}>{digest}</p> : null}
    </div>
  );
}
