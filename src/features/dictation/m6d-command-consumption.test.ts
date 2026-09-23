import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const panel = readFileSync(
  "src/features/encounters/components/m6a-voice-panel.tsx",
  "utf8",
);
const dictation = readFileSync("src/features/dictation/use-dictation.ts", "utf8");
const provider = readFileSync("src/features/dictation/provider.ts", "utf8");

describe("M6D navigation command consumption", () => {
  it("receives provider-final transcript before the end-of-run final callback", () => {
    expect(dictation).toContain("if (next.isFinal) onProviderFinalRef.current?.(next.text)");
    expect(panel).toContain("onProviderFinal: handleProviderFinal");
  });

  it("marks provider-final navigation consumed without restarting the persistent stream", () => {
    expect(panel).toContain("routePendingNavigation(local, true)");
    expect(panel).toContain("const local = parseM6DLocalCommand(rawText)");
    expect(panel).toContain('continuous: mode === "guided"');
    expect(panel).toContain("dictation.commitUtterance()");
    expect(panel).toContain("onUtteranceEnd: (text) => void handleFinal(text, false)");
    expect(panel.slice(panel.indexOf("function handleProviderFinal"), panel.indexOf("async function handleFinal"))).not.toContain("stopRef.current?.()");
  });

  it("suppresses the matching raw final before normalization or note append", () => {
    const rawGuard = panel.indexOf("const rawFinalLocal = parseM6DLocalCommand(rawText)");
    const normalize = panel.indexOf("const text = await normalizeTranscript(rawText, voiceLanguage.lang)");
    const append = panel.indexOf("appendDraft(destination.target, text)");
    expect(rawGuard).toBeGreaterThan(-1);
    expect(normalize).toBeGreaterThan(rawGuard);
    expect(append).toBeGreaterThan(normalize);
    expect(panel).toContain("pendingNavigation && isM6DNavigationIntent(rawFinalLocal)");
    expect(panel).toContain("pendingNavigation: null");
  });

  it("rolls back provisional navigation when a longer utterance is not a command", () => {
    expect(panel).toContain("rollbackPendingNavigation()");
    expect(panel).toContain("!isM6DNavigationIntent(candidate)");
  });

  it("keeps one provider session but forces a boundary after each consumed command", () => {
    expect(dictation).toContain("session.current?.commitUtterance?.()");
    expect(provider).toContain('socket.send(JSON.stringify({ type: "Finalize" }))');
    expect(provider).toContain("utteranceBoundaryPending = true");
    expect(provider).toContain("utteranceBoundaryPending = false");
    expect(provider).toContain("assembler.reset()");
    expect(panel).toContain("dictation.commitUtterance()");
  });

  it("commits ordinary guided dictation after stable silence without closing the persistent session", () => {
    const preview = panel.slice(
      panel.indexOf("function previewWithSilenceFinalization"),
      panel.indexOf("function writeDraft"),
    );
    expect(preview).toContain('if (mode === "guided")');
    expect(preview).toContain("latestPreviewRef.current === observed");
    expect(preview).toContain('voiceStateRef.current.session !== "idle"');
    expect(preview).toContain("dictation.commitUtterance()");
  });

  it("never treats accumulated command history as a navigation sequence", () => {
    expect(panel).not.toContain("parseM6DNavigationSequence");
    expect(panel).toContain("parseM6DLocalCommand(text)");
  });

  it("scrolls directly to the one selected target without animated stepping", () => {
    expect(panel).toContain('scrollIntoView({ behavior: "instant", block: "start" })');
    expect(panel).not.toContain('scrollIntoView({ behavior: "smooth"');
  });

  it("uses provider-final only to close standalone command boundaries", () => {
    const providerFinal = panel.slice(panel.indexOf("function handleProviderFinal"), panel.indexOf("async function handleFinal"));
    const speechFinal = panel.slice(panel.indexOf("async function handleFinal"), panel.indexOf("const dictation = useDictation"));
    expect(providerFinal).toContain('if (local.type === "NONE")');
    expect(providerFinal).toContain("dictation.commitUtterance()");
    expect(providerFinal).not.toContain("applyLocal(local)");
    expect(speechFinal).toContain("applyLocal(local)");
  });

  it("consumes controls before any clinical-note append", () => {
    const speechFinal = panel.slice(panel.indexOf("async function handleFinal"), panel.indexOf("const dictation = useDictation"));
    const apply = speechFinal.indexOf("applyLocal(local)");
    const append = speechFinal.indexOf("appendDraft(destination.target, text)");
    expect(apply).toBeGreaterThan(-1);
    expect(append).toBeGreaterThan(apply);
    expect(speechFinal).toContain('if (local.type !== "NONE")');
  });

  it("keeps the persistent command listener available for spoken Pause then Resume", () => {
    expect(panel).toContain('if (intent.type === "PAUSE") return pauseSession(true)');
    expect(panel).toContain('if (intent.type === "RESUME") return resumeSession(true)');
    expect(panel).toContain("if (providerBusy && !keepCommandListener) dictation.stop()");
    expect(panel).toContain("if (!keepCurrentSession) dictation.start()");
  });

  it("never leaks speech into notes while voice dictation is paused", () => {
    expect(panel).toContain('voiceStateRef.current.session === "paused"');
    expect(panel).toContain("Speech was not added to the clinical draft.");
  });
});
