"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Stethoscope } from "lucide-react";
import { cn } from "@/lib/utils";
import { emptyState } from "@/features/auth/schema";
import { changeStatusAction } from "@/features/appointments/actions";
import { openAppointmentConsultationAction } from "@/features/encounters/actions";

/** ARRIVED → explicit identity confirmation → IN_CONSULTATION → encounter → workspace. */
export function StartConsultation({
  appointmentId,
  patientName,
  tokenNumber,
  size = "default",
}: {
  appointmentId: string;
  patientName: string;
  tokenNumber: number | null;
  size?: "default" | "full";
}) {
  const router = useRouter();
  const [confirming, setConfirming] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [startedButNotOpened, setStartedButNotOpened] = React.useState(false);

  const openWorkspace = React.useCallback(() => {
    setError(null);
    startTransition(async () => {
      const opened = await openAppointmentConsultationAction({ appointmentId });
      if (!opened.ok) {
        setStartedButNotOpened(true);
        setError("Consultation has started, but the clinical workspace did not open.");
        return;
      }
      router.push(`/consultation/${opened.encounterId}`);
    });
  }, [appointmentId, router]);

  function confirmStart() {
    setError(null);
    setStartedButNotOpened(false);
    startTransition(async () => {
      const form = new FormData();
      form.set("appointmentId", appointmentId);
      form.set("toStatus", "IN_CONSULTATION");
      const changed = await changeStatusAction(emptyState, form);

      if (!changed.ok) {
        // A stale/double-clicked screen may already have started the appointment.
        // The appointment-specific RPC is safe to try: it opens only when the
        // authoritative status really is IN_CONSULTATION.
        const resumed = await openAppointmentConsultationAction({ appointmentId });
        if (resumed.ok) {
          router.push(`/consultation/${resumed.encounterId}`);
          return;
        }
        setError(changed.message ?? "The consultation could not be started.");
        return;
      }

      const opened = await openAppointmentConsultationAction({ appointmentId });
      if (!opened.ok) {
        setStartedButNotOpened(true);
        setConfirming(false);
        setError("Consultation has started, but the clinical workspace did not open.");
        return;
      }
      router.push(`/consultation/${opened.encounterId}`);
    });
  }

  if (startedButNotOpened) {
    return (
      <div className={cn("space-y-2", size === "full" && "w-full")}>
        <p role="alert" className="text-xs font-medium text-[#8a3f07]">{error}</p>
        <button
          type="button"
          onClick={openWorkspace}
          disabled={pending}
          className="inline-flex h-11 w-full items-center justify-center gap-1.5 rounded-xl bg-brand px-3.5 text-[13px] font-semibold text-white shadow-soft disabled:opacity-60 focus-visible:focus-ring"
        >
          <Stethoscope className="size-4" aria-hidden="true" />
          {pending ? "Opening…" : "Resume consultation"}
        </button>
      </div>
    );
  }

  if (!confirming) {
    return (
      <div className={size === "full" ? "w-full" : undefined}>
        <button
          type="button"
          onClick={() => {
            setError(null);
            setConfirming(true);
          }}
          disabled={pending}
          className={cn(
            "inline-flex h-11 items-center justify-center gap-1.5 rounded-xl bg-brand px-3.5 text-[13px] font-semibold text-white shadow-soft transition-[background-color,transform] duration-200 hover:bg-brand-hover active:scale-[0.985] disabled:opacity-60 focus-visible:focus-ring motion-reduce:active:scale-100",
            size === "full" && "w-full",
          )}
        >
          <Stethoscope className="size-4" aria-hidden="true" />
          Start consultation
        </button>
        {error ? <p role="alert" className="mt-2 text-xs font-medium text-danger">{error}</p> : null}
      </div>
    );
  }

  return (
    <div className="w-full rounded-xl border border-brand/25 bg-brand-soft/45 p-3">
      <p className="text-[13px] text-ink">
        Send in <strong className="font-semibold">{patientName}</strong>
        {tokenNumber !== null ? (
          <> · token <strong className="font-semibold tabular-nums">#{tokenNumber}</strong></>
        ) : null}
        ?
      </p>
      <p className="mt-1 text-xs text-ink-muted">Confirm the patient before opening their clinical record.</p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          onClick={confirmStart}
          disabled={pending}
          className="inline-flex h-11 items-center justify-center rounded-xl bg-brand px-3.5 text-[13px] font-semibold text-white shadow-soft disabled:opacity-60 focus-visible:focus-ring"
        >
          {pending ? "Starting…" : "Yes, start"}
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          disabled={pending}
          className="inline-flex h-11 items-center justify-center rounded-xl border border-hairline bg-white px-3 text-[13px] font-semibold text-ink hover:bg-surface-muted disabled:opacity-60 focus-visible:focus-ring"
        >
          Not yet
        </button>
      </div>
      {error ? <p role="alert" className="mt-2 text-xs font-medium text-danger">{error}</p> : null}
    </div>
  );
}
