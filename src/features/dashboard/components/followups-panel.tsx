import * as React from "react";
import { CalendarClock } from "lucide-react";
import { SectionCard, SectionHeader } from "@/components/common/section-card";
import { relativeDueLabel } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { FollowUpDue } from "@/mocks/types";

const STATUS_STYLE: Record<FollowUpDue["status"], string> = {
  overdue: "bg-danger-soft text-[#a81c1c]",
  recommended: "bg-warning-soft text-[#8a3f07]",
  booked: "bg-success-soft text-[#07684a]",
  completed: "bg-surface-muted text-ink-secondary",
};

export function FollowUpsPanel({
  followUps,
  todayISO,
}: {
  followUps: FollowUpDue[];
  todayISO: string;
}) {
  return (
    <SectionCard className="overflow-hidden">
      <SectionHeader
        title="Follow-ups due"
        count={followUps.length}
        icon={<CalendarClock className="size-4" />}
      />

      <ul className="divide-y divide-hairline">
        {followUps.map((f) => (
          <li key={f.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-ink">{f.patientName}</p>
              <p className="truncate text-xs text-ink-secondary">{f.reason}</p>
            </div>

            <span
              className={cn(
                "shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap tabular-nums",
                STATUS_STYLE[f.status],
              )}
            >
              {relativeDueLabel(f.dueOn, todayISO)}
            </span>
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}
