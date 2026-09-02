import {
  DEEPGRAM_CONNECTION_TIMEOUT_MS,
  DEEPGRAM_FINALIZE_TIMEOUT_MS,
  DEEPGRAM_FIRST_TRANSCRIPT_TIMEOUT_MS,
  DEEPGRAM_MEDIA_TIMESLICE_MS,
  DeepgramTranscriptAssembler,
  buildDeepgramStreamingUrl,
  deepgramBearerProtocols,
  type DeepgramResultsMessage,
} from "./deepgram-stream";

export const VOICE_TRANSCRIPTION_PROVIDER_IDS = ["browser", "deepgram"] as const;

export type VoiceTranscriptionProviderId = (typeof VOICE_TRANSCRIPTION_PROVIDER_IDS)[number];
export type VoiceProviderPhase = "connecting" | "listening" | "finalizing";

export interface VoiceLatencySnapshot {
  micReadyMs?: number;
  providerConnectedMs?: number;
  firstAudioSentMs?: number;
  firstTranscriptMs?: number;
  stopToFinalMs?: number;
}

export interface VoiceTranscriptEvent {
  text: string;
  isFinal: boolean;
}

export interface VoiceTranscriptionCallbacks {
  onPhase: (phase: VoiceProviderPhase) => void;
  onTranscript: (event: VoiceTranscriptEvent) => void;
  onLatency: (latency: VoiceLatencySnapshot) => void;
  onError: (code: string) => void;
  onEnd: (finalTranscript: string) => void;
}

export interface VoiceTranscriptionSession {
  start(): void;
  stop(): void;
  abort(): void;
}

/** Provider boundary only; no clinical identifiers or write callbacks cross it. */
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

function elapsed(startedAt: number): number {
  return Math.round(performance.now() - startedAt);
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
      let sawFinal = false;
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const said = result?.[0]?.transcript ?? "";
        if (result?.isFinal) {
          finalText += said;
          sawFinal = true;
        } else {
          interim += said;
        }
      }
      callbacks.onTranscript({ text: (finalText + interim).trim(), isFinal: sawFinal });
    };

    engine.onerror = (event) => callbacks.onError(event.error ?? "unknown");
    engine.onend = () => callbacks.onEnd(finalText.trim());

    return {
      start() {
        engine.start();
        callbacks.onPhase("listening");
      },
      stop() {
        callbacks.onPhase("finalizing");
        engine.stop();
      },
      abort: () => engine.abort(),
    };
  },
};

function deepgramStreamingSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof WebSocket !== "undefined" &&
    typeof MediaRecorder !== "undefined" &&
    "mediaDevices" in navigator &&
    typeof navigator.mediaDevices?.getUserMedia === "function"
  );
}

