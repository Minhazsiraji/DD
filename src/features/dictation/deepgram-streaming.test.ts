import { describe, expect, it } from "vitest";
import {
  DEEPGRAM_CONNECTION_TIMEOUT_MS,
  DEEPGRAM_FINALIZE_TIMEOUT_MS,
  DEEPGRAM_FIRST_TRANSCRIPT_TIMEOUT_MS,
  DEEPGRAM_MEDIA_TIMESLICE_MS,
  DEEPGRAM_STREAM_MODEL,
  DeepgramTranscriptAssembler,
  buildDeepgramStreamingUrl,
  deepgramBearerProtocols,
} from "./deepgram-stream";

describe("Deepgram Nova-3 selective streaming core", () => {
  it("locks the approved model and bounded pilot timings", () => {
    expect(DEEPGRAM_STREAM_MODEL).toBe("nova-3");
    expect(DEEPGRAM_MEDIA_TIMESLICE_MS).toBe(250);
    expect(DEEPGRAM_CONNECTION_TIMEOUT_MS).toBe(5000);
    expect(DEEPGRAM_FIRST_TRANSCRIPT_TIMEOUT_MS).toBe(5000);
    expect(DEEPGRAM_FINALIZE_TIMEOUT_MS).toBe(1500);
  });

  it("builds only allowed English and Bengali provider URLs", () => {
    const english = new URL(buildDeepgramStreamingUrl("en-US"));
    const bangla = new URL(buildDeepgramStreamingUrl("bn"));
    for (const url of [english, bangla]) {
      expect(url.origin).toBe("wss://api.deepgram.com");
      expect(url.pathname).toBe("/v1/listen");
      expect(url.searchParams.get("model")).toBe("nova-3");
      expect(url.searchParams.get("interim_results")).toBe("true");
      expect(url.searchParams.get("mip_opt_out")).toBe("true");
    }
    expect(english.searchParams.get("language")).toBe("en-US");
    expect(bangla.searchParams.get("language")).toBe("bn");
    expect(() => buildDeepgramStreamingUrl("fr")).toThrow(/unsupported/);
  });

  it("uses temporary bearer subprotocols without embedding a permanent key in URL", () => {
    const token = "temporary.jwt.token";
    expect(deepgramBearerProtocols(token)).toEqual(["bearer", token]);
    expect(buildDeepgramStreamingUrl("bn")).not.toContain(token);
  });

  it("replaces interim text with final text instead of duplicating it", () => {
    const assembler = new DeepgramTranscriptAssembler();
    expect(
      assembler.apply({
        type: "Results",
        start: 0,
        is_final: false,
        channel: { alternatives: [{ transcript: "Napa five" }] },
      })?.text,
    ).toBe("Napa five");
    expect(
      assembler.apply({
        type: "Results",
        start: 0,
        is_final: true,
        channel: { alternatives: [{ transcript: "Napa 500 mg" }] },
      })?.text,
    ).toBe("Napa 500 mg");
    expect(
      assembler.apply({
        type: "Results",
        start: 2.5,
        is_final: true,
        channel: { alternatives: [{ transcript: "BD 5 days" }] },
      })?.text,
    ).toBe("Napa 500 mg BD 5 days");
    expect(assembler.current()).toBe("Napa 500 mg BD 5 days");
  });

  it("preserves Bangla punctuation while joining final segments", () => {
    const assembler = new DeepgramTranscriptAssembler();
    assembler.apply({
      type: "Results",
      start: 0,
      is_final: true,
      channel: { alternatives: [{ transcript: "খাবারের পরে" }] },
    });
    assembler.apply({
      type: "Results",
      start: 1,
      is_final: true,
      channel: { alternatives: [{ transcript: "দিনে দুইবার ।" }] },
    });
    expect(assembler.current()).toBe("খাবারের পরে দিনে দুইবার।");
  });
});
