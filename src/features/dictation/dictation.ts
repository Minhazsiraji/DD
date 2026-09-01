/**
 * VOICE DICTATION — the rules, as pure decisions.
 *
 * This is Dictation V1, not a Copilot. It turns speech into TEXT IN A DRAFT and
 * stops there. Nothing here saves, and nothing here decides anything clinical:
 * a transcript becomes clinical data at the moment the doctor reads it, edits
 * it and presses the same Save they have always pressed, through the same
 * version and the same trusted write path.
 *
 * The transcriber never adds a diagnosis, never finalises a prescription and
 * never finishes a consultation. It types, badly, and a doctor corrects it.
 */

export type DictationState =
  /** Supported and idle. */
  | "ready"
  /** The microphone is live. */
  | "recording"
  /** Speech has stopped; the engine is still resolving the last words. */
  | "transcribing"
  /** Something went wrong. The draft is untouched. */
  | "error"
  /** No speech engine in this browser — the feature is simply absent. */
  | "unsupported";

/**
 * WHY THE STATE IS NEVER COLOUR ALONE.
 *
 * A doctor glancing at a red dot cannot tell "recording" from "error", and the
 * difference decides whether they keep talking. Every state carries a word.
 */
export const DICTATION_LABEL: Record<DictationState, string> = {
  ready: "Dictate",
  recording: "Recording",
  transcribing: "Transcribing",
  error: "Error",
  unsupported: "Dictation unavailable",
};

export interface InsertionResult {
  text: string;
  /** Where the caret should sit afterwards — the end of what was just added. */
  caret: number;
}

/**
 * Put a transcript into a draft WITHOUT destroying what is already there.
 *
 * Insertion is at the caret when there is one, otherwise appended. It never
 * replaces a selection and never replaces the field: a doctor who dictates into
 * a note they have already written keeps every word of it, and the failure mode
 * of "I lost my examination note" is not available.
 *
 * The separator is predictable — a single space mid-sentence, a blank line when
 * the existing text already ends a paragraph — so repeated dictation reads like
 * something a person wrote rather than a run-on.
 */
export function insertTranscript(
  existing: string,
  transcript: string,
  caretAt?: number,
): InsertionResult {
  const addition = transcript.trim();
  if (addition === "") return { text: existing, caret: caretAt ?? existing.length };

  if (existing.trim() === "") return { text: addition, caret: addition.length };

  // Out-of-range or absent caret means "the doctor was not in the field" —
  // append rather than guessing a position inside their text.
  const at =
    caretAt === undefined || caretAt < 0 || caretAt > existing.length ? existing.length : caretAt;

  const before = existing.slice(0, at);
  const after = existing.slice(at);

  const lead = separatorFor(before);
  const tail = after === "" ? "" : needsSpaceBefore(after) ? " " : "";

  const text = `${before}${lead}${addition}${tail}${after}`;
  return { text, caret: (before + lead + addition).length };
}

/**
 * A blank line after a finished paragraph, a space otherwise, nothing after an
 * existing space. Punctuation is left exactly as dictated — this decides
 * spacing, never wording.
 */
function separatorFor(before: string): string {
  if (before === "") return "";
  if (/\n[ \t]*$/.test(before)) return "";
  if (/\s$/.test(before)) return "";
  if (/[.!?]$/.test(before)) return "\n";
  return " ";
}

function needsSpaceBefore(after: string): boolean {
  return !/^\s/.test(after);
}

/**
 * What the doctor is told when the engine fails.
 *
 * `no-speech` and `aborted` are not failures — the first is a pause, the second
 * is the doctor pressing Cancel — so neither gets an alarming message. The
 * permission cases say what to do about it, because "error" is useless when the
 * fix is one browser prompt away.
 */
export function dictationErrorMessage(code: string): string {
  switch (code) {
    case "not-allowed":
    case "service-not-allowed":
      return "The microphone is blocked. Allow microphone access for this site, then try again.";
    case "audio-capture":
      return "No microphone was found. Check the device and try again.";
    case "network":
      return "The speech service could not be reached. Your notes are untouched — type instead, or try again.";
    case "no-speech":
      return "Nothing was heard. Try again, closer to the microphone.";
    case "aborted":
      return "Dictation stopped.";
    default:
      return "Dictation did not work. Your notes are untouched — type instead, or try again.";
  }
}

/** Cancelling throws the audio away. Nothing reaches the draft. */
export function transcriptAfterCancel(): string {
  return "";
}
