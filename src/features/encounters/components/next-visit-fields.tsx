"use client";

import * as React from "react";
import { SectionCard, SectionHeader } from "@/components/common/section-card";
import { CALENDAR_DATE, type DraftKey, type DraftValues } from "../schema";

/**
 * WHEN TO COME BACK.
 *
 * Two halves of one statement — "with reports · 2 Sep 2026" — and either may
 * stand alone. Neither is mandatory: a consultation with no follow-up has no
 * follow-up, and a section that insisted on one would get a date invented to
 * satisfy it.
 *
 * THE DATE IS A DAY ON A CALENDAR, NOT AN INSTANT.
 *
 * `<input type="date">` holds and emits the literal `YYYY-MM-DD` the doctor
 * picked, and that string travels unchanged to a `date` column. Nothing here
 * constructs a `Date`, and nothing here calls `toISOString()`:
 * `new Date("2026-09-02").toISOString()` is 2026-09-01 for every doctor west of
 * UTC, and the reverse conversion loses a day just as easily in Dhaka. A
 * follow-up that silently moves by one day is a patient who arrives to a closed
 * chamber, or a course of antibiotics reviewed a day late.
 *
 * There is also no "in 7 days" shortcut. Offering one would mean this component
 * computing a date from a clock — and whose clock, in which timezone, on which
 * side of midnight, are three questions with no safe default. The doctor picks
 * the day.
 */
export function NextVisitFields({
  values,
  dirtyKeys,
  disabled,
  onChange,
  shownBecauseFilled = false,
}: {
  values: DraftValues;
  dirtyKeys: DraftKey[];
  disabled: boolean;
  onChange: (key: DraftKey, value: string) => void;
  shownBecauseFilled?: boolean;
}) {
  const date = values.nextVisitOn ?? "";
  const note = values.nextVisitNote ?? "";
  const unsaved = dirtyKeys.includes("nextVisitOn") || dirtyKeys.includes("nextVisitNote");

  /**
   * A date the browser could not parse arrives as "" from the input itself, so
   * this only ever fires on a value that reached the editor some other way —
   * a stored one, or a paste. Reported rather than silently corrected.
   */
  const badDate = date !== "" && !CALENDAR_DATE.test(date);

  return (
    <SectionCard>
      <SectionHeader
        title="Next visit"
        action={
          unsaved ? (
            <span className="rounded-full bg-warning-soft px-2 py-0.5 text-[11px] font-semibold text-warning">
              Unsaved
            </span>
          ) : (
            <span className="text-[11px] text-ink-muted">Optional</span>
          )
        }
      />
      {shownBecauseFilled ? (
        <p className="border-b border-hairline bg-surface-muted px-4 py-2 text-[12px] text-ink-secondary sm:px-5">
          Shown because this visit already contains information.
        </p>
      ) : null}

      <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:p-5">
        <div className="sm:w-48">
          <label htmlFor="nextVisitOn" className="block text-[12px] font-medium text-ink-secondary">
            Date
          </label>
          <input
            id="nextVisitOn"
            name="nextVisitOn"
            type="date"
            disabled={disabled}
            /*
              `e.target.value` IS the calendar date, already `YYYY-MM-DD`. It is
              passed through untouched — see the note at the top of this file
              for what happens if anyone routes it through a `Date`.
            */
            value={date}
            onChange={(e) => onChange("nextVisitOn", e.target.value)}
            aria-invalid={badDate ? true : undefined}
            aria-describedby={badDate ? "nextVisitOn-error" : undefined}
            className="mt-1 h-11 w-full rounded-xl border border-hairline bg-white px-3 text-[15px] tabular-nums text-ink focus-visible:focus-ring disabled:bg-surface-muted disabled:text-ink-secondary"
          />
          {badDate ? (
            <p id="nextVisitOn-error" role="alert" className="mt-1 text-[12px] text-[#a81c1c]">
              This follow-up date is not a date this app can read. Choose it again from the
              calendar.
            </p>
          ) : null}
        </div>

        <div className="min-w-0 flex-1">
          <label
            htmlFor="nextVisitNote"
            className="block text-[12px] font-medium text-ink-secondary"
          >
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
            className="mt-1 h-11 w-full rounded-xl border border-hairline bg-white px-3 text-[15px] text-ink placeholder:text-ink-muted focus-visible:focus-ring disabled:bg-surface-muted disabled:text-ink-secondary"
          />
        </div>
      </div>
    </SectionCard>
  );
}
