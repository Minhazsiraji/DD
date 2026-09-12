import { isQualifyingSurface, type EngagementSurface } from "./surfaces";

/**
 * Engaged-use arithmetic. Pure: no clock, no network, no storage.
 *
 * THE UNIT IS A DISTINCT MINUTE, NOT A DURATION. The server stamps each
 * accepted interaction into its minute bucket and records that bucket once.
 * "Engaged minutes" is therefore a count of distinct minutes in which the
 * doctor genuinely interacted — never elapsed time, never a stopwatch.
 *
 * Documented measurement limits, which the presentation layer must carry as
 * "Estimated active time" rather than hide:
 *   - OVERSTATES by up to 59 seconds per engaged minute: one keypress marks the
 *     whole minute.
 *   - UNDERSTATES reading without input: studying a static screen produces no
 *     interaction and therefore no minute.
 */

/** Minimum idle gap that ends one session and starts the next. */
export const SESSION_GAP_MINUTES = 10;

/** Upper bound on buckets one doctor can contribute in a day. */
export const MAX_ENGAGED_MINUTES_PER_DAY = 1440;

/** Fallback clinic timezone, matching the workspace's existing default. */
export const DEFAULT_CLINIC_TIME_ZONE = "Asia/Dhaka";

export interface EngagedMinute {
  /** Server-stamped, truncated to the minute, ISO 8601 UTC. */
  minuteBucket: string;
  surface: EngagementSurface;
}

/**
 * Truncate a SERVER instant to its minute. The client's clock is never an
 * input: it can be wrong, it can be set, and it is not ours to trust.
 */
export function minuteBucket(serverNow: Date): string {
  const ms = serverNow.getTime();
  if (!Number.isFinite(ms)) throw new Error("minuteBucket requires a valid server time");
  const truncated = new Date(ms - (ms % 60_000));
  return truncated.toISOString();
}

/**
 * The clinic day an instant belongs to, in the location's own timezone.
 *
 * `timestamptz::date` in Postgres, and `toISOString().slice(0, 10)` here, both
 * answer in UTC — so a 00:30 visit in Dhaka would file under the previous day.
 * An engaged minute belongs to the day the doctor was at work.
 */
export function clinicDay(instant: Date | string, timeZone: string = DEFAULT_CLINIC_TIME_ZONE): string {
  const date = typeof instant === "string" ? new Date(instant) : instant;
  if (!Number.isFinite(date.getTime())) throw new Error("clinicDay requires a valid instant");
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  } catch {
    // An unrecognised zone must not silently become UTC; fall back to the
    // clinic default instead, which is at least a real clinic's day.
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: DEFAULT_CLINIC_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  }
  return formatter.format(date);
}

/** Distinct minutes, sorted, with duplicates collapsed. */
function distinctSorted(minutes: readonly string[]): number[] {
  return [...new Set(minutes.map((m) => Date.parse(m)))]
    .filter((ms) => Number.isFinite(ms))
    .sort((a, b) => a - b);
}

/**
 * Headline engaged minutes: distinct minutes on QUALIFYING surfaces only.
 *
 * A minute in which the doctor touched both CONSULTATION and PRESCRIPTION is
 * one engaged minute, not two. A minute spent only in SETTINGS is zero.
 */
export function engagedMinutes(minutes: readonly EngagedMinute[]): number {
  return distinctSorted(
    minutes.filter((m) => isQualifyingSurface(m.surface)).map((m) => m.minuteBucket),
  ).length;
}

/** Distinct minutes per surface, including non-qualifying ones. */
export function minutesBySurface(
  minutes: readonly EngagedMinute[],
): Partial<Record<EngagementSurface, number>> {
  const buckets = new Map<EngagementSurface, Set<string>>();
  for (const m of minutes) {
    const set = buckets.get(m.surface) ?? new Set<string>();
    set.add(m.minuteBucket);
    buckets.set(m.surface, set);
  }
  const out: Partial<Record<EngagementSurface, number>> = {};
  for (const [surface, set] of buckets) out[surface] = set.size;
  return out;
}

export interface EngagementSession {
  startedAt: string;
  endedAt: string;
  /** Distinct engaged minutes inside the session. */
  engagedMinutes: number;
}

/**
 * Sessions: maximal runs of qualifying minutes separated by a gap of at least
 * `gapMinutes`. A clinic with a lunch break is two sessions, correctly.
 *
 * Built only from qualifying minutes, so a morning spent in settings is not a
 * session of practice.
 */
export function deriveSessions(
  minutes: readonly EngagedMinute[],
  gapMinutes: number = SESSION_GAP_MINUTES,
): EngagementSession[] {
  const sorted = distinctSorted(
    minutes.filter((m) => isQualifyingSurface(m.surface)).map((m) => m.minuteBucket),
  );
  const sessions: EngagementSession[] = [];
  let start: number | null = null;
  let last: number | null = null;
  let count = 0;
  const flush = () => {
    if (start !== null && last !== null) {
      sessions.push({
        startedAt: new Date(start).toISOString(),
        endedAt: new Date(last + 60_000).toISOString(),
        engagedMinutes: count,
      });
    }
  };
  for (const ms of sorted) {
    if (last === null || ms - last >= gapMinutes * 60_000) {
      flush();
      start = ms;
      count = 0;
    }
    last = ms;
    count += 1;
  }
  flush();
  return sessions;
}

/** Clinic days containing at least one QUALIFYING engaged minute. */
export function activeDays(
  minutes: readonly EngagedMinute[],
  timeZone: string = DEFAULT_CLINIC_TIME_ZONE,
): string[] {
  const days = new Set<string>();
  for (const m of minutes) {
    if (isQualifyingSurface(m.surface)) days.add(clinicDay(m.minuteBucket, timeZone));
  }
  return [...days].sort();
}

/**
 * ACTIVE DOCTOR: at least one qualifying engaged minute in the window.
 *
 * Settings alone never qualifies. Signing in alone never qualifies — there is
 * no sign-in surface, so a sign-in produces no minute at all.
 */
export function isActiveDoctor(minutes: readonly EngagedMinute[]): boolean {
  return minutes.some((m) => isQualifyingSurface(m.surface));
}

/** Most recent qualifying minute, or null. Distinct from last sign-in. */
export function lastEngagedAt(minutes: readonly EngagedMinute[]): string | null {
  const sorted = distinctSorted(
    minutes.filter((m) => isQualifyingSurface(m.surface)).map((m) => m.minuteBucket),
  );
  const last = sorted.at(-1);
  return last === undefined ? null : new Date(last).toISOString();
}

/**
 * Reject a server-stamped bucket that cannot be genuine. The browser is never
 * trusted, but neither is a clock that has drifted: a bucket in the future or
 * older than the ingest window is refused rather than recorded.
 */
export function isAcceptableBucket(bucket: string, serverNow: Date, maxAgeHours = 48): boolean {
  const ms = Date.parse(bucket);
  if (!Number.isFinite(ms)) return false;
  const now = serverNow.getTime();
  if (ms > now) return false;
  return now - ms <= maxAgeHours * 3_600_000;
}
