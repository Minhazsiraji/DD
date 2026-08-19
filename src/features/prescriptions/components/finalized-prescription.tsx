"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, Lock } from "lucide-react";
import { formatDate } from "@/lib/format";
import { frozenSignatureUrlAction } from "../actions";
import type { ReviewBundle } from "../review-bundle";
import { toReviewView } from "../review-view";
import { PrintPrescription } from "./print-prescription";
import { ReviewSheet } from "./review-sheet";

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
  finalizedAt,
  digest,
  bundle,
}: {
  prescriptionId: string;
  encounterId: string;
  finalizedAt: string | null;
  digest: string;
  bundle: ReviewBundle;
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
      <Link
        href={`/consultation/${encounterId}`}
        className="inline-flex h-11 items-center gap-1.5 text-[13px] font-semibold text-ink-secondary hover:text-ink focus-visible:focus-ring"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Back to the consultation
      </Link>

      <p
        role="status"
        className="clinical-surface flex items-start gap-2 rounded-glass border-l-4 border-l-success px-4 py-3 text-[13px] text-ink-secondary"
      >
        <Lock className="mt-px size-4 shrink-0 text-success" aria-hidden="true" />
        <span>
          <strong className="font-semibold text-ink">Approved.</strong> This prescription is part of
          the patient&rsquo;s clinical record
          {finalizedAt ? ` as of ${formatDate(finalizedAt.slice(0, 10))}` : ""} and cannot be
          edited. A correction is a new prescription.
        </span>
      </p>

      <ReviewSheet view={view} signatureUrl={frozen ? signatureUrl : null} />

      <PrintPrescription prescriptionId={prescriptionId} view={view} />

      {/*
        Shown during the pilot so a reported problem can be checked against the
        record rather than taken on trust. It is the digest the doctor approved
        and the one stored with the prescription — and it is chrome, so it is
        marked as never printing.
      */}
      <p data-print-hidden className="font-mono text-[11px] break-all text-ink-muted">
        {digest}
      </p>
    </div>
  );
}
