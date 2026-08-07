import * as React from "react";
import { FileText, TriangleAlert, Clock } from "lucide-react";
import { SectionCard, SectionHeader } from "@/components/common/section-card";
import { EmptyState } from "@/components/common/empty-state";
import { formatDateShort } from "@/lib/format";
import type { PendingReport } from "@/mocks/types";

export function ReportsPanel({ reports }: { reports: PendingReport[] }) {
  return (
    <SectionCard className="overflow-hidden">
      <SectionHeader
        title="Reports"
        count={reports.length}
        icon={<FileText className="size-4" />}
      />

      {reports.length === 0 ? (
        <EmptyState
          icon={<FileText className="size-5" />}
          title="No reports outstanding"
          description="Investigations you order will appear here until the result is attached."
        />
      ) : (
        <ul className="divide-y divide-hairline">
          {reports.map((report) => {
            const received = report.receivedOn !== null;

            return (
              <li key={report.id} className="flex items-start gap-3 px-4 py-3 sm:px-5">
                <span className="mt-0.5 shrink-0" aria-hidden="true">
                  {report.isAbnormal ? (
                    <TriangleAlert className="size-4 text-danger" />
                  ) : (
                    <Clock className="size-4 text-ink-muted" />
                  )}
                </span>

                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink">
                    {report.testName}
                    {report.isAbnormal ? (
                      <span className="ml-2 rounded bg-danger-soft px-1.5 py-0.5 text-[11px] font-bold text-[#a81c1c]">
                        ABNORMAL
                      </span>
                    ) : null}
                  </p>
                  <p className="truncate text-xs text-ink-secondary">
                    {report.patientName} ·{" "}
                    <span className="font-mono text-ink-muted">
                      {report.patientNumber}
                    </span>
                  </p>
                  <p className="mt-0.5 text-xs text-ink-muted tabular-nums">
                    {received
                      ? `Received ${formatDateShort(report.receivedOn as string)}`
                      : `Awaiting result · ordered ${formatDateShort(report.requestedOn)}`}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </SectionCard>
  );
}
