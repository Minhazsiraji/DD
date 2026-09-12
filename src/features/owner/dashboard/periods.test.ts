import { describe, expect, it } from "vitest";
import { DEFAULT_PERIOD, describePeriod, MAX_CUSTOM_DAYS, parsePeriod, periodQuery } from "./periods";

describe("period parsing", () => {
  it("accepts the three fixed periods", () => {
    expect(parsePeriod({ period: "today" })).toEqual({ kind: "today" });
    expect(parsePeriod({ period: "7d" })).toEqual({ kind: "7d" });
    expect(parsePeriod({ period: "30d" })).toEqual({ kind: "30d" });
  });

  it("defaults to 30 days when absent or unknown", () => {
    expect(parsePeriod({})).toEqual(DEFAULT_PERIOD);
    expect(parsePeriod({ period: "forever" })).toEqual(DEFAULT_PERIOD);
    expect(parsePeriod({ period: ["7d", "30d"] })).toEqual(DEFAULT_PERIOD);
  });

  it("accepts a valid, ordered custom range", () => {
    expect(parsePeriod({ period: "custom", from: "2026-08-01", to: "2026-08-31" })).toEqual({
      kind: "custom",
      from: "2026-08-01",
      to: "2026-08-31",
    });
  });

  it("refuses impossible, reversed, malformed or over-long custom ranges", () => {
    // 30 February does not exist, even though it matches the pattern.
    expect(parsePeriod({ period: "custom", from: "2026-02-30", to: "2026-03-05" })).toEqual(DEFAULT_PERIOD);
    expect(parsePeriod({ period: "custom", from: "2026-09-10", to: "2026-09-01" })).toEqual(DEFAULT_PERIOD);
    expect(parsePeriod({ period: "custom", from: "10/09/2026", to: "2026-09-11" })).toEqual(DEFAULT_PERIOD);
    expect(parsePeriod({ period: "custom", from: "2026-09-01" })).toEqual(DEFAULT_PERIOD);
    expect(
      parsePeriod({ period: "custom", from: "2024-01-01", to: "2026-01-01" }),
      `> ${MAX_CUSTOM_DAYS} days`,
    ).toEqual(DEFAULT_PERIOD);
  });

  it("accepts a single-day custom range", () => {
    expect(parsePeriod({ period: "custom", from: "2026-09-11", to: "2026-09-11" }).kind).toBe("custom");
  });

  it("round-trips through the query string", () => {
    for (const p of [
      { kind: "today" as const },
      { kind: "7d" as const },
      { kind: "custom" as const, from: "2026-08-01", to: "2026-08-15" },
    ]) {
      const back = parsePeriod(Object.fromEntries(new URLSearchParams(periodQuery(p))));
      expect(back).toEqual(p);
    }
  });

  it("describes a period in plain words", () => {
    expect(describePeriod({ kind: "7d" })).toBe("7 days");
    expect(describePeriod({ kind: "custom", from: "2026-08-01", to: "2026-08-15" })).toBe("2026-08-01 → 2026-08-15");
  });
});
