import { describe, expect, it, vi } from "vitest";
import { normalizeClinicalTranscript } from "./normalize";
import { createMockVoiceTranscriptionProvider, mockTranscriptFor } from "./mock-provider";

function runMock(scenario: Parameters<typeof createMockVoiceTranscriptionProvider>[0] = {}) {
  vi.useFakeTimers();
  const events: string[] = [];
  let final = "";
  let error = "";
  const provider = createMockVoiceTranscriptionProvider(scenario);
  const session = provider.createSession({
    language: "en-US",
    callbacks: {
      onPhase: (phase) => events.push(phase),
      onTranscript: (value) => events.push(`text:${value.text}`),
      onLatency: () => {},
      onError: (code) => { error = code; },
      onEnd: (value) => { final = value; },
    },
  })!;
  session.start();
  vi.advanceTimersByTime(200);
  session.stop();
  vi.runAllTimers();
  vi.useRealTimers();
  return { events, final, error };
}

describe("M6A clinical transcript normalization", () => {
  it("preserves English medical terms, numbers and units", () => {
    expect(normalizeClinicalTranscript(" BP 120/80 mmHg , SpO2 98% , paracetamol 500 mg ").normalized)
      .toBe("BP 120/80 mmHg, SpO2 98%, paracetamol 500 mg");
  });

  it("preserves Bangla", () => {
    expect(normalizeClinicalTranscript("তিন দিন ধরে  জ্বর ।  BP 120/80").normalized)
      .toBe("তিন দিন ধরে জ্বর। BP 120/80");
  });

  it("preserves Banglish/mixed clinical wording without transliterating Bangla", () => {
    expect(normalizeClinicalTranscript("Patient এর তিন দিন ধরে fever , dry cough আছে").normalized)
      .toBe("Patient এর তিন দিন ধরে fever, dry cough আছে");
  });

  it("provides deterministic English, Bangla and native-script Banglish fixtures", () => {
    expect(mockTranscriptFor("en-US")).toContain("Fever");
    expect(mockTranscriptFor("bn")).toContain("জ্বর");
    expect(mockTranscriptFor("mixed")).toContain("Patient এর");
    expect(mockTranscriptFor("mixed")).not.toContain("Patient er");
  });
});

describe("M6A mock voice lifecycle", () => {
  it("streams then finalizes without external provider", () => {
    const result = runMock({ transcript: "CBC advised" });
    expect(result.events).toContain("connecting");
    expect(result.events).toContain("listening");
    expect(result.events).toContain("finalizing");
    expect(result.final).toBe("CBC advised");
    expect(result.error).toBe("");
  });

  it.each([
    ["permission-denied", "not-allowed"],
    ["no-microphone", "audio-capture"],
    ["no-speech", "no-speech"],
    ["timeout", "first-transcript-timeout"],
    ["disconnect", "network"],
  ] as const)("maps %s deterministically", (scenario, code) => {
    const result = runMock({ scenario });
    expect(result.error).toBe(code);
    expect(result.final).toBe("");
  });
});
