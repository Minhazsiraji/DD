"use client";

import * as React from "react";
import Link from "next/link";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import {
  Megaphone,
  UserX,
  ArrowUp,
  ArrowDownToLine,
  Stethoscope,
  Clock,
  CircleAlert,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { emptyState } from "@/features/auth/schema";
import { VISIT_TYPE_LABEL, timeInZone } from "@/features/appointments/schema";
import {
  callPatientAction,
  skipPatientAction,
  clearPriorityAction,
} from "../actions";
import { StartConsultation } from "./start-consultation";
import {
  PRIORITY_REASON_LABEL,
  waitedMinutes,
  waitLabel,
  type QueueRow,
} from "../schema";
import { PriorityForm } from "./priority-form";
import { OpenConsultation } from "@/features/encounters/components/open-consultation";

/**
 * One patient in the queue.
 *
 * `variant` decides what is OFFERED, never what is permitted — the database
 * refuses every queue action once the consultation starts, and a stale screen
 * that tries anyway gets a plain explanation rather than a fault.
 */
export function QueueCard({
  row,
  variant,
  now,
  onChanged,
  currentDoctorId = null,
}: {
  row: QueueRow;
  variant: "current" | "waiting" | "skipped";
  /** Passed in so every card agrees, and so the server render is stable. */
  now: number;
  onChanged: () => void;
  /** The viewer's own doctor_profiles.id, or null if they are not a doctor. */
  currentDoctorId?: string | null;
}) {
  const [panel, setPanel] = React.useState<"none" | "priority">("none");
  const waited = waitLabel(waitedMinutes(row.arrivedAt, now));

  return (
    <li
      className={cn(
        "clinical-surface rounded-glass p-4 sm:px-5",
        variant === "current" && "ring-2 ring-brand",
        variant === "skipped" && "opacity-90",
      )}
    >
      <div className="flex flex-wrap items-start gap-3">
        <Token row={row} variant={variant} />

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {/*
              py-3 -my-3 gives the link a 44px tap target without adding a
              pixel of visual height — on a phone at a busy desk this is hit
              with a thumb, and 20px of text is not a target.
            */}
            <Link
              href={`/patients/${row.patientId}`}
              className="-my-3 inline-flex items-center py-3 text-sm font-semibold text-ink hover:underline focus-visible:focus-ring"
            >
              {row.patientName}
            </Link>
            {row.priority > 0 && row.priorityReason ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-warning-soft px-2 py-0.5 text-[11px] font-semibold text-[#8a3f07]">
                <ArrowUp className="size-3" aria-hidden="true" />
                {PRIORITY_REASON_LABEL[row.priorityReason]}
              </span>
            ) : null}
          </div>

          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-ink-secondary">
            <span className="tabular-nums">{row.patientNumber}</span>
            <span aria-hidden="true">·</span>
            <span>{VISIT_TYPE_LABEL[row.visitType]}</span>
            {row.doctorName ? (
              <>
                <span aria-hidden="true">·</span>
                <span>{row.doctorName}</span>
              </>
            ) : null}
            {waited ? (
              <>
                <span aria-hidden="true">·</span>
                <span className="inline-flex items-center gap-1">
                  <Clock className="size-3" aria-hidden="true" />
                  waiting {waited}
                </span>
              </>
            ) : null}
          </p>

          {row.priorityNote ? (
            <p className="mt-1 text-xs text-ink-muted">{row.priorityNote}</p>
          ) : null}

          <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-ink-muted">
            <span>Booked {timeInZone(row.scheduledFor)}</span>
            {row.callCount > 0 ? (
              <>
                <span aria-hidden="true">·</span>
                <span>
                  called {row.callCount} {row.callCount === 1 ? "time" : "times"}
                </span>
              </>
            ) : null}
            {row.skipCount > 0 ? (
              <>
                <span aria-hidden="true">·</span>
                <span>missed {row.skipCount}×</span>
              </>
            ) : null}
          </p>
        </div>

        {variant === "current" ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-xl bg-brand-soft px-3 py-2 text-[13px] font-semibold text-brand">
              <Stethoscope className="size-4" aria-hidden="true" />
              With doctor
            </span>
            {/*
              Only the owning doctor. Reception stands in front of this same
              board, and offering them a button the database will refuse is
              worse than not offering one at all.
            */}
            {currentDoctorId && row.ownerDoctorId === currentDoctorId ? (
              <OpenConsultation appointmentId={row.appointmentId} />
            ) : null}
          </div>
        ) : (
          <Actions
            row={row}
            variant={variant}
            onChanged={onChanged}
            onPriority={() => setPanel(panel === "priority" ? "none" : "priority")}
            priorityOpen={panel === "priority"}
          />
        )}
      </div>

      {panel === "priority" ? (
        <PriorityForm
          row={row}
          onDone={() => {
            setPanel("none");
            onChanged();
          }}
        />
      ) : null}
    </li>
  );
}

