"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CircleAlert, Loader2, Pill } from "lucide-react";
import { requestGuardedNavigation } from "@/features/encounters/components/unsaved-guard";
import { openPrescriptionAction } from "../actions";

/**
 * M2 prescription handoff only. Opening remains idempotent and the Rx screen
 * loads patient/allergy identity from the encounter-owned prescription. The
 * return path explicitly brings the doctor back to this same consultation.
 */
export function OpenPrescriptionButton({ encounterId }: { encounterId: string }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function open() {
    if (busy) return;
    setBusy(true);
    setError(null);

    const result = await openPrescriptionAction({ encounterId });
    if (!result.ok) {
      setBusy(false);
      setError(result.message);
      return;
    }

    const returnTo = `/consultation/${encounterId}`;
    requestGuardedNavigation(
      () =>
        router.push(
          `/prescription/${result.prescriptionId}?returnTo=${encodeURIComponent(returnTo)}`,
        ),
      () => setBusy(false),
    );
  }

  return (
    <div className="dd-app-panel rounded-glass p-4 sm:p-5">
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-[15px] font-semibold text-ink">Prescription</p>
          <p className="mt-0.5 text-[12px] text-ink-muted">
            Opens this encounter&rsquo;s same prescription draft. Patient and allergy identity stay visible there.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void open()}
          disabled={busy}
          className="dd-primary inline-flex min-h-11 w-full shrink-0 items-center justify-center gap-1.5 px-4 text-[13px] font-semibold disabled:cursor-not-allowed disabled:opacity-55 focus-visible:focus-ring sm:w-auto"
        >
          {busy ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Pill className="size-4" aria-hidden="true" />
          )}
          {busy ? "Opening…" : "Write prescription"}
        </button>
      </div>
      {error ? (
        <p
          role="status"
          className="mt-2 flex items-start gap-2 rounded-xl bg-danger-soft px-3 py-2 text-[13px] font-medium text-[#a81c1c]"
        >
          <CircleAlert className="mt-px size-4 shrink-0" aria-hidden="true" />
          {error}
        </p>
      ) : null}
    </div>
  );
}
