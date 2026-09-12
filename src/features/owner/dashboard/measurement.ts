/**
 * What the Owner Dashboard knows about a number — including when it knows
 * nothing, and the three different ways it can know nothing.
 *
 * FOUR STATES, PERMANENTLY DISTINCT. They are not shades of "empty": each one
 * leads an owner to a different decision, so each one has its own words, and
 * none of them can become a digit.
 *
 *   0                    a measured, authoritative zero. Something was counted
 *                        and the count was none.
 *   Not measured         measurement coverage is absent or incomplete for the
 *                        window. Something may well have happened; we cannot
 *                        say what.
 *   Unavailable          the source or the authority did not answer — an
 *                        outage, a contract that is not deployed, a withdrawn
 *                        consent.
 *   Insufficient cohort  the value exists and is deliberately withheld,
 *                        because reporting it could identify a Doctor (k=5).
 *
 * O1-F OWNS THE DECISION. Every one of those four readings arrives FROM the
 * approved Owner RPC as a token in the value position; this module maps the
 * token and never re-derives it. There is no client-side k-anonymity, no
 * client-side consent test and no client-side coverage test here — a second
 * implementation of a privacy rule is a second place for it to be wrong.
 *
 * Pure: no I/O, no server-only import, no database client. The same rules run
 * in a test, on the server and in the browser bundle.
 */

/**
 * The lane that owes the authoritative source, for the cases where nothing has
 * been produced yet. The dashboard names it so an unmeasured tile says who it
 * is waiting for rather than looking broken.
 */
export type SourceLane = "F" | "A" | "E";

export const LANE_LABEL: Record<SourceLane, string> = {
  F: "Owner analytics authority (Loop F)",
  A: "Adoption telemetry (Loop A)",
  E: "AI & Voice telemetry (Loop E)",
};

export type Measurement =
  /** An approved source answered with a number. `0` is a real answer. */
  | { state: "measured"; value: number }
  /** Coverage is absent or incomplete. Never "none". */
  | { state: "not-measured"; lane: SourceLane }
  /** The source, contract or authority did not answer. Never "none". */
  | { state: "unavailable"; lane?: SourceLane }
  /** Withheld by O1-F's k-anonymity rule. The value exists; we may not see it. */
  | { state: "insufficient-cohort" };

export type MeasurementState = Measurement["state"];

/** Exact visible labels. Colour alone never distinguishes these. */
export const NOT_MEASURED = "Not measured";
export const UNAVAILABLE = "Unavailable";
export const INSUFFICIENT_COHORT = "Insufficient cohort";

export type MetricUnit = "COUNT" | "DAYS" | "MINUTES" | "SESSIONS" | "PERCENT" | "TIMESTAMP";

export interface FormattedMeasurement {
  /** What the tile or cell prints. */
  display: string;
  /** For a screen reader: the full sentence, never an abbreviation. */
  spoken: string;
  /** Measured values render as numerals; the three absent states as words. */
  kind: "value" | "absent";
}

/**
 * Deterministic formatters. Fixed `en-US`, never the runtime default locale,
 * so the server and the browser print the same string.
 */
const NUMBER = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const DECIMAL = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });

/**
 * The status vocabulary O1-F returns in a value position. Anything outside it
 * is a source defect and fails closed to `Unavailable`.
 */
export const OWNER_STATUS_TOKENS = ["OK", "NOT_MEASURED", "UNAVAILABLE", "INSUFFICIENT_COHORT"] as const;

export type OwnerStatusToken = (typeof OWNER_STATUS_TOKENS)[number];

/**
 * Map one O1-F value-position token to a measurement.
 *
 * O1-F returns its counts as TEXT precisely so that a suppressed or unmeasured
 * value cannot be mistaken for a number on the way out of the database. The
 * mapping is total: an unknown token, an empty string, a null and a non-finite
 * numeral all fail closed to `Unavailable` — never to zero.
 */
export function measurementFromToken(
  token: string | number | null | undefined,
  lane: SourceLane = "F",
): Measurement {
  if (token === null || token === undefined) return { state: "unavailable", lane };

  if (typeof token === "number") {
    return Number.isFinite(token) ? { state: "measured", value: token } : { state: "unavailable", lane };
  }

  const trimmed = token.trim();
  if (trimmed === "") return { state: "unavailable", lane };
  if (trimmed === "NOT_MEASURED") return { state: "not-measured", lane };
  if (trimmed === "UNAVAILABLE") return { state: "unavailable", lane };
  if (trimmed === "INSUFFICIENT_COHORT") return { state: "insufficient-cohort" };

  // A numeral, and only a numeral. `Number("")` and `Number("OK")` must never
  // reach the measured branch.
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) return { state: "unavailable", lane };
  const value = Number(trimmed);
  return Number.isFinite(value) ? { state: "measured", value } : { state: "unavailable", lane };
}

/**
 * Map an O1-F row-level `status` column plus an already-typed value.
 *
 * Used where F reports the state once for the row and returns the metrics as
 * nullable numbers (`owner_doctor_activity`, `owner_pilot_cohort_detail`). A
 * null under an `OK` status is still not a zero: F leaves the column null when
 * it has nothing complete to sum, so it maps to `Not measured`.
 */
export function measurementFromRow(
  status: string | null | undefined,
  value: number | string | null | undefined,
  lane: SourceLane = "F",
): Measurement {
  const state = (status ?? "").trim();
  if (state !== "OK") return measurementFromToken(state === "" ? null : state, lane);
  if (value === null || value === undefined) return { state: "not-measured", lane };
  return measurementFromToken(value, lane);
}

export function formatMeasurement(m: Measurement, unit: MetricUnit): FormattedMeasurement {
  switch (m.state) {
    case "not-measured":
      return {
        display: NOT_MEASURED,
        spoken: `Not measured. Measurement coverage for this window is absent or incomplete — ${LANE_LABEL[m.lane]}. This is not a zero.`,
        kind: "absent",
      };
    case "unavailable":
      return {
        display: UNAVAILABLE,
        spoken: "Unavailable. The approved source did not answer. This is not a zero.",
        kind: "absent",
      };
    case "insufficient-cohort":
      return {
        display: INSUFFICIENT_COHORT,
        spoken:
          "Insufficient cohort. The value is withheld because reporting it could identify a doctor. This is not a zero.",
        kind: "absent",
      };
    case "measured": {
      /**
       * A measured value that is not a finite number is a source defect, and
       * `NaN` on an owner console is worse than an honest gap.
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
  }
}

function formatValue(value: number, unit: MetricUnit): string {
  switch (unit) {
    case "PERCENT":
      return `${DECIMAL.format(value)}%`;
    case "MINUTES":
      return `${NUMBER.format(value)} min`;
    case "DAYS":
      return `${NUMBER.format(value)} d`;
    case "SESSIONS":
    case "COUNT":
      return NUMBER.format(value);
    case "TIMESTAMP":
      // Epoch milliseconds in, ISO day out. The source owns the timezone.
      return new Date(value).toISOString().slice(0, 10);
  }
}

/** No approved source has produced this yet. */
export function notMeasured(lane: SourceLane): Measurement {
  return { state: "not-measured", lane };
}

/** The source, contract or authority did not answer. */
export function unavailable(lane?: SourceLane): Measurement {
  return { state: "unavailable", lane };
}

export type MeasurementMap = Record<string, Measurement>;
