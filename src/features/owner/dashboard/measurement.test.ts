import { describe, expect, it } from "vitest";
import {
  formatMeasurement,
  INSUFFICIENT_COHORT,
  LANE_LABEL,
  measurementFromRow,
  measurementFromToken,
  NOT_MEASURED,
  UNAVAILABLE,
  type Measurement,
  type MetricUnit,
  type SourceLane,
} from "./measurement";

const UNITS: MetricUnit[] = ["COUNT", "DAYS", "MINUTES", "SESSIONS", "PERCENT", "TIMESTAMP"];
const LANES: SourceLane[] = ["F", "A", "E"];
const HAS_DIGIT = /\d/;

describe("the four truth states are permanently distinct", () => {
  it("prints a different word for each absent state, and never a digit", () => {
    const absent: Measurement[] = [
      ...LANES.map((lane): Measurement => ({ state: "not-measured", lane })),
      { state: "unavailable" },
      { state: "insufficient-cohort" },
    ];

    for (const m of absent) {
      for (const unit of UNITS) {
        const f = formatMeasurement(m, unit);
        expect(f.kind).toBe("absent");
        expect(f.display, `${m.state} / ${unit}`).not.toMatch(HAS_DIGIT);
      }
    }
  });

  it("uses the exact labels, so no two states can be read as each other", () => {
    expect(formatMeasurement({ state: "not-measured", lane: "F" }, "COUNT").display).toBe(NOT_MEASURED);
    expect(formatMeasurement({ state: "unavailable" }, "COUNT").display).toBe(UNAVAILABLE);
    expect(formatMeasurement({ state: "insufficient-cohort" }, "COUNT").display).toBe(INSUFFICIENT_COHORT);
    expect(new Set([NOT_MEASURED, UNAVAILABLE, INSUFFICIENT_COHORT]).size).toBe(3);
  });

  it("says out loud that an absent value is not a zero", () => {
    for (const m of [
      { state: "not-measured", lane: "F" } as const,
      { state: "unavailable" } as const,
      { state: "insufficient-cohort" } as const,
    ]) {
      expect(formatMeasurement(m, "COUNT").spoken).toMatch(/not a zero|not zero/i);
    }
  });

  it("names the lane a not-measured value is waiting on", () => {
    for (const lane of LANES) {
      expect(formatMeasurement({ state: "not-measured", lane }, "COUNT").spoken).toContain(LANE_LABEL[lane]);
    }
  });

  it("renders a measured zero as a zero — the one place a digit is correct", () => {
    const f = formatMeasurement({ state: "measured", value: 0 }, "COUNT");
    expect(f.kind).toBe("value");
    expect(f.display).toBe("0");
  });

  it("refuses to print a non-finite measured value", () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const f = formatMeasurement({ state: "measured", value }, "COUNT");
      expect(f.display).toBe(UNAVAILABLE);
      expect(f.kind).toBe("absent");
    }
  });

  it("formats deterministically, with no dependence on the runtime locale", () => {
    expect(formatMeasurement({ state: "measured", value: 1234567 }, "COUNT").display).toBe("1,234,567");
    expect(formatMeasurement({ state: "measured", value: 90 }, "MINUTES").display).toBe("90 min");
    expect(formatMeasurement({ state: "measured", value: 12 }, "DAYS").display).toBe("12 d");
    expect(formatMeasurement({ state: "measured", value: 99.55 }, "PERCENT").display).toBe("99.6%");
  });
});

describe("mapping O1-F's value-position tokens", () => {
  it("maps each status token to its own state", () => {
    expect(measurementFromToken("NOT_MEASURED")).toEqual({ state: "not-measured", lane: "F" });
    expect(measurementFromToken("UNAVAILABLE")).toEqual({ state: "unavailable", lane: "F" });
    expect(measurementFromToken("INSUFFICIENT_COHORT")).toEqual({ state: "insufficient-cohort" });
  });

  it("maps a numeral, including an authoritative zero", () => {
    expect(measurementFromToken("0")).toEqual({ state: "measured", value: 0 });
    expect(measurementFromToken("42")).toEqual({ state: "measured", value: 42 });
    expect(measurementFromToken(7)).toEqual({ state: "measured", value: 7 });
  });

  it("fails closed to Unavailable — never to zero — for anything it cannot read", () => {
    for (const token of [null, undefined, "", "   ", "OK", "n/a", "NaN", "1e3", "12abc", Number.NaN]) {
      const m = measurementFromToken(token);
      expect(m.state, String(token)).toBe("unavailable");
      expect(formatMeasurement(m, "COUNT").display).not.toMatch(HAS_DIGIT);
    }
  });
});

describe("mapping a row-level status plus a nullable value", () => {
  it("treats a null under OK as not measured, never as zero", () => {
    expect(measurementFromRow("OK", null)).toEqual({ state: "not-measured", lane: "F" });
    expect(measurementFromRow("OK", undefined)).toEqual({ state: "not-measured", lane: "F" });
  });

  it("keeps a real zero under OK", () => {
    expect(measurementFromRow("OK", 0)).toEqual({ state: "measured", value: 0 });
  });

  it("lets the row status override any value that came with it", () => {
    expect(measurementFromRow("NOT_MEASURED", 99)).toEqual({ state: "not-measured", lane: "F" });
    expect(measurementFromRow("UNAVAILABLE", 99).state).toBe("unavailable");
    expect(measurementFromRow("INSUFFICIENT_COHORT", 99)).toEqual({ state: "insufficient-cohort" });
    expect(measurementFromRow(null, 99).state).toBe("unavailable");
  });
});
