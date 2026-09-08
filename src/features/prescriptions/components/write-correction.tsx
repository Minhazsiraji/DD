"use client";

import * as React from "react";
import { createPortal } from "react-dom";
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

  /**
   * The reason sheet is portalled directly to body so opening it never becomes
   * another flex/grid child of the finalised prescription action row. The
   * server snapshot remains false and React owns the client transition.
   */
  const mounted = React.useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  React.useEffect(() => {
    if (!open || !mounted) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    fieldRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) {
        setOpen(false);
        setReason("");
        setError(null);
      }
    };
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, mounted, busy]);

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

  function close() {
    if (busy) return;
    setOpen(false);
    setReason("");
    setError(null);
  }

  function keepFocusInside(event: React.KeyboardEvent<HTMLElement>) {
    if (event.key !== "Tab") return;
    const focusable = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>(
        'textarea:not([disabled]), button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((element) => element.getAttribute("aria-hidden") !== "true");
    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
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
        className="dd-primary inline-flex h-11 w-full items-center justify-center gap-1.5 px-4 text-[13px] font-semibold focus-visible:focus-ring sm:w-auto"
      >
        <FilePlus2 className="size-4" aria-hidden="true" />
        Write corrected prescription
      </button>
    );
  }

  if (!mounted) return null;

  return createPortal(
    <div
      data-print-hidden
      data-correction-dialog-backdrop
      className="fixed inset-0 z-[80] flex items-end justify-center bg-black/35 p-0 sm:items-center sm:p-4"
    >
      <SectionCard
        data-correction-dialog
        role="dialog"
        aria-modal="true"
        aria-labelledby="correction-dialog-title"
        aria-describedby="correction-dialog-description"
        onKeyDown={keepFocusInside}
        className="dd-panel-pearl dd-panel-rim max-h-[90dvh] w-full max-w-xl overflow-y-auto rounded-b-none sm:rounded-glass-lg"
      >
        <div className="space-y-3 p-4 sm:p-5">
          <div>
            <h2 id="correction-dialog-title" className="text-[15px] font-semibold text-ink">
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
            <p id="correction-dialog-description" className="mt-1 text-[13px] text-ink-secondary">
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
              rows={4}
              maxLength={MAX_REASON}
              disabled={busy || error?.blocking}
              aria-invalid={trimmed === "" && reason !== "" ? true : undefined}
              placeholder="e.g. Wrong strength written for the antibiotic"
              className="min-h-28 w-full resize-y rounded-xl border border-hairline bg-white px-3 py-2 text-sm text-ink placeholder:text-ink-muted focus-visible:focus-ring"
            />
            <p className="text-right text-[11px] tabular-nums text-ink-muted">
              {reason.length} / {MAX_REASON}
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

          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
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
                className="dd-primary inline-flex min-h-11 w-full items-center justify-center gap-1.5 px-4 text-[13px] font-semibold disabled:cursor-not-allowed disabled:opacity-55 focus-visible:focus-ring sm:w-auto"
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
              onClick={close}
              disabled={busy}
              className="dd-secondary inline-flex min-h-11 w-full items-center justify-center px-4 text-[13px] font-semibold disabled:opacity-55 focus-visible:focus-ring sm:w-auto"
            >
              Keep original prescription
            </button>
          </div>
        </div>
      </SectionCard>
    </div>,
    document.body,
  );
}
