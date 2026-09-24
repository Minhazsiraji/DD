import { describe, expect, it } from "vitest";
import {
  parseM6EPrescriptionVoice,
  parseStructuredMedicineSpeech,
} from "./m6e-prescription-voice-contract";

const noEditor = { editorOpen: false, fieldTarget: null } as const;
const editor = { editorOpen: true, fieldTarget: null } as const;

describe("M6E prescription deterministic voice contract", () => {
  it("stages a complete English medicine utterance without an Add write intent", () => {
    expect(parseM6EPrescriptionVoice(
      "Add medicine Napa 500 mg 1 tablet three times daily for 5 days after food",
      noEditor,
    )).toMatchObject({
      type: "STAGE_MEDICINE",
      patch: {
        displayName: "Napa",
        strengthText: "500 mg",
        doseText: "1 tablet",
        scheduleText: "Three times daily",
        durationText: "5 days",
        foodRelation: "After food",
      },
    });
  });

  it("keeps strength and dose separate", () => {
    expect(parseStructuredMedicineSpeech("Napa 500 mg 1 tablet for 5 days")).toMatchObject({
      displayName: "Napa",
      strengthText: "500 mg",
      doseText: "1 tablet",
      durationText: "5 days",
    });
  });

  it("normalizes common Bengali medicine quantities deterministically", () => {
    expect(parseStructuredMedicineSpeech("Napa পাঁচশ এমজি এক ট্যাবলেট দিনে তিনবার পাঁচ দিন খাবারের পরে")).toMatchObject({
      displayName: "Napa",
      strengthText: "500 mg",
      doseText: "1 tablet",
      scheduleText: "Three times daily",
      durationText: "5 days",
      foodRelation: "After food",
    });
  });

  it("does not stage arbitrary prose outside an open editor", () => {
    expect(parseM6EPrescriptionVoice("Patient took Napa yesterday", noEditor)).toEqual({
      type: "UNKNOWN",
      rawText: "Patient took Napa yesterday",
    });
  });

  it("opens add/edit/navigation intents deterministically", () => {
    expect(parseM6EPrescriptionVoice("Add medicine", noEditor)).toEqual({ type: "OPEN_ADD" });
    expect(parseM6EPrescriptionVoice("Edit medicine 2", noEditor)).toEqual({ type: "EDIT_MEDICINE", index: 2 });
    expect(parseM6EPrescriptionVoice("Next medicine", noEditor)).toEqual({ type: "NEXT_MEDICINE" });
    expect(parseM6EPrescriptionVoice("Previous medicine", noEditor)).toEqual({ type: "PREVIOUS_MEDICINE" });
  });

  it("stages removal rather than expressing a direct write", () => {
    expect(parseM6EPrescriptionVoice("Remove medicine 3", noEditor)).toEqual({ type: "REQUEST_REMOVE", index: 3 });
  });

  it("supports field targeting and staged field dictation", () => {
    expect(parseM6EPrescriptionVoice("Dose", editor)).toEqual({ type: "TARGET_FIELD", field: "doseText" });
    expect(parseM6EPrescriptionVoice("one tablet", { editorOpen: true, fieldTarget: "doseText" })).toEqual({
      type: "SET_FIELD",
      field: "doseText",
      value: "one tablet",
    });
  });

  it("supports safe clear, replace, undo and cancel intents", () => {
    expect(parseM6EPrescriptionVoice("Clear dose", editor)).toEqual({ type: "CLEAR_FIELD", field: "doseText" });
    expect(parseM6EPrescriptionVoice("Replace one with two", { editorOpen: true, fieldTarget: "doseText" })).toEqual({
      type: "REPLACE_FIELD",
      from: "one",
      to: "two",
    });
    expect(parseM6EPrescriptionVoice("Undo", editor)).toEqual({ type: "UNDO" });
    expect(parseM6EPrescriptionVoice("Cancel medicine", editor)).toEqual({ type: "CANCEL_EDITOR" });
  });

  it("maps Autopilot commands to the existing workflow actions", () => {
    expect(parseM6EPrescriptionVoice("Generate with Autopilot", noEditor)).toEqual({ type: "GENERATE_AUTOPILOT" });
    expect(parseM6EPrescriptionVoice("Discard proposal", noEditor)).toEqual({ type: "DISCARD_AUTOPILOT" });
    expect(parseM6EPrescriptionVoice("Apply proposal", noEditor)).toEqual({ type: "APPLY_AUTOPILOT" });
  });

  it("allows Review navigation but prohibits spoken finalization", () => {
    expect(parseM6EPrescriptionVoice("Review prescription", noEditor)).toEqual({ type: "REVIEW_PRESCRIPTION" });
    for (const phrase of ["Finalize prescription", "Sign prescription", "Complete prescription"]) {
      expect(parseM6EPrescriptionVoice(phrase, noEditor)).toEqual({ type: "PROHIBITED_FINALIZE" });
    }
  });

  it("supports Bengali/Banglish command aliases without fuzzy prose matching", () => {
    expect(parseM6EPrescriptionVoice("মেডিসিন যোগ করো", noEditor)).toEqual({ type: "OPEN_ADD" });
    expect(parseM6EPrescriptionVoice("medicine add koro", noEditor)).toEqual({ type: "OPEN_ADD" });
    expect(parseM6EPrescriptionVoice("প্রেসক্রিপশন রিভিউ", noEditor)).toEqual({ type: "REVIEW_PRESCRIPTION" });
    expect(parseM6EPrescriptionVoice("প্রেসক্রিপশন ফাইনাল", noEditor)).toEqual({ type: "PROHIBITED_FINALIZE" });
  });
});
