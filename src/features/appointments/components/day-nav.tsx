"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, CalendarDays } from "lucide-react";
import { addDays, todayInDhaka } from "../schema";

/**
 * Day navigation for the appointment list.
 *
 * The date lives in the URL so a receptionist can keep tomorrow's list open in
 * a second tab, and so a refresh does not silently jump back to today while
 * they are working through a queue.
 */
export function DayNav({ sessionDate }: { sessionDate: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const today = todayInDhaka();

  const go = React.useCallback(
    (date: string) => {
      const next = new URLSearchParams(params.toString());
      next.set("date", date);
      router.push(`/appointments?${next.toString()}`);
    },
    [params, router],
  );

  const label =
    sessionDate === today
      ? "Today"
      : sessionDate === addDays(today, 1)
        ? "Tomorrow"
        : sessionDate === addDays(today, -1)
          ? "Yesterday"
          : new Intl.DateTimeFormat("en-GB", {
              weekday: "short",
              day: "numeric",
              month: "short",
            }).format(new Date(`${sessionDate}T00:00:00Z`));

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => go(addDays(sessionDate, -1))}
        aria-label="Previous day"
        className="inline-flex size-11 items-center justify-center rounded-xl border border-hairline bg-white text-ink transition-colors hover:bg-surface-muted focus-visible:focus-ring"
      >
        <ChevronLeft className="size-4" aria-hidden="true" />
      </button>

      <div className="flex min-w-36 flex-col items-center">
        <span className="text-sm font-semibold text-ink">{label}</span>
        <span className="text-xs tabular-nums text-ink-muted">{sessionDate}</span>
      </div>

      <button
        type="button"
        onClick={() => go(addDays(sessionDate, 1))}
        aria-label="Next day"
        className="inline-flex size-11 items-center justify-center rounded-xl border border-hairline bg-white text-ink transition-colors hover:bg-surface-muted focus-visible:focus-ring"
      >
        <ChevronRight className="size-4" aria-hidden="true" />
      </button>

      {sessionDate !== today ? (
        <button
          type="button"
          onClick={() => go(today)}
          className="inline-flex h-11 items-center gap-1.5 rounded-xl border border-hairline bg-white px-3.5 text-[13px] font-semibold text-ink transition-colors hover:bg-surface-muted focus-visible:focus-ring"
        >
          <CalendarDays className="size-4" aria-hidden="true" />
          Today
        </button>
      ) : null}

      <label className="sr-only" htmlFor="day-picker">
        Jump to a date
      </label>
      <input
        id="day-picker"
        type="date"
        value={sessionDate}
        onChange={(e) => e.target.value && go(e.target.value)}
        className="h-11 rounded-xl border border-hairline bg-white px-3 text-sm text-ink focus-visible:focus-ring"
      />
    </div>
  );
}
