import * as React from "react";
import Link from "next/link";
import { ListChecks, ChevronRight, TriangleAlert } from "lucide-react";
import { SectionCard, SectionHeader } from "@/components/common/section-card";
import { StatusBadge } from "@/components/common/status-badge";
import { formatTime, formatAgeSex, VISIT_TYPE_LABEL } from "@/lib/format";
import type { QueueEntry } from "@/mocks/types";

export function QueuePreview({ queue }: { queue: QueueEntry[] }) {
  return (
    <SectionCard className="overflow-hidden">
      <SectionHeader
        title="Waiting"
        count={queue.length}
        icon={<ListChecks className="size-4" />}
        action={
          <Link
            href="/queue"
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[13px] font-semibold text-brand hover:bg-brand-soft focus-visible:focus-ring"
          >
            Live queue
            <ChevronRight className="size-3.5" aria-hidden="true" />
          </Link>
        }
      />

      <ul className="divide-y divide-hairline">
        {queue.map((entry) => (
          <li key={entry.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-surface-muted text-sm font-bold text-ink ring-1 ring-hairline ring-inset tabular-nums">
              {entry.tokenNumber}
            </span>

            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1.5 truncate text-sm font-medium text-ink">
                {entry.patient.fullName}
                {entry.patient.allergies.length > 0 ? (
                  <TriangleAlert
                    className="size-3.5 shrink-0 text-danger"
                    aria-label="Recorded drug allergy"
                  />
                ) : null}
              </p>
              <p className="truncate text-xs text-ink-secondary tabular-nums">
                {formatAgeSex(
                  entry.patient.ageYears,
                  entry.patient.sex,
                  entry.patient.dobPrecision,
                )}{" "}
                · {VISIT_TYPE_LABEL[entry.visitType]} · exp.{" "}
                {formatTime(entry.expectedAt)}
              </p>
            </div>

            <StatusBadge status={entry.status} className="hidden sm:inline-flex" />
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}
