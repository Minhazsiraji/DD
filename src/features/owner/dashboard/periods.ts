/**
 * The dashboard's reporting period — Today, 7 days, 30 days or a custom range.
 *
 * It lives in the URL (`?period=7d`, `?period=custom&from=…&to=…`) so a view is
 * shareable, survives a refresh, and is rendered on the server.
 *
 * NO HIDDEN CLOCK AND NO HIDDEN ZONE. O1-F takes two explicit `date` bounds,
 * so a window has to be computed somewhere — but nothing here reads the clock
 * and nothing here assumes a market's timezone. The caller passes the reference
 * day in, the window comes back as two ISO days, and the dashboard prints those
 * two days on screen. What the owner is looking at is therefore always stated,
 * never implied. Which zone defines "today" for a pilot is a product decision
 * (O1D-6) that this module deliberately does not make on its own.
 *
 * Pure: no I/O.
 */

export const PERIODS = ["today", "7d", "30d", "custom"] as const;
export type PeriodKind = (typeof PERIODS)[number];

export const PERIOD_LABEL: Record<PeriodKind, string> = {
  today: "Today",
  "7d": "7 days",
  "30d": "30 days",
  custom: "Custom",
};

export type Period =
  | { kind: "today" | "7d" | "30d" }
  | { kind: "custom"; from: string; to: string };

export const DEFAULT_PERIOD: Period = { kind: "30d" };

/** The longest custom range accepted. Beyond it, the source picks a grain. */
export const MAX_CUSTOM_DAYS = 366;

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

function isRealDay(value: string): boolean {
  if (!ISO_DAY.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  // Rejects 2026-02-30, which the regex alone would accept.
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

function spanDays(from: string, to: string): number {
  const ms = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`);
  return Math.round(ms / 86_400_000) + 1;
}

/**
 * Parse search params into a period. Anything malformed falls back to the
 * default rather than erroring: a bad bookmark should show a dashboard, not a
 * crash — and never a range the owner did not ask for silently widened.
 */
export function parsePeriod(params: Record<string, string | string[] | undefined>): Period {
  const one = (k: string) => (typeof params[k] === "string" ? (params[k] as string) : "");
  const kind = one("period");

  if (kind === "today" || kind === "7d" || kind === "30d") return { kind };

  if (kind === "custom") {
    const from = one("from");
    const to = one("to");
    if (isRealDay(from) && isRealDay(to) && from <= to) {
      const days = spanDays(from, to);
      if (days >= 1 && days <= MAX_CUSTOM_DAYS) return { kind: "custom", from, to };
    }
  }

  return DEFAULT_PERIOD;
}

export function describePeriod(p: Period): string {
  return p.kind === "custom" ? `${p.from} → ${p.to}` : PERIOD_LABEL[p.kind];
}

/** Serialise back to query params, so tab links keep the owner's choice. */
export function periodQuery(p: Period): string {
  const q = new URLSearchParams({ period: p.kind });
  if (p.kind === "custom") {
    q.set("from", p.from);
    q.set("to", p.to);
  }
  return q.toString();
}

/** The two inclusive ISO days O1-F is asked for. */
export interface PeriodWindow {
  start: string;
  end: string;
}

function addDays(iso: string, delta: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + delta * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Resolve a period against an explicit reference day.
 *
 * `today` is inclusive of itself, so "7 days" is the reference day and the six
 * before it — not eight days, and not a week that quietly excludes today.
 */
export function periodWindow(p: Period, todayIso: string): PeriodWindow {
  if (p.kind === "custom") return { start: p.from, end: p.to };
  const span = p.kind === "today" ? 1 : p.kind === "7d" ? 7 : 30;
  return { start: addDays(todayIso, -(span - 1)), end: todayIso };
}

/** The reference day in UTC. The only place this module admits a clock exists. */
export function todayIsoUtc(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** "2026-08-14 → 2026-09-12 (UTC)" — the exact window, always on screen. */
export function describeWindow(w: PeriodWindow): string {
  return `${w.start} → ${w.end} (UTC)`;
}
