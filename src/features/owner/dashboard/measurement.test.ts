import { describe, expect, it } from "vitest";
import {
  formatMeasurement,
  NOT_MEASURED,
  notMeasured,
  UNAVAILABLE,
  type Measurement,
  type MetricUnit,
  type SourceLane,
} from "./measurement";

/**
 * The invariant the whole dashboard rests on: absence is never a number.
 *
 * Asserted exhaustively over every unit × every absent state, because the
 * failure this guards against — a fabricated 0 on an owner console — is
 * exactly the kind that reads as correct at a glance.
 */

const UNITS: MetricUnit[] = ["COUNT", "DAYS", "MINUTES", "TOKENS", "PERCENT", "USD", "BDT", "TIMESTAMP"];
const LANES: SourceLane[] = ["F", "A", "E"];
const ANY_DIGIT = /\d/;

describe("absence is never rendered as a number", () => {
  it("not-measured produces no digit, for every unit and every lane", () => {
    for (const unit of UNITS) {
      for (const lane of LANES) {
        const f = formatMeasurement(notMeasured(lane), unit);
        expect(f.display, `${unit}/${lane}`).toBe(NOT_MEASURED);
        expect(f.display, `${unit}/${lane}`).not.toMatch(ANY_DIGIT);
        expect(f.kind).toBe("absent");
      }
    }
  });

  it("unavailable produces no digit, for every unit", () => {
    for (const unit of UNITS) {
      const f = formatMeasurement({ state: "unavailable" }, unit);
      expect(f.display).toBe(UNAVAILABLE);
      expect(f.display).not.toMatch(ANY_DIGIT);
      expect(f.kind).toBe("absent");
    }
  });

  it("a non-finite measured value is reported unavailable, never printed", () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      for (const unit of UNITS) {
        const f = formatMeasurement({ state: "measured", value: bad, asOf: "2026-09-11" }, unit);
        expect(f.display, `${bad}/${unit}`).toBe(UNAVAILABLE);
        expect(f.kind).toBe("absent");
      }
    }
  });

  it("the spoken form says it is not a zero, rather than leaving it implied", () => {
    expect(formatMeasurement({ state: "unavailable" }, "COUNT").spoken).toMatch(/not a zero/i);
    expect(formatMeasurement(notMeasured("E"), "USD").spoken).toMatch(/not measured/i);
  });

  it("names the lane that owes the source", () => {
    expect(formatMeasurement(notMeasured("E"), "COUNT").spoken).toMatch(/AI & Voice/);
    expect(formatMeasurement(notMeasured("F"), "COUNT").spoken).toMatch(/Database V2/);
    expect(formatMeasurement(notMeasured("A"), "COUNT").spoken).toMatch(/Clinical workflow/);
  });
});

describe("a real zero is still allowed — when it is measured", () => {
  it("renders a measured zero as 0, because then it is a true statement", () => {
    const zero: Measurement = { state: "measured", value: 0, asOf: "2026-09-11" };
    expect(formatMeasurement(zero, "COUNT").display).toBe("0");
    expect(formatMeasurement(zero, "COUNT").kind).toBe("value");
  });

  it("formats each unit deterministically, without the runtime locale", () => {
    const m = (value: number): Measurement => ({ state: "measured", value, asOf: "2026-09-11" });
    expect(formatMeasurement(m(1234), "COUNT").display).toBe("1,234");
    expect(formatMeasurement(m(12.5), "USD").display).toBe("$12.50");
    expect(formatMeasurement(m(90), "MINUTES").display).toBe("90 min");
    expect(formatMeasurement(m(42.25), "PERCENT").display).toBe("42.3%");
    expect(formatMeasurement(m(7), "DAYS").display).toBe("7 d");
    expect(formatMeasurement(m(Date.UTC(2026, 8, 11)), "TIMESTAMP").display).toBe("2026-09-11");
  });
});
