"use client";

import * as React from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Stethoscope } from "lucide-react";
import { cn } from "@/lib/utils";
import { emptyState } from "@/features/auth/schema";
import { changeStatusAction } from "@/features/appointments/actions";

/**
 * Starting a consultation.
 *
 * Goes through the APPOINTMENT status transition, not a queue action — there is
 * exactly one way to move a patient through their day (ADR 0009). It confirms
 * the patient by name and token first, because sending in the wrong person is
 * the mistake the queue exists to prevent.
 *
 * Shared by the queue board and the dashboard's "Work now" panel so both get the
 * same confirmation and the same failure handling; a second copy would be a
 * second place for that safeguard to drift.
 */
export function StartConsultation({
  appointmentId,
  patientName,
  tokenNumber,
  onStarted,
  size = "default",
}: {
  appointmentId: string;
  patientName: string;
  tokenNumber: number | null;
  onStarted?: () => void;
  /** `full` stretches the trigger for a narrow panel. */
  size?: "default" | "full";
}) {
  const [confirming, setConfirming] = React.useState(false);
  const [state, start] = useActionState(changeStatusAction, emptyState);

  // Derived, not set in an effect: once the start succeeds the confirmation is
  // finished by definition, and the row is about to be re-fetched anyway.
  const showConfirm = confirming && !state.ok;

  React.useEffect(() => {
    if (state.ok) onStarted?.();
  }, [state.ok, onStarted]);

  if (!showConfirm) {
    return (
      <div className={size === "full" ? "w-full" : undefined}>
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className={cn(
            "inline-flex h-11 items-center justify-center gap-1.5 rounded-xl bg-brand px-3.5 text-[13px] font-semibold text-white shadow-soft transition-[background-color,transform] duration-200 hover:bg-brand-hover active:scale-[0.985] focus-visible:focus-ring motion-reduce:active:scale-100",
            size === "full" && "w-full",
          )}
        >
          <Stethoscope className="size-4" aria-hidden="true" />
          Start consultation
        </button>
        {state.message && !state.ok ? (
          <p role="status" className="mt-2 text-xs font-medium text-danger">
            {state.message}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <form action={start} className="flex w-full flex-wrap items-center gap-2">
      <input type="hidden" name="appointmentId" value={appointmentId} />
      <input type="hidden" name="toStatus" value="IN_CONSULTATION" />
      <span className="text-[13px] text-ink">
        Send in <strong className="font-semibold">{patientName}</strong>
        {tokenNumber !== null ? ` (#${tokenNumber})` : ""}?
      </span>
      <ConfirmButton />
      <button
        type="button"
        onClick={() => setConfirming(false)}
        className="inline-flex h-11 items-center justify-center rounded-xl border border-hairline bg-white px-3 text-[13px] font-semibold text-ink hover:bg-surface-muted focus-visible:focus-ring"
      >
        Not yet
      </button>
      {state.message && !state.ok ? (
        <p role="status" className="basis-full text-xs font-medium text-danger">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

/** Disabled while pending — a busy desk taps twice when nothing happens. */
function ConfirmButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex h-11 items-center justify-center rounded-xl bg-brand px-3.5 text-[13px] font-semibold text-white shadow-soft transition-colors hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-60 focus-visible:focus-ring"
    >
      {pending ? "Working…" : "Yes, start"}
    </button>
  );
}
