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

/**
 * DICTATION TYPES. IT DOES NOT DECIDE, AND IT DOES NOT SAVE.
 *
 * Every test here is one of two sentences: a transcript never destroys what a
 * doctor already wrote, and a transcript is never clinical data until the
 * doctor saves it through the path they have always used.
 */

describe("a transcript never destroys what is already written", () => {
  it("fills an empty field", () => {
    expect(insertTranscript("", "Fever for three days").text).toBe("Fever for three days");
  });

  it("appends after existing text with a single space", () => {
    const r = insertTranscript("Fever", "for three days");
    expect(r.text).toBe("Fever for three days");
  });

  it("starts a new line after a finished sentence", () => {
    // Two dictated sentences should read as two, not run together.
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
    // The caret follows what was just said, ready to keep going.
    expect(r.text.slice(0, r.caret)).toBe("Fever high");
  });

  it("appends when the caret is absent or nonsensical", () => {
    for (const caret of [undefined, -1, 999]) {
      expect(insertTranscript("Fever", "today", caret).text, String(caret)).toBe("Fever today");
    }
  });

  /**
   * The failure this forecloses: a doctor dictates over a note they spent two
   * minutes typing and it disappears. There is no code path that replaces the
   * field — insertion only ever adds.
   */
  it("NEVER replaces the existing text", () => {
    /**
     * Checked as a SUBSEQUENCE, because inserting at a caret inside a word
     * legitimately splits the text — "Detai|led" becomes "Detai and more led".
     * Nothing is contiguous afterwards, and nothing is missing either, which is
     * the actual promise: every character the doctor typed survives, in order.
     */
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
    // Nothing heard is not a reason to touch a draft.
    for (const said of ["", "   ", "\n\t"]) {
      expect(insertTranscript("Fever", said).text).toBe("Fever");
    }
  });

  it("preserves the words exactly, including Bangla", () => {
    const said = "জ্বর তিন দিন";
    expect(insertTranscript("", said).text).toBe(said);
    expect(insertTranscript("Note:", said).text).toBe(`Note: ${said}`);
  });
});

describe("cancelling inserts nothing", () => {
  it("a cancelled run yields no text", () => {
    expect(transcriptAfterCancel()).toBe("");
    expect(insertTranscript("Fever", transcriptAfterCancel()).text).toBe("Fever");
  });

  it("the hook discards a cancelled run even though the engine still ends", async () => {
    /**
     * `abort()` still fires `onend`. Without the flag, the words spoken before
     * Cancel would arrive in the draft a moment after the doctor discarded them.
     */
    const hook = await code("src/features/dictation/use-dictation.ts");
    expect(hook).toMatch(/cancelled\.current = true/);
    expect(hook).toMatch(/if \(cancelled\.current\)/);
  });
});

describe("a failed run leaves the draft alone", () => {
  it("every error is explained, and none of them mention the draft being lost", () => {
    for (const code of ["not-allowed", "audio-capture", "network", "no-speech", "weird"]) {
      const msg = dictationErrorMessage(code);
      expect(msg.length, code).toBeGreaterThan(0);
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

  it("the hook only ever delivers on a successful, non-empty run", async () => {
    const hook = await code("src/features/dictation/use-dictation.ts");
    // Delivery is guarded on there being something to deliver.
    expect(hook).toMatch(/if \(said !== ""\) onFinalRef\.current\?\.\(said\)/);
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
    // The dot is decoration beside the word, never the message.
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
    // And a failed run offers another go rather than a dead end.
    expect(button).toMatch(/Try again/);
  });

  it("every control is a real touch target", async () => {
    const button = await code("src/features/dictation/components/dictate-button.tsx");
    const buttons = button.match(/<button[\s\S]*?>/g) ?? [];
    expect(buttons.length).toBeGreaterThan(0);
    for (const b of buttons) expect(b).toMatch(/min-h-11/);
  });
});

describe("dictation cannot reach a clinical write path", () => {
  it("no dictation file imports an action, a query or a client", async () => {
    /**
     * The structural version of "this is not a Copilot". Speech becomes text in
     * a draft; the screen underneath owns every mutation, on the one version
     * and the one queue it always had.
     */
    for (const file of [
      "src/features/dictation/dictation.ts",
      "src/features/dictation/use-dictation.ts",
      "src/features/dictation/components/dictate-button.tsx",
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
    // The same `onChange` typing uses — no separate write, no autosave.
    expect(fields).toMatch(/onInsert=\{\(next\) => onChange\(section\.key, next\)\}/);
    expect(fields).not.toMatch(/autoSave|autosave/i);
  });

  it("no audio is stored, uploaded or attached to a record", async () => {
    const hook = await code("src/features/dictation/use-dictation.ts");
    for (const forbidden of [
      "MediaRecorder",
      "createObjectURL",
      "FormData",
      "Blob",
      "upload",
      "localStorage",
      "indexedDB",
    ]) {
      expect(hook.includes(forbidden), `use-dictation.ts must not use ${forbidden}`).toBe(false);
    }
  });

  it("the microphone is released when the screen goes away", async () => {
    const hook = await code("src/features/dictation/use-dictation.ts");
    expect(hook).toMatch(/abort\(\)/);
    expect(hook).toMatch(/recognition\.current = null/);
  });
});

describe("an unsupported browser blocks nothing", () => {
  it("the control is absent rather than broken", async () => {
    // Firefox has no engine. A button that fails when pressed is worse than
    // no button, and typing must be exactly as it was.
    const button = await code("src/features/dictation/components/dictate-button.tsx");
    expect(button).toMatch(/if \(!supported\) return null/);
  });

  it("the hook reports unsupported instead of throwing", async () => {
    const hook = await code("src/features/dictation/use-dictation.ts");
    expect(hook).toMatch(/setState\("unsupported"\)/);
    expect(hook).toMatch(/webkitSpeechRecognition/);
  });

  it("the doctor is told where their voice goes", async () => {
    /**
     * The browser's engine streams audio to the browser vendor. This is a
     * patient describing symptoms, so it is said at the point of use rather
     * than buried in a policy page.
     */
    const button = await readFile(
      path.resolve("src/features/dictation/components/dictate-button.tsx"),
      "utf8",
    );
    expect(button).toMatch(/browser&rsquo;s speech service|browser's speech service/);
    expect(button).toMatch(/No audio is stored/);
    expect(button).toMatch(/nothing is saved until you press Save/i);
  });
});
