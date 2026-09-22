import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const panel = readFileSync(
  "src/features/encounters/components/m6a-voice-panel.tsx",
  "utf8",
);
const dictation = readFileSync("src/features/dictation/use-dictation.ts", "utf8");

describe("M6D navigation command consumption", () => {
  it("receives provider-final transcript before the end-of-run final callback", () => {
    expect(dictation).toContain("if (next.isFinal) onProviderFinalRef.current?.(next.text)");
    expect(panel).toContain("onProviderFinal: handleProviderFinal");
  });

  it("marks provider-final navigation consumed without restarting the persistent stream", () => {
    expect(panel).toContain("routePendingNavigation(local, true)");
    expect(panel).toContain('continuous: mode === "guided"');
    expect(panel).toContain("onUtteranceEnd: (text) => void handleFinal(text, false)");
    expect(panel.slice(panel.indexOf("function handleProviderFinal"), panel.indexOf("async function handleFinal"))).not.toContain("stopRef.current?.()");
  });

  it("suppresses the matching raw final before normalization or note append", () => {
    const rawGuard = panel.indexOf("const rawFinalLocal = parseM6DLocalCommand(rawText)");
    const normalize = panel.indexOf("const text = await normalizeTranscript(rawText, voiceLanguage.lang)");
    const append = panel.indexOf("appendDraft(targetRef.current, text)");
    expect(rawGuard).toBeGreaterThan(-1);
    expect(normalize).toBeGreaterThan(rawGuard);
    expect(append).toBeGreaterThan(normalize);
    expect(panel).toContain("pendingNavigation?.consumed");
    expect(panel).toContain("pendingNavigationRef.current = null");
  });

  it("rolls back provisional navigation when a longer utterance is not a command", () => {
    expect(panel).toContain("rollbackPendingNavigation()");
    expect(panel).toContain("!isM6DNavigationIntent(candidate)");
  });

  it("keeps guided utterances on one stream and resets provider text at speech boundaries", () => {
    expect(dictation).toContain("continuous,");
    expect(dictation).toContain("onUtteranceEndRef.current?.(said)");
    expect(panel).toContain('if (mode !== "guided")');
  });
});
