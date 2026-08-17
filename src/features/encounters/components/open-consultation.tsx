"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { NotebookPen } from "lucide-react";
import { cn } from "@/lib/utils";
import { openConsultationAction } from "../actions";

/**
 * Open the notes for a patient who is already with the doctor — or resume the
 * ones already started.
 *
 * There is deliberately no "new consultation" here. `open_encounter` returns
 * the existing draft when there is one, so tapping twice, or coming back after
 * stepping away, lands in the SAME record rather than creating a second one.
 *
 * "Open notes" for the same reason: the queue does not know whether a draft
 * already exists, and "Write notes" would quietly claim there is nothing there
 * yet. One label that is true either way beats a guess.
 */
export function OpenConsultation({
  patientId,
  appointmentId,
  size = "default",
}: {
  patientId: string;
  appointmentId: string | null;
  size?: "default" | "full";
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);

  function open() {
    setError(null);
    startTransition(async () => {
      const result = await openConsultationAction({ patientId, appointmentId });
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
          "inline-flex h-11 items-center justify-center gap-1.5 rounded-xl border border-brand bg-brand-soft px-3.5 text-[13px] font-semibold text-brand transition-[background-color,transform] duration-200 hover:bg-brand hover:text-white active:scale-[0.985] disabled:cursor-not-allowed disabled:opacity-60 motion-reduce:active:scale-100 focus-visible:focus-ring",
          size === "full" && "w-full",
        )}
      >
        <NotebookPen className="size-4" aria-hidden="true" />
        {pending ? "Opening…" : "Open notes"}
      </button>
      {error ? (
        <p role="status" className="mt-2 text-xs font-medium text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
