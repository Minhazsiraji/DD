/**
 * VOICE DICTATION — pure draft insertion and state wording only.
 * Nothing here saves, creates findings, adds medicines, finalises a prescription,
 * or finishes a consultation.
 */
export type DictationState =
  | "ready"
  | "recording"
  | "transcribing"
  | "error"
  | "unsupported";

export const DICTATION_LABEL: Record<DictationState, string> = {
  ready: "Dictate",
  recording: "Recording",
  transcribing: "Transcribing",
  error: "Error",
  unsupported: "Dictation unavailable",
};

export interface InsertionResult {
  text: string;
  caret: number;
}

export function insertTranscript(
  existing: string,
  transcript: string,
  caretAt?: number,
): InsertionResult {
  const addition = transcript.trim();
  if (addition === "") return { text: existing, caret: caretAt ?? existing.length };
  if (existing.trim() === "") return { text: addition, caret: addition.length };

  const at =
    caretAt === undefined || caretAt < 0 || caretAt > existing.length ? existing.length : caretAt;
  const before = existing.slice(0, at);
  const after = existing.slice(at);
  const lead = separatorFor(before);
  const tail = after === "" ? "" : needsSpaceBefore(after) ? " " : "";
  const text = `${before}${lead}${addition}${tail}${after}`;
  return { text, caret: (before + lead + addition).length };
}

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

export function dictationErrorMessage(code: string): string {
  switch (code) {
    case "not-allowed":
    case "service-not-allowed":
      return "The microphone is blocked. Allow microphone access for this site, then try again.";
    case "audio-capture":
      return "No usable microphone audio was captured. Check the device and try again.";
    case "network":
      return "The speech service could not be reached. Your draft is untouched — type instead, choose Browser fallback, or try again.";
    case "provider-unavailable":
      return "The selected speech provider is unavailable. Your draft is untouched — choose Browser fallback or type normally.";
    case "provider-error":
      return "The speech provider could not transcribe this recording. Your draft is untouched — retry, choose Browser fallback, or type normally.";
    case "no-speech":
      return "Nothing was heard. Try again, closer to the microphone.";
    case "aborted":
      return "Dictation stopped.";
    default:
      return "Dictation did not work. Your draft is untouched — type instead, choose Browser fallback, or try again.";
  }
}

export function transcriptAfterCancel(): string {
  return "";
}
