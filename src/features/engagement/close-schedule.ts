import "server-only";

const DAY_MS = 86_400_000;

function localDateParts(now: Date, timeZone: string) {
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  } catch {
    throw new Error("O1_PILOT_CLOSE_TIME_ZONE_INVALID");
  }
  const parts = Object.fromEntries(
    formatter
      .formatToParts(now)
      .filter((part) => part.type === "year" || part.type === "month" || part.type === "day")
      .map((part) => [part.type, part.value]),
  );
  if (!parts.year || !parts.month || !parts.day) throw new Error("O1_PILOT_CLOSE_DAY_INVALID");
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day) };
}

/** Previous fully completed calendar date in the configured pilot-close timezone. */
export function previousCompletedClinicDay(now: Date, timeZone: string): string {
  if (!Number.isFinite(now.getTime())) throw new Error("O1_PILOT_CLOSE_CLOCK_INVALID");
  if (!timeZone.trim()) throw new Error("O1_PILOT_CLOSE_TIME_ZONE_REQUIRED");
  const p = localDateParts(now, timeZone);
  const previous = new Date(Date.UTC(p.year, p.month - 1, p.day) - DAY_MS);
  return previous.toISOString().slice(0, 10);
}
