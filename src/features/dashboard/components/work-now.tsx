"use client";

import * as React from "react";
import Link from "next/link";
import { ListChecks, ChevronRight, Stethoscope, Clock, CircleAlert } from "lucide-react";
import { SectionCard, SectionHeader } from "@/components/common/section-card";
import { StartConsultation } from "@/features/queue/components/start-consultation";
import { OpenConsultation } from "@/features/encounters/components/open-consultation";
import { timeInZone } from "@/features/appointments/schema";
import { PRIORITY_REASON_LABEL, type QueueRow } from "@/features/queue/schema";

/**
 * What the doctor should do next.
 *
 * Both rows come from `get_queue()` in the order the DATABASE returned — the
 * dashboard filters to this doctor and takes the head of each group, and never
 * sorts. Re-deriving the queue's rules here would be the second copy ADR 0009
 * exists to prevent, and this panel and the queue screen would eventually
 * disagree about who is next.
 */
export function WorkNow({
  current,
  next,
  failed,
  waitingCount,
  locationName,
  canClinical,
}: {
  current: QueueRow | null;
  next: QueueRow | null;
  /** The queue read failed — say so; never draw this as an empty room. */
  failed: boolean;
  waitingCount: number;
  locationName: string;
  canClinical: boolean;
}) {
  return (
    <SectionCard className="overflow-hidden">
      <SectionHeader
        title="Work now"
        icon={<ListChecks className="size-4" />}
        action={
          <Link
            href="/queue"
            // min-h-11: a header shortcut is still a touch target.
            className="inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-[13px] font-semibold text-brand hover:underline focus-visible:focus-ring"
          >
            Live queue
            <ChevronRight className="size-4" aria-hidden="true" />
          </Link>
        }
      />

      <div className="space-y-3 p-4 sm:p-5">
        {failed ? (
          <p className="flex items-start gap-2 rounded-xl bg-danger-soft px-3 py-2.5 text-[13px] font-medium text-[#a81c1c]">
            <CircleAlert className="mt-px size-4 shrink-0" aria-hidden="true" />
            The queue could not be loaded. This is not an empty waiting room —
            open the live queue to check.
          </p>
        ) : null}

        {!failed && !current && !next ? (
          <p className="text-[13px] text-ink-secondary">
            Nobody of yours is waiting at {locationName} right now. Patients
            appear here once reception marks them arrived.
          </p>
        ) : null}

        {current ? (
          <Row
            row={current}
            label="With you now"
            tone="current"
            footer={
              canClinical ? (
                <OpenConsultation appointmentId={current.appointmentId} size="full" />
              ) : (
                <span className="inline-flex items-center gap-1.5 rounded-lg bg-brand-soft px-2.5 py-1 text-xs font-semibold text-brand">
                  <Stethoscope className="size-3.5" aria-hidden="true" />
                  With doctor
                </span>
              )
            }
          />
        ) : null}

        {next ? (
          <Row
            row={next}
            label={current ? "Next for you" : "Ready for you"}
            tone="next"
            footer={
              canClinical ? (
                <StartConsultation
                  appointmentId={next.appointmentId}
                  patientName={next.patientName}
                  tokenNumber={next.tokenNumber}
                  size="full"
                />
              ) : (
                <p className="text-xs font-medium text-ink-secondary">Ready for doctor</p>
              )
            }
          />
        ) : null}

        {!failed && waitingCount > 1 ? (
          <p className="text-xs text-ink-muted">
            {waitingCount - 1} more of yours waiting.
          </p>
        ) : null}
      </div>
    </SectionCard>
  );
}

function Row({
  row,
  label,
  tone,
  footer,
}: {
  row: QueueRow;
  label: string;
  tone: "current" | "next";
  footer: React.ReactNode;
}) {
  return (
    <div
      className={
        tone === "current"
          ? "rounded-xl border border-brand/40 bg-brand-soft/40 p-3.5"
          : "rounded-xl border border-hairline p-3.5"
      }
    >
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
        {label}
      </p>

      <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-1">
        {/*
          The token is the LOCATION's serial for the day, shared with every
          other doctor here — labelled so nobody reads "#3" as "your third
          patient" and calls the wrong person in.
        */}
        <span className="inline-flex items-baseline gap-1 rounded-lg bg-white px-2 py-0.5 text-sm font-bold tabular-nums text-brand ring-1 ring-inset ring-hairline">
          #{row.tokenNumber ?? "—"}
          <span className="text-[10px] font-medium uppercase tracking-wide text-ink-muted">
            desk serial
          </span>
        </span>
        <Link
          href={`/patients/${row.patientId}`}
          className="-my-3 inline-flex items-center py-3 text-sm font-semibold text-ink hover:underline focus-visible:focus-ring"
        >
          {row.patientName}
        </Link>
      </div>

      <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-ink-secondary">
        <span className="tabular-nums">{row.patientNumber}</span>
        {row.arrivedAt ? (
          <>
            <span aria-hidden="true">·</span>
            <span className="inline-flex items-center gap-1">
              <Clock className="size-3" aria-hidden="true" />
              arrived {timeInZone(row.arrivedAt)}
            </span>
          </>
        ) : null}
        {row.priority > 0 && row.priorityReason ? (
          <>
            <span aria-hidden="true">·</span>
            <span className="font-medium text-[#8a3f07]">
              {PRIORITY_REASON_LABEL[row.priorityReason]}
            </span>
          </>
        ) : null}
      </p>

      <div className="mt-3">{footer}</div>
    </div>
  );
}
