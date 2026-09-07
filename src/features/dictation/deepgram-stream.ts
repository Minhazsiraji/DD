export const DEEPGRAM_STREAM_MODEL = "nova-3";
export const DEEPGRAM_STREAM_ENDPOINT = "wss://api.deepgram.com/v1/listen";
export const DEEPGRAM_ENDPOINTING_MS = 300;
export const DEEPGRAM_UTTERANCE_END_MS = 1000;
export const DEEPGRAM_MEDIA_TIMESLICE_MS = 250;
export const DEEPGRAM_CONNECTION_TIMEOUT_MS = 5000;
export const DEEPGRAM_FIRST_TRANSCRIPT_TIMEOUT_MS = 5000;
export const DEEPGRAM_FINALIZE_TIMEOUT_MS = 1500;

const ALLOWED_LANGUAGES = new Set(["bn", "en-US"]);

/**
 * Build only the provider URL. Clinical context never enters this function.
 * MediaRecorder sends a containerized WebM/Ogg stream, so encoding/sample_rate
 * are deliberately omitted and Deepgram reads them from the container.
 */
export function buildDeepgramStreamingUrl(language: string): string {
  if (!ALLOWED_LANGUAGES.has(language)) throw new Error("unsupported Deepgram language");

  const params = new URLSearchParams({
    model: DEEPGRAM_STREAM_MODEL,
    language,
    interim_results: "true",
    endpointing: String(DEEPGRAM_ENDPOINTING_MS),
    utterance_end_ms: String(DEEPGRAM_UTTERANCE_END_MS),
    vad_events: "true",
    smart_format: "true",
    punctuate: "true",
    mip_opt_out: "true",
  });

  return `${DEEPGRAM_STREAM_ENDPOINT}?${params.toString()}`;
}

/** Deepgram's browser transport maps bearer access tokens to WS subprotocols. */
export function deepgramBearerProtocols(accessToken: string): string[] {
  return ["bearer", accessToken];
}

export interface DeepgramResultsMessage {
  type: "Results";
  start?: number;
  duration?: number;
  is_final?: boolean;
  speech_final?: boolean;
  from_finalize?: boolean;
  channel?: { alternatives?: Array<{ transcript?: string }> };
}

function segmentKey(start: number | undefined): string {
  return Number(start ?? 0).toFixed(3);
}

function joinSegments(parts: string[]): string {
  return parts
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+([,.;!?।])/g, "$1")
    .trim();
}

/**
 * Converts Deepgram's evolving interim/final results into one cumulative draft.
 * Final segments are keyed by their audio start offset so an interim becoming
 * final replaces that span instead of being appended twice.
 */
export class DeepgramTranscriptAssembler {
  private readonly finals = new Map<string, { start: number; text: string }>();
  private interim: { key: string; start: number; text: string } | null = null;

  apply(message: DeepgramResultsMessage): { text: string; isFinal: boolean } | null {
    const said = message.channel?.alternatives?.[0]?.transcript?.trim() ?? "";
    if (!said) return null;

    const start = Number(message.start ?? 0);
    const key = segmentKey(message.start);

    if (message.is_final) {
      this.finals.set(key, { start, text: said });
      if (this.interim?.key === key) this.interim = null;
    } else {
      this.interim = { key, start, text: said };
    }

    const pieces = [...this.finals.values()].sort((a, b) => a.start - b.start).map((part) => part.text);
    if (this.interim && !this.finals.has(this.interim.key)) pieces.push(this.interim.text);

    return { text: joinSegments(pieces), isFinal: message.is_final === true };
  }

  current(): string {
    const pieces = [...this.finals.values()].sort((a, b) => a.start - b.start).map((part) => part.text);
    if (this.interim && !this.finals.has(this.interim.key)) pieces.push(this.interim.text);
    return joinSegments(pieces);
  }
}
