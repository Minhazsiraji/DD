import { describe, expect, it } from "vitest";
import { dictationErrorMessage, insertTranscript } from "./dictation";

describe("dictation draft insertion", () => {
  it("inserts a transcript at the caret without any clinical side effect", () => {
    expect(insertTranscript("Take after food", "Napa 500 mg", 4)).toEqual({
      text: "Take Napa 500 mg after food",
      caret: 16,
    });
  });

  it("uses a new line after completed sentence punctuation", () => {
    expect(insertTranscript("Fever for 3 days.", "CBC")).toEqual({
      text: "Fever for 3 days.\nCBC",
      caret: 21,
    });
  });

  it("leaves the draft unchanged for empty transcript", () => {
    expect(insertTranscript("Existing draft", "   ", 3)).toEqual({
      text: "Existing draft",
      caret: 3,
    });
  });

  it("uses fail-safe user messages that promise draft preservation", () => {
    for (const code of [
      "connection-timeout",
      "FIRST_TRANSCRIPT_TIMEOUT",
      "TOKEN_GRANT_NETWORK",
      "TOKEN_CONFIG_MISSING",
      "provider-error",
    ]) {
      expect(dictationErrorMessage(code)).toContain("draft is preserved");
    }
  });
});
