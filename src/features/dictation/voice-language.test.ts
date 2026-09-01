import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  DEFAULT_DICTATION_LANGUAGE,
  DICTATION_LANGUAGES,
  resolveDictationLanguage,
} from "./voice-language";

async function source(file: string) {
  return readFile(path.resolve(file), "utf8");
}

function codeOnly(src: string) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\/[^\n]*/g, "");
}

describe("configurable browser dictation languages", () => {
  it("ships English and Bangla Bangladesh as initial configured locales", () => {
    expect(DICTATION_LANGUAGES).toContainEqual({ label: "English", lang: "en-US" });
    expect(DICTATION_LANGUAGES).toContainEqual({ label: "বাংলা", lang: "bn-BD" });
    expect(DEFAULT_DICTATION_LANGUAGE).toBe("en-US");
  });

  it("is a list-based configuration that can accept more locales later", () => {
    expect(Array.isArray(DICTATION_LANGUAGES)).toBe(true);
    expect(DICTATION_LANGUAGES.length).toBeGreaterThanOrEqual(2);
    for (const option of DICTATION_LANGUAGES) {
      expect(option.label.trim()).not.toBe("");
      expect(option.lang).toMatch(/^[a-z]{2,3}(?:-[A-Z]{2})?$/);
    }
  });

  it("fails a stale/unknown selection back to the configured default", () => {
    expect(resolveDictationLanguage("bn-BD").lang).toBe("bn-BD");
    expect(resolveDictationLanguage("en-US").lang).toBe("en-US");
    expect(resolveDictationLanguage("not-a-locale").lang).toBe(DEFAULT_DICTATION_LANGUAGE);
  });

  it("passes the selected BCP-47 tag only into the browser recognition engine", async () => {
    const hook = await source("src/features/dictation/use-dictation.ts");
    expect(hook).toMatch(/language = DEFAULT_DICTATION_LANGUAGE/);
    expect(hook).toMatch(/engine\.lang = language/);
    expect(hook).toMatch(/\}, \[language\]\);/);

    const button = await source("src/features/dictation/components/dictate-button.tsx");
    expect(button).toMatch(/useVoiceLanguage\(\)/);
    expect(button).toMatch(/language: voiceLanguage\.lang/);
  });

  it("keeps the language preference local to the browser UI with no persistence or backend", async () => {
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

  it("shows one consultation-wide selector beside Fast Entry rather than one per field", async () => {
    const fastEntry = await source("src/features/encounters/components/fast-entry.tsx");
    expect(fastEntry).toMatch(/<VoiceLanguageControl disabled=\{blocked\} \/>/);
    expect(fastEntry).toMatch(/VoiceLanguageControl/);

    const button = await source("src/features/dictation/components/dictate-button.tsx");
    expect(button).not.toMatch(/<select/);
  });

  it("keeps normal free-form dictation out of structured Vitals", async () => {
    const fields = await source("src/features/encounters/components/draft-fields.tsx");
    const vitals = fields.slice(fields.indexOf("export function VitalFields"));
    expect(vitals).not.toMatch(/<DictateButton/);
  });
});

describe("language support does not weaken the corrected discard boundary", () => {
  it("still invalidates an old run before abort and gates late callbacks by run id", async () => {
    const hook = await source("src/features/dictation/use-dictation.ts");
    expect(hook).toMatch(/activeRun\.current \+= 1;[\s\S]*engine\?\.abort\(\)/);
    expect(hook).toMatch(/activeRun\.current !== runId \|\| ended/);
    expect(hook).toMatch(/const runId = activeRun\.current \+ 1/);
  });

  it("adds no clinical write authority", async () => {
    for (const file of [
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
