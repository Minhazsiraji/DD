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
  it("fills an empty field", () => {
    expect(insertTranscript("", "Fever for three days").text).toBe("Fever for three days");
  });

  it("appends after existing text with a single space", () => {
    expect(insertTranscript("Fever", "for three days").text).toBe("Fever for three days");
  });

  it("starts a new line after a finished sentence", () => {
    expect(insertTranscript("Throat congested.", "Chest clear.").text).toBe(
      "Throat congested.\nChest clear.",
    );
  });

  it("adds no second space where one already exists", () => {
    expect(insertTranscript("Fever ", "three days").text).toBe("Fever three days");
    expect(insertTranscript("Fever\n", "three days").text).toBe("Fever\nthree days");
  });

  it("inserts at the caret, keeping both sides", () => {
    const r = insertTranscript("Fever and cough", "high", 5);
    expect(r.text).toBe("Fever high and cough");
    expect(r.text.slice(0, r.caret)).toBe("Fever high");
  });

  it("appends when the caret is absent or nonsensical", () => {
    for (const caret of [undefined, -1, 999]) {
      expect(insertTranscript("Fever", "today", caret).text, String(caret)).toBe("Fever today");
    }
  });

  it("NEVER replaces the existing text", () => {
    const preserved = (original: string, result: string) => {
      let i = 0;
      for (const ch of result) if (ch === original[i]) i++;
      return i === original.length;
    };

    const existing = "Detailed examination the doctor typed by hand.";
    for (const caret of [undefined, 0, 5, 22, existing.length]) {
      const r = insertTranscript(existing, "and more", caret);
      expect(preserved(existing, r.text), `caret ${caret}`).toBe(true);
      expect(r.text.length).toBeGreaterThan(existing.length);
    }
  });

  it("an empty or blank transcript changes nothing at all", () => {
    for (const said of ["", "   ", "\n\t"]) {
      expect(insertTranscript("Fever", said).text).toBe("Fever");
    }
  });

  it("preserves the words exactly, including Bangla", () => {
    const said = "জ্বর তিন দিন";
    expect(insertTranscript("", said).text).toBe(said);
    expect(insertTranscript("Note:", said).text).toBe(`Note: ${said}`);
  });

  it("returns the next caret so repeated dictation can continue after the last insertion", () => {
    const first = insertTranscript("Fever and cough", "high", 5);
    const second = insertTranscript(first.text, "persistent", first.caret);
    expect(second.text).toBe("Fever high persistent and cough");
  });
});

