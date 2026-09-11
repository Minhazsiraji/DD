/**
 * What the Owner Dashboard knows about a number — including when it knows
 * nothing.
 *
 * THE RULE THIS MODULE EXISTS TO ENFORCE: a metric with no authoritative source
 * is never rendered as 0.
 *
 * A zero is a claim. "AI Spend: 0" tells the owner nothing was spent; "Active
 * Today: 0" tells them nobody came. When no approved aggregate interface exists
 * yet, the truthful answer is that the number has not been measured — and on an
 * operating console those two readings lead to opposite decisions. So absence
 * is its own state, it has its own words, and `formatMeasurement` cannot turn
 * it into a digit.
 *
 * Pure: no I/O, no server-only import. The same rules run in tests and in the
 * browser bundle.
 */

/**
 * The lane that owes the authoritative source.
 *
 *   F — Database V2 (aggregate interfaces over the control plane)
 *   A — clinical workflow (what counts as a consultation, time saved)
 *   E — AI and Voice (usage, tokens, audio minutes, provider cost)
 *
 * The dashboard names the lane so an unmeasured tile says who it is waiting
 * for, rather than looking broken.
 */
export type SourceLane = "F" | "A" | "E";

export const LANE_LABEL: Record<SourceLane, string> = {
  F: "Database V2 (Loop F)",
  A: "Clinical workflow (Loop A)",
  E: "AI & Voice (Loop E)",
};

export type Measurement =
  /** An approved source answered. `asOf` is when that answer was computed. */
  | { state: "measured"; value: number; asOf: string }
  /**
   * A source exists and could not answer right now. Distinct from
   * not-measured: this is an outage, and it must never read as "none".
   */
  | { state: "unavailable" }
  /** No approved source exists yet. The normal state before F/A/E deliver. */
  | { state: "not-measured"; lane: SourceLane };

export type MetricUnit =
  | "COUNT"
  | "DAYS"
  | "MINUTES"
  | "TOKENS"
  | "PERCENT"
  | "USD"
  | "BDT"
  | "TIMESTAMP";

export interface FormattedMeasurement {
  /** What the tile or cell prints. */
  display: string;
  /** For screen readers: the full sentence, never an abbreviation. */
  spoken: string;
  /** Measured values render as numerals; the two absent states as words. */
  kind: "value" | "absent";
}

/** A value every dashboard number formats through — never `String(n)` inline. */
const NUMBER = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const DECIMAL = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });

/**
 * Currency is formatted from the unit, never from a runtime default locale,
 * so the server and the browser print the same string (no hydration drift).
 */
const CURRENCY: Record<"USD" | "BDT", Intl.NumberFormat> = {
  USD: new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }),
  BDT: new Intl.NumberFormat("en-US", { style: "currency", currency: "BDT" }),
};

export const NOT_MEASURED = "Not measured";
export const UNAVAILABLE = "Unavailable";

export function formatMeasurement(m: Measurement, unit: MetricUnit): FormattedMeasurement {
  if (m.state === "not-measured") {
    return {
      display: NOT_MEASURED,
      spoken: `Not measured yet. Waiting for an approved source from ${LANE_LABEL[m.lane]}.`,
      kind: "absent",
    };
  }
  if (m.state === "unavailable") {
    return {
      display: UNAVAILABLE,
      spoken: "Unavailable. The source did not answer; this is not a zero.",
      kind: "absent",
    };
  }

  /**
   * A measured value that is not a finite number is a source defect. It is
   * reported as unavailable rather than printed — `NaN` or `Infinity` on an
   * owner console is a worse failure than an honest gap.
   */
  if (!Number.isFinite(m.value)) {
    return {
      display: UNAVAILABLE,
      spoken: "Unavailable. The source returned a value that is not a number.",
      kind: "absent",
    };
  }

  const display = formatValue(m.value, unit);
  return { display, spoken: display, kind: "value" };
}

function formatValue(value: number, unit: MetricUnit): string {
  switch (unit) {
    case "USD":
    case "BDT":
      return CURRENCY[unit].format(value);
    case "PERCENT":
      return `${DECIMAL.format(value)}%`;
    case "MINUTES":
      return `${NUMBER.format(value)} min`;
    case "DAYS":
      return `${NUMBER.format(value)} d`;
    case "TIMESTAMP":
      // Timestamps arrive as epoch milliseconds from a source and are shown
      // as an ISO date — the source, not this module, owns the timezone.
      return new Date(value).toISOString().slice(0, 10);
    case "TOKENS":
    case "COUNT":
      return NUMBER.format(value);
  }
}

/** Convenience for sources: every metric starts here until F/A/E deliver. */
export function notMeasured(lane: SourceLane): Measurement {
  return { state: "not-measured", lane };
}
