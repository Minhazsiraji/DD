import { describe, expect, it } from "vitest";
import { parseM6EPrescriptionVoiceTargeting } from "./m6e-prescription-voice-targeting";

describe("M6E staged field replacement canonicalization", () => {
  it("matches spoken duration wording to the existing canonical staged representation", () => {
    expect(parseM6EPrescriptionVoiceTargeting("Replace five days with seven days", {
      editorOpen: true,
      fieldTarget: "durationText",
      destinationKind: "MEDICINE_FIELD",
      autopilotProposalActive: false,
    })).toEqual({
      type: "REPLACE_FIELD",
      from: "5 days",
      to: "7 days",
    });
  });
});
