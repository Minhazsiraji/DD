import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  canonicalizeM6EScheduleSpeech,
  parseM6EPrescriptionVoice,
  parseStructuredMedicineSpeech,
} from "./m6e-prescription-voice-contract";

const context = {
  editorOpen: true,
  fieldTarget: "scheduleText" as const,
  autopilotProposalActive: false,
};

describe("M6E prescription usability correction", () => {
  it("turns explicit spoken Bangladesh schedule notation into printable codes", () => {
    expect(canonicalizeM6EScheduleSpeech("one plus zero plus one")).toBe("1+0+1");
    expect(canonicalizeM6EScheduleSpeech("zero plus one plus zero")).toBe("0+1+0");
    expect(canonicalizeM6EScheduleSpeech("morning and night")).toBe("1+0+1");
    expect(canonicalizeM6EScheduleSpeech("noon only")).toBe("0+1+0");
  });

  it("normalizes frequency prose without inventing dose timing", () => {
    expect(parseStructuredMedicineSpeech("Schedule daily 2 time")?.scheduleText).toBe("Twice daily");
    expect(parseStructuredMedicineSpeech("Schedule three times a day")?.scheduleText).toBe("Three times daily");
  });
  it("consumes field edit commands before they can leak into the active field", () => {
    expect(parseM6EPrescriptionVoice("Clear this section", context)).toEqual({
      type: "CLEAR_FIELD",
      field: "scheduleText",
    });
    expect(parseM6EPrescriptionVoice("Remove last line", context)).toEqual({
      type: "REMOVE_LAST_LINE",
    });
  });

  it("accepts Preview prescription as Review navigation, never finalization", () => {
    expect(parseM6EPrescriptionVoice("Preview prescription", context)).toEqual({
      type: "REVIEW_PRESCRIPTION",
    });
  });

  it("parses read-only medicine catalogue and personal-library lookup commands", () => {
    expect(parseM6EPrescriptionVoice("Search medicine Napa", context)).toEqual({
      type: "SEARCH_MEDICINE", scope: "all", query: "Napa",
    });
    expect(parseM6EPrescriptionVoice("Search favorites Napa", context)).toEqual({
      type: "SEARCH_MEDICINE", scope: "favorites", query: "Napa",
    });
    expect(parseM6EPrescriptionVoice("Show favorite medicines", context)).toEqual({
      type: "SEARCH_MEDICINE", scope: "favorites", query: "",
    });
    expect(parseM6EPrescriptionVoice("Use medicine 1", context)).toEqual({
      type: "USE_MEDICINE_MATCH", index: 1,
    });
  });
  it("reuses M4 read models and keeps voice lookup proposal-only", () => {
    const root = process.cwd();
    const route = readFileSync(resolve(root, "src/app/api/m6e-medicine-lookup/route.ts"), "utf8");
    const controller = readFileSync(resolve(root, "src/features/prescriptions/use-m6e-prescription-voice.ts"), "utf8");
    expect(route).toContain("listDoctorMedicines");
    expect(route).toContain("searchMedicines");
    expect(route).toContain("requireLocationContext");
    expect(route).not.toContain("addDoctorMedicine");
    expect(route).not.toContain("addMedicineAction");
    expect(route).not.toContain("finalizePrescriptionAction");
    expect(controller).toContain("loaded from ${source} into the staged medicine form");
    expect(controller).toContain("visible Add medicine button");
    expect(controller).not.toContain("finalizePrescriptionAction");
  });

  it("keeps the latency-passed 800 ms utterance boundary", () => {
    const panel = readFileSync(
      resolve(process.cwd(), "src/features/prescriptions/components/m6e-prescription-voice-panel.tsx"),
      "utf8",
    );
    expect(panel).toContain("const M6E_SILENCE_FINALIZE_MS = 800");
    expect(panel).toContain("dictation.commitUtterance()");
  });
});
