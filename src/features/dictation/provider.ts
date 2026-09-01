export const VOICE_TRANSCRIPTION_PROVIDER_IDS = [
  "browser",
  "future_server_provider",
] as const;

export type VoiceTranscriptionProviderId =
  (typeof VOICE_TRANSCRIPTION_PROVIDER_IDS)[number];

export interface VoiceTranscriptionCallbacks {
  onTranscript: (transcript: string) => void;
  onError: (code: string) => void;
  onEnd: (finalTranscript: string) => void;
}

export interface VoiceTranscriptionSession {
  start(): void;
  stop(): void;
  abort(): void;
}

/**
 * Provider boundary for speech-to-text only.
 *
 * A provider may capture/transcribe audio, but it can never know which clinical
 * field it is beside and it receives no save/finalize callbacks. That keeps
 * transcription replaceable without creating a second clinical write path.
 */
export interface VoiceTranscriptionProvider {
  id: VoiceTranscriptionProviderId;
  /** Short, provider-specific privacy disclosure shown while recording. */
  privacyNotice: string;
  isSupported(): boolean;
  createSession(input: {
    language: string;
    callbacks: VoiceTranscriptionCallbacks;
  }): VoiceTranscriptionSession | null;
}

/** The slice of the browser Web Speech API used by the adapter. */
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechResultEventLike) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
}

interface SpeechResultEventLike {
  resultIndex: number;
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
}

type RecognitionCtor = new () => SpeechRecognitionLike;

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const browserProvider: VoiceTranscriptionProvider = {
  id: "browser",
  privacyNotice:
    "Speech is transcribed by your browser's speech service. No audio is stored by Doctor's Diary.",
  isSupported() {
    return recognitionCtor() !== null;
  },
  createSession({ language, callbacks }) {
    const Ctor = recognitionCtor();
    if (!Ctor) return null;

    const engine = new Ctor();
    let finalText = "";

    engine.lang = language;
    engine.continuous = true;
    engine.interimResults = true;

    engine.onresult = (event) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const said = result?.[0]?.transcript ?? "";
        if (result?.isFinal) finalText += said;
        else interim += said;
      }
      callbacks.onTranscript(finalText + interim);
    };

    engine.onerror = (event) => callbacks.onError(event.error ?? "unknown");
    engine.onend = () => callbacks.onEnd(finalText.trim());

    return {
      start: () => engine.start(),
      stop: () => engine.stop(),
      abort: () => engine.abort(),
    };
  },
};

/**
 * Only the browser provider is implemented in this MVP.
 *
 * `future_server_provider` is a reserved provider kind, not an active backend.
 * Later a server implementation can be registered here and a locale can route
 * to it without changing DictateButton or any consultation/prescription field.
 */
const PROVIDERS: Partial<Record<VoiceTranscriptionProviderId, VoiceTranscriptionProvider>> = {
  browser: browserProvider,
};

export function getVoiceTranscriptionProvider(
  id: VoiceTranscriptionProviderId,
): VoiceTranscriptionProvider | null {
  return PROVIDERS[id] ?? null;
}
