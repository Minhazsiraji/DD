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

/**
 * An approved prescription — the permanent record.
 *
 * Rendered entirely from the immutable snapshot the doctor approved, through
 * the same view model and the same sheet the review used. One renderer, so the
 * record cannot look different from the thing that was signed; and Stage 7C-3's
 * print output will read from this same model rather than a second one.
 *
 * No editing controls of any kind, and no approval control — not disabled,
 * absent. There is nothing left to approve.
 */
export function FinalizedPrescription({
  prescriptionId,
  encounterId,
  viewerIsOwner,
  finalizedAt,
  digest,
  bundle,
  lineage,
  lineageUnavailable,
}: {
  prescriptionId: string;
  encounterId: string;
  /**
   * As the DATABASE answered, not as the session's roles claim. It chooses
   * chrome and nothing else — every clinical field below comes from the same
   * immutable snapshot either way, which is what makes the doctor's print and
   * the front desk's print the same document.
   */
  viewerIsOwner: boolean;
  finalizedAt: string | null;
  digest: string;
  bundle: ReviewBundle;
  /**
   * Correction history. Null when the read failed — which is shown as "we could
   * not check", never as "there is no correction". Those are different things
   * to say to someone about to hand a prescription to a patient.
   */
  lineage: PrescriptionLineage | null;
  lineageUnavailable: boolean;
}) {
  const render = React.useMemo(() => toPrescriptionView(bundle), [bundle]);
  const view = render.ok ? render.view : null;
  const [signatureUrl, setSignatureUrl] = React.useState<string | null>(null);
  const frozen = view?.signature.kind === "frozen";

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

  return (
    <div className="min-w-0 overflow-x-clip pb-2">
      <div className="mx-auto flex min-w-0 max-w-[820px] flex-col gap-3">
        <Link
          href={viewerIsOwner ? `/consultation/${encounterId}` : "/queue"}
          className="inline-flex min-h-11 items-center gap-1.5 self-start text-[13px] font-semibold text-ink-secondary hover:text-ink focus-visible:focus-ring"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          {viewerIsOwner ? "Back to the consultation" : "Back to the queue"}
        </Link>

        <p
          role="status"
          className="clinical-surface flex min-w-0 items-start gap-2 rounded-glass border-l-4 border-l-success px-4 py-3 text-[13px] text-ink-secondary"
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

        {/* On a phone these are two deliberate, full-width actions rather than a squeezed row. */}
        <div className="flex min-w-0 flex-col items-stretch gap-2 sm:flex-row sm:items-start sm:gap-3">
          <PrintPrescription prescriptionId={prescriptionId} view={doc} />
          {viewerIsOwner && !lineage?.replacedBy ? (
            <WriteCorrection prescriptionId={prescriptionId} />
          ) : null}
        </div>
      </div>

      {/* The preview stays inside the page; only the print portal uses physical paper dimensions. */}
      <div className="mt-5 min-w-0 overflow-hidden rounded-glass bg-surface-muted px-2 py-4 sm:px-6 sm:py-8">
        <ReviewSheet view={doc} signatureUrl={frozen ? signatureUrl : null} />
      </div>

      {viewerIsOwner ? (
        <p
          data-print-hidden
          className="mx-auto mt-4 min-w-0 max-w-[820px] font-mono text-[11px] break-all text-ink-muted"
        >
          {digest}
        </p>
      ) : null}
    </div>
  );
}
