"use client";

import * as React from "react";
import { useActionState } from "react";
import { FormMessage, SubmitButton } from "@/features/auth/components/form-parts";
import { rescheduleAction } from "../actions";
import { timeInZone, dateInZone, type AppointmentActionState } from "../schema";
import type { AppointmentRow } from "../queries";

const initial: AppointmentActionState = { ok: false };

/**
 * Moving an appointment.
 *
 * Not an edit: the original is cancelled as RESCHEDULED and a linked successor
 * is created, so "originally due on the 3rd, moved twice" stays answerable. The
 * copy says "move" because that is what the user is doing; the bookkeeping is
 * ours to worry about, not theirs.
 */
export function RescheduleForm({
  appointment,
  onDone,
}: {
  appointment: AppointmentRow;
  onDone: () => void;
}) {
  const [state, formAction] = useActionState(rescheduleAction, initial);

  React.useEffect(() => {
    if (state.ok) onDone();
  }, [state.ok, onDone]);

  return (
    <form
      action={formAction}
      className="mt-3 space-y-3 rounded-xl border border-hairline bg-surface-muted p-3.5"
      noValidate
    >
      <input type="hidden" name="appointmentId" value={appointment.id} />

      <p className="text-xs text-ink-secondary">
        Currently {dateInZone(appointment.scheduledFor)} at{" "}
        {timeInZone(appointment.scheduledFor)}.
      </p>

      <div className="space-y-1.5">
        <label
          htmlFor={`when-${appointment.id}`}
          className="block text-[13px] font-medium text-ink"
        >
          New date and time
        </label>
        <input
          id={`when-${appointment.id}`}
          name="scheduledFor"
          type="datetime-local"
          required
          defaultValue={state.values?.scheduledFor ?? ""}
          className="h-11 w-full rounded-xl border border-hairline bg-white px-3 text-sm text-ink focus-visible:focus-ring"
        />
        {state.fieldErrors?.scheduledFor ? (
          <p className="text-xs font-medium text-danger">{state.fieldErrors.scheduledFor[0]}</p>
        ) : null}
      </div>

      <div className="space-y-1.5">
        <label
          htmlFor={`note-${appointment.id}`}
          className="block text-[13px] font-medium text-ink"
        >
          Note <span className="font-normal text-ink-muted">(optional)</span>
        </label>
        <input
          id={`note-${appointment.id}`}
          name="note"
          maxLength={300}
          placeholder="e.g. Patient asked for an evening slot"
          className="h-11 w-full rounded-xl border border-hairline bg-white px-3 text-sm text-ink placeholder:text-ink-muted focus-visible:focus-ring"
        />
      </div>

      <FormMessage state={state} />

      <div className="flex flex-col gap-2 sm:flex-row sm:max-w-md">
        <SubmitButton>Move appointment</SubmitButton>
        <button
          type="button"
          onClick={onDone}
          className="inline-flex h-11 items-center justify-center rounded-xl border border-hairline bg-white px-4 text-sm font-semibold text-ink transition-colors hover:bg-surface-muted focus-visible:focus-ring"
        >
          Keep the current time
        </button>
      </div>
    </form>
  );
}
