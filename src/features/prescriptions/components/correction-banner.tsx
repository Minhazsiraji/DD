import * as React from "react";
import Link from "next/link";
import { ArrowRight, FileWarning, History } from "lucide-react";
import { formatDate } from "@/lib/format";
import type { PrescriptionLineage } from "../queries";

/**
 * Where this prescription sits in its correction history.
 *
 * NEVER INSIDE THE PRINTED SHEET. The paper a patient was handed on the 19th
 * must reproduce exactly as it was approved, forever — a banner printed onto it
 * later would change a document nobody re-approved. These render outside
 * `PrintSheet`, in the app chrome, and `data-print-hidden` keeps them off paper
 * even if the layout moves.
 *
 * The wording differs by reader because the need differs. The doctor is reading
 * clinical history and may see why. The front desk needs exactly one fact —
 * this is not the current sheet — so they do not hand over a corrected dose.
 */
export function CorrectionLineage({
  lineage,
  unavailable = false,
}: {
  lineage: PrescriptionLineage | null;
  /** The lineage read failed. Say so rather than imply there is no correction. */
  unavailable?: boolean;
}) {
  if (unavailable) {
    return (
      <p
        data-print-hidden
        role="status"
        className="clinical-surface flex items-start gap-2 rounded-glass border-l-4 border-l-warning px-4 py-3 text-[13px] text-ink-secondary"
      >
        <FileWarning className="mt-px size-4 shrink-0 text-warning" aria-hidden="true" />
        <span>
          We could not check whether this prescription has been corrected. Check before handing it
          to the patient.
        </span>
      </p>
    );
  }

  if (!lineage) return null;
  const { replacedBy, replaces, viewerIsOwner } = lineage;
  if (!replacedBy && !replaces) return null;

  return (
    <div data-print-hidden className="space-y-2">
      {replacedBy ? (
        <p
          role="status"
          className="clinical-surface flex flex-wrap items-start gap-2 rounded-glass border-l-4 border-l-warning px-4 py-3 text-[13px] text-ink-secondary"
        >
          <FileWarning className="mt-px size-4 shrink-0 text-warning" aria-hidden="true" />
          <span className="min-w-0 flex-1">
            <strong className="font-semibold text-ink">
              {viewerIsOwner ? "Replaced by a corrected prescription." : "Do not hand this one over."}
            </strong>{" "}
            {viewerIsOwner ?
              "This one stays in the record exactly as it was approved."
            : replacedBy.status === "FINALIZED" ?
              "A newer prescription replaces it — give the patient that one instead."
            : /*
                The correction is still being written. Staff must not hand over
                the old sheet, and there is nothing yet to hand over instead.
              */
              "The doctor is writing a corrected prescription. Wait for it before giving the patient anything."
            }
            {/*
              The reason is clinical reasoning. The RPC does not send it to
              anyone but the owner, so this cannot render for staff even by
              mistake — but it is also only asked for here.
            */}
            {viewerIsOwner && replacedBy.reason ? (
              <span className="mt-1 block text-ink">
                <span className="text-ink-muted">Reason: </span>
                {replacedBy.reason}
              </span>
            ) : null}
          </span>
          {replacedBy.id ? (
            <Link
              href={`/prescription/${replacedBy.id}`}
              className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-hairline bg-white px-3 text-[12px] font-semibold text-ink hover:bg-surface-muted focus-visible:focus-ring"
            >
              Open the current one
              <ArrowRight className="size-3.5" aria-hidden="true" />
            </Link>
          ) : null}
        </p>
      ) : null}

      {replaces ? (
        <p
          role="status"
          className="clinical-surface flex flex-wrap items-start gap-2 rounded-glass border-l-4 border-l-info px-4 py-3 text-[13px] text-ink-secondary"
        >
          <History className="mt-px size-4 shrink-0 text-info" aria-hidden="true" />
          <span className="min-w-0 flex-1">
            <strong className="font-semibold text-ink">Corrected prescription.</strong> It corrects
            an earlier prescription
            {replaces.finalizedAt ? ` from ${formatDate(replaces.finalizedAt.slice(0, 10))}` : ""},
            which stays in the record unchanged.
            {viewerIsOwner && lineage.reason ? (
              <span className="mt-1 block text-ink">
                <span className="text-ink-muted">Reason: </span>
                {lineage.reason}
              </span>
            ) : null}
          </span>
          {replaces.id ? (
            <Link
              href={`/prescription/${replaces.id}`}
              className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-hairline bg-white px-3 text-[12px] font-semibold text-ink hover:bg-surface-muted focus-visible:focus-ring"
            >
              See the original
              <ArrowRight className="size-3.5" aria-hidden="true" />
            </Link>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}
