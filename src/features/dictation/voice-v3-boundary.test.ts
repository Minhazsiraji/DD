import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";

async function source(file: string) {
  return readFile(path.resolve(file), "utf8");
}

describe("Voice V3 pilot boundary", () => {
  it("does not expose an unproven Bangla + English doctor-facing mode", async () => {
    const language = await source("src/features/dictation/voice-language.tsx");
    expect(language).not.toContain("বাংলা + English");
    expect(language).not.toMatch(/providerLanguage:\s*["']multi["']/);
  });

  it("keeps the two physically proven Deepgram language routes unchanged", async () => {
    const language = await source("src/features/dictation/voice-language.tsx");
    expect(language).toMatch(/label: "English"[\s\S]*providerLanguage: "en-US"/);
    expect(language).toMatch(/label: "বাংলা"[\s\S]*providerLanguage: "bn"/);
  });

  it("keeps the QA engine selector while provider choice remains under evaluation", async () => {
    const language = await source("src/features/dictation/voice-language.tsx");
    expect(language).toContain("Engine:");
    expect(language).toContain("Browser fallback");
    expect(language).toContain("Deepgram");
  });
});
