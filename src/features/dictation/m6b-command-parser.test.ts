import { describe, expect, it } from "vitest";
import { authorizeM6BCommand, parseM6BCommand } from "./m6b-command-parser";

describe("M6B deterministic command parser", () => {
  it.each([
    ["open prescription", "prescription"],
    ["পরীক্ষা অংশে যাও", "examination"],
    ["advice e jao", "advice"],
    ["ফলো আপে যাও", "follow-up"],
  ] as const)("routes allowlisted navigation: %s", (spoken, target) => {
    expect(parseM6BCommand(spoken)).toMatchObject({ type: "NAVIGATE", target });
  });

  it("creates an English medicine proposal without inventing frequency or duration", () => {
    const intent = parseM6BCommand("Add Napa 500 mg");
    expect(intent).toMatchObject({
      type: "PROPOSE_MEDICINE",
      medicine: { name: "Napa", strengthText: "500 mg" },
    });
    if (intent.type === "PROPOSE_MEDICINE") {
      expect(intent.uncertainties).toContain("Frequency is not explicit.");
      expect(intent.uncertainties).toContain("Duration is not explicit.");
    }
  });

  it("preserves ambiguity when a medicine number has no unit", () => {
    const intent = parseM6BCommand("Napa 500 add koro");
    expect(intent.type).toBe("PROPOSE_MEDICINE");
    if (intent.type === "PROPOSE_MEDICINE") {
      expect(intent.medicine.name).toBe("Napa");
      expect(intent.medicine.strengthText).toBe("");
      expect(intent.uncertainties).toContain("A number was heard but its unit is not explicit.");
    }
  });

  it("creates Bangla/Banglish investigation proposals from an allowlist", () => {
    expect(parseM6BCommand("CBC আর creatinine add করো")).toMatchObject({
      type: "PROPOSE_INVESTIGATION",
      investigations: ["CBC", "Serum Creatinine"],
    });
  });

  it("creates a follow-up proposal instead of writing a date", () => {
    expect(parseM6BCommand("follow-up seven days")).toMatchObject({
      type: "PROPOSE_FOLLOW_UP",
      days: 7,
      uncertainties: [],
    });
  });

  it("never turns finalize speech into a finalize mutation", () => {
    expect(parseM6BCommand("finalize prescription")).toEqual({
      type: "PROHIBITED_ACTION",
      rawText: "finalize prescription",
      action: "FINALIZE_PRESCRIPTION",
      reviewOnly: true,
    });
  });

  it("blocks finalized-prescription mutation speech", () => {
    expect(parseM6BCommand("edit finalized prescription")).toMatchObject({
      type: "PROHIBITED_ACTION",
      action: "FINALIZED_MUTATION",
      reviewOnly: false,
    });
  });

  it("fails closed without an active editable encounter", () => {
    const intent = parseM6BCommand("Add CBC");
    expect(authorizeM6BCommand(intent, { editableEncounter: false })).toEqual({
      ok: false,
      message: "Voice commands require an active editable encounter.",
    });
  });
});
