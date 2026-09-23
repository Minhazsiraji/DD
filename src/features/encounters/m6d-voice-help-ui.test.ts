import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const panel = readFileSync("src/features/encounters/components/m6a-voice-panel.tsx", "utf8");

describe("M6D compact contextual voice help", () => {
  it("associates a compact help disclosure with the sticky Voice Assistant", () => {
    expect(panel).toContain("What can I say?");
    expect(panel).toContain("data-m6d-voice-help");
    expect(panel).toContain("getM6DVoiceHelpExamples(currentSection)");
    expect(panel).toContain("Target: {SECTION_LABELS[currentSection]}");
  });

  it("keeps help mobile-safe and does not create another voice state", () => {
    expect(panel).toContain("max-w-full");
    expect(panel).toContain("break-words");
    expect(panel).toContain("Commands work only as standalone utterances");
    expect((panel.match(/useState<M6DVoiceState>/g) ?? []).length).toBe(1);
  });
});
