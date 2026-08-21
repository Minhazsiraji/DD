"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CircleAlert, FilePlus2, Loader2 } from "lucide-react";
import { SectionCard } from "@/components/common/section-card";
import { startCorrectionAction } from "../actions";

const MAX_REASON = 500;

/**
 * Writing a corrected prescription.
 *
 * NOT "Edit", "Modify", "Reopen" or "Change" — every one of those describes
 * mutating the finalised record, which is the thing that never happens. What
 * happens is a NEW prescription that points back at this one, and the wording
 * has to say so before the doctor clicks anything.
 *
 * It starts BLANK. Copying the old medicines forward would put the dose being
 * corrected back on screen as a default to accept, and the medicine that needs
 * correcting is exactly the one nobody should be nudged into keeping.
 *
 * The reason is required because the lineage row cannot exist without it — the
 * database enforces `replaces_prescription_id is null or replacement_reason is
 * not null`. Asking here just means the doctor writes it in a text box instead
 * of meeting a constraint violation.
 *
 * Rendered ONLY for the owning doctor, and only when this prescription has not
 * already been corrected. That is presentation: `open_prescription` refuses a
 * non-owner regardless, and a unique index allows one correction per
 * prescription however many tabs are open.
 */
export function WriteCorrection({ prescriptionId }: { prescriptionId: string }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<{ message: string; blocking: boolean } | null>(null);
  const fieldRef = React.useRef<HTMLTextAreaElement>(null);

  React.useEffect(() => {
    if (open) fieldRef.current?.focus();
  }, [open]);

  const trimmed = reason.trim();

  async function start() {
    if (trimmed === "" || busy) return;
    setBusy(true);
    setError(null);

    /**
     * ONE identifier. The encounter this correction belongs to is read from the
     * prescription row inside the database transaction — sending it from here
     * would let the two halves of one clinical relationship disagree.
     */
    const result = await startCorrectionAction({ prescriptionId, reason });

    if (result.ok) {
      /**
       * `alreadyFinalized` means someone else's correction got there first —
       * another tab, or a second click. Going to it is right; offering to
       * write another would be how an encounter grows two competing
       * corrections.
       */
      router.push(`/prescription/${result.prescriptionId}`);
      router.refresh();
      return;
    }

    setBusy(false);
    // `unconfirmed` is the one branch that must not leave a usable button.
    setError({ message: result.message, blocking: result.kind === "unconfirmed" });
  }

  if (!open) {
    /*
      Closed, this is ONE BUTTON — not a titled card.

      It used to be a full-width panel headed "Something wrong with this one?"
      explaining that a correction is a new prescription. The sentence is
      already in the approval line directly above it, so the card spent a
      document-sized block of a document-viewing screen repeating it, and the
      finalised prescription competed with two panels for attention.

      The explanation belongs where the decision is actually made — the form
      below says it again when the doctor opens it, which is the moment it
      matters.
    */
    return (
      <button
        data-print-hidden
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-xl border border-hairline bg-white px-4 text-[13px] font-semibold text-ink transition-colors hover:bg-surface-muted focus-visible:focus-ring"
      >
        <FilePlus2 className="size-4" aria-hidden="true" />
        Write corrected prescription
      </button>
    );
  }

  return (
    <SectionCard data-print-hidden>
      <div className="space-y-3 p-4 sm:p-5">
        <div>
          <h2 className="text-[15px] font-semibold text-ink">
            Why is this prescription being corrected?
          </h2>
          {/*
            It has to say what it DOES, at the moment the doctor commits to it.

            This sentence used to live on the closed trigger card. Collapsing
            that card to a button dropped it, and `correction.test.ts` caught
            it — rightly: "correct" can be read as "edit this one", and the
            whole immutability contract is that it never is. The status line
            above the paper says it too, but a control must not depend on
            another component's wording to be honest.
          */}
          <p className="mt-1 text-[13px] text-ink-secondary">
            A correction is a new prescription. The original stays in the record exactly as it is,
            and this note is part of the clinical correction history — it is never printed on paper.
          </p>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="correction-reason" className="sr-only">
            Reason for correcting this prescription
          </label>
          <textarea
            id="correction-reason"
            ref={fieldRef}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            maxLength={MAX_REASON}
            disabled={busy || error?.blocking}
            aria-invalid={trimmed === "" && reason !== "" ? true : undefined}
            placeholder="e.g. Wrong strength written for the antibiotic"
            className="w-full rounded-xl border border-hairline bg-white px-3 py-2 text-sm text-ink placeholder:text-ink-muted focus-visible:focus-ring"
          />
          <p className="text-right text-[11px] tabular-nums text-ink-muted">
            {trimmed.length} / {MAX_REASON}
          </p>
        </div>

        {error ? (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-xl bg-danger-soft px-3 py-2 text-[13px] font-medium text-[#a81c1c]"
          >
            <CircleAlert className="mt-px size-4 shrink-0" aria-hidden="true" />
            {error.message}
          </p>
        ) : null}

        <div className="flex flex-wrap gap-2">
          {/*
            Hidden entirely once the outcome is unconfirmed. A disabled button
            invites a reload-and-retry; the message says to reload and check,
            and a second correction is the thing being prevented.
          */}
          {error?.blocking ? null : (
            <button
              type="button"
              onClick={start}
              disabled={busy || trimmed === ""}
              className="inline-flex h-11 items-center justify-center gap-1.5 rounded-xl bg-brand px-4 text-[13px] font-semibold text-white shadow-soft transition-colors hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-55 focus-visible:focus-ring"
            >
              {busy ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <FilePlus2 className="size-4" aria-hidden="true" />
              )}
              {busy ? "Starting…" : "Start corrected prescription"}
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              setReason("");
              setError(null);
            }}
            disabled={busy}
            className="inline-flex h-11 items-center justify-center rounded-xl border border-hairline bg-white px-4 text-[13px] font-semibold text-ink hover:bg-surface-muted disabled:opacity-55 focus-visible:focus-ring"
          >
            Keep original prescription
          </button>
        </div>
      </div>
    </SectionCard>
  );
}
