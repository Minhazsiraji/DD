"use client";

import * as React from "react";
import { useActionState } from "react";
import { FormMessage, SubmitButton } from "@/features/auth/components/form-parts";
import { emptyState } from "@/features/auth/schema";
import { setPriorityAction } from "../actions";
import { PRIORITY_REASONS, PRIORITY_REASON_LABEL, type QueueRow } from "../schema";

/**
 * Moving someone up the queue.
 *
 * The reason is required by the DATABASE, not merely by this form — a queue that
 * lets people jump without recording why is one that will eventually be accused
 * of selling the privilege, and the assistant who did it will have nothing to
 * show. The form asks for it because refusing afterwards would be worse UX, not
 * because the form is the control.
 */
export function PriorityForm({ row, onDone }: { row: QueueRow; onDone: () => void }) {
  const [state, formAction] = useActionState(setPriorityAction, emptyState);

  React.useEffect(() => {
    if (state.ok) onDone();
  }, [state.ok, onDone]);

  const id = `priority-${row.appointmentId}`;

  return (
    <form
      action={formAction}
      className="mt-3 space-y-3 rounded-xl border border-hairline bg-surface-muted p-3.5"
      noValidate
    >
      <input type="hidden" name="appointmentId" value={row.appointmentId} />

      <div className="space-y-1.5">
        <label htmlFor={id} className="block text-[13px] font-medium text-ink">
          Why is {row.patientName} going first?
        </label>
        <select
          id={id}
          name="reason"
          required
          defaultValue=""
          className="h-11 w-full rounded-xl border border-hairline bg-white px-3 text-sm text-ink focus-visible:focus-ring"
        >
          <option value="" disabled>
            Choose a reason
          </option>
          {PRIORITY_REASONS.map((r) => (
            <option key={r} value={r}>
              {PRIORITY_REASON_LABEL[r]}
            </option>
          ))}
        </select>
        {state.fieldErrors?.reason ? (
          <p className="text-xs font-medium text-danger">{state.fieldErrors.reason[0]}</p>
        ) : null}
        <p className="text-xs text-ink-muted">
          Recorded with your name. Everyone else waits longer because of this, so
          it is kept.
        </p>
      </div>

      <div className="space-y-1.5">
        <label
          htmlFor={`${id}-note`}
          className="block text-[13px] font-medium text-ink"
        >
          Note <span className="font-normal text-ink-muted">(optional)</span>
        </label>
        <input
          id={`${id}-note`}
          name="note"
          maxLength={200}
          placeholder="e.g. Struggling to stand"
          className="h-11 w-full rounded-xl border border-hairline bg-white px-3 text-sm text-ink placeholder:text-ink-muted focus-visible:focus-ring"
        />
      </div>

      <FormMessage state={state} />

      <div className="flex flex-col gap-2 sm:flex-row sm:max-w-md">
        <SubmitButton>Move up the queue</SubmitButton>
        <button
          type="button"
          onClick={onDone}
          className="inline-flex h-11 items-center justify-center rounded-xl border border-hairline bg-white px-4 text-sm font-semibold text-ink transition-colors hover:bg-surface-muted focus-visible:focus-ring"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
