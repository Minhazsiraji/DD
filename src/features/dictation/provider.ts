export const VOICE_TRANSCRIPTION_PROVIDER_IDS = [
  "browser",
  "deepgram",
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
 * A provider may capture/transcribe audio, but it never knows which clinical
 * field it is beside and receives no save/finalize callbacks. That keeps
 * transcription replaceable without creating a second clinical write path.
 */
export interface VoiceTranscriptionProvider {
  id: VoiceTranscriptionProviderId;
  privacyNotice: string;
  isSupported(): boolean;
  createSession(input: {
    language: string;
    callbacks: VoiceTranscriptionCallbacks;
  }): VoiceTranscriptionSession | null;
}

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

function mediaRecorderSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "mediaDevices" in navigator &&
    typeof MediaRecorder !== "undefined"
  );
}

function preferredRecorderMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  for (const type of ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"]) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return undefined;
}

const deepgramProvider: VoiceTranscriptionProvider = {
  id: "deepgram",
  privacyNotice:
    "Audio is sent to Deepgram for transcription. Doctor's Diary does not store the audio.",
  isSupported() {
    return mediaRecorderSupported();
  },
  createSession({ language, callbacks }) {
    if (!mediaRecorderSupported()) return null;

    let recorder: MediaRecorder | null = null;
    let stream: MediaStream | null = null;
    let cancelled = false;
    let stopped = false;
    const chunks: Blob[] = [];
    const controller = new AbortController();

    const release = () => {
      stream?.getTracks().forEach((track) => track.stop());
      stream = null;
    };

    const transcribe = async () => {
      if (cancelled) return;
      const mimeType = recorder?.mimeType || chunks[0]?.type || "audio/webm";
      const audio = new Blob(chunks, { type: mimeType });
      if (audio.size === 0) {
        callbacks.onError("no-speech");
        return;
      }

      const body = new FormData();
      body.append("audio", audio, "dictation.webm");
      body.append("language", language);

      try {
        const response = await fetch("/api/voice/transcribe", {
          method: "POST",
          body,
          cache: "no-store",
          signal: controller.signal,
        });

        if (!response.ok) {
          callbacks.onError(response.status === 503 ? "provider-unavailable" : "provider-error");
          return;
        }

        const payload = (await response.json()) as { transcript?: string };
        if (cancelled) return;
        const transcript = payload.transcript?.trim() ?? "";
        callbacks.onTranscript(transcript);
        callbacks.onEnd(transcript);
      } catch (error) {
        if (cancelled || (error instanceof DOMException && error.name === "AbortError")) return;
        callbacks.onError("network");
      }
    };

    return {
      start() {
        void navigator.mediaDevices
          .getUserMedia({ audio: true })
          .then((nextStream) => {
            if (cancelled) {
              nextStream.getTracks().forEach((track) => track.stop());
              return;
            }
            stream = nextStream;
            const mimeType = preferredRecorderMimeType();
            recorder = mimeType ? new MediaRecorder(nextStream, { mimeType }) : new MediaRecorder(nextStream);
            recorder.ondataavailable = (event) => {
              if (!cancelled && event.data.size > 0) chunks.push(event.data);
            };
            recorder.onerror = () => {
              if (cancelled) return;
              release();
              callbacks.onError("audio-capture");
            };
            recorder.onstop = () => {
              release();
              if (!cancelled) void transcribe();
            };
            recorder.start();
            if (stopped && recorder.state !== "inactive") recorder.stop();
          })
          .catch((error: unknown) => {
            if (cancelled) return;
            const name = error instanceof DOMException ? error.name : "";
            callbacks.onError(name === "NotAllowedError" ? "not-allowed" : "audio-capture");
          });
      },
      stop() {
        stopped = true;
        if (recorder && recorder.state !== "inactive") recorder.stop();
      },
      abort() {
        cancelled = true;
        controller.abort();
        if (recorder && recorder.state !== "inactive") recorder.stop();
        release();
      },
    };
  },
};

const PROVIDERS: Record<VoiceTranscriptionProviderId, VoiceTranscriptionProvider> = {
  browser: browserProvider,
  deepgram: deepgramProvider,
};

export function getVoiceTranscriptionProvider(
  id: VoiceTranscriptionProviderId,
): VoiceTranscriptionProvider | null {
  return PROVIDERS[id] ?? null;
}
