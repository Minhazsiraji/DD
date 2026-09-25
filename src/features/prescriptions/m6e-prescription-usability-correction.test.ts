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
    expect(parseM6EPrescriptionVoice("\u09aa\u09cd\u09b0\u09c7\u09b8\u0995\u09cd\u09b0\u09bf\u09aa\u09b6\u09a8 \u09aa\u09cd\u09b0\u09bf\u09ad\u09bf\u0989", context)).toEqual({
      type: "REVIEW_PRESCRIPTION",
    });
  });

  it("opens signed medicine history by voice without creating a clinical write", () => {
    expect(parseM6EPrescriptionVoice("Signed medicine history", context)).toEqual({
      type: "OPEN_SIGNED_HISTORY", mode: "RECENT",
    });
    expect(parseM6EPrescriptionVoice("Frequent signed medicines", context)).toEqual({
      type: "OPEN_SIGNED_HISTORY", mode: "FREQUENT",
    });
    const controller = readFileSync(resolve(process.cwd(), "src/features/prescriptions/use-m6e-prescription-voice.ts"), "utf8");
    expect(controller).toContain('case "OPEN_SIGNED_HISTORY"');
    expect(controller).toContain('data-m3-signed-medicine-history');
    expect(controller).toContain('data-m3-signed-history-mode');
    expect(controller).toContain("Add medicine is still required");
    expect(controller).not.toContain("addMedicineAction");
  });

  it("opens previous-prescription reuse by voice without copying history automatically", () => {
    for (const phrase of [
      "Reuse previous prescription",
      "Reuse previous prescriptions",
      "Previous prescription reuse koro",
      "\u0986\u0997\u09c7\u09b0 \u09aa\u09cd\u09b0\u09c7\u09b8\u0995\u09cd\u09b0\u09bf\u09aa\u09b6\u09a8",
      "\u0986\u0997\u09c7\u09b0 \u09aa\u09cd\u09b0\u09c7\u09b8\u0995\u09cd\u09b0\u09bf\u09aa\u09b6\u09a8 \u09ac\u09cd\u09af\u09ac\u09b9\u09be\u09b0 \u0995\u09b0\u09cb",
    ]) {
      expect(parseM6EPrescriptionVoice(phrase, context)).toEqual({ type: "OPEN_REUSE_HISTORY" });
    }
    const controller = readFileSync(resolve(process.cwd(), "src/features/prescriptions/use-m6e-prescription-voice.ts"), "utf8");
    const reuse = readFileSync(resolve(process.cwd(), "src/features/prescriptions/components/prescription-reuse.tsx"), "utf8");
    expect(controller).toContain('case "OPEN_REUSE_HISTORY"');
    expect(controller).toContain('data-m3-prescription-reuse-trigger');
    expect(controller).toContain("trigger.click()");
    expect(controller).toContain("Nothing will be copied until you explicitly choose and confirm");
    expect(controller).not.toContain("rx.reuseHistory");
    expect(reuse).toContain("data-m3-prescription-reuse-trigger");
    expect(reuse).toContain("data-m3-prescription-reuse-panel");
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
