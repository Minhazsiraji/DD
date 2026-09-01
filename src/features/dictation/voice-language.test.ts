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
  it("ships English and Bangla Bangladesh on the browser provider for MVP", () => {
    expect(DICTATION_LANGUAGES).toContainEqual({
      label: "English",
      lang: "en-US",
      provider: "browser",
    });
    expect(DICTATION_LANGUAGES).toContainEqual({
      label: "বাংলা",
      lang: "bn-BD",
      provider: "browser",
    });
    expect(DEFAULT_DICTATION_LANGUAGE).toBe("en-US");
  });

  it("keeps a provider kind reserved for a future server implementation without enabling one", () => {
    expect(VOICE_TRANSCRIPTION_PROVIDER_IDS).toContain("browser");
    expect(VOICE_TRANSCRIPTION_PROVIDER_IDS).toContain("future_server_provider");
    expect(getVoiceTranscriptionProvider("browser")?.id).toBe("browser");
    expect(getVoiceTranscriptionProvider("future_server_provider")).toBeNull();
  });

  it("is list-based configuration that can accept more locales later", () => {
    expect(Array.isArray(DICTATION_LANGUAGES)).toBe(true);
    expect(DICTATION_LANGUAGES.length).toBeGreaterThanOrEqual(2);
    for (const option of DICTATION_LANGUAGES) {
      expect(option.label.trim()).not.toBe("");
      expect(option.lang).toMatch(/^[a-z]{2,3}(?:-[A-Z]{2})?$/);
      expect(VOICE_TRANSCRIPTION_PROVIDER_IDS).toContain(option.provider);
    }
  });

  it("falls an unknown locale back to the configured default", () => {
    expect(resolveDictationLanguage("bn-BD").lang).toBe("bn-BD");
    expect(resolveDictationLanguage("en-US").lang).toBe("en-US");
    expect(resolveDictationLanguage("not-a-locale").lang).toBe(DEFAULT_DICTATION_LANGUAGE);
  });

  it("routes the selected locale through provider config and passes lang to the provider adapter", async () => {
    const hook = await source("src/features/dictation/use-dictation.ts");
    const provider = await source("src/features/dictation/provider.ts");
    expect(hook).toMatch(/resolveDictationLanguage\(language\)/);
    expect(hook).toMatch(/getVoiceTranscriptionProvider\(activeLanguage\.provider\)/);
    expect(hook).toMatch(/language: activeLanguage\.lang/);
    expect(provider).toMatch(/engine\.lang = language/);

    const button = await source("src/features/dictation/components/dictate-button.tsx");
    expect(button).toMatch(/useVoiceLanguage\(\)/);
    expect(button).toMatch(/language: voiceLanguage\.lang/);
  });

  it("keeps the language preference local to the UI with no persistence or backend", async () => {
    const language = codeOnly(await source("src/features/dictation/voice-language.tsx"));
    for (const forbidden of [
      "localStorage",
      "sessionStorage",
      "indexedDB",
      "fetch(",
      "supabase",
      "MediaRecorder",
      "FormData",
      "Blob",
    ]) {
      expect(language.includes(forbidden), forbidden).toBe(false);
    }
  });

  it("shows one consultation-wide selector rather than one select per Dictate button", async () => {
    const fastEntry = await source("src/features/encounters/components/fast-entry.tsx");
    expect(fastEntry).toMatch(/<VoiceLanguageControl disabled=\{blocked\} \/>/);
    const button = await source("src/features/dictation/components/dictate-button.tsx");
    expect(button).not.toMatch(/<select/);
  });

  it("keeps normal free-form dictation out of structured Vitals", async () => {
    const fields = await source("src/features/encounters/components/draft-fields.tsx");
    const vitals = fields.slice(fields.indexOf("export function VitalFields"));
    expect(vitals).not.toMatch(/<DictateButton/);
  });
});

describe("provider routing does not weaken the discard or clinical authority boundary", () => {
  it("still invalidates an old session before abort and gates late callbacks by run id", async () => {
    const hook = await source("src/features/dictation/use-dictation.ts");
    expect(hook).toMatch(/activeRun\.current \+= 1;[\s\S]*current\?\.abort\(\)/);
    expect(hook).toMatch(/activeRun\.current !== runId \|\| ended/);
    expect(hook).toMatch(/const runId = activeRun\.current \+ 1/);
  });

  it("adds no active server provider and no clinical write authority", async () => {
    for (const file of [
      "src/features/dictation/provider.ts",
      "src/features/dictation/use-dictation.ts",
      "src/features/dictation/components/dictate-button.tsx",
      "src/features/dictation/voice-language.tsx",
    ]) {
      const src = codeOnly(await source(file));
      for (const forbidden of [
        /from\s+["'][^"']*actions["']/,
        /from\s+["'][^"']*supabase[^"']*["']/,
        /\bfetch\s*\(/,
        /\bfinalize\w*\s*\(/,
        /\bfinish\w*consultation\w*\s*\(/i,
      ]) {
        expect(forbidden.test(src), `${file}: ${forbidden}`).toBe(false);
      }
    }
  });
});
