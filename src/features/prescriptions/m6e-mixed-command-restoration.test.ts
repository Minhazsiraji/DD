import { describe, expect, it } from "vitest";
import { restoreM6EMixedContractTerms } from "./m6e-mixed-restoration";
import { parseM6EPrescriptionVoiceTargeting } from "./m6e-prescription-voice-targeting";
import { parseM6EVoiceSessionControl } from "./m6e-prescription-voice-contract";

const noEditor = {
  editorOpen: false,
  fieldTarget: null,
  destinationKind: "MEDICINES" as const,
  autopilotProposalActive: false,
};

describe("M6E mixed command restoration", () => {
  it("keeps known command phrases deterministic after script restoration", () => {
    expect(parseM6EPrescriptionVoiceTargeting(restoreM6EMixedContractTerms("মেডিসিন যোগ করো"), noEditor)).toEqual({ type: "OPEN_ADD" });
    expect(parseM6EPrescriptionVoiceTargeting(restoreM6EMixedContractTerms("মেডিসিন সেকশনে যাও"), noEditor)).toEqual({ type: "TARGET_MEDICINES" });
    expect(parseM6EPrescriptionVoiceTargeting(restoreM6EMixedContractTerms("অটোপাইলট জেনারেট করো"), noEditor)).toEqual({ type: "GENERATE_AUTOPILOT" });
    expect(parseM6EPrescriptionVoiceTargeting(restoreM6EMixedContractTerms("প্রেসক্রিপশন ফাইনাল"), noEditor)).toEqual({ type: "PROHIBITED_FINALIZE" });
    expect(parseM6EVoiceSessionControl(restoreM6EMixedContractTerms("পজ"))).toBe("PAUSE");
  });

  it("restores phonetic Next/Previous field commands without broad translation", () => {
    const fieldContext = { ...noEditor, editorOpen: true, fieldTarget: "doseText" as const, destinationKind: "MEDICINE_FIELD" as const };
    expect(parseM6EPrescriptionVoiceTargeting(restoreM6EMixedContractTerms("নেক্সট ফিল্ড"), fieldContext)).toEqual({ type: "NEXT_FIELD" });
    expect(parseM6EPrescriptionVoiceTargeting(restoreM6EMixedContractTerms("প্রিভিয়াস ফিল্ড"), fieldContext)).toEqual({ type: "PREVIOUS_FIELD" });
  });
});
