import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DeepgramTranscriptAssembler, type DeepgramResultsMessage } from "./deepgram-stream";
import {
  BP_INCOMPLETE_FINALIZATION_MS,
  BP_SPLIT_COMPLETION_GRACE_MS,
  bloodPressureCaptureState,
  guidedVoiceFinalizationDelay,
  reduceBloodPressureCapture,
  type BloodPressureCaptureState,
} from "./m6d-bp-stream";
import { applyGuidedVoiceFinalToNote } from "./m6d-guided-note-runtime";

const frame = (transcript: string, overrides: Partial<DeepgramResultsMessage> = {}): DeepgramResultsMessage => ({
  type: "Results",
  start: 0,
  is_final: false,
  channel: { alternatives: [{ transcript }] },
  ...overrides,
});

describe("M6D BP streaming finalization", () => {
  it("lets an interim BP entity complete before committing the Examination draft", () => {
    const assembler = new DeepgramTranscriptAssembler();
    expect(assembler.apply(frame("BP 110/8"))?.text).toBe("BP 110/8");
    expect(guidedVoiceFinalizationDelay("BP 110/8", 800)).toBe(BP_INCOMPLETE_FINALIZATION_MS);
    expect(assembler.apply(frame("BP 110/80"))?.text).toBe("BP 110/80");
    expect(guidedVoiceFinalizationDelay("BP 110/80", 800)).toBe(800);
    const final = assembler.apply(frame("BP 110/80", { is_final: true, from_finalize: true }));
    expect(final).toEqual({ text: "BP 110/80", isFinal: true });
    expect(applyGuidedVoiceFinalToNote("", final!.text).value).toBe("BP 110/80");
  });

  it("reconciles a split provider utterance without committing BP 110/8 or standalone 80", () => {
    const assembler = new DeepgramTranscriptAssembler();
    const firstProviderFinal = assembler.apply(frame("BP 110/8", { is_final: true, speech_final: true }));
    expect(firstProviderFinal).toEqual({ text: "BP 110/8", isFinal: true });
    assembler.reset();
    const secondProviderFinal = assembler.apply(frame("80", { start: 1.4, is_final: true, speech_final: true }));
    expect(secondProviderFinal).toEqual({ text: "80", isFinal: true });

    let state: BloodPressureCaptureState = { pending: null };
    const first = reduceBloodPressureCapture(state, { type: "provider-utterance", transcript: firstProviderFinal!.text });
    expect(first).toMatchObject({ commits: [], held: true });
    state = first.state;
    const second = reduceBloodPressureCapture(state, { type: "provider-utterance", transcript: secondProviderFinal!.text });
    expect(second).toEqual({ state: { pending: null }, commits: ["BP 110/80"], held: false });
    expect(applyGuidedVoiceFinalToNote("", second.commits[0]).value).toBe("BP 110/80");
  });

  it("expires genuine provider-final BP values unchanged instead of inventing a correction", () => {
    const held = reduceBloodPressureCapture({ pending: null }, { type: "provider-utterance", transcript: "BP 110/17" });
    expect(held).toMatchObject({ commits: [], held: true });
    const expired = reduceBloodPressureCapture(held.state, { type: "grace-expired" });
    expect(expired.commits).toEqual(["BP 110/17"]);
    expect(applyGuidedVoiceFinalToNote("", expired.commits[0]).value).toBe("BP 110/17");
  });

  it.each([
    ["BP 118 by 80", "complete"],
    ["BP 118 over 80", "complete"],
    ["BP 118 slash 80", "complete"],
    ["BP 118 80", "complete"],
    ["110 by 80", "not-bp"],
    ["Pulse 96 per minute", "not-bp"],
  ] as const)("classifies %s as %s", (transcript, expected) => {
    expect(bloodPressureCaptureState(transcript)).toBe(expected);
    expect(guidedVoiceFinalizationDelay(transcript, 800)).toBe(800);
  });

  it("keeps ordinary dictation and command timing at 800 ms", () => {
    expect(guidedVoiceFinalizationDelay("History", 800)).toBe(800);
    expect(guidedVoiceFinalizationDelay("Patient reports fever", 800)).toBe(800);
    expect(guidedVoiceFinalizationDelay("Pulse 96 per minute", 800)).toBe(800);
    expect(BP_SPLIT_COMPLETION_GRACE_MS).toBe(700);
    expect(applyGuidedVoiceFinalToNote("", "Pulse 96 per minute").value).toBe("Pulse 96 per minute");
    expect(applyGuidedVoiceFinalToNote("", "110 by 80").value).toBe("110 by 80");
  });

  it("wires the BP-only delay and split reconciliation into Guided Voice", () => {
    const panel = readFileSync("src/features/encounters/components/m6a-voice-panel.tsx", "utf8");
    const preview = panel.slice(panel.indexOf("function previewWithSilenceFinalization"), panel.indexOf("function writeDraft"));
    expect(preview).toContain("guidedVoiceFinalizationDelay(text, SILENCE_FINALIZE_MS)");
    expect(panel).toContain("reduceBloodPressureCapture");
    expect(panel).toContain("onUtteranceEnd: (text) => void handleGuidedUtteranceEnd(text)");
    expect(panel).toContain("BP_SPLIT_COMPLETION_GRACE_MS");
    expect(panel).not.toContain("SILENCE_FINALIZE_MS = 1500");
  });
});
