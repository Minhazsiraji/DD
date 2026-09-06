export interface FollowUpShortcut {
  label: string;
  date: string;
}

/**
 * Return the active location's literal calendar day. No browser clock and no
 * instant is ever persisted as a follow-up date.
 */
export function calendarDateInTimeZone(timeZone: string, now = new Date()): string | null {
  try {
    const parts = new Intl.DateTimeFormat("en", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(now);
    const year = parts.find((part) => part.type === "year")?.value;
    const month = parts.find((part) => part.type === "month")?.value;
    const day = parts.find((part) => part.type === "day")?.value;
    return year && month && day ? `${year}-${month}-${day}` : null;
  } catch {
    return null;
  }
}

/** Calendar arithmetic after timezone resolution: add days to YYYY-MM-DD only. */
export function addCalendarDays(date: string, days: number): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return null;
  const instant = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days));
  if (Number.isNaN(instant.getTime())) return null;
  const year = instant.getUTCFullYear();
  const month = String(instant.getUTCMonth() + 1).padStart(2, "0");
  const day = String(instant.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Add whole calendar months to a literal chamber-local date.
 *
 * This is deliberately not 30/60/90-day arithmetic. The day-of-month is kept
 * when that day exists in the target month and clamped to the target month's
 * final valid day otherwise (31 Jan + 1 month -> 28/29 Feb).
 */
export function addCalendarMonths(date: string, months: number): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match || !Number.isInteger(months)) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1) return null;

  const sourceLastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day > sourceLastDay) return null;

  const targetIndex = year * 12 + (month - 1) + months;
  const targetYear = Math.floor(targetIndex / 12);
  const targetMonthIndex = ((targetIndex % 12) + 12) % 12;
  const targetLastDay = new Date(Date.UTC(targetYear, targetMonthIndex + 1, 0)).getUTCDate();
  const targetDay = Math.min(day, targetLastDay);

  return `${String(targetYear).padStart(4, "0")}-${String(targetMonthIndex + 1).padStart(2, "0")}-${String(targetDay).padStart(2, "0")}`;
}

export function getFollowUpShortcuts(timeZone: string | null, now = new Date()): FollowUpShortcut[] {
  if (!timeZone) return [];
  const today = calendarDateInTimeZone(timeZone, now);
  if (!today) return [];

  const dayShortcuts = [
    ["Tomorrow", 1],
    ["3 days", 3],
    ["1 week", 7],
    ["2 weeks", 14],
  ] as const;
  const monthShortcuts = [
    ["1 month", 1],
    ["2 months", 2],
    ["3 months", 3],
  ] as const;

  return [
    ...dayShortcuts.flatMap(([label, offset]) => {
      const date = addCalendarDays(today, offset);
      return date ? [{ label, date }] : [];
    }),
    ...monthShortcuts.flatMap(([label, offset]) => {
      const date = addCalendarMonths(today, offset);
      return date ? [{ label, date }] : [];
    }),
  ];
}
