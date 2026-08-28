"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, CircleAlert, Loader2 } from "lucide-react";
import { SectionCard } from "@/components/common/section-card";
import { requestGuardedNavigation } from "./unsaved-guard";
import { finishConsultationAction } from "../actions";

/**
 * Ending the visit. The clinical authority remains `finishConsultationAction`;
 * this component only controls presentation and explicit confirmation.
 */
export function FinishConsultation({
  encounterId,
  version,
  unsaved,
}: {
  encounterId: string;
  version: number;
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
    <SectionCard className="min-w-0">
      <div className="min-w-0 space-y-3 p-4 sm:p-5">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold text-ink">Finished with this patient?</h2>
          <p className="mt-0.5 break-words text-[13px] text-ink-secondary">
            Closing the visit puts it in the patient&rsquo;s history as seen. The notes become
            read-only; any prescription you have already signed is unaffected.
          </p>
        </div>

        {unsaved ? (
          <p className="flex min-w-0 items-start gap-2 rounded-xl bg-warning-soft px-3 py-2 text-[13px] font-medium text-ink">
            <CircleAlert className="mt-px size-4 shrink-0 text-warning" aria-hidden="true" />
            <span className="min-w-0 break-words">Save your notes first — closing the visit now would leave them unsaved.</span>
          </p>
        ) : null}

        {error ? (
          <p
            role="alert"
            className="flex min-w-0 items-start gap-2 rounded-xl bg-danger-soft px-3 py-2 text-[13px] font-medium text-[#a81c1c]"
          >
            <CircleAlert className="mt-px size-4 shrink-0" aria-hidden="true" />
            <span className="min-w-0 break-words">{error}</span>
          </p>
        ) : null}

        {confirming ? (
          <div
            data-mobile-finish-confirmation
            className="min-w-0 rounded-xl border border-hairline bg-surface-muted/60 p-3 sm:p-4"
          >
            <p className="text-[15px] font-semibold text-ink">Finish this consultation?</p>
            <p className="mt-1 break-words text-[13px] text-ink-secondary">
              The visit is recorded as seen and the notes can no longer be edited.
            </p>
            <div className="mt-3 flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap">
              <button
                type="button"
                onClick={() => void finish()}
                disabled={busy}
                className="inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl bg-brand px-4 text-[13px] font-semibold text-white shadow-soft transition-colors hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-55 focus-visible:focus-ring sm:w-auto"
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
                className="inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-hairline bg-white px-4 text-[13px] font-semibold text-ink hover:bg-surface-muted disabled:opacity-55 focus-visible:focus-ring sm:w-auto"
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
            className="inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl bg-brand px-4 text-[13px] font-semibold text-white shadow-soft transition-colors hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-55 focus-visible:focus-ring sm:w-auto"
          >
            <CheckCircle2 className="size-4" aria-hidden="true" />
            Finish consultation
          </button>
        )}
      </div>
    </SectionCard>
  );
}
