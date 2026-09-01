"use client";

import * as React from "react";
import {
  dictationErrorMessage,
  type DictationState,
} from "./dictation";
import {
  getVoiceTranscriptionProvider,
  type VoiceTranscriptionSession,
} from "./provider";
import {
  DEFAULT_DICTATION_LANGUAGE,
  resolveDictationLanguage,
} from "./voice-language";

/**
 * TRANSCRIPTION ORCHESTRATION, AND NOTHING ELSE.
 *
 * This hook receives text from one configured transcription provider and hands
 * it back to the caller. It does not know which clinical field it is filling,
 * cannot save, cannot add a finding/medicine and cannot finalize anything.
 *
 * The provider itself is selected through the language configuration. Today
 * both English and Bangla resolve to the browser Web Speech adapter. A future
 * approved server provider can implement the same provider contract without
 * changing DictateButton or any clinical form.
 */
export interface Dictation {
  state: DictationState;
  /** Words heard so far this run — final text plus whatever is still forming. */
  transcript: string;
  error: string | null;
  supported: boolean;
  /** Provider-specific privacy wording shown by the shared Dictate control. */
  providerNotice: string;
  start: () => void;
  /** Finish and keep what was heard. */
  stop: () => void;
  /** Throw the run away. Nothing reaches the draft. */
  cancel: () => void;
  /** Clear the last transcript and error, ready for another go. */
  reset: () => void;
}

export function useDictation({
  onFinal,
  language = DEFAULT_DICTATION_LANGUAGE,
}: {
  /**
   * Called ONCE per completed run, with the final text. The caller decides what
   * to do with it — this hook never touches a draft itself.
   */
  onFinal?: (transcript: string) => void;
  /** BCP-47 tag used to choose the configured provider and recognition locale. */
  language?: string;
} = {}): Dictation {
  const [rawState, setState] = React.useState<DictationState>("ready");
  const [transcript, setTranscript] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  const activeLanguage = resolveDictationLanguage(language);
  const provider = getVoiceTranscriptionProvider(activeLanguage.provider);
  const session = React.useRef<VoiceTranscriptionSession | null>(null);

  /**
   * Every provider session gets an identity. Abort does not guarantee that
   * queued callbacks disappear, so an old session must prove it still owns the
   * active run before it may touch transcript state or deliver text.
   */
  const activeRun = React.useRef(0);

  /** Latest insertion callback, safe for delayed provider events. */
  const onFinalRef = React.useRef(onFinal);
  React.useLayoutEffect(() => {
    onFinalRef.current = onFinal;
  });

  /** SSR-safe provider support detection. */
  const mounted = React.useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const supported = mounted && provider?.isSupported() === true;
  const state: DictationState = supported ? rawState : "unsupported";

  /** Always stop capture and invalidate queued callbacks on unmount. */
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

    // Invalidate the previous provider session BEFORE aborting it. This keeps
    // late result/end callbacks from a discarded run out of a quick retry.
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
      language: activeLanguage.lang,
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
  }, [activeLanguage.lang, provider]);

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
    start,
    stop,
    cancel,
    reset,
  };
}
