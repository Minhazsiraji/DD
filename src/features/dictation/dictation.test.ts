import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  DICTATION_LABEL,
  dictationErrorMessage,
  insertTranscript,
  transcriptAfterCancel,
} from "./dictation";

async function code(file: string) {
  return (await readFile(path.resolve(file), "utf8"))
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\/[^\n]*/g, "");
}

describe("a transcript never destroys what is already written", () => {
  it("fills empty and appends to existing text", () => {
    expect(insertTranscript("", "Fever for three days").text).toBe("Fever for three days");
    expect(insertTranscript("Fever", "for three days").text).toBe("Fever for three days");
  });

  it("inserts at caret and preserves both sides", () => {
    const r = insertTranscript("Fever and cough", "high", 5);
    expect(r.text).toBe("Fever high and cough");
    expect(r.text.slice(0, r.caret)).toBe("Fever high");
  });

  it("preserves Bangla exactly", () => {
    const said = "জ্বর তিন দিন";
    expect(insertTranscript("", said).text).toBe(said);
    expect(insertTranscript("Note:", said).text).toBe(`Note: ${said}`);
  });

  it("keeps returned caret for repeated dictation", () => {
    const first = insertTranscript("Fever and cough", "high", 5);
    const second = insertTranscript(first.text, "persistent", first.caret);
    expect(second.text).toBe("Fever high persistent and cough");
  });
});

describe("discard and stale-result boundary", () => {
  it("cancel yields no text", () => {
    expect(transcriptAfterCancel()).toBe("");
    expect(insertTranscript("Fever", transcriptAfterCancel()).text).toBe("Fever");
  });

  it("invalidates old provider sessions before abort and gates callbacks by run id", async () => {
    const hook = await code("src/features/dictation/use-dictation.ts");
    expect(hook).toMatch(/const activeRun = React\.useRef\(0\)/);
    expect(hook).toMatch(/activeRun\.current \+= 1;[\s\S]*?current\?\.abort\(\)/);
    expect(hook).toMatch(/activeRun\.current !== runId \|\| ended/);
    expect(hook).toMatch(/const runId = activeRun\.current \+ 1;\s*activeRun\.current = runId/);
  });

  it("Deepgram abort cancels upload/result delivery", async () => {
    const provider = await code("src/features/dictation/provider.ts");
    expect(provider).toMatch(/cancelled = true/);
    expect(provider).toMatch(/controller\.abort\(\)/);
    expect(provider).toMatch(/if \(cancelled\) return/);
  });
});

describe("failure leaves draft alone", () => {
  it("provider and network errors say draft is untouched", () => {
    for (const code of ["network", "provider-unavailable", "provider-error"]) {
      expect(dictationErrorMessage(code)).toMatch(/untouched/);
    }
  });

  it("permission denial is actionable", () => {
    expect(dictationErrorMessage("not-allowed")).toMatch(/[Aa]llow microphone/);
  });
});

describe("state and accessibility", () => {
  it("every state has words", () => {
    for (const state of ["ready", "recording", "transcribing", "error", "unsupported"] as const) {
      expect(DICTATION_LABEL[state]?.length).toBeGreaterThan(0);
    }
  });

  it("control exposes recording state and real touch targets", async () => {
    const button = await code("src/features/dictation/components/dictate-button.tsx");
    expect(button).toMatch(/role="status"/);
    expect(button).toMatch(/aria-live="polite"/);
    for (const b of button.match(/<button[\s\S]*?>/g) ?? []) expect(b).toMatch(/min-h-11/);
  });
});

describe("voice remains draft assistance, not clinical authority", () => {
  it("shared UI/orchestration imports no clinical actions and performs no save/finalize", async () => {
    for (const file of [
      "src/features/dictation/use-dictation.ts",
      "src/features/dictation/components/dictate-button.tsx",
      "src/features/dictation/voice-language.tsx",
    ]) {
      const src = await code(file);
      expect(src).not.toMatch(/from\s+["'][^"']*actions["']/);
      expect(src).not.toMatch(/\bfinalize\w*\s*\(/);
      expect(src).not.toMatch(/\bsave\w*\s*\(/);
      expect(src).not.toMatch(/\bfinish\w*consultation\w*\s*\(/i);
    }
  });

  it("consultation transcript still reaches draft setters only", async () => {
    const fields = await code("src/features/encounters/components/draft-fields.tsx");
    expect(fields).toMatch(/onInsert=\{\(next\) => onChange\(section\.key, next\)\}/);
    expect(fields).not.toMatch(/autoSave|autosave/i);
  });

  it("finding voice drafts title/note but submit remains explicit", async () => {
    const finding = await code("src/features/encounters/components/finding-form.tsx");
    expect((finding.match(/<DictateButton/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(finding).toMatch(/type="submit"/);
    expect(finding).toMatch(/if \(canSubmit\) onSubmit\(\)/);
  });
});

describe("provider privacy boundary", () => {
  it("browser and Deepgram disclosures are accurate and never promise on-device processing", async () => {
    const provider = await readFile(path.resolve("src/features/dictation/provider.ts"), "utf8");
    expect(provider).toMatch(/browser's speech service/);
    expect(provider).toMatch(/sent to Deepgram for transcription/);
    expect(provider).toMatch(/does not store the audio/);
    expect(provider).not.toMatch(/audio never leaves (?:your|the) device/i);
  });

  it("Deepgram client transport goes only through the DD transcription endpoint", async () => {
    const provider = await code("src/features/dictation/provider.ts");
    expect(provider).toMatch(/fetch\("\/api\/voice\/transcribe"/);
    expect(provider).not.toMatch(/api\.deepgram\.com/);
    expect(provider).not.toMatch(/DEEPGRAM_API_KEY/);
  });

  it("no voice client persists audio or transcript", async () => {
    const provider = await code("src/features/dictation/provider.ts");
    for (const forbidden of ["localStorage", "sessionStorage", "indexedDB", "console.log", "supabase"] ) {
      expect(provider.includes(forbidden), forbidden).toBe(false);
    }
  });
});
