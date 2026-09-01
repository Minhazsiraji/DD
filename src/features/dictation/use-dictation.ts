"use client";

import * as React from "react";
import { dictationErrorMessage, type DictationState } from "./dictation";
import {
  getVoiceTranscriptionProvider,
  type VoiceTranscriptionProviderId,
  type VoiceTranscriptionSession,
} from "./provider";

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
  /** Provider-specific language parameter, chosen by config. */
  language?: string;
  providerId?: VoiceTranscriptionProviderId;
} = {}): Dictation {
  const [rawState, setState] = React.useState<DictationState>("ready");
  const [transcript, setTranscript] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  const provider = getVoiceTranscriptionProvider(providerId);
  const session = React.useRef<VoiceTranscriptionSession | null>(null);
  const activeRun = React.useRef(0);

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

  React.useEffect(
    () => () => {
      activeRun.current += 1;
      const current = session.current;
      session.current = null;
      current?.abort();
    },
    [],
  );

  const start = React.useCallback(() => {
    if (!provider || !provider.isSupported()) {
      setState("unsupported");
      return;
    }

    const runId = activeRun.current + 1;
    activeRun.current = runId;
    const previous = session.current;
    session.current = null;
    previous?.abort();

    setTranscript("");
    setError(null);

    let ended = false;
    let current: VoiceTranscriptionSession | null = null;
    current = provider.createSession({
      language,
      callbacks: {
        onTranscript(next) {
          if (activeRun.current !== runId || ended) return;
          setTranscript(next);
        },
        onError(code) {
          if (activeRun.current !== runId || ended) return;
          if (code === "aborted") return;
          setError(dictationErrorMessage(code));
          setState("error");
        },
        onEnd(said) {
          if (activeRun.current !== runId || ended) return;
          ended = true;
          activeRun.current += 1;
          if (session.current === current) session.current = null;
          setState((existing) => (existing === "error" ? "error" : "ready"));
          if (said !== "") onFinalRef.current?.(said);
        },
      },
    });

    if (!current) {
      setState("unsupported");
      return;
    }

    session.current = current;
    try {
      current.start();
      setState("recording");
    } catch {
      if (activeRun.current === runId) {
        activeRun.current += 1;
        if (session.current === current) session.current = null;
        setError(dictationErrorMessage("unknown"));
        setState("error");
      }
    }
  }, [language, provider]);

  const stop = React.useCallback(() => {
    if (!session.current) return;
    setState("transcribing");
    session.current.stop();
  }, []);

  const cancel = React.useCallback(() => {
    activeRun.current += 1;
    const current = session.current;
    session.current = null;
    current?.abort();
    setTranscript("");
    setError(null);
    setState("ready");
  }, []);

  const reset = React.useCallback(() => {
    setTranscript("");
    setError(null);
    setState("ready");
  }, []);

  return {
    state,
    transcript,
    error,
    supported,
    providerNotice: provider?.privacyNotice ?? "",
    providerId,
    start,
    stop,
    cancel,
    reset,
  };
}
