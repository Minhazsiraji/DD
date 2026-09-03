"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ListChecks, ChevronRight, Stethoscope, Clock, CircleAlert } from "lucide-react";
import { GlassCard } from "@/components/glass/glass-card";
import { StartConsultation } from "@/features/queue/components/start-consultation";
import { timeInZone } from "@/features/appointments/schema";
import { PRIORITY_REASON_LABEL, type QueueRow } from "@/features/queue/schema";

export function WorkNow({
  current,
  next,
  failed,
  waitingCount,
  locationName,
}: {
  current: QueueRow | null;
  next: QueueRow | null;
  failed: boolean;
  waitingCount: number;
  locationName: string;
}) {
  const router = useRouter();
  const refresh = React.useCallback(() => router.refresh(), [router]);

  return (
    <GlassCard tone="strong" className="dd-dashboard-card overflow-hidden">
      <div className="flex min-w-0 items-center justify-between gap-3 border-b border-white/65 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="dd-feature-icon inline-flex size-8 shrink-0 items-center justify-center rounded-full text-brand">
            <ListChecks className="size-4" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h2 className="text-[14px] font-semibold text-ink">Work now</h2>
            <p className="text-[10.5px] text-ink-muted">Who needs your attention next</p>
          </div>
        </div>
        <Link
          href="/queue"
          className="dd-secondary inline-flex h-9 shrink-0 items-center gap-1 rounded-full px-3 text-[11.5px] font-semibold text-brand focus-visible:focus-ring"
        >
          Live queue
          <ChevronRight className="size-3.5" aria-hidden="true" />
        </Link>
      </div>

      <div className="space-y-2.5 p-3.5 sm:p-4">
        {failed ? (
          <p className="flex items-start gap-2 rounded-[14px] bg-danger-soft px-3 py-2.5 text-[12px] font-medium text-[#a81c1c]">
            <CircleAlert className="mt-px size-4 shrink-0" aria-hidden="true" />
            The queue could not be loaded. This is not an empty waiting room — open the live queue to check.
          </p>
        ) : null}

        {!failed && !current && !next ? (
          <div className="dd-patient-tile rounded-[16px] px-4 py-4 text-[12.5px] text-ink-secondary">
            Nobody of yours is waiting at {locationName} right now. Patients appear here once reception marks them arrived.
          </div>
        ) : null}

        {current ? (
          <Row
            row={current}
            label="With you now"
            tone="current"
            footer={
              <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-soft px-2.5 py-1 text-[11px] font-semibold text-brand">
                <Stethoscope className="size-3.5" aria-hidden="true" />
                In consultation
              </span>
            }
          />
        ) : null}

        {next ? (
          <Row
            row={next}
            label={current ? "Next for you" : "Ready for you"}
            tone="next"
            footer={
              <StartConsultation
                appointmentId={next.appointmentId}
                patientName={next.patientName}
                tokenNumber={next.tokenNumber}
                onStarted={refresh}
                size="full"
              />
            }
          />
        ) : null}

        {!failed && waitingCount > 1 ? (
          <p className="px-1 text-[11px] text-ink-muted">{waitingCount - 1} more of yours waiting.</p>
        ) : null}
      </div>
    </GlassCard>
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
          ? "dd-patient-tile overflow-hidden rounded-[17px] border-brand/30"
          : "dd-patient-tile overflow-hidden rounded-[17px]"
      }
    >
      <div className="flex min-w-0 items-stretch">
        <div className="flex w-[74px] shrink-0 flex-col items-center justify-center border-r border-white/70 bg-[linear-gradient(180deg,rgb(226_217_252/.62),rgb(246_243_250/.34))] px-2 py-3 text-center">
          <span className="text-[18px] leading-none font-bold text-[#5144b7] tabular-nums">#{row.tokenNumber ?? "—"}</span>
          <span className="mt-1 text-[8.5px] font-semibold uppercase tracking-[0.12em] text-ink-muted">desk serial</span>
        </div>

        <div className="min-w-0 flex-1 px-3.5 py-3">
          <p className="text-[9.5px] font-semibold uppercase tracking-[0.15em] text-[#716b87]">{label}</p>
          <Link
            href={`/patients/${row.patientId}`}
            className="mt-1 block truncate text-[14px] font-semibold text-ink hover:underline focus-visible:focus-ring"
          >
            {row.patientName}
          </Link>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10.5px] text-ink-secondary">
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
                <span className="font-medium text-[#8a3f07]">{PRIORITY_REASON_LABEL[row.priorityReason]}</span>
              </>
            ) : null}
          </p>
          <div className="mt-2.5">{footer}</div>
        </div>
      </div>
    </div>
  );
}
