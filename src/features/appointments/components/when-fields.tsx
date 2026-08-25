"use client";

import * as React from "react";

/**
 * "Please come on 25 Aug at 7:30 PM" — two questions, two controls.
 *
 * It was ONE `datetime-local`, and on a desktop that is a single strip of
 * segments where the arrow keys walk from year into hour. Reception rescheduling
 * a patient by an hour could nudge the date without noticing, and the person on
 * the phone is told the wrong day.
 *
 * THE SUBMITTED VALUE IS UNCHANGED. A hidden `scheduledFor` still carries
 * exactly `YYYY-MM-DDTHH:mm`, the same field name and the same format the
 * server already validates — so the timezone rules, the clinic's session-date
 * derivation and the stored timestamp are all untouched. This is a change to
 * how the question is ASKED, not to what is recorded.
 */
export function WhenFields({
  initial,
  error,
}: {
  /** `YYYY-MM-DDTHH:mm`, from the server's echoed values or today's default. */
  initial: string;
  error?: string;
}) {
  const [date, setDate] = React.useState(() => split(initial).date);
  const [time, setTime] = React.useState(() => split(initial).time);

  return (
    <div className="grid gap-4 sm:col-span-2 sm:grid-cols-2">
      {/*
        The one value the server sees. Kept in sync here rather than assembled
        on the server, so there is no second parser to disagree with the first.
      */}
      <input type="hidden" name="scheduledFor" value={`${date}T${time}`} />

      <div className="space-y-1.5">
        <label htmlFor="book-date" className="block text-[13px] font-medium text-ink">
          Date
        </label>
        <input
          id="book-date"
          type="date"
          required
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="h-11 w-full rounded-xl border border-hairline bg-white px-3 text-sm text-ink tabular-nums focus-visible:focus-ring"
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="book-time" className="block text-[13px] font-medium text-ink">
          Time
        </label>
        <input
          id="book-time"
          type="time"
          required
          value={time}
          onChange={(e) => setTime(e.target.value)}
          className="h-11 w-full rounded-xl border border-hairline bg-white px-3 text-sm text-ink tabular-nums focus-visible:focus-ring"
        />
      </div>

      {error ? (
        <p className="text-xs font-medium text-danger sm:col-span-2">{error}</p>
      ) : null}
    </div>
  );
}

/** Tolerant of a missing or malformed half — neither control may render blank. */
export function split(value: string): { date: string; time: string } {
  const [date = "", time = ""] = value.split("T");
  return {
    date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : "",
    time: /^\d{2}:\d{2}/.test(time) ? time.slice(0, 5) : "10:00",
  };
}
