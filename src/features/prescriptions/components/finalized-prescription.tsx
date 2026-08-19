"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, Lock } from "lucide-react";
import { formatDate } from "@/lib/format";
import { frozenSignatureUrlAction } from "../actions";
import type { PrescriptionLineage } from "../queries";
import type { ReviewBundle } from "../review-bundle";
import { toReviewView } from "../review-view";
import { CorrectionLineage } from "./correction-banner";
import { PrintPrescription } from "./print-prescription";
import { ReviewSheet } from "./review-sheet";
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
  const view = React.useMemo(() => toReviewView(bundle), [bundle]);
  const [signatureUrl, setSignatureUrl] = React.useState<string | null>(null);
  const frozen = view.signature.kind === "frozen";

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

  return (
    <div className="space-y-4 pb-2">
      {/*
        Where "back" goes depends on where the reader came from, and reception
        cannot open a consultation. Offering them the link anyway would be a
        dead end that reads as a permissions error — and pointing staff at a
        clinical route is exactly the habit this stage is meant to break.
      */}
      <Link
        href={viewerIsOwner ? `/consultation/${encounterId}` : "/queue"}
        className="inline-flex h-11 items-center gap-1.5 text-[13px] font-semibold text-ink-secondary hover:text-ink focus-visible:focus-ring"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        {viewerIsOwner ? "Back to the consultation" : "Back to the queue"}
      </Link>

      <p
        role="status"
        className="clinical-surface flex items-start gap-2 rounded-glass border-l-4 border-l-success px-4 py-3 text-[13px] text-ink-secondary"
      >
        <Lock className="mt-px size-4 shrink-0 text-success" aria-hidden="true" />
        <span>
          <strong className="font-semibold text-ink">Approved.</strong>{" "}
          {viewerIsOwner ? (
            <>
              This prescription is part of the patient&rsquo;s clinical record
              {finalizedAt ? ` as of ${formatDate(finalizedAt.slice(0, 10))}` : ""} and cannot be
              edited. A correction is a new prescription.
            </>
          ) : (
            /*
              The front desk needs to know two things: it is safe to hand over,
              and it is not theirs to change. Not "a correction is a new
              prescription" — that is an instruction for someone who can write
              one.

              And NOT "ready to give to the patient" once a correction exists.
              Found by reading the screen as reception: this line sat directly
              above "do not hand this one over", and a person scanning two
              banners for an instruction should never have to decide which of
              two contradictions to believe.
            */
            <>
              Signed by the doctor
              {finalizedAt ? ` on ${formatDate(finalizedAt.slice(0, 10))}` : ""}
              {lineage?.replacedBy ?
                ". It cannot be edited here — see the note below before giving the patient anything."
              : " and ready to give to the patient. It cannot be edited here."}
            </>
          )}
        </span>
      </p>

      {/*
        Correction history sits ABOVE the sheet and outside it. Above, because
        "do not hand this one over" is useless after someone has read the
        medicines and pressed Print. Outside, because the paper must reproduce
        exactly as approved — see `correction-banner.tsx`.
      */}
      <CorrectionLineage lineage={lineage} unavailable={lineageUnavailable} />

      <ReviewSheet view={view} signatureUrl={frozen ? signatureUrl : null} />

      <PrintPrescription prescriptionId={prescriptionId} view={view} />

      {/*
        Offered only to the owning doctor, and only while this prescription is
        still the current one. Once it has been corrected the banner above
        already points at the replacement, and a second "write a correction"
        control there would be offering to correct a superseded sheet.
      */}
      {viewerIsOwner && !lineage?.replacedBy ? (
        <WriteCorrection prescriptionId={prescriptionId} encounterId={encounterId} />
      ) : null}

      {/*
        Shown during the pilot so a reported problem can be checked against the
        record rather than taken on trust. It is the digest the doctor approved
        and the one stored with the prescription — and it is chrome, so it is
        marked as never printing.

        Doctor only: it is a diagnostic for whoever owns the record, and it is
        nothing the front desk can act on.
      */}
      {viewerIsOwner ? (
        <p data-print-hidden className="font-mono text-[11px] break-all text-ink-muted">
          {digest}
        </p>
      ) : null}
    </div>
  );
}
