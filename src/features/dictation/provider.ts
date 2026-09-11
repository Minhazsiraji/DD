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
import { mintVoiceSessionId, parseGrantId, type VoiceStreamUsage } from "./voice-usage";

export type { VoiceStreamUsage } from "./voice-usage";

export const VOICE_TRANSCRIPTION_PROVIDER_IDS = ["deepgram"] as const;
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
  /**
   * Accounting, not UI state: fired exactly once per session on EVERY terminal
   * path — end, error and cancel — because audio streamed before a Discard was
   * still sent to the provider. Carries no transcript.
   */
  onUsage?: (usage: VoiceStreamUsage) => void;
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

function elapsed(startedAt: number): number {
  return Math.round(performance.now() - startedAt);
}

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
  grantId?: unknown;
}

function tokenQaDiagnostic(value: unknown): string | null {
  return typeof value === "string" && TOKEN_QA_DIAGNOSTICS.has(value) ? value : null;
}

async function requestDeepgramAccessToken(signal: AbortSignal): Promise<{
  accessToken: string;
  qaDiagnostics: boolean;
  grantId: string | null;
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
  return {
    accessToken: payload.accessToken,
    qaDiagnostics: payload.qaDiagnostics === true,
    grantId: parseGrantId(payload.grantId),
  };
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

    // Usage accounting. Streamed audio is measured from recorder start to the
    // last chunk actually SENT, so audio captured after the socket died is not
    // counted as streamed. Reported once, on whichever terminal path comes first.
    const voiceSessionId = mintVoiceSessionId();
    let grantId: string | null = null;
    let recorderStartedAt: number | null = null;
    let lastChunkSentAt: number | null = null;
    let usageReported = false;
    const reportUsage = () => {
      if (usageReported) return;
      usageReported = true;
      callbacks.onUsage?.({
        voiceSessionId,
        grantId,
        streamedAudioMs:
          recorderStartedAt !== null && lastChunkSentAt !== null
            ? Math.max(0, Math.round(lastChunkSentAt - recorderStartedAt))
            : 0,
        connectLatencyMs: latency.providerConnectedMs ?? null,
        firstResultLatencyMs: latency.firstTranscriptMs ?? null,
      });
    };

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
      reportUsage();
      cleanup();
      callbacks.onError(code);
    };

    const settle = () => {
      if (cancelled || terminal) return;
      terminal = true;
      if (stopAt !== null) latency.stopToFinalMs = Math.round(performance.now() - stopAt);
      emitLatency();
      reportUsage();
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
          lastChunkSentAt = performance.now();
        };
        recorder.onerror = () => fail(qaCode("AUDIO_CAPTURE", "audio-capture"));
        recorder.onstop = () => {
          releaseTracks();
          if (!cancelled && !terminal) beginFinalize();
        };
        recorderStartedAt = performance.now();
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
        const tokenTimeout = setTimeout(() => tokenController?.abort(), TOKEN_ROUTE_TIMEOUT_MS);
        let accessToken: string;
        try {
          const grant = await requestDeepgramAccessToken(tokenController.signal);
          accessToken = grant.accessToken;
          qaDiagnostics = grant.qaDiagnostics;
          grantId = grant.grantId;
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
            : code === "provider-unavailable" || code === "provider-error"
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
        // A cancelled or Discarded run still streamed whatever it streamed.
        // No-op if the session already reported on end or error.
        reportUsage();
        cancelled = true;
        terminal = true;
        cleanup();
      },
    };
  },
};

export function getVoiceTranscriptionProvider(
  id: VoiceTranscriptionProviderId = "deepgram",
): VoiceTranscriptionProvider | null {
  return id === "deepgram" ? deepgramProvider : null;
}
