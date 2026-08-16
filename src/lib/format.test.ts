import { describe, it, expect } from "vitest";
import { formatAgeSex } from "./format";

/**
 * These exist because a real patient rendered as "34y · undefined" on the
 * dashboard: SEX_LABEL was keyed on the mock vocabulary ("male") while the
 * database enum is uppercase ("MALE") and adds "UNKNOWN".
 */
describe("formatAgeSex", () => {
  it("handles the database enum", () => {
    expect(formatAgeSex(34, "MALE")).toBe("34y · M");
    expect(formatAgeSex(34, "FEMALE")).toBe("34y · F");
    expect(formatAgeSex(34, "OTHER")).toBe("34y · Other");
  });

  it("still handles the mock vocabulary", () => {
    expect(formatAgeSex(34, "male")).toBe("34y · M");
    expect(formatAgeSex(34, "female")).toBe("34y · F");
  });

  it("shows the age alone when sex was never recorded", () => {
    expect(formatAgeSex(34, "UNKNOWN")).toBe("34y");
  });

  it("never renders undefined for a value it does not know", () => {
    expect(formatAgeSex(34, "something-new")).toBe("34y");
    expect(formatAgeSex(34, "something-new")).not.toContain("undefined");
  });

  /**
   * A walk-in whose age nobody asked used to render as "0y" — a newborn. On a
   * screen a doctor scans quickly that is a clinical statement, and a wrong one.
   */
  it("never renders an unrecorded age as zero", () => {
    expect(formatAgeSex(null, "MALE")).toBe("Age not recorded · M");
    expect(formatAgeSex(null, "UNKNOWN")).toBe("Age not recorded");
    expect(formatAgeSex(null, "FEMALE")).not.toContain("0y");
  });

  it("still renders a genuine zero for an infant under one", () => {
    expect(formatAgeSex(0, "MALE")).toBe("0y · M");
  });

  it("marks an estimated age so it is not mistaken for a known one", () => {
    expect(formatAgeSex(34, "MALE", "AGE_ONLY")).toBe("~34y · M");
    expect(formatAgeSex(34, "UNKNOWN", "AGE_ONLY")).toBe("~34y");
    expect(formatAgeSex(34, "MALE", "DAY")).toBe("34y · M");
  });
});
