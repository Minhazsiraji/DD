"use client";

import * as React from "react";
import { SectionCard, SectionHeader } from "@/components/common/section-card";
import { CALENDAR_DATE, type DraftKey, type DraftValues } from "../schema";
import type { FollowUpShortcut } from "../follow-up-dates";
import { appendTextSuggestion } from "../text-suggestions";

const NOTE_SUGGESTIONS = ["With reports", "If symptoms persist", "After treatment course"] as const;

/**
 * Follow-up remains the accepted `date + short note` contract. Date shortcuts
 * are already resolved by the server from the active location timezone; this
 * component only copies the literal YYYY-MM-DD the doctor explicitly selects.
 */
export function NextVisitFields({
  values,
  dirtyKeys,
  disabled,
  onChange,
  shortcuts = [],
  shownBecauseFilled = false,
}: {
  values: DraftValues;
  dirtyKeys: DraftKey[];
  disabled: boolean;
  onChange: (key: DraftKey, value: string) => void;
  shortcuts?: FollowUpShortcut[];
  shownBecauseFilled?: boolean;
}) {
  const date = values.nextVisitOn ?? "";
  const note = values.nextVisitNote ?? "";
  const unsaved = dirtyKeys.includes("nextVisitOn") || dirtyKeys.includes("nextVisitNote");
  const badDate = date !== "" && !CALENDAR_DATE.test(date);

  return (
    <SectionCard>
      <SectionHeader
        title="Follow-up"
        action={
          unsaved ? (
            <span className="rounded-full bg-warning-soft px-2 py-0.5 text-[11px] font-semibold text-warning">
              Pending
            </span>
          ) : (
            <span className="text-[11px] text-ink-muted">Optional</span>
          )
        }
      />
      {shownBecauseFilled ? (
        <p className="border-b border-white/45 px-4 py-2 text-[12px] text-ink-secondary sm:px-5">
          Shown because this visit already contains information.
        </p>
      ) : null}

      <div className="space-y-3 p-4 sm:p-5">
        {shortcuts.length > 0 ? (
          <div>
            <p className="text-[11px] text-ink-muted">Quick date · uses this chamber&rsquo;s timezone</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {shortcuts.map((shortcut) => (
                <button
                  key={shortcut.label}
                  type="button"
                  disabled={disabled}
                  onClick={() => onChange("nextVisitOn", shortcut.date)}
                  className="dd-secondary inline-flex min-h-11 items-center px-3 text-[12px] font-semibold disabled:opacity-45 focus-visible:focus-ring"
                >
                  {shortcut.label}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
          <div className="sm:w-48">
            <label htmlFor="nextVisitOn" className="block text-[12px] font-medium text-ink-secondary">
              Date
            </label>
            <input
              id="nextVisitOn"
              name="nextVisitOn"
              type="date"
              disabled={disabled}
              value={date}
              onChange={(e) => onChange("nextVisitOn", e.target.value)}
              aria-invalid={badDate ? true : undefined}
              aria-describedby={badDate ? "nextVisitOn-error" : undefined}
              className="mt-1 h-11 w-full rounded-xl border border-hairline bg-white/90 px-3 text-[15px] tabular-nums text-ink focus-visible:focus-ring disabled:bg-surface-muted disabled:text-ink-secondary"
            />
            {badDate ? (
              <p id="nextVisitOn-error" role="alert" className="mt-1 text-[12px] text-[#a81c1c]">
                Choose this date again from the calendar.
              </p>
            ) : null}
          </div>

          <div className="min-w-0 flex-1">
            <label htmlFor="nextVisitNote" className="block text-[12px] font-medium text-ink-secondary">
              Note
            </label>
            <input
              id="nextVisitNote"
              name="nextVisitNote"
              type="text"
              disabled={disabled}
              value={note}
              placeholder="With reports · if the fever returns · after the course"
              onChange={(e) => onChange("nextVisitNote", e.target.value)}
              className="mt-1 h-11 w-full rounded-xl border border-hairline bg-white/90 px-3 text-[15px] text-ink placeholder:text-ink-muted focus-visible:focus-ring disabled:bg-surface-muted disabled:text-ink-secondary"
            />
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {NOTE_SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  disabled={disabled}
                  onClick={() =>
                    onChange("nextVisitNote", appendTextSuggestion(note, suggestion))
                  }
                  className="inline-flex min-h-11 items-center rounded-xl px-2.5 text-[11px] font-semibold text-brand hover:bg-white/35 disabled:opacity-45 focus-visible:focus-ring"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </SectionCard>
  );
}
