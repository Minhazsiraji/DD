"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { NotebookPen } from "lucide-react";
import { cn } from "@/lib/utils";
import { openAppointmentConsultationAction } from "../actions";

/** Resume the single appointment-linked draft; the appointment remains authority. */
export function OpenConsultation({
  appointmentId,
  size = "default",
}: {
  appointmentId: string;
  size?: "default" | "full";
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);

  function open() {
    setError(null);
    startTransition(async () => {
      const result = await openAppointmentConsultationAction({ appointmentId });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      router.push(`/consultation/${result.encounterId}`);
    });
  }

  return (
    <div className={size === "full" ? "w-full" : undefined}>
      <button
        type="button"
        onClick={open}
        disabled={pending}
        className={cn(
          "inline-flex h-11 items-center justify-center gap-1.5 rounded-xl border border-brand bg-brand-soft px-3.5 text-[13px] font-semibold text-brand transition-[background-color,transform] duration-200 hover:bg-brand hover:text-white active:scale-[0.985] disabled:opacity-60 motion-reduce:active:scale-100 focus-visible:focus-ring",
          size === "full" && "w-full",
        )}
      >
        <NotebookPen className="size-4" aria-hidden="true" />
        {pending ? "Opening…" : "Resume consultation"}
      </button>
      {error ? <p role="alert" className="mt-2 text-xs font-medium text-danger">{error}</p> : null}
    </div>
  );
}
