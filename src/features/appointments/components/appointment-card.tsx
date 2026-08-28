"use client";

import * as React from "react";
import { useActionState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Clock, Phone, PhoneCall, CalendarClock, ChevronRight, Ban, UserX } from "lucide-react";
import { AppointmentStatusBadge } from "@/components/common/status-badge";
import { FormMessage } from "@/features/auth/components/form-parts";
import { emptyState } from "@/features/auth/schema";
import { changeStatusAction } from "../actions";
import {
  PRIMARY_ACTION,
  VISIT_TYPE_LABEL,
  CANCELLATION_REASONS,
  CANCELLATION_LABEL,
  isTerminal,
  canReschedule,
  canTransition,
  timeInZone,
  type AppointmentStatus,
} from "../schema";
import type { AppointmentRow } from "../queries";
import { RescheduleForm } from "./reschedule-form";

/**
 * One appointment on the day list.
 *
 * The primary action is a single button because the desk is busy and the common
 * path — "they're here", "start", "done" — should not require a menu. Cancelling
 * and no-show are deliberately secondary: they end the appointment, and the
 * database will not let them be undone.
 */
export function AppointmentCard({
  appointment,
  canManage,
}: {
  appointment: AppointmentRow;
  canManage: boolean;
}) {
  const [state, formAction] = useActionState(changeStatusAction, emptyState);
  const [panel, setPanel] = React.useState<"none" | "cancel" | "reschedule">("none");
  const router = useRouter();

  React.useEffect(() => {
    if (state.ok) router.refresh();
  }, [state.ok, router]);

  const a = appointment;
  const primary = PRIMARY_ACTION[a.status];
  const finished = isTerminal(a.status);

  return (
    <li className="clinical-surface min-w-0 rounded-glass p-4 sm:px-5">
      <div className="flex min-w-0 flex-wrap items-start gap-3">
        <div className="flex w-14 shrink-0 flex-col items-center">
          <span className="text-sm font-semibold tabular-nums text-ink">
            {timeInZone(a.scheduledFor)}
          </span>
          {a.bookingSerial ? (
            <span className="mt-1 inline-flex min-w-8 items-center justify-center rounded-lg bg-slate-100 px-1.5 py-0.5 text-[11px] font-bold tabular-nums text-slate-700">
              S#{a.bookingSerial}
            </span>
          ) : null}
          {a.tokenNumber !== null ? (
            <span className="mt-1 inline-flex min-w-8 items-center justify-center rounded-lg bg-brand-soft px-1.5 py-0.5 text-[11px] font-bold tabular-nums text-brand">
              Queue #{a.tokenNumber}
            </span>
          ) : null}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/patients/${a.patientId}`}
              className="min-w-0 break-words text-sm font-semibold text-ink hover:underline focus-visible:focus-ring"
            >
              {a.patientName}
            </Link>
            {a.bookingSource === "PUBLIC" ? (
              <span className="rounded-full bg-teal-50 px-2 py-0.5 text-[11px] font-semibold text-teal-700 ring-1 ring-inset ring-teal-200">
                Online
              </span>
            ) : null}
            <AppointmentStatusBadge status={a.status} />
          </div>

          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-ink-secondary">
            <span className="tabular-nums">{a.patientNumber}</span>
            <span aria-hidden="true">·</span>
            <span>{VISIT_TYPE_LABEL[a.visitType]}</span>
            <span aria-hidden="true">·</span>
            <span className="inline-flex items-center gap-1">
              <Clock className="size-3" aria-hidden="true" />
              {a.durationMinutes} min
            </span>
            {a.doctorName ? (
              <>
                <span aria-hidden="true">·</span>
                <span className="break-words">{a.doctorName}</span>
              </>
            ) : null}
          </p>

          {a.reason ? (
            <p className="mt-1 break-words text-xs text-ink-muted">{a.reason}</p>
          ) : null}

          {a.patientPhone ? (
            <a
              href={`tel:${a.patientPhone}`}
              className="mt-1 inline-flex items-center gap-1 text-xs tabular-nums text-brand hover:underline focus-visible:focus-ring"
            >
              <Phone className="size-3" aria-hidden="true" />
              {a.patientPhone}
            </a>
          ) : null}

          {a.status === "CANCELLED" && a.cancellationReason ? (
            <p className="mt-1 break-words text-xs text-ink-muted">
              {CANCELLATION_LABEL[a.cancellationReason]}
              {a.cancellationNote ? ` — ${a.cancellationNote}` : ""}
            </p>
          ) : null}

          {a.rescheduledFromId ? (
            <p className="mt-1 inline-flex items-center gap-1 text-xs text-ink-muted">
              <CalendarClock className="size-3" aria-hidden="true" />
              Moved from an earlier booking
            </p>
          ) : null}
        </div>

        {canManage && !finished ? (
          <div
            data-mobile-appointment-actions
            className="flex w-full min-w-0 shrink-0 flex-col items-stretch gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center"
          >
            {primary ? (
              <form action={formAction} className="w-full sm:w-auto">
                <input type="hidden" name="appointmentId" value={a.id} />
                <input type="hidden" name="toStatus" value={primary.to} />
                <PrimaryButton label={primary.label} />
              </form>
            ) : null}

            {/*
              Confirming is separate from arriving: it records that the patient
              was reached and said they are coming, which is what a reminder
              call produces. Only offered while it still means something.
            */}
            {canTransition(a.status, "CONFIRMED") ? (
              <form action={formAction} className="w-full sm:w-auto">
                <input type="hidden" name="appointmentId" value={a.id} />
                <input type="hidden" name="toStatus" value="CONFIRMED" />
                <button
                  type="submit"
                  className="inline-flex h-11 w-full items-center justify-center gap-1.5 rounded-xl border border-hairline bg-white px-3 text-[13px] font-semibold text-ink transition-colors hover:bg-surface-muted focus-visible:focus-ring sm:h-10 sm:w-auto"
                >
                  <PhoneCall className="size-4" aria-hidden="true" />
                  Confirmed by phone
                </button>
              </form>
            ) : null}

            <button
              type="button"
              onClick={() => setPanel(panel === "reschedule" ? "none" : "reschedule")}
              aria-expanded={panel === "reschedule"}
              disabled={!canReschedule(a.status)}
              className="inline-flex h-11 w-full items-center justify-center gap-1.5 rounded-xl border border-hairline bg-white px-3 text-[13px] font-semibold text-ink transition-colors hover:bg-surface-muted disabled:opacity-50 focus-visible:focus-ring sm:h-10 sm:w-auto"
            >
              <CalendarClock className="size-4" aria-hidden="true" />
              Move
            </button>

            <button
              type="button"
              onClick={() => setPanel(panel === "cancel" ? "none" : "cancel")}
              aria-expanded={panel === "cancel"}
              className="inline-flex h-11 w-full items-center justify-center gap-1.5 rounded-xl border border-hairline bg-white px-3 text-[13px] font-semibold text-danger transition-colors hover:bg-danger-soft focus-visible:focus-ring sm:h-10 sm:w-auto"
            >
              <Ban className="size-4" aria-hidden="true" />
              Cancel
            </button>
          </div>
        ) : null}
      </div>

      {state.message ? (
        <div className="mt-3">
          <FormMessage state={state} />
        </div>
      ) : null}

      {panel === "cancel" && canManage ? (
        <CancelPanel
          appointmentId={a.id}
          status={a.status}
          formAction={formAction}
          onClose={() => setPanel("none")}
        />
      ) : null}

      {panel === "reschedule" && canManage ? (
        <RescheduleForm
          appointment={a}
          onDone={() => {
            setPanel("none");
            router.refresh();
          }}
        />
      ) : null}
    </li>
  );
}

function PrimaryButton({ label }: { label: string }) {
  return (
    <button
      type="submit"
      className="inline-flex h-11 w-full items-center justify-center gap-1.5 rounded-xl bg-brand px-3.5 text-[13px] font-semibold text-white shadow-soft transition-[background-color,transform] duration-200 hover:bg-brand-hover active:scale-[0.985] focus-visible:focus-ring motion-reduce:active:scale-100 sm:h-10 sm:w-auto"
    >
      {label}
      <ChevronRight className="size-4" aria-hidden="true" />
    </button>
  );
}

/**
 * Cancelling asks WHY before it asks whether.
 *
 * "Patient asked to cancel" and "doctor was called away" leave the clinic owing
 * the patient completely different things, and nobody will come back later to
 * fill it in.
 */
function CancelPanel({
  appointmentId,
  status,
  formAction,
  onClose,
}: {
  appointmentId: string;
  status: AppointmentStatus;
  formAction: (formData: FormData) => void;
  onClose: () => void;
}) {
  const canNoShow = status === "SCHEDULED" || status === "CONFIRMED" || status === "ARRIVED";

  return (
    <div className="mt-3 min-w-0 space-y-3 rounded-xl border border-hairline bg-surface-muted p-3.5">
      <form action={formAction} className="min-w-0 space-y-3">
        <input type="hidden" name="appointmentId" value={appointmentId} />
        <input type="hidden" name="toStatus" value="CANCELLED" />

        <div className="space-y-1.5">
          <label
            htmlFor={`reason-${appointmentId}`}
            className="block text-[13px] font-medium text-ink"
          >
            Why is it being cancelled?
          </label>
          <select
            id={`reason-${appointmentId}`}
            name="reason"
            required
            defaultValue=""
            className="h-11 w-full min-w-0 rounded-xl border border-hairline bg-white px-3 text-sm text-ink focus-visible:focus-ring"
          >
            <option value="" disabled>
              Choose a reason
            </option>
            {CANCELLATION_REASONS.filter((r) => r !== "RESCHEDULED").map((r) => (
              <option key={r} value={r}>
                {CANCELLATION_LABEL[r]}
              </option>
            ))}
          </select>
          <p className="text-xs text-ink-muted">
            To move it to another time, use Move instead — that keeps the link
            between the two bookings.
          </p>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            type="submit"
            className="inline-flex h-11 w-full items-center justify-center rounded-xl bg-danger px-4 text-sm font-semibold text-white transition-colors hover:opacity-90 focus-visible:focus-ring sm:w-auto"
          >
            Cancel this appointment
          </button>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-11 w-full items-center justify-center rounded-xl border border-hairline bg-white px-4 text-sm font-semibold text-ink transition-colors hover:bg-surface-muted focus-visible:focus-ring sm:w-auto"
          >
            Keep it
          </button>
        </div>
      </form>

      {canNoShow ? (
        <form action={formAction} className="border-t border-hairline pt-3">
          <input type="hidden" name="appointmentId" value={appointmentId} />
          <input type="hidden" name="toStatus" value="NO_SHOW" />
          <button
            type="submit"
            className="inline-flex h-11 w-full items-center justify-center gap-1.5 rounded-xl border border-hairline bg-white px-3.5 text-[13px] font-semibold text-ink transition-colors hover:bg-surface-muted focus-visible:focus-ring sm:h-10 sm:w-auto"
          >
            <UserX className="size-4" aria-hidden="true" />
            They did not come
          </button>
        </form>
      ) : null}
    </div>
  );
}
