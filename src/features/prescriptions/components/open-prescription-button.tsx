"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CircleAlert, Loader2, Pill } from "lucide-react";
import { requestGuardedNavigation } from "@/features/encounters/components/unsaved-guard";
import { openPrescriptionAction } from "../actions";

/**
 * The way into the prescription composer.
 *
 * Opening is idempotent by design (ADR 0011 §3): one DRAFT per encounter, so
 * pressing this twice — or on a second device — resumes the same prescription
 * rather than starting a rival one. The database enforces that; this button
 * only asks.
 *
 * Navigation goes through `requestGuardedNavigation`, never `router.push`
 * directly: the consultation's unsaved notes are only protected against anchor
 * clicks and Back, and a bare push would drop them without a word.
 */
export function OpenPrescriptionButton({ encounterId }: { encounterId: string }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function open() {
    if (busy) return;
    setBusy(true);
    setError(null);

    /**
     * Open BEFORE asking about unsaved notes. A failed open must leave the
     * consultation exactly as it was — asking first would mark the screen as
     * departing, and a failure would then leave it unguarded.
     */
    const result = await openPrescriptionAction({ encounterId });
    if (!result.ok) {
      setBusy(false);
      setError(result.message);
      return;
    }

    /**
     * Stays busy while the guard asks — re-enabling mid-question would invite a
     * second open — but releases if the doctor decides to stay, or the button
     * sits at "Opening…" for the rest of the consultation.
     */
    requestGuardedNavigation(
      () => router.push(`/prescription/${result.prescriptionId}`),
      () => setBusy(false),
    );
  }

  return (
    <div className="clinical-surface rounded-glass p-4 sm:p-5">
      <button
        type="button"
        onClick={() => void open()}
        disabled={busy}
        className="inline-flex h-11 items-center justify-center gap-1.5 rounded-xl bg-brand px-4 text-[13px] font-semibold text-white shadow-soft transition-colors hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-55 focus-visible:focus-ring"
      >
        {busy ? (
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        ) : (
          <Pill className="size-4" aria-hidden="true" />
        )}
        {busy ? "Opening…" : "Write the prescription"}
      </button>
      <p className="mt-2 text-[12px] text-ink-muted">
        Opens this consultation&rsquo;s prescription — the same one every time, on every device.
      </p>
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