describe("cancelling inserts nothing", () => {
  it("a cancelled run yields no text", () => {
    expect(transcriptAfterCancel()).toBe("");
    expect(insertTranscript("Fever", transcriptAfterCancel()).text).toBe("Fever");
  });

  it("invalidates an aborted provider session before abort so late callbacks are stale", async () => {
    const hook = await code("src/features/dictation/use-dictation.ts");
    expect(hook).toMatch(/const activeRun = React\.useRef\(0\)/);
    expect(hook).toMatch(/activeRun\.current \+= 1;[\s\S]*?current\?\.abort\(\)/);
    expect(hook).toMatch(/if \(activeRun\.current !== runId \|\| ended\) return/);
    expect((hook.match(/activeRun\.current !== runId/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  it("a replacement run invalidates the old provider session before aborting it", async () => {
    const hook = await code("src/features/dictation/use-dictation.ts");
    expect(hook).toMatch(
      /const runId = activeRun\.current \+ 1;\s*activeRun\.current = runId;[\s\S]*?previous\?\.abort\(\)/,
    );
  });
});

describe("a failed run leaves the draft alone", () => {
  it("every error is explained, and none of them mention the draft being lost", () => {
    for (const errorCode of ["not-allowed", "audio-capture", "network", "no-speech", "weird"]) {
      const msg = dictationErrorMessage(errorCode);
      expect(msg.length, errorCode).toBeGreaterThan(0);
      expect(msg).not.toMatch(/lost|deleted|cleared/i);
    }
  });

  it("a blocked microphone says how to fix it", () => {
    expect(dictationErrorMessage("not-allowed")).toMatch(/[Aa]llow microphone/);
  });

  it("network failure tells the doctor their notes are untouched", () => {
    expect(dictationErrorMessage("network")).toMatch(/untouched/);
  });

  it("silence is not an alarm", () => {
    expect(dictationErrorMessage("no-speech")).not.toMatch(/error|failed/i);
  });

  it("the hook only ever delivers a successful, non-empty completed run", async () => {
    const hook = await code("src/features/dictation/use-dictation.ts");
    expect(hook).toMatch(/if \(said !== ""\) onFinalRef\.current\?\.\(said\)/);
    expect(hook).toMatch(/let ended = false/);
    expect(hook).toMatch(/ended = true/);
  });
});

describe("state is never colour alone", () => {
  it("every state has a word for it", () => {
    for (const state of ["ready", "recording", "transcribing", "error", "unsupported"] as const) {
      expect(DICTATION_LABEL[state]?.length, state).toBeGreaterThan(0);
    }
  });

  it("the control renders the word, not just a dot", async () => {
    const button = await code("src/features/dictation/components/dictate-button.tsx");
    expect(button).toMatch(/DICTATION_LABEL\[state\]/);
    expect(button).toMatch(/role="status"/);
    expect(button).toMatch(/aria-live="polite"/);
    expect(button).toMatch(/aria-hidden="true"/);
  });

  it("the control names the field it fills", async () => {
    const button = await code("src/features/dictation/components/dictate-button.tsx");
    expect(button).toMatch(/aria-label=/);
    expect(button).toMatch(/fieldLabel/);
  });

  it("start, stop and cancel are all reachable", async () => {
    const button = await code("src/features/dictation/components/dictate-button.tsx");
    for (const control of ["start", "stop", "cancel"]) {
      expect(button.includes(`onClick={${control}}`), `${control} has no control`).toBe(true);
    }
    expect(button).toMatch(/Try again/);
  });

  it("every control is a real touch target", async () => {
    const button = await code("src/features/dictation/components/dictate-button.tsx");
    const buttons = button.match(/<button[\s\S]*?>/g) ?? [];
    expect(buttons.length).toBeGreaterThan(0);
    for (const b of buttons) expect(b).toMatch(/min-h-11/);
  });

  it("carries the returned insertion caret into the next dictation", async () => {
    const button = await code("src/features/dictation/components/dictate-button.tsx");
    expect(button).toMatch(/insertionCaret\.current = result\.caret/);
    expect(button).toMatch(/insertTranscript\(value, said, insertionCaret\.current\)/);
  });
});

describe("dictation cannot reach a clinical write path", () => {
  it("no voice infrastructure imports an action, query, database client or write endpoint", async () => {
    for (const file of [
      "src/features/dictation/dictation.ts",
      "src/features/dictation/provider.ts",
      "src/features/dictation/use-dictation.ts",
      "src/features/dictation/components/dictate-button.tsx",
      "src/features/dictation/voice-language.tsx",
    ]) {
      const src = await code(file);
      for (const [pattern, what] of [
        [/\bfrom\s+["'][^"']*actions["']/, "imports a server action module"],
        [/\bfrom\s+["'][^"']*queries["']/, "imports a query module"],
        [/\bfrom\s+["'][^"']*supabase[^"']*["']/, "imports a Supabase client"],
        [/\w+Action\s*\(/, "calls a server action"],
        [/\bfetch\s*\(/, "calls fetch"],
        [/\bfinalize\w*\s*\(/, "calls a finalisation"],
        [/\bsave\w*\s*\(/, "calls a save"],
      ] as [RegExp, string][]) {
        expect(pattern.test(src), `${file} ${what}`).toBe(false);
      }
    }
  });

  it("the transcript reaches a draft setter and nothing else", async () => {
    const fields = await code("src/features/encounters/components/draft-fields.tsx");
    expect(fields).toMatch(/onInsert=\{\(next\) => onChange\(section\.key, next\)\}/);
    expect(fields).not.toMatch(/autoSave|autosave/i);
  });

  it("finding dictation may draft title and note but never submits the finding", async () => {
    const finding = await code("src/features/encounters/components/finding-form.tsx");
    expect((finding.match(/<DictateButton/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(finding).toMatch(/value=\{value\.title\}/);
    expect(finding).toMatch(/title: next/);
    expect(finding).toMatch(/value=\{value\.note\}/);
    expect(finding).toMatch(/note: next/);
    expect(finding).toMatch(/type="submit"/);
    expect(finding).toMatch(/if \(canSubmit\) onSubmit\(\)/);
  });

  it("no DD-side audio is stored, uploaded or attached to a record", async () => {
    for (const file of [
      "src/features/dictation/provider.ts",
      "src/features/dictation/use-dictation.ts",
    ]) {
      const src = await code(file);
      for (const forbidden of [
        "MediaRecorder",
        "createObjectURL",
        "FormData",
        "Blob",
        "upload",
        "localStorage",
        "indexedDB",
        "console.log",
      ]) {
        expect(src.includes(forbidden), `${file} must not use ${forbidden}`).toBe(false);
      }
    }
  });

  it("capture is released and callbacks invalidated when the screen goes away", async () => {
    const hook = await code("src/features/dictation/use-dictation.ts");
    expect(hook).toMatch(/activeRun\.current \+= 1/);
    expect(hook).toMatch(/abort\(\)/);
    expect(hook).toMatch(/session\.current = null/);
  });
});

describe("an unsupported browser/provider blocks nothing", () => {
  it("the control is absent rather than broken", async () => {
    const button = await code("src/features/dictation/components/dictate-button.tsx");
    expect(button).toMatch(/if \(!supported\) return null/);
  });

  it("the hook reports unsupported and the browser adapter owns Web Speech details", async () => {
    const hook = await code("src/features/dictation/use-dictation.ts");
    const provider = await code("src/features/dictation/provider.ts");
    expect(hook).toMatch(/setState\("unsupported"\)/);
    expect(provider).toMatch(/webkitSpeechRecognition/);
    expect(provider).toMatch(/SpeechRecognition/);
  });

  it("the doctor is told the accurate active-provider privacy boundary", async () => {
    const button = await readFile(
      path.resolve("src/features/dictation/components/dictate-button.tsx"),
      "utf8",
    );
    const provider = await readFile(path.resolve("src/features/dictation/provider.ts"), "utf8");
    expect(button).toMatch(/providerNotice/);
    expect(provider).toMatch(/browser's speech service/);
    expect(provider).toMatch(/No audio is stored/);
    expect(button).toMatch(/until you explicitly save or add it/i);
    expect(`${button}\n${provider}`).not.toMatch(/audio never leaves (?:your|the) device/i);
  });
});
