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
  correctionUiEligible,
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
  /** Presentation policy only; authoritative correction enforcement belongs to MD. */
  correctionUiEligible: boolean;
  digest: string;
  bundle: ReviewBundle;
  lineage: PrescriptionLineage | null;
  lineageUnavailable: boolean;
  /** A validated current-consultation path when this Rx was opened from history. */
  returnTo?: string | null;
}) {
  const render = React.useMemo(() => toPrescriptionView(bundle), [bundle]);
  const view = render.ok ? render.view : null;
  const [signatureUrl, setSignatureUrl] = React.useState<string | null>(null);
  const frozen = view?.signature.kind === "frozen";
  const digestClass =
    "mx-auto mt-4 min-w-0 max-w-[820px] break-all font-mono text-[11px] text-ink-muted";

  React.useEffect(() => {
    if (!frozen) return;
    let cancelled = false;
    void frozenSignatureUrlAction(prescriptionId).then((r) => {
      if (!cancelled) setSignatureUrl(r.ok ? r.url : null);
    });
    return () => {
      cancelled = true;
    };
  }, [frozen, prescriptionId]);

  if (!render.ok) {
    return (
      <div className="min-w-0 pb-2">
        <UnsupportedSnapshot found={render.found} />
      </div>
    );
  }
  const doc = render.view;
  const backHref = returnTo ?? (viewerIsOwner ? `/consultation/${encounterId}` : "/queue");
  const backLabel = returnTo
    ? "Return to current consultation"
    : viewerIsOwner
      ? "Back to the consultation"
      : "Back to the queue";
  const showCorrectionAction = viewerIsOwner && !lineage?.replacedBy && correctionUiEligible;
  const showHistoricalReadOnly = viewerIsOwner && !lineage?.replacedBy && !correctionUiEligible;

  return (
    <div className="min-w-0 overflow-x-clip pb-2">
      <div className="mx-auto flex min-w-0 max-w-[820px] flex-col gap-3">
        <Link
          href={backHref}
          className="inline-flex min-h-11 items-center gap-1.5 self-start text-[13px] font-semibold text-ink-secondary hover:text-ink focus-visible:focus-ring"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          {backLabel}
        </Link>

        <p
          role="status"
          className="dd-material-panel dd-panel-pearl dd-panel-rim flex min-w-0 items-start gap-2 rounded-glass border-l-4 border-l-success px-4 py-3 text-[13px] text-ink-secondary"
        >
          <Lock className="mt-px size-4 shrink-0 text-success" aria-hidden="true" />
          <span className="min-w-0 break-words">
            <strong className="font-semibold text-ink">Approved.</strong>{" "}
            {viewerIsOwner ? (
              <>
                This prescription is part of the patient&rsquo;s clinical record
                {finalizedAt ? ` as of ${formatDate(finalizedAt.slice(0, 10))}` : ""} and cannot be
                edited. A correction is a new prescription.
              </>
            ) : (
              <>
                Signed by the doctor
                {finalizedAt ? ` on ${formatDate(finalizedAt.slice(0, 10))}` : ""}
                {lineage?.replacedBy
                  ? ". It cannot be edited here — see the note below before giving the patient anything."
                  : " and ready to give to the patient. It cannot be edited here."}
              </>
            )}
          </span>
        </p>

        <CorrectionLineage lineage={lineage} unavailable={lineageUnavailable} />

        {showHistoricalReadOnly ? (
          <p
            data-print-hidden
            role="status"
            className="dd-material-record dd-record-pearl flex min-w-0 items-start gap-2 rounded-glass px-4 py-3 text-[13px] text-ink-secondary"
          >
            <Lock className="mt-px size-4 shrink-0 text-ink-muted" aria-hidden="true" />
            <span>
              <strong className="font-semibold text-ink">Historical prescription.</strong>{" "}
              The normal correction action is no longer offered after 48 hours. This finalized
              prescription remains read-only; return to the current consultation workflow if the
              patient needs a new prescription.
            </span>
          </p>
        ) : null}

        <div className="flex min-w-0 flex-col items-stretch gap-2 sm:flex-row sm:items-start sm:gap-3">
          <PrintPrescription prescriptionId={prescriptionId} view={doc} />
          {showCorrectionAction ? <WriteCorrection prescriptionId={prescriptionId} /> : null}
        </div>
      </div>

      <ReviewSheet
        className="mt-5"
        view={doc}
        signatureUrl={frozen ? signatureUrl : null}
      />

      {viewerIsOwner ? (
        <p data-print-hidden className={digestClass}>{digest}</p>
      ) : null}
    </div>
  );
}
