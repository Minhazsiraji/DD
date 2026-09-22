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
  onUtteranceEnd?: (finalTranscript: string) => void;
  onUsage?: (usage: VoiceStreamUsage) => void;
}

export interface VoiceTranscriptionSession {
  start(): void;
  /** Flush one consumed command without closing the persistent provider session. */
  commitUtterance?(): void;
  stop(): void;
  abort(): void;
}

export interface VoiceTranscriptionProvider {
  id: VoiceTranscriptionProviderId;
  privacyNotice: string;
  isSupported(): boolean;
  createSession(input: {
    language: string;
    continuous?: boolean;
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
const MAX_BUFFERED_AUDIO_BYTES = 4 * 1024 * 1024;
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
  createSession({ language, continuous = false, callbacks }) {
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
    let utteranceBoundaryPending = false;
    let latestTranscript = "";
    let startedAt = 0;
    let stopAt: number | null = null;
    let qaDiagnostics = false;
    const assembler = new DeepgramTranscriptAssembler();
    const latency: VoiceLatencySnapshot = {};
    const pendingAudio: Blob[] = [];
    let pendingAudioBytes = 0;

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
      pendingAudio.length = 0;
      pendingAudioBytes = 0;
      utteranceBoundaryPending = false;

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

    const markFirstAudioSent = () => {
      if (latency.firstAudioSentMs !== undefined) return;
      latency.firstAudioSentMs = elapsed(startedAt);
      emitLatency();
      firstTranscriptTimer = setTimeout(
        () => fail(qaCode("FIRST_TRANSCRIPT_TIMEOUT", "first-transcript-timeout")),
        DEEPGRAM_FIRST_TRANSCRIPT_TIMEOUT_MS,
      );
    };

    const sendAudioChunk = (chunk: Blob) => {
      if (!socket || socket.readyState !== WebSocket.OPEN || chunk.size === 0) return false;
      markFirstAudioSent();
      socket.send(chunk);
      lastChunkSentAt = performance.now();
      return true;
    };

    const flushPendingAudio = () => {
      if (!socket || socket.readyState !== WebSocket.OPEN) return;
      while (pendingAudio.length > 0) {
        const chunk = pendingAudio.shift()!;
        pendingAudioBytes -= chunk.size;
        if (!sendAudioChunk(chunk)) break;
      }
      if (pendingAudioBytes < 0) pendingAudioBytes = 0;
    };

    const beginFinalize = () => {
      if (cancelled || terminal || finalizing) return;
      if (!socket || socket.readyState !== WebSocket.OPEN) return;
      finalizing = true;
      callbacks.onPhase("finalizing");
      if (stopAt === null) stopAt = performance.now();
      flushPendingAudio();

      try {
        socket.send(JSON.stringify({ type: "Finalize" }));
      } catch {
        settle();
        return;
      }
      finalizeTimer = setTimeout(settle, DEEPGRAM_FINALIZE_TIMEOUT_MS);
    };

    const commitContinuousUtterance = () => {
      if (
        !continuous ||
        utteranceBoundaryPending ||
        cancelled ||
        terminal ||
        !socket ||
        socket.readyState !== WebSocket.OPEN
      ) return;
      utteranceBoundaryPending = true;
      flushPendingAudio();
      try {
        // Finalize flushes the current utterance but deliberately keeps the
        // Deepgram WebSocket and microphone session alive.
        socket.send(JSON.stringify({ type: "Finalize" }));
      } catch {
        utteranceBoundaryPending = false;
      }
    };

    const startRecorder = () => {
      if (!stream || cancelled || terminal || recorder) return;
      try {
        recorder = new MediaRecorder(stream, { mimeType });
        recorder.ondataavailable = (event) => {
          if (cancelled || terminal || event.data.size === 0) return;
          if (socket?.readyState === WebSocket.OPEN) {
            sendAudioChunk(event.data);
            return;
          }
          if (pendingAudioBytes + event.data.size > MAX_BUFFERED_AUDIO_BYTES) {
            fail(qaCode("AUDIO_CAPTURE", "audio-capture"));
            return;
          }
          pendingAudio.push(event.data);
          pendingAudioBytes += event.data.size;
        };
        recorder.onerror = () => fail(qaCode("AUDIO_CAPTURE", "audio-capture"));
        recorder.onstop = () => {
          releaseTracks();
          if (!cancelled && !terminal && socket?.readyState === WebSocket.OPEN) beginFinalize();
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

        // Capture immediately. Provider/token/WebSocket startup may take several
        // seconds on a cold Preview; chunks are buffered locally and flushed as
        // soon as Deepgram connects, so the doctor's first words are not lost.
        startRecorder();

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
          flushPendingAudio();
          if (stopped) beginFinalize();
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
          if (
            continuous &&
            (message.speech_final === true ||
              (utteranceBoundaryPending && message.from_finalize === true))
          ) {
            const utterance = assembler.current().trim();
            assembler.reset();
            utteranceBoundaryPending = false;
            latestTranscript = "";
            if (utterance) callbacks.onUtteranceEnd?.(utterance);
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
      commitUtterance() {
        commitContinuousUtterance();
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