function preferredRecorderMimeType(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  for (const type of ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"]) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return null;
}

const TOKEN_ROUTE_TIMEOUT_MS = 6500;
const TOKEN_QA_DIAGNOSTICS = new Set([
  "TOKEN_ROUTE_UNAUTHORIZED",
  "TOKEN_ROUTE_FORBIDDEN",
  "TOKEN_RATE_LIMIT",
  "TOKEN_CONFIG_MISSING",
  "TOKEN_GRANT_REJECTED",
  "TOKEN_GRANT_NETWORK",
]);

interface DeepgramTokenPayload {
  accessToken?: string;
  diagnostic?: string;
  qaDiagnostics?: boolean;
}

function tokenQaDiagnostic(value: unknown): string | null {
  return typeof value === "string" && TOKEN_QA_DIAGNOSTICS.has(value) ? value : null;
}

async function requestDeepgramAccessToken(signal: AbortSignal): Promise<{
  accessToken: string;
  qaDiagnostics: boolean;
}> {
  const response = await fetch("/api/voice/token", {
    method: "POST",
    cache: "no-store",
    signal,
    headers: { Accept: "application/json" },
  });

  let payload: DeepgramTokenPayload = {};
  try {
    payload = (await response.json()) as DeepgramTokenPayload;
  } catch {}

  if (!response.ok) {
    const diagnostic = tokenQaDiagnostic(payload.diagnostic);
    if (diagnostic) throw new Error(diagnostic);
    throw new Error(response.status === 503 ? "provider-unavailable" : "provider-error");
  }
  if (!payload.accessToken) throw new Error("provider-error");
  return { accessToken: payload.accessToken, qaDiagnostics: payload.qaDiagnostics === true };
}

const deepgramProvider: VoiceTranscriptionProvider = {
  id: "deepgram",
  privacyNotice:
    "Audio is securely streamed to Deepgram for transcription. Doctor's Diary does not store the audio.",
  isSupported() {
    return deepgramStreamingSupported() && preferredRecorderMimeType() !== null;
  },
  createSession({ language, callbacks }) {
    if (!deepgramStreamingSupported()) return null;
    const mimeType = preferredRecorderMimeType();
    if (!mimeType) return null;

    let recorder: MediaRecorder | null = null;
    let stream: MediaStream | null = null;
    let socket: WebSocket | null = null;
    let keepAlive: ReturnType<typeof setInterval> | null = null;
    let connectionTimer: ReturnType<typeof setTimeout> | null = null;
    let firstTranscriptTimer: ReturnType<typeof setTimeout> | null = null;
    let finalizeTimer: ReturnType<typeof setTimeout> | null = null;
    let tokenController: AbortController | null = null;
    let cancelled = false;
    let terminal = false;
    let stopped = false;
    let finalizing = false;
    let latestTranscript = "";
    let startedAt = 0;
    let stopAt: number | null = null;
    let qaDiagnostics = false;
    const assembler = new DeepgramTranscriptAssembler();
    const latency: VoiceLatencySnapshot = {};

    const emitLatency = () => callbacks.onLatency({ ...latency });
    const clearTimer = (timer: ReturnType<typeof setTimeout> | null) => {
      if (timer) clearTimeout(timer);
    };
    const qaCode = (diagnostic: string, fallback: string) =>
      qaDiagnostics ? diagnostic : fallback;

    const releaseTracks = () => {
      stream?.getTracks().forEach((track) => track.stop());
      stream = null;
    };

    const cleanup = () => {
      tokenController?.abort();
      tokenController = null;
      clearTimer(connectionTimer);
      clearTimer(firstTranscriptTimer);
      clearTimer(finalizeTimer);
      connectionTimer = null;
      firstTranscriptTimer = null;
      finalizeTimer = null;
      if (keepAlive) clearInterval(keepAlive);
      keepAlive = null;

      if (recorder) {
        recorder.ondataavailable = null;
        recorder.onerror = null;
        recorder.onstop = null;
        if (recorder.state !== "inactive") {
          try {
            recorder.stop();
          } catch {}
        }
      }
      recorder = null;
      releaseTracks();

      if (socket && socket.readyState === WebSocket.OPEN) {
        try {
          socket.send(JSON.stringify({ type: "CloseStream" }));
        } catch {}
        socket.close(1000);
      } else if (socket && socket.readyState === WebSocket.CONNECTING) {
        socket.close();
      }
      socket = null;
    };

    const fail = (code: string) => {
      if (cancelled || terminal) return;
      terminal = true;
      cleanup();
      callbacks.onError(code);
    };

    const settle = () => {
      if (cancelled || terminal) return;
      terminal = true;
      if (stopAt !== null) latency.stopToFinalMs = Math.round(performance.now() - stopAt);
      emitLatency();
      cleanup();
      callbacks.onEnd(latestTranscript.trim());
    };

    const beginFinalize = () => {
      if (cancelled || terminal || finalizing) return;
      finalizing = true;
      callbacks.onPhase("finalizing");
      if (stopAt === null) stopAt = performance.now();

      if (socket?.readyState === WebSocket.OPEN) {
        try {
          socket.send(JSON.stringify({ type: "Finalize" }));
        } catch {
          settle();
          return;
        }
        finalizeTimer = setTimeout(settle, DEEPGRAM_FINALIZE_TIMEOUT_MS);
      } else {
        settle();
      }
    };

    const startRecorder = () => {
      if (!stream || !socket || socket.readyState !== WebSocket.OPEN || cancelled || terminal) return;
      try {
        recorder = new MediaRecorder(stream, { mimeType });
        recorder.ondataavailable = (event) => {
          if (cancelled || terminal || event.data.size === 0 || socket?.readyState !== WebSocket.OPEN) return;
          if (latency.firstAudioSentMs === undefined) {
            latency.firstAudioSentMs = elapsed(startedAt);
            emitLatency();
            firstTranscriptTimer = setTimeout(
              () => fail(qaCode("FIRST_TRANSCRIPT_TIMEOUT", "first-transcript-timeout")),
              DEEPGRAM_FIRST_TRANSCRIPT_TIMEOUT_MS,
            );
          }
          socket.send(event.data);
        };
        recorder.onerror = () => fail(qaCode("AUDIO_CAPTURE", "audio-capture"));
        recorder.onstop = () => {
          releaseTracks();
          if (!cancelled && !terminal) beginFinalize();
        };
        recorder.start(DEEPGRAM_MEDIA_TIMESLICE_MS);
        callbacks.onPhase("listening");
        if (stopped && recorder.state !== "inactive") recorder.stop();
      } catch {
        fail(qaCode("AUDIO_CAPTURE", "audio-capture"));
      }
    };

    const connect = async () => {
      callbacks.onPhase("connecting");
      startedAt = performance.now();

      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            channelCount: 1,
          },
        });
        if (cancelled || terminal) {
          releaseTracks();
          return;
        }
        latency.micReadyMs = elapsed(startedAt);
        emitLatency();

        tokenController = new AbortController();
        const tokenTimeout = setTimeout(
          () => tokenController?.abort(),
          TOKEN_ROUTE_TIMEOUT_MS,
        );
        let accessToken: string;
        try {
          const grant = await requestDeepgramAccessToken(tokenController.signal);
          accessToken = grant.accessToken;
          qaDiagnostics = grant.qaDiagnostics;
        } finally {
          clearTimeout(tokenTimeout);
        }
        tokenController = null;
        if (cancelled || terminal) return;

        socket = new WebSocket(
          buildDeepgramStreamingUrl(language),
          deepgramBearerProtocols(accessToken),
        );
        connectionTimer = setTimeout(
          () => fail(qaCode("WS_CONNECTION", "connection-timeout")),
          DEEPGRAM_CONNECTION_TIMEOUT_MS,
        );

        socket.onopen = () => {
          if (cancelled || terminal) return;
          clearTimer(connectionTimer);
          connectionTimer = null;
          latency.providerConnectedMs = elapsed(startedAt);
          emitLatency();
          keepAlive = setInterval(() => {
            if (socket?.readyState === WebSocket.OPEN) {
              socket.send(JSON.stringify({ type: "KeepAlive" }));
            }
          }, 3000);
          startRecorder();
        };

        socket.onmessage = (event) => {
          if (cancelled || terminal || typeof event.data !== "string") return;
          let message: { type?: string } & Partial<DeepgramResultsMessage>;
          try {
            message = JSON.parse(event.data) as { type?: string } & Partial<DeepgramResultsMessage>;
          } catch {
            return;
          }

          if (message.type !== "Results") return;
          const next = assembler.apply(message as DeepgramResultsMessage);
          if (next?.text) {
            latestTranscript = next.text;
            if (latency.firstTranscriptMs === undefined) {
              latency.firstTranscriptMs = elapsed(startedAt);
              clearTimer(firstTranscriptTimer);
              firstTranscriptTimer = null;
              emitLatency();
            }
            callbacks.onTranscript(next);
          }

          if (finalizing && message.from_finalize === true) settle();
        };

        socket.onerror = () => {
          if (!cancelled && !terminal) fail(qaCode("WS_CONNECTION", "provider-error"));
        };
        socket.onclose = () => {
          if (cancelled || terminal) return;
          if (finalizing) settle();
          else fail(qaCode("WS_CONNECTION", "network"));
        };
      } catch (error) {
        if (cancelled || terminal) return;
        releaseTracks();
        if (error instanceof DOMException) {
          if (error.name === "NotAllowedError") {
            fail("not-allowed");
            return;
          }
          if (["NotFoundError", "NotReadableError", "OverconstrainedError"].includes(error.name)) {
            fail(qaCode("AUDIO_CAPTURE", "audio-capture"));
            return;
          }
        }
        const code = error instanceof Error ? error.message : "";
        fail(
          TOKEN_QA_DIAGNOSTICS.has(code)
            ? code
            : code === "provider-unavailable"
              ? code
              : code === "provider-error"
                ? code
                : "network",
        );
      }
    };

    return {
      start() {
        void connect();
      },
      stop() {
        if (cancelled || terminal) return;
        stopped = true;
        if (stopAt === null) stopAt = performance.now();
        callbacks.onPhase("finalizing");
        if (recorder && recorder.state !== "inactive") recorder.stop();
        else if (socket?.readyState === WebSocket.OPEN) beginFinalize();
      },
      abort() {
        cancelled = true;
        terminal = true;
        cleanup();
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
