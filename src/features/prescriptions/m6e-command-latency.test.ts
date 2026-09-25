import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(process.cwd(), "src/features/prescriptions/components/m6e-prescription-voice-panel.tsx"),
  "utf8",
);

describe("M6E Prescription voice command latency", () => {
  it("forces a persistent-session utterance boundary after 800 ms of stable silence", () => {
    expect(source).toContain("const M6E_SILENCE_FINALIZE_MS = 800");
    expect(source).toContain("latestPreviewRef.current = text");
    expect(source).toContain("if (latestPreviewRef.current === observed) dictation.commitUtterance()");
    expect(source).toContain("}, M6E_SILENCE_FINALIZE_MS)");
    expect(source).toContain("continuous: true");
  });

  it("clears the pending latency timer at every utterance/session boundary", () => {
    expect(source.match(/clearSilenceTimer\(\)/g)?.length ?? 0).toBeGreaterThanOrEqual(6);
    expect(source).toContain("onUtteranceEnd: (text) => {\n      clearSilenceTimer()");
    expect(source).toContain("onFinal: (text) => {\n      clearSilenceTimer()");
    expect(source).toContain("onCancel: () => {\n      clearSilenceTimer()");
  });
});
