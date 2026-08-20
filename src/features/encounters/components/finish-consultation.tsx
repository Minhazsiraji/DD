"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, CircleAlert, Loader2 } from "lucide-react";
import { SectionCard } from "@/components/common/section-card";
import { requestGuardedNavigation } from "./unsaved-guard";
import { finishConsultationAction } from "../actions";

/**
 * Ending the visit.
 *
 * `close_encounter` has existed since Stage 6 and nothing called it. The
 * appointment screen's "Finish consultation" completes the APPOINTMENT — a
 * different record — so a doctor could write the notes, the diagnosis and a
 * signed prescription, print it, and the encounter stayed DRAFT for ever. The
 * patient's own timeline then said "Consultation in progress" about a visit
 * that had obviously ended.
 *
 * It sits at the END of the consultation, after prescribing, because that is
 * where the visit actually finishes.
 *
 * NOT triggered by finalising a prescription. A doctor often signs the
 * prescription and then adds a last line to the notes; closing the visit
 * underneath them would be the software deciding the consultation is over.
 *
 * Two steps, like every other terminal action here: after this the notes are
 * read-only, and a single mis-click should not end a consultation.
 */
export function FinishConsultation({
  encounterId,
  version,
  unsaved,
}: {
  encounterId: string;
  version: number;
  /** Notes typed but not saved. Closing now would strand them. */
  unsaved: boolean;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function finish() {
    if (busy) return;
    setBusy(true);
    setError(null);

    const result = await finishConsultationAction({ encounterId, expectedVersion: version });

    if (result.ok) {
      /**
       * Through the guard, not `router.push`: a bare push bypasses the unsaved
       * check silently. Nothing should be unsaved by now — the button refuses
       * while anything is — but the guard is the rule for this screen.
       */
      requestGuardedNavigation(
        () => {
          router.refresh();
          router.push("/queue");
        },
        () => setBusy(false),
      );
      return;
    }

    setBusy(false);
    setError(result.message);
  }

  return (
    <SectionCard>
      <div className="space-y-3 p-4 sm:p-5">
        <div>
          <h2 className="text-[15px] font-semibold text-ink">Finished with this patient?</h2>
          <p className="mt-0.5 text-[13px] text-ink-secondary">
            Closing the visit puts it in the patient&rsquo;s history as seen. The notes become
            read-only; any prescription you have already signed is unaffected.
          </p>
        </div>

        {unsaved ? (
          <p className="flex items-start gap-2 rounded-xl bg-warning-soft px-3 py-2 text-[13px] font-medium text-ink">
            <CircleAlert className="mt-px size-4 shrink-0 text-warning" aria-hidden="true" />
            Save your notes first — closing the visit now would leave them unsaved.
          </p>
        ) : null}

        {error ? (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-xl bg-danger-soft px-3 py-2 text-[13px] font-medium text-[#a81c1c]"
          >
            <CircleAlert className="mt-px size-4 shrink-0" aria-hidden="true" />
            {error}
          </p>
        ) : null}

        {confirming ? (
          <div className="rounded-xl border border-hairline bg-surface-muted/60 p-3 sm:p-4">
            <p className="text-[15px] font-semibold text-ink">Finish this consultation?</p>
            <p className="mt-1 text-[13px] text-ink-secondary">
              The visit is recorded as seen and the notes can no longer be edited.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void finish()}
                disabled={busy}
                className="inline-flex h-11 items-center justify-center gap-1.5 rounded-xl bg-brand px-4 text-[13px] font-semibold text-white shadow-soft transition-colors hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-55 focus-visible:focus-ring"
              >
                {busy ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <CheckCircle2 className="size-4" aria-hidden="true" />
                )}
                {busy ? "Finishing…" : "Finish consultation"}
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                disabled={busy}
                className="inline-flex h-11 items-center justify-center rounded-xl border border-hairline bg-white px-4 text-[13px] font-semibold text-ink hover:bg-surface-muted disabled:opacity-55 focus-visible:focus-ring"
              >
                Keep it open
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            disabled={unsaved}
            className="inline-flex h-11 items-center justify-center gap-1.5 rounded-xl bg-brand px-4 text-[13px] font-semibold text-white shadow-soft transition-colors hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-55 focus-visible:focus-ring"
          >
            <CheckCircle2 className="size-4" aria-hidden="true" />
            Finish consultation
          </button>
        )}
      </div>
    </SectionCard>
  );
}
