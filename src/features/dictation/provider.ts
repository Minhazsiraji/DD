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
import {
  clearDeepgramAccessTokenCache,
  getDeepgramAccessToken,
  type DeepgramAccessTokenGrant,
} from "./deepgram-token-cache";

export const VOICE_TRANSCRIPTION_PROVIDER_IDS = ["browser", "deepgram"] as const;

export type VoiceTranscriptionProviderId = (typeof VOICE_TRANSCRIPTION_PROVIDER_IDS)[number];
export type VoiceProviderPhase = "connecting" | "listening" | "finalizing";

export interface VoiceLatencySnapshot {
  micReadyMs?: number;
  tokenReadyMs?: number;
  providerConnectedMs?: number;
  firstAudioSentMs?: number;
  speechStartedMs?: number;
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
    let socketGeneration = 0;
    let cachedTokenRetryUsed = false;
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

    const detachAndCloseSocket = (target: WebSocket | null) => {
      if (!target) return;
      target.onopen = null;
      target.onmessage = null;
      target.onerror = null;
      target.onclose = null;
      if (target.readyState === WebSocket.OPEN) {
        try {
          target.send(JSON.stringify({ type: "CloseStream" }));
        } catch {}
        target.close(1000);
      } else if (target.readyState === WebSocket.CONNECTING) {
        target.close();
      }
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
      detachAndCloseSocket(socket);
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

    const requestToken = async (forceRefresh = false): Promise<DeepgramAccessTokenGrant> => {
      tokenController?.abort();
      tokenController = new AbortController();
      const currentController = tokenController;
      const tokenTimeout = setTimeout(() => currentController.abort(), TOKEN_ROUTE_TIMEOUT_MS);
      try {
        const grant = await getDeepgramAccessToken({
          signal: currentController.signal,
          forceRefresh,
        });
        latency.tokenReadyMs = elapsed(startedAt);
        qaDiagnostics = grant.qaDiagnostics;
        emitLatency();
        return grant;
      } finally {
        clearTimeout(tokenTimeout);
        if (tokenController === currentController) tokenController = null;
      }
    };

    const classifyConnectError = (error: unknown) => {
      if (error instanceof DOMException) {
        if (error.name === "NotAllowedError") return "not-allowed";
        if (["NotFoundError", "NotReadableError", "OverconstrainedError"].includes(error.name)) {
          return qaCode("AUDIO_CAPTURE", "audio-capture");
        }
      }
      const code = error instanceof Error ? error.message : "";
      if (TOKEN_QA_DIAGNOSTICS.has(code)) return code;
      if (code === "provider-unavailable" || code === "provider-error") return code;
      return "network";
    };

    const openSocket = (grant: DeepgramAccessTokenGrant) => {
      if (cancelled || terminal || !stream) return;

      const generation = ++socketGeneration;
      let opened = false;
      const ws = new WebSocket(
        buildDeepgramStreamingUrl(language),
        deepgramBearerProtocols(grant.accessToken),
      );
      socket = ws;

      const refreshRejectedCachedToken = async () => {
        if (
          cancelled ||
          terminal ||
          cachedTokenRetryUsed ||
          grant.source !== "cache" ||
          generation !== socketGeneration
        ) {
          return false;
        }
        cachedTokenRetryUsed = true;
        clearTimer(connectionTimer);
        connectionTimer = null;
        detachAndCloseSocket(ws);
        if (socket === ws) socket = null;
        clearDeepgramAccessTokenCache();
        try {
          const freshGrant = await requestToken(true);
          if (cancelled || terminal || generation !== socketGeneration) return true;
          openSocket(freshGrant);
          return true;
        } catch (error) {
          fail(classifyConnectError(error));
          return true;
        }
      };

      connectionTimer = setTimeout(() => {
        if (cancelled || terminal || generation !== socketGeneration) return;
        if (!opened && grant.source === "cache" && !cachedTokenRetryUsed) {
          void refreshRejectedCachedToken();
          return;
        }
        fail(qaCode("WS_CONNECTION", "connection-timeout"));
      }, DEEPGRAM_CONNECTION_TIMEOUT_MS);

      ws.onopen = () => {
        if (cancelled || terminal || generation !== socketGeneration) return;
        opened = true;
        clearTimer(connectionTimer);
        connectionTimer = null;
        latency.providerConnectedMs = elapsed(startedAt);
        emitLatency();
        keepAlive = setInterval(() => {
          if (socket === ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "KeepAlive" }));
          }
        }, 3000);
        startRecorder();
      };

      ws.onmessage = (event) => {
        if (cancelled || terminal || generation !== socketGeneration || typeof event.data !== "string") return;
        let message: { type?: string } & Partial<DeepgramResultsMessage>;
        try {
          message = JSON.parse(event.data) as { type?: string } & Partial<DeepgramResultsMessage>;
        } catch {
          return;
        }

        if (message.type === "SpeechStarted") {
          if (latency.speechStartedMs === undefined) {
            latency.speechStartedMs = elapsed(startedAt);
            emitLatency();
          }
          if (latency.firstTranscriptMs === undefined && !firstTranscriptTimer) {
            firstTranscriptTimer = setTimeout(
              () => fail(qaCode("FIRST_TRANSCRIPT_TIMEOUT", "first-transcript-timeout")),
              DEEPGRAM_FIRST_TRANSCRIPT_TIMEOUT_MS,
            );
          }
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

      ws.onerror = () => {
        if (cancelled || terminal || generation !== socketGeneration) return;
        if (!opened && grant.source === "cache" && !cachedTokenRetryUsed) return;
        clearDeepgramAccessTokenCache();
        fail(qaCode("WS_CONNECTION", "provider-error"));
      };

      ws.onclose = () => {
        if (cancelled || terminal || generation !== socketGeneration) return;
        if (!opened && grant.source === "cache" && !cachedTokenRetryUsed) {
          void refreshRejectedCachedToken();
          return;
        }
        if (finalizing) settle();
        else {
          clearDeepgramAccessTokenCache();
          fail(qaCode("WS_CONNECTION", "network"));
        }
      };
    };

    const connect = async () => {
      callbacks.onPhase("connecting");
      startedAt = performance.now();

      try {
        const microphonePromise = navigator.mediaDevices
          .getUserMedia({
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
              channelCount: 1,
            },
          })
          .then((nextStream) => {
            if (cancelled || terminal) {
              nextStream.getTracks().forEach((track) => track.stop());
              throw new DOMException("Dictation cancelled", "AbortError");
            }
            stream = nextStream;
            latency.micReadyMs = elapsed(startedAt);
            emitLatency();
            return nextStream;
          });

        // Microphone permission/device startup and token acquisition are independent.
        // Start them together so neither network grant nor getUserMedia waits on the other.
        const tokenPromise = requestToken(false);
        const [, grant] = await Promise.all([microphonePromise, tokenPromise]);

        if (cancelled || terminal) {
          releaseTracks();
          return;
        }
        openSocket(grant);
      } catch (error) {
        if (cancelled || terminal) return;
        tokenController?.abort();
        tokenController = null;
        releaseTracks();
        fail(classifyConnectError(error));
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
