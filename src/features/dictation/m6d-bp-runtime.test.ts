import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { applyGuidedVoiceFinalToNote } from "./m6d-guided-note-runtime";

describe("M6D BP provider-final runtime path", () => {
  it.each([
    ["B p hundred 18 80", "BP 118/80"],
    ["B p hundred 18 80.", "BP 118/80."],
    ["BP hundred 18 80", "BP 118/80"],
    ["BP hundred 10 slash 80", "BP 110/80"],
    ["BP hundred 10 slash 80.", "BP 110/80."],
    ["BP 118 by 80", "BP 118/80"],
    ["BP 118 over 80", "BP 118/80"],
    ["BP 118 slash 80", "BP 118/80"],
    ["BP 118 80", "BP 118/80"],
    ["Pulse ninety six per minute", "Pulse 96 per minute"],
  ])("takes provider final %j through normalization and Examination append", (providerFinal, expected) => {
    const examination = "Throat congested.";
    const result = applyGuidedVoiceFinalToNote(examination, providerFinal);
    expect(result.normalizedTranscript).toBe(expected);
    expect(result.value).toBe(`Throat congested.\n${expected}`);
  });

  it.each([
    "Patient took 1 tablet 2 times",
    "Fever for 18 days",
    "VP was documented previously",
    "Vitamin B 12 80",
    "Patient lost 10 8 kilograms",
  ])("does not split adjacent numbers in non-BP provider prose: %s", (providerFinal) => {
    const result = applyGuidedVoiceFinalToNote("", providerFinal);
    expect(result.normalizedTranscript).toBe(providerFinal);
    expect(result.value).toBe(providerFinal);
  });

  it("is the exact ordinary-note branch used by Guided Voice handleFinal", () => {
    const panel = readFileSync("src/features/encounters/components/m6a-voice-panel.tsx", "utf8");
    const handleFinal = panel.slice(panel.indexOf("async function handleFinal"), panel.indexOf("const dictation = useDictation"));
    expect(handleFinal).toContain("applyGuidedVoiceFinalToNote(current, appendText ?? text)");
    expect(handleFinal).toContain("writeDraft(destination.target, result.value)");
  });
});
