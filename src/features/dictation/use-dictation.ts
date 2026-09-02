"use client";

import * as React from "react";
import { dictationErrorMessage, type DictationState } from "./dictation";
import {
  getVoiceTranscriptionProvider,
  type VoiceLatencySnapshot,
  type VoiceTranscriptionProviderId,
  type VoiceTranscriptionSession,
} from "./provider";

interface ActiveVoiceLease {
  owner: symbol;
  cancel: () => void;
}

let activeVoiceLease: ActiveVoiceLease | null = null;

const QA_DIAGNOSTIC_CODES = new Set([
  "TOKEN_ROUTE_UNAUTHORIZED",
  "TOKEN_ROUTE_FORBIDDEN",
  "TOKEN_RATE_LIMIT",
  "TOKEN_CONFIG_MISSING",
  "TOKEN_GRANT_REJECTED",
  "TOKEN_GRANT_NETWORK",
  "WS_CONNECTION",
  "AUDIO_CAPTURE",
  "FIRST_TRANSCRIPT_TIMEOUT",
]);

function qaDiagnostic(code: string): string | null {
  return QA_DIAGNOSTIC_CODES.has(code) ? code : null;
}

function providerUnavailable(code: string): boolean {
  return ["provider-unavailable", "TOKEN_CONFIG_MISSING", "TOKEN_GRANT_REJECTED"].includes(code);
}

/**
 * TRANSCRIPTION ORCHESTRATION, AND NOTHING ELSE.
 *
 * This hook receives text from one configured transcription provider and hands
 * it back to the caller. It does not know which clinical field it is filling,
 * cannot save, cannot add a finding/medicine and cannot finalize anything.
 */
export interface Dictation {
  state: DictationState;
  transcript: string;
  error: string | null;
  diagnosticCode: string | null;
  supported: boolean;
  providerNotice: string;
  providerId: VoiceTranscriptionProviderId;
  latency: VoiceLatencySnapshot;
  start: () => void;
  stop: () => void;
  cancel: () => void;
  reset: () => void;
}

export function useDictation({
  onPreview,
  onFinal,
  onCancel,
  language = "en-US",
  providerId = "browser",
}: {
  onPreview?: (transcript: string) => void;
  onFinal?: (transcript: string) => void;
  onCancel?: () => void;
  language?: string;
  providerId?: VoiceTranscriptionProviderId;
} = {}): Dictation {
  const [rawState, setState] = React.useState<DictationState>("ready");
  const [transcript, setTranscript] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [diagnosticCode, setDiagnosticCode] = React.useState<string | null>(null);
  const [latency, setLatency] = React.useState<VoiceLatencySnapshot>({});

  const provider = getVoiceTranscriptionProvider(providerId);
  const session = React.useRef<VoiceTranscriptionSession | null>(null);
  const activeRun = React.useRef(0);
  const owner = React.useRef(Symbol("voice-dictation-owner")).current;

  const onPreviewRef = React.useRef(onPreview);
  const onFinalRef = React.useRef(onFinal);
  const onCancelRef = React.useRef(onCancel);
  React.useLayoutEffect(() => {
    onPreviewRef.current = onPreview;
    onFinalRef.current = onFinal;
    onCancelRef.current = onCancel;
  });

  const mounted = React.useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const supported = mounted && provider?.isSupported() === true;
  const state: DictationState = supported ? rawState : "unsupported";

  const releaseLease = React.useCallback(() => {
    if (activeVoiceLease?.owner === owner) activeVoiceLease = null;
  }, [owner]);

  const cancelCurrent = React.useCallback(() => {
    activeRun.current += 1;
    const current = session.current;
    session.current = null;
    current?.abort();
    releaseLease();
    onCancelRef.current?.();
    setTranscript("");
    setError(null);
    setDiagnosticCode(null);
    setLatency({});
    setState("ready");
  }, [releaseLease]);

  React.useEffect(
    () => () => {
      activeRun.current += 1;
      const current = session.current;
      session.current = null;
      current?.abort();
      releaseLease();
    },
    [releaseLease],
  );

  const start = React.useCallback(() => {
    if (!provider || !provider.isSupported()) {
      setState("unsupported");
      return;
    }

    if (activeVoiceLease && activeVoiceLease.owner !== owner) activeVoiceLease.cancel();

    const runId = activeRun.current + 1;
    activeRun.current = runId;
    const previous = session.current;
    session.current = null;
    previous?.abort();

    setTranscript("");
    setError(null);
    setDiagnosticCode(null);
    setLatency({});
    setState("connecting");

    let ended = false;
    let current: VoiceTranscriptionSession | null = null;
    current = provider.createSession({
      language,
      callbacks: {
        onPhase(phase) {
          if (activeRun.current !== runId || ended) return;
          setState(phase);
        },
        onTranscript(next) {
          if (activeRun.current !== runId || ended) return;
          setTranscript(next.text);
          onPreviewRef.current?.(next.text);
        },
        onLatency(next) {
          if (activeRun.current !== runId || ended) return;
          setLatency(next);
        },
        onError(code) {
          if (activeRun.current !== runId || ended || code === "aborted") return;
          ended = true;
          activeRun.current += 1;
          if (session.current === current) session.current = null;
          releaseLease();
          setDiagnosticCode(qaDiagnostic(code));
          setError(dictationErrorMessage(code));
          setState(providerUnavailable(code) ? "provider-unavailable" : "error");
        },
        onEnd(said) {
          if (activeRun.current !== runId || ended) return;
          ended = true;
          activeRun.current += 1;
          if (session.current === current) session.current = null;
          releaseLease();
          setTranscript(said);
          setDiagnosticCode(null);
          setState("ready");
          if (said !== "") onFinalRef.current?.(said);
        },
      },
    });

    if (!current) {
      setState("unsupported");
      return;
    }

    session.current = current;
    activeVoiceLease = { owner, cancel: cancelCurrent };
    try {
      current.start();
    } catch {
      if (activeRun.current === runId) {
        activeRun.current += 1;
        if (session.current === current) session.current = null;
        releaseLease();
        setDiagnosticCode(null);
        setError(dictationErrorMessage("unknown"));
        setState("error");
      }
    }
  }, [cancelCurrent, language, owner, provider, releaseLease]);

  const stop = React.useCallback(() => {
    if (!session.current) return;
    setState("finalizing");
    session.current.stop();
  }, []);

  const cancel = React.useCallback(() => {
    cancelCurrent();
  }, [cancelCurrent]);

  const reset = React.useCallback(() => {
    if (session.current) return;
    setTranscript("");
    setError(null);
    setDiagnosticCode(null);
    setLatency({});
    setState("ready");
  }, []);

  return {
    state,
    transcript,
    error,
    diagnosticCode,
    supported,
    providerNotice: provider?.privacyNotice ?? "",
    providerId,
    latency,
    start,
    stop,
    cancel,
    reset,
  };
}
