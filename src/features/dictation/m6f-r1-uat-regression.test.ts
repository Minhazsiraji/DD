import { describe, expect, it } from "vitest";
import { applyM6DTextEdit } from "./m6d-voice-state";
import { parseM6DLocalCommand } from "./m6d-intent-router";
import {
  m6fConsultationTargetForDestination,
  nextM6FConsultationTarget,
  parseM6FConsultationCommand,
  type M6FConsultationCommandContext,
} from "./m6f-consultation-controls";
import {
  M6F_ENGLISH_SILENCE_FINALIZE_MS,
  M6F_MULTILINGUAL_SILENCE_FINALIZE_MS,
  createM6FSyntheticVoiceTrace,
  m6fSilenceFinalizeMs,
  shouldCommitM6FProviderFinal,
} from "./m6f-utterance-boundary";

const examination: M6FConsultationCommandContext = {
  activeTarget: "examination",
  destination: { kind: "note", target: "examination" },
};

describe("M6F R1 live-UAT correction", () => {
  it.each(["BP 110/80", "Pulse 96", "Weight 70 kg"])(
    "keeps bare vital observation %s as Examination dictation",
    (spoken) => expect(parseM6FConsultationCommand(spoken, examination)).toEqual({ type: "NONE" }),
  );

  it.each(["110/80", "110 over 80", "110 by 80", "১১০/৮০", "একশো দশ বাই আশি", "eksho dosh by ashi"])(
    "accepts targeted Blood pressure convenience: %s",
    (spoken) => expect(parseM6FConsultationCommand(spoken, {
      activeTarget: "bloodPressure",
      destination: { kind: "note", target: "examination" },
    })).toEqual({ type: "SET_BP", systolic: "110", diastolic: "80" }),
  );

  it.each([
    "Set blood pressure 110 over 80",
    "Record BP 110/80",
    "Set BP 110/80",
    "ব্লাড প্রেসার ১১০/৮০ সেট করো",
    "বিপি ১১০/৮০ দাও",
    "ব্লাড প্রেসার একশো দশ বাই আশি সেট করো",
    "BP eksho dosh by ashi set koro",
  ])("allows explicit global BP imperative: %s", (spoken) => {
    expect(parseM6FConsultationCommand(spoken, examination)).toEqual({ type: "SET_BP", systolic: "110", diastolic: "80" });
  });

  it("allows a bare number only for the exact active Pulse target", () => {
    expect(parseM6FConsultationCommand("96", {
      activeTarget: "vitalPulseBpm",
      destination: { kind: "note", target: "examination" },
    })).toEqual({ type: "SET_DRAFT", target: "vitalPulseBpm", value: "96" });
  });

  it("retains frozen BP plausibility protection", () => {
    expect(parseM6FConsultationCommand("Set BP 999/10", examination)).toEqual({ type: "NONE" });
  });

  it.each([
    "এই সেকশন ক্লিয়ার করো", "এই সেকশন ক্লিয়ার করো", "সেকশনটা ক্লিয়ার করো",
    "বর্তমান সেকশন ক্লিয়ার করো", "এই ঘরটা খালি করো", "ঘরটা খালি করো",
    "এই ফিল্ড ক্লিয়ার করো", "ফিল্ডটা ক্লিয়ার করো", "এটা ক্লিয়ার করো", "সব মুছে দাও",
    "ei section clear koro", "this section clear koro", "section clear koro",
    "current section clear koro", "field clear koro", "field ta clear koro",
    "current field clear koro", "eta clear koro", "clear koro", "clear করো", "section clear করো", "এই section clear করো",
  ])("clears only the current authoritative target: %s", (spoken) => {
    const intent = parseM6DLocalCommand(spoken, { activeTarget: "chiefComplaints" });
    expect(intent).toEqual({ type: "NOTE_EDIT", operation: "CLEAR" });
    expect(applyM6DTextEdit("Fever", intent)).toBe("");
  });

  it.each([
    "রোগী বলেছে ঘরটা খালি ছিল",
    "Patient said the field was clear",
    "clear fluid was advised",
  ])("keeps prose out of current-target controls: %s", (spoken) => {
    expect(parseM6DLocalCommand(spoken, { activeTarget: "chiefComplaints" })).toEqual({ type: "NONE" });
  });

  it.each([
    ["আনডু", { type: "UNDO" }],
    ["undo koro", { type: "UNDO" }],
    ["শেষ বাক্য মুছে দাও", { type: "REMOVE_LAST_SENTENCE" }],
    ["last sentence remove koro", { type: "REMOVE_LAST_SENTENCE" }],
    ["এই সেকশন পড়ে শোনাও", { type: "NOTE_EDIT", operation: "READ" }],
    ["current section pore shonao", { type: "NOTE_EDIT", operation: "READ" }],
    ["fever এর জায়গায় dengue দাও", { type: "NOTE_EDIT", operation: "REPLACE", value: "fever", replacement: "dengue" }],
    ["fever er jaygay dengue dao", { type: "NOTE_EDIT", operation: "REPLACE", value: "fever", replacement: "dengue" }],
  ])("supports current-target edit control %s", (spoken, expected) => {
    expect(parseM6DLocalCommand(spoken, { activeTarget: "chiefComplaints" })).toEqual(expected);
  });

  it("derives the visible target from every authoritative destination transition", () => {
    expect(m6fConsultationTargetForDestination({ kind: "note", target: "assessment" })).toBe("assessment");
    expect(m6fConsultationTargetForDestination({ kind: "note", target: "advice" })).toBe("advice");
    expect(m6fConsultationTargetForDestination({ kind: "diagnosis", target: "note" })).toBe("diagnosisNote");
    expect(m6fConsultationTargetForDestination({ kind: "investigation", target: "field" })).toBe("investigationSearch");
  });

  it("keeps Next and Previous on the same authoritative target order", () => {
    expect(nextM6FConsultationTarget("bloodPressure", 1)).toBe("vitalSystolic");
    expect(nextM6FConsultationTarget("vitalSystolic", -1)).toBe("bloodPressure");
    expect(nextM6FConsultationTarget("assessment", 1)).toBe("advice");
  });

  it("replaces a prior BP target with Assessment before accepting its next dictation", () => {
    let visibleTarget: import("./m6f-consultation-controls").M6FConsultationTarget = "bloodPressure";
    const destination = { kind: "note" as const, target: "assessment" };
    visibleTarget = m6fConsultationTargetForDestination(destination);
    expect(visibleTarget).toBe("assessment");
    expect(parseM6FConsultationCommand("Dengue fever", { activeTarget: visibleTarget, destination })).toEqual({ type: "NONE" });
    expect(parseM6DLocalCommand("Dengue fever", { activeTarget: "assessment" })).toEqual({ type: "NONE" });
  });

  it("does not commit progressive provider-final command prefixes", () => {
    const trace = createM6FSyntheticVoiceTrace();
    ["assessment", "assessment e", "assessment e jao"].forEach((rawFragment, index) => {
      trace.record({ event: "onProviderFinal", language: "bn-BD-mixed", rawFragment, atMs: index * 120, reason: "provider-final-is-not-boundary" });
      expect(shouldCommitM6FProviderFinal()).toBe(false);
    });
    trace.record({ event: "onUtteranceEnd", language: "bn-BD-mixed", rawFragment: "assessment e jao", atMs: 520, reason: "provider-utterance-end" });
    expect(trace.snapshot()).toHaveLength(4);
    expect(trace.snapshot().filter((entry) => entry.event === "onProviderFinal")).toHaveLength(3);
  });

  it("retains the complete progressive Bangla clinical utterance exactly once", () => {
    const fragments = ["রোগীর", "রোগীর তিন দিন ধরে", "রোগীর তিন দিন ধরে জ্বর", "রোগীর তিন দিন ধরে জ্বর এবং শুকনো", "রোগীর তিন দিন ধরে জ্বর এবং শুকনো কাশি আছে"];
    expect(fragments.at(-1)).toBe("রোগীর তিন দিন ধরে জ্বর এবং শুকনো কাশি আছে");
    expect(new Set(fragments).size).toBe(fragments.length);
    for (const fragment of fragments.slice(0, -1)) expect(shouldCommitM6FProviderFinal(), fragment).toBe(false);
  });

  it("retains the complete progressive Banglish clinical utterance exactly once", () => {
    const fragments = [
      "patient er",
      "patient er tin din dhore",
      "patient er tin din dhore fever",
      "patient er tin din dhore fever and dry cough ache",
    ];
    for (const fragment of fragments.slice(0, -1)) expect(shouldCommitM6FProviderFinal(), fragment).toBe(false);
    expect(fragments.at(-1)).toBe("patient er tin din dhore fever and dry cough ache");
  });

  it("uses longer Bangla/Banglish stability without changing English", () => {
    expect(m6fSilenceFinalizeMs("en-US")).toBe(M6F_ENGLISH_SILENCE_FINALIZE_MS);
    expect(m6fSilenceFinalizeMs("bn-BD")).toBe(M6F_MULTILINGUAL_SILENCE_FINALIZE_MS);
    expect(m6fSilenceFinalizeMs("bn-BD-mixed")).toBe(M6F_MULTILINGUAL_SILENCE_FINALIZE_MS);
    expect(M6F_ENGLISH_SILENCE_FINALIZE_MS).toBe(800);
    expect(M6F_MULTILINGUAL_SILENCE_FINALIZE_MS).toBe(1400);
  });
});
