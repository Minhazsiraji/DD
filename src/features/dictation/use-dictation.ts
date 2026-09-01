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
  onFinal,
  language = "en-US",
  providerId = "browser",
}: {
  onFinal?: (transcript: string) => void;
  language?: string;
  providerId?: VoiceTranscriptionProviderId;
} = {}): Dictation {
  const [rawState, setState] = React.useState<DictationState>("ready");
  const [transcript, setTranscript] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [latency, setLatency] = React.useState<VoiceLatencySnapshot>({});

  const provider = getVoiceTranscriptionProvider(providerId);
  const session = React.useRef<VoiceTranscriptionSession | null>(null);
  const activeRun = React.useRef(0);
  const owner = React.useRef(Symbol("voice-dictation-owner")).current;

  const onFinalRef = React.useRef(onFinal);
  React.useLayoutEffect(() => {
    onFinalRef.current = onFinal;
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
    setTranscript("");
    setError(null);
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
          setError(dictationErrorMessage(code));
          setState(code === "provider-unavailable" ? "provider-unavailable" : "error");
        },
        onEnd(said) {
          if (activeRun.current !== runId || ended) return;
          ended = true;
          activeRun.current += 1;
          if (session.current === current) session.current = null;
          releaseLease();
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
    setLatency({});
    setState("ready");
  }, []);

  return {
    state,
    transcript,
    error,
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
