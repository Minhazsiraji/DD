import { describe, expect, it } from "vitest";
import { parseM6EPrescriptionVoiceTargeting } from "./m6e-prescription-voice-targeting";
import { restoreM6ECommandTerms, restoreM6EMixedContractTerms } from "./m6e-mixed-restoration";

const context = { editorOpen: true, fieldTarget: null, destinationKind: "MEDICINE_FORM" as const, autopilotProposalActive: false, medicineResultsActive: false };

describe("M6F prescription multilingual recovery", () => {
  it.each([
    ["medicine name e jao", { type: "TARGET_FIELD", field: "displayName" }],
    ["মেডিসিন নামের ঘরে যাও", { type: "TARGET_FIELD", field: "displayName" }],
    ["strength pachsho mg dao", { type: "SET_FIELD", field: "strengthText", value: "500 mg" }],
    ["স্ট্রেংথ পাঁচশো মিলিগ্রাম দাও", { type: "SET_FIELD", field: "strengthText", value: "500 mg" }],
    ["dose ek tablet", { type: "SET_FIELD", field: "doseText", value: "1 tablet" }],
    ["schedule shokal rate", { type: "SET_FIELD", field: "scheduleText", value: "1+0+1" }],
    ["duration sat din", { type: "SET_FIELD", field: "durationText", value: "7 days" }],
    ["khabarer pore dao", { type: "SET_FIELD", field: "foodRelation", value: "After food" }],
    ["proyojone", { type: "SET_PRN", value: true }],
    ["substitution off koro", { type: "SET_SUBSTITUTION", value: false }],
  ])("normalizes %s", (spoken, expected) => {
    expect(parseM6EPrescriptionVoiceTargeting(spoken, context)).toEqual(expected);
  });

  it("separates medicine results from proposal selection", () => {
    expect(parseM6EPrescriptionVoiceTargeting("select medicine 1", { ...context, medicineResultsActive: true })).toEqual({ type: "USE_MEDICINE_MATCH", index: 1 });
    expect(parseM6EPrescriptionVoiceTargeting("select proposal medicine 1", { ...context, destinationKind: "AUTOPILOT", autopilotProposalActive: true })).toEqual({ type: "SELECT_AUTOPILOT_MEDICINE", index: 1 });
  });

  it("recognizes but never performs finalization", () => {
    for (const spoken of ["finish prescription", "প্রেসক্রিপশন ফাইনাল করো", "prescription final koro"]) {
      expect(parseM6EPrescriptionVoiceTargeting(spoken, context)).toEqual({ type: "PROHIBITED_FINALIZE" });
    }
  });

  it.each([
    "মেডিসিন এড করো", "মেডিসিন এড করুন", "মেডিসিন অ্যাড করো", "মেডিসিন অ্যাড করুন",
    "মেডিসিন যোগ করো", "মেডিসিন যোগ করুন", "ওষুধ এড করো", "ওষুধ অ্যাড করো",
    "ওষুধ যোগ করো", "ওষুধ যোগ করুন", "medicine add koro", "add medicine", "new medicine",
  ])("opens only the staged medicine editor for %s", (spoken) => {
    expect(parseM6EPrescriptionVoiceTargeting(spoken, {
      ...context,
      editorOpen: false,
      destinationKind: "MEDICINES",
    })).toEqual({ type: "OPEN_ADD" });
  });

  it("keeps add restoration inside command parsing and does not rewrite prose", () => {
    const prose = "রোগী নতুন মেডিসিন এড করেনি";
    expect(restoreM6EMixedContractTerms(prose)).toContain("এড করেনি");
    expect(restoreM6ECommandTerms("মেডিসিন এড করো")).toBe("medicine add করো");
    expect(parseM6EPrescriptionVoiceTargeting(prose, context)).toEqual({ type: "UNKNOWN", rawText: prose });
  });
});
