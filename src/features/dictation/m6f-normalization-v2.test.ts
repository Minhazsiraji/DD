import { describe, expect, it } from "vitest";
import { parseM6DLocalCommand } from "./m6d-intent-router";
import { parseM6EPrescriptionVoiceTargeting } from "@/features/prescriptions/m6e-prescription-voice-targeting";

const prescription = {
  editorOpen: false,
  fieldTarget: null,
  destinationKind: "MEDICINES" as const,
  autopilotProposalActive: false,
  medicineResultsActive: false,
};

describe("M6F normalization v2", () => {
  it.each([
    "Add medicine", "Medicine add", "Add a medicine", "মেডিসিন অ্যাড করো",
    "মেডিসিন এড করো", "ওষুধ যোগ করো", "medicine ta add koro", "oshudh ta add koro",
    "মেডিসিনটা অ্যাড করো", "ওষুধটা যোগ করো",
  ])("normalizes the bounded add-medicine family: %s", (utterance) => {
    expect(parseM6EPrescriptionVoiceTargeting(utterance, prescription)).toEqual({ type: "OPEN_ADD" });
  });

  it.each([
    "Clear this section", "Section clear", "এই সেকশন ক্লিয়ার করো",
    "এই section clear করো", "ei section ta clear koro",
  ])("normalizes the bounded clear family: %s", (utterance) => {
    expect(parseM6DLocalCommand(utterance)).toMatchObject({ type: "NOTE_EDIT", operation: "CLEAR" });
  });

  it.each([
    "The patient did not add medicine yesterday",
    "রোগী ওষুধটা যোগ করেনি",
    "medicine ta add koreni bole patient janay",
    "section clear chilo na, examination continued",
    "এই section clear ছিল না",
  ])("does not promote clinical prose into a command: %s", (utterance) => {
    expect(parseM6EPrescriptionVoiceTargeting(utterance, prescription)).toMatchObject({ type: "UNKNOWN" });
    expect(parseM6DLocalCommand(utterance)).toEqual({ type: "NONE" });
  });
});
