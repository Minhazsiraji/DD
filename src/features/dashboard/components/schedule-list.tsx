import * as React from "react";
import Link from "next/link";
import { CalendarDays, ChevronRight } from "lucide-react";
import { SectionCard, SectionHeader } from "@/components/common/section-card";
import { StatusBadge } from "@/components/common/status-badge";
import { formatTime, VISIT_TYPE_LABEL } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ScheduleSlot } from "@/mocks/types";

/**
 * Today's schedule. Clinical-adjacent list content, so it renders on an opaque
 * SectionCard rather than glass.
 */
export function ScheduleList({ slots }: { slots: ScheduleSlot[] }) {
  return (
    <SectionCard className="overflow-hidden">
      <SectionHeader
        title="Today's schedule"
        count={slots.length}
        icon={<CalendarDays className="size-4" />}
        action={
          <Link
            href="/appointments"
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[13px] font-semibold text-brand hover:bg-brand-soft focus-visible:focus-ring"
          >
            All
            <ChevronRight className="size-3.5" aria-hidden="true" />
          </Link>
        }
      />

      <ul className="divide-y divide-hairline">
        {slots.map((slot) => {
          const done = slot.status === "COMPLETED";
          const active = slot.status === "IN_CONSULTATION";

          return (
            <li
              key={slot.id}
              className={cn(
                "flex items-center gap-3 px-4 py-2.5 sm:px-5",
                active && "bg-brand-soft/60",
              )}
            >
              <span
                className={cn(
                  "w-[68px] shrink-0 text-[13px] font-semibold tabular-nums",
                  done ? "text-ink-muted" : "text-ink",
                )}
              >
                {formatTime(slot.time)}
              </span>

              <div className="min-w-0 flex-1">
                <p
                  className={cn(
                    "truncate text-sm font-medium",
                    done ? "text-ink-muted" : "text-ink",
                  )}
                >
                  {slot.patientName}
                </p>
                <p className="truncate text-xs text-ink-muted">
                  {VISIT_TYPE_LABEL[slot.visitType]}
                </p>
              </div>

              <StatusBadge status={slot.status} className="hidden sm:inline-flex" />
            </li>
          );
        })}
      </ul>
    </SectionCard>
  );
}
