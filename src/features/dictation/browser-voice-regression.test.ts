import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  DICTATION_LABEL,
  dictationErrorMessage,
  insertTranscript,
} from "./dictation";

async function source(file: string) {
  return readFile(path.resolve(file), "utf8");
}

function codeOnly(src: string) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\/[^\n]*/g, "");
}

describe("accepted draft insertion behavior remains intact", () => {
  it("starts a new line after a finished sentence", () => {
    expect(insertTranscript("Throat congested.", "Chest clear.").text).toBe(
      "Throat congested.\nChest clear.",
    );
  });

  it("does not create duplicate spaces", () => {
    expect(insertTranscript("Fever ", "three days").text).toBe("Fever three days");
    expect(insertTranscript("Fever\n", "three days").text).toBe("Fever\nthree days");
  });

  it("appends when caret is absent or invalid", () => {
    for (const caret of [undefined, -1, 999]) {
      expect(insertTranscript("Fever", "today", caret).text).toBe("Fever today");
    }
  });

  it("never removes existing doctor-authored text", () => {
    const existing = "Detailed examination the doctor typed by hand.";
    const preserved = (result: string) => {
      let i = 0;
      for (const ch of result) if (ch === existing[i]) i += 1;
      return i === existing.length;
    };
    for (const caret of [undefined, 0, 5, 22, existing.length]) {
      const result = insertTranscript(existing, "and more", caret).text;
      expect(preserved(result), `caret ${caret}`).toBe(true);
      expect(result.length).toBeGreaterThan(existing.length);
    }
  });

  it("blank recognition result changes nothing", () => {
    for (const said of ["", "   ", "\n\t"]) {
      expect(insertTranscript("Fever", said).text).toBe("Fever");
    }
  });
});

describe("accepted recovery and accessibility behavior remains intact", () => {
  it("all public states have text labels including provider unavailable", () => {
    for (const state of [
      "ready",
      "recording",
      "transcribing",
      "error",
      "provider-unavailable",
      "unsupported",
    ] as const) {
      expect(DICTATION_LABEL[state]?.length, state).toBeGreaterThan(0);
    }
  });

  it("every normal error is explained without claiming draft loss", () => {
    for (const code of [
      "not-allowed",
      "audio-capture",
      "network",
      "provider-unavailable",
      "provider-error",
      "no-speech",
      "weird",
    ]) {
      const message = dictationErrorMessage(code);
      expect(message.length, code).toBeGreaterThan(0);
      expect(message).not.toMatch(/lost|deleted|cleared/i);
    }
  });

  it("silence is not described as an alarming failure", () => {
    expect(dictationErrorMessage("no-speech")).not.toMatch(/error|failed/i);
  });

  it("DictateButton names its field and exposes start stop discard", async () => {
    const button = await source("src/features/dictation/components/dictate-button.tsx");
    expect(button).toMatch(/aria-label=/);
    expect(button).toMatch(/fieldLabel/);
    for (const action of ["start", "stop", "cancel"]) {
      expect(button.includes(`onClick={${action}}`), action).toBe(true);
    }
    expect(button).toMatch(/Try again/);
  });

  it("all microphone action buttons retain real mobile touch targets", async () => {
    const button = await source("src/features/dictation/components/dictate-button.tsx");
    const buttons = button.match(/<button[\s\S]*?>/g) ?? [];
    expect(buttons.length).toBeGreaterThan(0);
    for (const element of buttons) expect(element).toMatch(/min-h-11/);
  });

  it("repeated dictation continues from the returned insertion caret", async () => {
    const button = await source("src/features/dictation/components/dictate-button.tsx");
    expect(button).toMatch(/insertionCaret\.current = result\.caret/);
    expect(button).toMatch(/insertTranscript\(value, said, insertionCaret\.current\)/);
  });
});

describe("browser fallback and provider-neutral authority remain intact", () => {
  it("browser adapter still owns Web Speech implementation details", async () => {
    const provider = await source("src/features/dictation/provider.ts");
    expect(provider).toMatch(/SpeechRecognition/);
    expect(provider).toMatch(/webkitSpeechRecognition/);
    expect(provider).toMatch(/engine\.lang = language/);
  });

  it("unsupported provider hides Dictate without breaking typing", async () => {
    const button = await source("src/features/dictation/components/dictate-button.tsx");
    const hook = await source("src/features/dictation/use-dictation.ts");
    expect(button).toMatch(/if \(!supported\) return null/);
    expect(hook).toMatch(/setState\("unsupported"\)/);
  });

  it("one shared consultation selector remains outside individual DictateButton", async () => {
    const fastEntry = await source("src/features/encounters/components/fast-entry.tsx");
    const button = await source("src/features/dictation/components/dictate-button.tsx");
    expect(fastEntry).toMatch(/<VoiceLanguageControl disabled=\{blocked\} \/>/);
    expect(button).not.toMatch(/<select/);
  });

  it("finding dictation still edits title and note but cannot submit", async () => {
    const finding = await source("src/features/encounters/components/finding-form.tsx");
    expect((finding.match(/<DictateButton/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(finding).toMatch(/value=\{value\.title\}/);
    expect(finding).toMatch(/title: next/);
    expect(finding).toMatch(/value=\{value\.note\}/);
    expect(finding).toMatch(/note: next/);
    expect(finding).toMatch(/type="submit"/);
    expect(finding).toMatch(/if \(canSubmit\) onSubmit\(\)/);
  });

  it("voice UI still imports no clinical action/query/database client", async () => {
    for (const file of [
      "src/features/dictation/use-dictation.ts",
      "src/features/dictation/components/dictate-button.tsx",
      "src/features/dictation/voice-language.tsx",
    ]) {
      const code = codeOnly(await source(file));
      expect(code).not.toMatch(/from\s+["'][^"']*actions["']/);
      expect(code).not.toMatch(/from\s+["'][^"']*queries["']/);
      expect(code).not.toMatch(/from\s+["'][^"']*supabase[^"']*["']/);
      expect(code).not.toMatch(/\bfinalize\w*\s*\(/);
      expect(code).not.toMatch(/\bsave\w*\s*\(/);
      expect(code).not.toMatch(/finish[_A-Za-z]*consultation/i);
    }
  });

  it("privacy copy is provider-specific and never says audio stays on device", async () => {
    const provider = await source("src/features/dictation/provider.ts");
    const button = await source("src/features/dictation/components/dictate-button.tsx");
    expect(provider).toMatch(/browser's speech service/);
    expect(provider).toMatch(/Audio is sent to Deepgram for transcription/);
    expect(provider).toMatch(/does not store the audio/);
    expect(button).toMatch(/providerNotice/);
    expect(`${provider}\n${button}`).not.toMatch(/audio never leaves (?:your|the) device/i);
  });
});
