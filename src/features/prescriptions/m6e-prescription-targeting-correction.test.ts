import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { restoreM6EMixedContractTerms } from "./m6e-mixed-restoration";
import {
  M6E_VOICE_FIELD_ORDER,
  canonicalizeM6ETargetedFieldValue,
  m6eVoiceTargetOptions,
  parseM6EPrescriptionVoiceTargeting,
} from "./m6e-prescription-voice-targeting";

const root = process.cwd();
const panelSource = readFileSync(resolve(root, "src/features/prescriptions/components/m6e-prescription-voice-panel.tsx"), "utf8");
const controllerSource = readFileSync(resolve(root, "src/features/prescriptions/use-m6e-prescription-voice.ts"), "utf8");

const noEditor = {
  editorOpen: false,
  fieldTarget: null,
  destinationKind: "MEDICINES" as const,
  autopilotProposalActive: false,
};

const editorField = {
  editorOpen: true,
  fieldTarget: "doseText" as const,
  destinationKind: "MEDICINE_FIELD" as const,
  autopilotProposalActive: false,
};

describe("M6E CENTRAL mixed-language restoration", () => {
  it("restores only the closed Doctor's Diary vocabulary in the live user fixture", () => {
    const raw = "পেশেন্টের তিনদিন ধরে ফিভার সিবিসি টেস্ট করতে হবে, ফলোআপ তিনদিন পরে";
    const restored = restoreM6EMixedContractTerms(raw);
    expect(restored).toContain("Patient-এর");
    expect(restored).toContain("fever");
    expect(restored).toContain("CBC");
    expect(restored).toContain("test");
    expect(restored).toContain("follow-up");
    expect(restored).toContain("তিনদিন ধরে");
    expect(restored).toContain("তিনদিন পরে");
  });

  it("restores deterministic command terms but never guesses a medicine name", () => {
    expect(restoreM6EMixedContractTerms("মেডিসিন সেকশনে যাও")).toBe("medicine section e jao");
    expect(restoreM6EMixedContractTerms("ডোজ")).toBe("dose");
    expect(restoreM6EMixedContractTerms("ফ্রিকোয়েন্সি")).toBe("frequency");
    expect(restoreM6EMixedContractTerms("নাপা পাঁচ দিন")).toBe("নাপা পাঁচ দিন");
  });
});

