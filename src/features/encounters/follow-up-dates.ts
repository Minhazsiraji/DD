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

export function getFollowUpShortcuts(timeZone: string | null, now = new Date()): FollowUpShortcut[] {
  if (!timeZone) return [];
  const today = calendarDateInTimeZone(timeZone, now);
  if (!today) return [];

  return [
    ["Tomorrow", 1],
    ["3 days", 3],
    ["1 week", 7],
    ["2 weeks", 14],
  ].flatMap(([label, offset]) => {
    const date = addCalendarDays(today, Number(offset));
    return date ? [{ label: String(label), date }] : [];
  });
}
