import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  DEFAULT_DICTATION_LANGUAGE,
  DICTATION_LANGUAGES,
  resolveDictationLanguage,
} from "./voice-language";
import {
  VOICE_TRANSCRIPTION_PROVIDER_IDS,
  getVoiceTranscriptionProvider,
} from "./provider";

async function source(file: string) {
  return readFile(path.resolve(file), "utf8");
}

function codeOnly(src: string) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\/[^\n]*/g, "");
}

describe("configurable dictation languages and providers", () => {
  it("prefers browser for English and Deepgram Nova-3 language bn for Bangla", () => {
    const english = resolveDictationLanguage("en-US");
    const bangla = resolveDictationLanguage("bn-BD");
    expect(english.preferredProvider).toBe("browser");
    expect(english.providers).toContainEqual({ id: "deepgram", label: "Deepgram", providerLanguage: "en-US" });
    expect(bangla.preferredProvider).toBe("deepgram");
    expect(bangla.providers).toContainEqual({ id: "deepgram", label: "Deepgram", providerLanguage: "bn" });
    expect(bangla.providers).toContainEqual({ id: "browser", label: "Browser fallback", providerLanguage: "bn-BD" });
    expect(DEFAULT_DICTATION_LANGUAGE).toBe("en-US");
  });

  it("registers browser and Deepgram behind the same provider interface", () => {
    expect(VOICE_TRANSCRIPTION_PROVIDER_IDS).toEqual(["browser", "deepgram"]);
    expect(getVoiceTranscriptionProvider("browser")?.id).toBe("browser");
    expect(getVoiceTranscriptionProvider("deepgram")?.id).toBe("deepgram");
  });

  it("is list-based and can accept more locales/providers later", () => {
    expect(DICTATION_LANGUAGES.length).toBeGreaterThanOrEqual(2);
    for (const option of DICTATION_LANGUAGES) {
      expect(option.label.trim()).not.toBe("");
      expect(option.lang).toMatch(/^[a-z]{2,3}(?:-[A-Z]{2})?$/);
      expect(option.providers.length).toBeGreaterThan(0);
      for (const provider of option.providers) {
        expect(VOICE_TRANSCRIPTION_PROVIDER_IDS).toContain(provider.id);
        expect(provider.providerLanguage.trim()).not.toBe("");
      }
    }
  });

  it("falls an unknown locale back to the configured default", () => {
    expect(resolveDictationLanguage("not-a-locale").lang).toBe(DEFAULT_DICTATION_LANGUAGE);
  });

  it("passes configured provider id and provider-specific language into DictateButton", async () => {
    const button = await source("src/features/dictation/components/dictate-button.tsx");
    expect(button).toMatch(/providerId: voiceLanguage\.provider/);
    expect(button).toMatch(/language: voiceLanguage\.providerLanguage/);
  });

  it("keeps language/provider preference local to UI state", async () => {
    const language = codeOnly(await source("src/features/dictation/voice-language.tsx"));
    for (const forbidden of ["localStorage", "sessionStorage", "indexedDB", "supabase", "DEEPGRAM_API_KEY"]) {
      expect(language.includes(forbidden), forbidden).toBe(false);
    }
  });

  it("keeps normal free-form dictation out of structured Vitals", async () => {
    const fields = await source("src/features/encounters/components/draft-fields.tsx");
    const vitals = fields.slice(fields.indexOf("export function VitalFields"));
    expect(vitals).not.toMatch(/<DictateButton/);
  });
});

describe("provider routing keeps authority and discard boundaries", () => {
  it("invalidates an old session before abort and gates late callbacks by run id", async () => {
    const hook = await source("src/features/dictation/use-dictation.ts");
    expect(hook).toMatch(/activeRun\.current \+= 1;[\s\S]*current\?\.abort\(\)/);
    expect(hook).toMatch(/activeRun\.current !== runId \|\| ended/);
    expect(hook).toMatch(/const runId = activeRun\.current \+ 1/);
  });

  it("DictateButton and orchestration still import no clinical actions", async () => {
    for (const file of [
      "src/features/dictation/use-dictation.ts",
      "src/features/dictation/components/dictate-button.tsx",
      "src/features/dictation/voice-language.tsx",
    ]) {
      const src = codeOnly(await source(file));
      expect(src).not.toMatch(/from\s+["'][^"']*actions["']/);
      expect(src).not.toMatch(/\bfinalize\w*\s*\(/);
      expect(src).not.toMatch(/\bfinish\w*consultation\w*\s*\(/i);
    }
  });
});