describe("M6E authoritative Prescription command targeting", () => {
  it.each([
    "Medicine",
    "Medicines",
    "Medicine section",
    "Go to medicine",
    "Go to medicines",
    "Go to medicine section",
    "Open medicine section",
    "মেডিসিন",
    "মেডিসিন সেকশন",
    "মেডিসিনে যাও",
    "মেডিসিন সেকশনে যাও",
    "medicine e jao",
    "medicine section e jao",
    "medicine section kholo",
  ])("routes Medicines section alias: %s", (spoken) => {
    expect(parseM6EPrescriptionVoiceTargeting(spoken, noEditor)).toEqual({ type: "TARGET_MEDICINES" });
  });

  it.each(["Autopilot", "Go to Autopilot", "Autopilot section", "অটোপাইলট", "autopilot e jao"])(
    "routes Autopilot section alias: %s",
    (spoken) => {
      expect(parseM6EPrescriptionVoiceTargeting(spoken, noEditor)).toEqual({ type: "TARGET_AUTOPILOT" });
    },
  );

  it("routes explicit section and field navigation before ordinary dictation", () => {
    expect(parseM6EPrescriptionVoiceTargeting("next section", editorField)).toEqual({ type: "NEXT_SECTION" });
    expect(parseM6EPrescriptionVoiceTargeting("previous section", editorField)).toEqual({ type: "PREVIOUS_SECTION" });
    expect(parseM6EPrescriptionVoiceTargeting("next field", editorField)).toEqual({ type: "NEXT_FIELD" });
    expect(parseM6EPrescriptionVoiceTargeting("previous field", editorField)).toEqual({ type: "PREVIOUS_FIELD" });
    expect(parseM6EPrescriptionVoiceTargeting("next", editorField)).toEqual({ type: "NEXT_FIELD" });
    expect(parseM6EPrescriptionVoiceTargeting("previous", editorField)).toEqual({ type: "PREVIOUS_FIELD" });
    expect(parseM6EPrescriptionVoiceTargeting("next", noEditor)).toEqual({ type: "NEXT_MEDICINE" });
    expect(parseM6EPrescriptionVoiceTargeting("next", {
      ...noEditor,
      destinationKind: "AUTOPILOT",
      autopilotProposalActive: true,
    })).toEqual({ type: "NEXT_AUTOPILOT_ITEM" });
  });

  it("targets all twelve staged medicine text fields in the required order", () => {
    expect(M6E_VOICE_FIELD_ORDER).toEqual([
      "displayName", "brandName", "genericName", "strengthText", "doseText", "dosageForm",
      "route", "scheduleText", "durationText", "quantityText", "foodRelation", "instructions",
    ]);
    expect(m6eVoiceTargetOptions(true).filter((option) => option.value.startsWith("FIELD:"))).toHaveLength(12);

    const fixtures = [
      ["medicine name e jao", "displayName"],
      ["brand", "brandName"],
      ["generic", "genericName"],
      ["স্ট্রেংথ", "strengthText"],
      ["ডোজ", "doseText"],
      ["dosage form", "dosageForm"],
      ["route", "route"],
      ["frequency e jao", "scheduleText"],
      ["ডিউরেশন", "durationText"],
      ["quantity", "quantityText"],
      ["খাবার", "foodRelation"],
      ["নির্দেশনা", "instructions"],
    ] as const;
    for (const [spoken, field] of fixtures) {
      expect(parseM6EPrescriptionVoiceTargeting(spoken, {
        ...editorField,
        fieldTarget: null,
        destinationKind: "MEDICINE_FORM",
      })).toEqual({ type: "TARGET_FIELD", field });
    }
  });

  it("supports Read/Clear/Replace/Undo while keeping ordinary targeted speech staged", () => {
    expect(parseM6EPrescriptionVoiceTargeting("read dose", editorField)).toEqual({ type: "READ_FIELD", field: "doseText" });
    expect(parseM6EPrescriptionVoiceTargeting("clear field", editorField)).toEqual({ type: "CLEAR_FIELD", field: "doseText" });
    expect(parseM6EPrescriptionVoiceTargeting("replace 500 with 650", editorField)).toEqual({ type: "REPLACE_FIELD", from: "500", to: "650" });
    expect(parseM6EPrescriptionVoiceTargeting("undo", editorField)).toEqual({ type: "UNDO" });
    expect(parseM6EPrescriptionVoiceTargeting("two tablets", editorField)).toEqual({ type: "SET_FIELD", field: "doseText", value: "2 tablets" });
    expect(canonicalizeM6ETargetedFieldValue("durationText", "five days")).toBe("5 days");
  });
});

describe("M6E sticky target/focus source contract", () => {
  it("uses one destination model for selector, parser context, focus and scroll", () => {
    expect(controllerSource).toContain("const [destination, setDestination]");
    expect(controllerSource).toContain("const destinationRef");
    expect(controllerSource).not.toContain("voiceField");
    expect(controllerSource).not.toContain("voiceCursor");
    expect(controllerSource).not.toContain("voiceSurface");
    expect(controllerSource).toContain('document.querySelector<HTMLElement>(`[data-medicine-field="${field}"]`)');
    expect(controllerSource).toContain('const details = element?.closest("details")');
    expect(controllerSource).toContain("details.open = true");
    expect(controllerSource).toContain("scrollIntoView");
    expect(controllerSource).toContain("focus({ preventScroll: true })");
  });

  it("keeps the same Voice Assistant sticky, mobile-contained, and visibly targetable", () => {
    expect(panelSource).toContain('className="sticky top-2 z-40 min-w-0"');
    expect(panelSource).toContain('aria-label="Current voice target"');
    expect(panelSource).toContain("max-h-[42vh]");
    expect(panelSource).toContain("overflow-x-hidden");
    expect(panelSource).toContain("targetOptions.map");
  });

  it("preserves protected clinical write boundaries", () => {
    expect(controllerSource).toContain("rx.openAdd()");
    expect(controllerSource).toContain("rx.setConfirmingRemoval(row)");
    expect(controllerSource).not.toContain("rx.submit()");
    expect(controllerSource).not.toContain("rx.remove(row)");
    expect(controllerSource).not.toContain("finalizePrescriptionAction");
    expect(controllerSource).toContain("Voice cannot Finalize, Sign, or Complete a prescription");
  });
});
