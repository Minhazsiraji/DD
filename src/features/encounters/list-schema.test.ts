import { describe, it, expect } from "vitest";
import {
  CERTAINTIES,
  CERTAINTY_LABEL,
  certaintyLabel,
  noteInstruction,
  versionMoved,
} from "./list-schema";

describe("certaintyLabel", () => {
  /**
   * The rule that matters: a clinical list must never print an enum. RULED_OUT
   * on screen is the same class of mistake as B_POS for a blood group, on a
   * more consequential field.
   */
  it("never renders a raw database value", () => {
    for (const value of CERTAINTIES) {
      const label = certaintyLabel(value);
      expect(label).toBe(CERTAINTY_LABEL[value]);
      expect(label).not.toMatch(/_/);
      expect(label).not.toBe(value);
    }
  });

  it.each([
    ["PROVISIONAL", "Provisional"],
    ["WORKING", "Working"],
    ["CONFIRMED", "Confirmed"],
    ["RULED_OUT", "Ruled out"],
  ])("%s reads as %s", (value, expected) => {
    expect(certaintyLabel(value)).toBe(expected);
  });

  /** An unknown certainty must stay legible rather than disappear. */
  it("makes an unrecognised value readable instead of dropping it", () => {
    expect(certaintyLabel("STRONGLY_SUSPECTED")).toBe("Strongly suspected");
    expect(certaintyLabel("STRONGLY_SUSPECTED")).not.toMatch(/_/);
  });
});

describe("noteInstruction", () => {
  /**
   * Emptied means CLEAR, not "leave alone". Without the distinction a note
   * typed by mistake could never be removed — the bug the whole patch contract
   * exists to prevent.
   */
  it("turns an emptied box into an explicit clear", () => {
    expect(noteInstruction("")).toBeNull();
    expect(noteInstruction("   ")).toBeNull();
    expect(noteInstruction("\n\t ")).toBeNull();
  });

  it("passes real text through", () => {
    expect(noteInstruction("Platelets falling")).toBe("Platelets falling");
  });
});

describe("versionMoved", () => {
  /**
   * After a successful mutation the screen knows the version it earned. A
   * different number in the database means somebody else moved the record —
   * adopting it silently would keep a stale notes baseline while claiming to be
   * current, and a genuine conflict would never be shown.
   */
  it("accepts exactly the version that was earned", () => {
    expect(versionMoved(7, 7)).toBe(false);
  });

  it("flags a higher version as somebody else's work", () => {
    expect(versionMoved(7, 8)).toBe(true);
    expect(versionMoved(7, 12)).toBe(true);
  });

  it("flags a lower version rather than trusting it", () => {
    expect(versionMoved(7, 6)).toBe(true);
  });
});
