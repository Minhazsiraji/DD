import { describe, expect, it } from "vitest";
import { formatCostMinor, totalCostMinor } from "./cost";
import { NOT_MEASURED } from "./measurement";

describe("cost formatting keeps the difference between nothing and unknown", () => {
  it("renders an exact zero as a zero amount", () => {
    const f = formatCostMinor("0", "USD");
    expect(f.display).toBe("$0.00");
    expect(f.kind).toBe("value");
    expect(formatCostMinor("0.0000000000", "USD").display).toBe("$0.00");
    expect(formatCostMinor(0, "USD").display).toBe("$0.00");
  });

  it("renders a null cost as Not measured, never as zero", () => {
    const f = formatCostMinor(null, "USD");
    expect(f.display).toBe(NOT_MEASURED);
    expect(f.kind).toBe("absent");
    expect(f.display).not.toMatch(/\d/);
    expect(formatCostMinor(undefined, "USD").display).toBe(NOT_MEASURED);
  });

  it("never rounds a positive sub-cent cost down to zero", () => {
    // 0.03 cents — the exact case O1-E's picodollar unit exists to preserve.
    expect(formatCostMinor("0.0300000000", "USD").display).toBe("<$0.01");
    expect(formatCostMinor("0.9999999999", "USD").display).toBe("<$0.01");
    expect(formatCostMinor("0.0000000001", "USD").display).toBe("<$0.01");
    for (const tiny of ["0.03", "0.5", "0.9"]) {
      expect(formatCostMinor(tiny, "USD").display).not.toBe("$0.00");
    }
  });

  it("formats whole and fractional cents as money", () => {
    expect(formatCostMinor("1", "USD").display).toBe("$0.01");
    expect(formatCostMinor("1.4", "USD").display).toBe("$0.01");
    expect(formatCostMinor("1.5", "USD").display).toBe("$0.02");
    expect(formatCostMinor("12345", "USD").display).toBe("$123.45");
    expect(formatCostMinor("123456789", "USD").display).toBe("$1,234,567.89");
  });

  it("keeps the currency O1-F reported and assumes none when it reported none", () => {
    expect(formatCostMinor("12345", "BDT").display).toBe("BDT 123.45");
    expect(formatCostMinor("12345", null).display).toBe("123.45");
    expect(formatCostMinor("0", null).display).toBe("0.00");
    // A BDT amount must never acquire a dollar sign.
    expect(formatCostMinor("12345", "BDT").display).not.toContain("$");
  });

  it("fails closed on a value it cannot parse exactly", () => {
    for (const bad of ["", "  ", "abc", "1e3", "1,234", Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(formatCostMinor(bad, "USD").display, String(bad)).toBe(NOT_MEASURED);
    }
  });

  it("keeps a negative amount negative rather than hiding it", () => {
    expect(formatCostMinor("-12345", "USD").display).toBe("-$123.45");
  });
});

describe("a total is published only when every contributor is known", () => {
  it("sums exactly, without floating point drift", () => {
    const total = totalCostMinor(["0.0300000000", "0.0300000000", "0.0400000000"], "USD");
    expect(total.state).toBe("measured");
    if (total.state === "measured") expect(Number(total.minor)).toBe(0.1);
    expect(formatCostMinor(total.state === "measured" ? total.minor : null, "USD").display).toBe("<$0.01");
  });

  it("adds whole and fractional minor units together", () => {
    const total = totalCostMinor(["100", "0.5", "23.25"], "USD");
    expect(total.state).toBe("measured");
    if (total.state === "measured") expect(formatCostMinor(total.minor, "USD").display).toBe("$1.24");
  });

  it("refuses a total when any contributor is unknown", () => {
    expect(totalCostMinor(["100", null, "200"], "USD")).toEqual({ state: "not-measured" });
    expect(totalCostMinor([null], "USD")).toEqual({ state: "not-measured" });
    // And the refusal renders as words, not as the partial sum.
    expect(formatCostMinor(null, "USD").display).toBe(NOT_MEASURED);
  });

  it("totals an empty set as an exact zero, not as unknown", () => {
    const total = totalCostMinor([], "USD");
    expect(total).toEqual({ state: "measured", minor: "0", currency: "USD" });
  });
});
