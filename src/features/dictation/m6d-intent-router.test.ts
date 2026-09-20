import { describe, expect, it } from "vitest";
import { M6D_TARGETS, nextM6DTarget, parseM6DLocalCommand } from "./m6d-intent-router";

describe("M6D local command router", () => {
  it("keeps the supported clinical-note target order stable", () => {
    expect(M6D_TARGETS).toEqual([
      "chiefComplaints",
      "presentIllness",
      "examination",
      "assessment",
      "advice",
      "nextVisitNote",
    ]);
  });

  it("routes explicit section names without treating them as note text", () => {
    expect(parseM6DLocalCommand("History")).toEqual({ type: "NAVIGATE", target: "presentIllness" });
    expect(parseM6DLocalCommand("Examination")).toEqual({ type: "NAVIGATE", target: "examination" });
    expect(parseM6DLocalCommand("ফলো আপ")).toEqual({ type: "NAVIGATE", target: "nextVisitNote" });
  });

  it("supports next and previous section movement", () => {
    expect(parseM6DLocalCommand("Next").type).toBe("NEXT");
    expect(parseM6DLocalCommand("Previous section").type).toBe("PREVIOUS");
    expect(nextM6DTarget("presentIllness", 1)).toBe("examination");
    expect(nextM6DTarget("presentIllness", -1)).toBe("chiefComplaints");
  });

  it("supports draft-only editing commands", () => {
    expect(parseM6DLocalCommand("Undo last sentence").type).toBe("UNDO");
    expect(parseM6DLocalCommand("Clear current section")).toEqual({ type: "NOTE_EDIT", operation: "CLEAR" });
    expect(parseM6DLocalCommand("Replace three days with five days")).toEqual({
      type: "NOTE_EDIT",
      operation: "REPLACE",
      value: "three days",
      replacement: "five days",
    });
    expect(parseM6DLocalCommand("Remove vomiting")).toEqual({
      type: "NOTE_EDIT",
      operation: "REMOVE",
      value: "vomiting",
    });
  });

  it("leaves ordinary dictation for semantic command interpretation or note insertion", () => {
    expect(parseM6DLocalCommand("Patient has fever for three days with dry cough.")).toEqual({ type: "NONE" });
    expect(parseM6DLocalCommand("Patient এর তিন দিন ধরে fever আছে।")).toEqual({ type: "NONE" });
  });
});
