"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CircleAlert, Stethoscope, UserCheck } from "lucide-react";
import { emptyState } from "@/features/auth/schema";
import { changeStatusAction } from "@/features/appointments/actions";
import { OpenConsultation } from "@/features/encounters/components/open-consultation";
import { openUnscheduledConsultationAction } from "@/features/encounters/actions";
import { StartConsultation } from "@/features/queue/components/start-consultation";
import type { M1PatientState } from "../m1-context";
import { cn } from "@/lib/utils";

export function DoctorConsultationLauncher({
  patientId,
  patientName,
  patientNumber,
  state,
  appointmentId,
  unscheduledEncounterId,
  tokenNumber,
  locationName,
  canMarkArrived,
  compact = false,
  onChanged,
}: {
  patientId: string;
  patientName: string;
  patientNumber: string;
  state: M1PatientState;
  appointmentId: string | null;
  unscheduledEncounterId?: string | null;
  tokenNumber: number | null;
  locationName: string;
  canMarkArrived: boolean;
  compact?: boolean;
  onChanged?: () => void;
}) {
  const router = useRouter();
  const [confirmingUnscheduled, setConfirmingUnscheduled] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const [message, setMessage] = React.useState<string | null>(null);

  if (state === "IN_CONSULTATION" && appointmentId) {
    return <OpenConsultation appointmentId={appointmentId} size={compact ? "default" : "full"} />;
  }

  if (state === "ARRIVED" && appointmentId) {
    return (
      <StartConsultation
        appointmentId={appointmentId}
        patientName={patientName}
        tokenNumber={tokenNumber}
        size={compact ? "default" : "full"}
      />
    );
  }

  if ((state === "SCHEDULED" || state === "CONFIRMED") && appointmentId) {
    if (!canMarkArrived) {
      return (
        <p className="flex items-start gap-1.5 text-xs text-ink-secondary">
          <CircleAlert className="mt-px size-3.5 shrink-0" aria-hidden="true" />
          Mark arrival from the authorised appointment desk before starting clinical work.
        </p>
      );
    }

    return (
      <div className={cn("space-y-1.5", !compact && "w-full")}>
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            setMessage(null);
            startTransition(async () => {
              const form = new FormData();
              form.set("appointmentId", appointmentId);
              form.set("toStatus", "ARRIVED");
              const result = await changeStatusAction(emptyState, form);
              if (!result.ok) {
                setMessage(result.message ?? "Arrival could not be recorded.");
                return;
              }
              onChanged?.();
              router.refresh();
            });
          }}
          className={cn(
            "inline-flex h-11 items-center justify-center gap-1.5 rounded-xl border border-brand bg-brand-soft px-3.5 text-[13px] font-semibold text-brand hover:bg-brand hover:text-white disabled:opacity-60 focus-visible:focus-ring",
            !compact && "w-full",
          )}
        >
          <UserCheck className="size-4" aria-hidden="true" />
          {pending ? "Updating…" : "Mark arrived"}
        </button>
        {message ? <p role="alert" className="text-xs font-medium text-danger">{message}</p> : null}
      </div>
    );
  }

  // Only NONE and COMPLETED deliberately start a new unscheduled encounter.
  if (state !== "NONE" && state !== "COMPLETED") return null;


  if (unscheduledEncounterId) {
    return (
      <div className={compact ? undefined : "w-full"}>
        <button
          type="button"
          onClick={() => router.push(`/consultation/${unscheduledEncounterId}`)}
          className={cn(
            "inline-flex h-11 items-center justify-center gap-1.5 rounded-xl border border-brand bg-brand-soft px-3.5 text-[13px] font-semibold text-brand transition-[background-color,transform] duration-200 hover:bg-brand hover:text-white active:scale-[0.985] motion-reduce:active:scale-100 focus-visible:focus-ring",
            !compact && "w-full",
          )}
        >
          <Stethoscope className="size-4" aria-hidden="true" />
          Resume consultation
        </button>
      </div>
    );
  }

  if (!confirmingUnscheduled) {
    return (
      <div className={compact ? undefined : "w-full"}>
        <button
          type="button"
          onClick={() => {
            setMessage(null);
            setConfirmingUnscheduled(true);
          }}
          className={cn(
            "inline-flex h-11 items-center justify-center gap-1.5 rounded-xl bg-brand px-3.5 text-[13px] font-semibold text-white shadow-soft hover:bg-brand-hover focus-visible:focus-ring",
            !compact && "w-full",
          )}
        >
          <Stethoscope className="size-4" aria-hidden="true" />
          Start unscheduled consultation
        </button>
        {message ? <p role="alert" className="mt-1.5 text-xs font-medium text-danger">{message}</p> : null}
      </div>
    );
  }

  return (
    <div className="w-full rounded-xl border border-brand/25 bg-brand-soft/45 p-3">
      <p className="text-[13px] font-semibold text-ink">Start an unscheduled consultation?</p>
      <p className="mt-1 text-xs text-ink-secondary">
        {patientName} · {patientNumber} · {locationName}
      </p>
      <p className="mt-1 text-xs text-ink-muted">No appointment, queue entry or token will be created.</p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            setMessage(null);
            startTransition(async () => {
              const result = await openUnscheduledConsultationAction({ patientId });
              if (!result.ok) {
                setMessage(result.message);
                return;
              }
              router.push(`/consultation/${result.encounterId}`);
            });
          }}
          className="inline-flex h-11 items-center justify-center rounded-xl bg-brand px-3.5 text-[13px] font-semibold text-white shadow-soft disabled:opacity-60 focus-visible:focus-ring"
        >
          {pending ? "Opening…" : "Yes, start"}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => setConfirmingUnscheduled(false)}
          className="inline-flex h-11 items-center justify-center rounded-xl border border-hairline bg-white px-3.5 text-[13px] font-semibold text-ink hover:bg-surface-muted disabled:opacity-60 focus-visible:focus-ring"
        >
          Cancel
        </button>
      </div>
      {message ? <p role="alert" className="mt-2 text-xs font-medium text-danger">{message}</p> : null}
    </div>
  );
}
