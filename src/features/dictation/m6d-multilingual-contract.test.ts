import { describe, expect, it } from "vitest";
import { parseM6BCommand } from "./m6b-command-parser";
import { parseM6DLocalCommand } from "./m6d-intent-router";

describe("M6D multilingual voice contract", () => {
  it.each([
    ["হিস্ট্রিতে যাও", { type: "NAVIGATE", target: "presentIllness" }],
    ["পূর্ব ইতিহাসে যাও", { type: "NAVIGATE", target: "pastHistory" }],
    ["শারীরিক পরীক্ষায় যাও", { type: "NAVIGATE", target: "examination" }],
    ["মূল্যায়নে যাও", { type: "NAVIGATE", target: "assessment" }],
    ["পরামর্শে যাও", { type: "NAVIGATE", target: "advice" }],
    ["রোগ নির্ণয়ে যাও", { type: "DIAGNOSIS_NAVIGATE" }],
    ["টেস্ট অর্ডারে যাও", { type: "INVESTIGATION_NAVIGATE" }],
    ["diagnosis title e jao", { type: "DIAGNOSIS_TARGET", target: "title" }],
    ["certainty te jao", { type: "DIAGNOSIS_TARGET", target: "certainty" }],
    ["diagnosis note kholo", { type: "DIAGNOSIS_TARGET", target: "note" }],
    ["investigation field e jao", { type: "INVESTIGATION_TARGET", target: "field" }],
    ["test search e jao", { type: "INVESTIGATION_TARGET", target: "field" }],
    ["next e jao", { type: "NEXT" }],
    ["previous e jao", { type: "PREVIOUS" }],
    ["last line remove koro", { type: "REMOVE_LAST_SENTENCE" }],
    ["section clear koro", { type: "NOTE_EDIT", operation: "CLEAR" }],
    ["current section poro", { type: "NOTE_EDIT", operation: "READ" }],
  ] as const)("routes the exact standalone alias %s", (spoken, expected) => {
    expect(parseM6DLocalCommand(spoken)).toEqual(expected);
  });

  it("accepts mixed-language replacement without broad matching", () => {
    expect(parseM6DLocalCommand("fever replace kore headache")).toEqual({
      type: "NOTE_EDIT",
      operation: "REPLACE",
      value: "fever",
      replacement: "headache",
    });
  });

  it.each([
    ["2 week পরে", 14, "days"],
    ["two সপ্তাহ পরে", 14, "days"],
    ["2 weeks pore", 14, "days"],
    ["দুই week পরে", 14, "days"],
    ["3 দিন pore", 3, "days"],
    ["three days পরে", 3, "days"],
    ["1 month পরে", 1, "months"],
    ["এক month pore", 1, "months"],
  ] as const)("parses contextual follow-up interval %s", (spoken, amount, unit) => {
    expect(parseM6DLocalCommand(spoken, { activeTarget: "nextVisitNote" })).toEqual({
      type: "FOLLOW_UP_DATE",
      amount,
      unit,
    });
    expect(parseM6DLocalCommand(spoken, { activeTarget: "presentIllness" })).toEqual({ type: "NONE" });
  });

  it.each([
    "pause medication for two days",
    "resume medication tomorrow",
    "end stage renal disease",
    "history of fever for two weeks",
    "diagnosis was confirmed by laboratory findings",
    "investigation suggests dengue",
  ])("keeps collision-prone prose as dictation: %s", (spoken) => {
    expect(parseM6DLocalCommand(spoken)).toEqual({ type: "NONE" });
  });

  it.each([
    "prescription was written previously",
    "patient will follow up after two weeks",
  ])("does not turn proposal/navigation prose into an M6B action: %s", (spoken) => {
    expect(parseM6BCommand(spoken)).toEqual({ type: "UNKNOWN", rawText: spoken });
  });

  it("maps only current common-catalogue investigation names into proposals", () => {
    const cases = [
      ["Urine RME add koro", "Urine R/M/E"],
      ["blood sugar add koro", "Blood Glucose"],
      ["Hb A1c add koro", "HbA1c"],
      ["lipid profile add koro", "Lipid Profile"],
      ["টি এস এইচ add করো", "TSH"],
      ["এল এফ টি add করো", "LFT"],
      ["chest x ray add koro", "Chest X-ray"],
      ["আল্ট্রাসাউন্ড add করো", "Ultrasonography"],
    ] as const;
    for (const [spoken, expected] of cases) {
      expect(parseM6BCommand(spoken)).toMatchObject({
        type: "PROPOSE_INVESTIGATION",
        investigations: [expected],
      });
    }
    expect(parseM6BCommand("MRI brain add koro").type).not.toBe("PROPOSE_INVESTIGATION");
  });
});