function Token({ row, variant }: { row: QueueRow; variant: string }) {
  return (
    <div className="flex w-14 shrink-0 flex-col items-center gap-1">
      <span
        className={cn(
          "inline-flex min-w-10 items-center justify-center rounded-xl px-2 py-1 text-base font-bold tabular-nums",
          variant === "current"
            ? "bg-brand text-white"
            : variant === "skipped"
              ? "bg-surface-muted text-ink-secondary"
              : "bg-brand-soft text-brand",
        )}
      >
        {row.tokenNumber !== null ? `#${row.tokenNumber}` : "—"}
      </span>
      {row.arrivedAt ? (
        <span className="text-[11px] tabular-nums text-ink-muted">
          {timeInZone(row.arrivedAt)}
        </span>
      ) : null}
    </div>
  );
}

/**
 * Every action is its own form with its own pending state, so a slow network
 * cannot produce a double call — the desk taps twice when nothing happens.
 */
function Actions({
  row,
  variant,
  onChanged,
  onPriority,
  priorityOpen,
}: {
  row: QueueRow;
  variant: "waiting" | "skipped";
  onChanged: () => void;
  onPriority: () => void;
  priorityOpen: boolean;
}) {
  const [callState, call] = useActionState(callPatientAction, emptyState);
  const [skipState, skip] = useActionState(skipPatientAction, emptyState);
  const [clearState, clearPriority] = useActionState(clearPriorityAction, emptyState);

  const state = [callState, skipState, clearState].find((s) => s.message);

  React.useEffect(() => {
    if (callState.ok || skipState.ok || clearState.ok) onChanged();
  }, [callState.ok, skipState.ok, clearState.ok, onChanged]);

  return (
    <div className="flex w-full shrink-0 flex-col items-stretch gap-2 sm:w-auto sm:flex-row sm:items-center">
      <form action={call}>
        <input type="hidden" name="appointmentId" value={row.appointmentId} />
        {/*
          "Call in" — announcing the patient into the room, not telephoning
          them. The megaphone says it and so should the words: reception read
          "Call" as "ring this number", which the app does not do.
        */}
        <ActionButton
          tone="primary"
          icon={<Megaphone className="size-4" aria-hidden="true" />}
          label={
            variant === "skipped" || row.callCount > 0 ? "Call in again" : "Call in"
          }
        />
      </form>

      {variant === "waiting" ? (
        <form action={skip}>
          <input type="hidden" name="appointmentId" value={row.appointmentId} />
          <ActionButton
            tone="quiet"
            icon={<UserX className="size-4" aria-hidden="true" />}
            label="No answer"
          />
        </form>
      ) : null}

      {row.priority > 0 ? (
        <form action={clearPriority}>
          <input type="hidden" name="appointmentId" value={row.appointmentId} />
          <ActionButton
            tone="quiet"
            icon={<ArrowDownToLine className="size-4" aria-hidden="true" />}
            label="Normal order"
          />
        </form>
      ) : (
        <button
          type="button"
          onClick={onPriority}
          aria-expanded={priorityOpen}
          className="inline-flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-xl border border-hairline bg-white px-3 text-[13px] font-semibold text-ink transition-colors hover:bg-surface-muted focus-visible:focus-ring"
        >
          <ArrowUp className="size-4" aria-hidden="true" />
          Move up
        </button>
      )}

      <StartConsultation
        appointmentId={row.appointmentId}
        patientName={row.patientName}
        tokenNumber={row.tokenNumber}
      />

      {state?.message ? (
        <p
          role="status"
          className={cn(
            "flex items-start gap-1.5 text-xs font-medium sm:basis-full",
            state.ok ? "text-ink-secondary" : "text-danger",
          )}
        >
          {!state.ok ? <CircleAlert className="mt-px size-3.5 shrink-0" aria-hidden="true" /> : null}
          {state.message}
        </p>
      ) : null}
    </div>
  );
}


/** Disabled while pending — a queue screen gets tapped twice when it is slow. */
function ActionButton({
  tone,
  icon,
  label,
}: {
  tone: "primary" | "quiet";
  icon: React.ReactNode;
  label: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={cn(
        "inline-flex h-11 w-full items-center justify-center gap-1.5 rounded-xl px-3.5 text-[13px] font-semibold transition-[background-color,transform] duration-200 active:scale-[0.985] disabled:cursor-not-allowed disabled:opacity-60 focus-visible:focus-ring motion-reduce:active:scale-100 sm:w-auto",
        tone === "primary"
          ? "bg-brand text-white shadow-soft hover:bg-brand-hover"
          : "border border-hairline bg-white text-ink hover:bg-surface-muted",
      )}
    >
      {pending ? "Working…" : (
        <>
          {icon}
          {label}
        </>
      )}
    </button>
  );
}
