"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ListChecks, ChevronRight, Stethoscope, Clock, CircleAlert } from "lucide-react";
import { SectionCard, SectionHeader } from "@/components/common/section-card";
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
    <SectionCard className="overflow-hidden">
      <SectionHeader
        title="Work now"
        icon={<ListChecks className="size-4" />}
        action={
          <Link
            href="/queue"
            className="liquid-secondary inline-flex min-h-10 items-center gap-1 rounded-full px-3 text-[13px] font-semibold text-brand focus-visible:focus-ring"
          >
            Live queue
            <ChevronRight className="size-4" aria-hidden="true" />
          </Link>
        }
      />

      <div className="space-y-3 p-4 sm:p-5">
        {failed ? (
          <p className="flex items-start gap-2 rounded-[16px] bg-danger-soft px-3 py-2.5 text-[13px] font-medium text-[#b63745]">
            <CircleAlert className="mt-px size-4 shrink-0" aria-hidden="true" />
            The queue could not be loaded. This is not an empty waiting room — open the live queue to check.
          </p>
        ) : null}

        {!failed && !current && !next ? (
          <div className="liquid-panel rounded-[18px] px-4 py-4 text-[13px] leading-relaxed text-ink-secondary">
            Nobody of yours is waiting at {locationName} right now. Patients appear here once reception marks them arrived.
          </div>
        ) : null}

        {current ? (
          <Row
            row={current}
            label="With you now"
            tone="current"
            footer={
              <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-soft px-3 py-1.5 text-xs font-semibold text-brand shadow-[inset_0_1px_0_white]">
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
          <p className="text-xs text-ink-muted">{waitingCount - 1} more of yours waiting.</p>
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
          ? "liquid-panel rounded-[20px] bg-brand-soft/20 p-4"
          : "liquid-panel rounded-[20px] p-4"
      }
    >
      <p className="text-[11px] font-semibold uppercase tracking-[0.13em] text-ink-muted">{label}</p>

      <div className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="inline-flex items-baseline gap-1 rounded-full border border-white/75 bg-white/72 px-2.5 py-1 text-sm font-bold text-brand shadow-[inset_0_1px_0_white] tabular-nums">
          #{row.tokenNumber ?? "—"}
          <span className="text-[9px] font-medium uppercase tracking-wide text-ink-muted">desk serial</span>
        </span>
        <Link
          href={`/patients/${row.patientId}`}
          className="-my-3 inline-flex items-center py-3 text-[15px] font-semibold tracking-[-0.01em] text-ink hover:text-brand focus-visible:focus-ring"
        >
          {row.patientName}
        </Link>
      </div>

      <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-ink-secondary">
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
            <span className="font-medium text-[#a65d0f]">{PRIORITY_REASON_LABEL[row.priorityReason]}</span>
          </>
        ) : null}
      </p>

      <div className="mt-3">{footer}</div>
    </div>
  );
}
