"use client";

import * as React from "react";
import {
  DICTATION_LANG,
  dictationErrorMessage,
  type DictationState,
} from "./dictation";

/**
 * AUDIO CAPTURE, AND NOTHING ELSE.
 *
 * This hook owns the microphone and hands back text. It does not know which
 * field it is filling, does not insert anything, and cannot save — those are
 * three separate jobs on purpose, so the day a server-side transcriber replaces
 * the browser one, only this file changes.
 *
 * THE PROVIDER IS THE BROWSER, AND THAT IS A PRIVACY FACT.
 *
 * `SpeechRecognition` in Chrome and Edge streams audio to the browser vendor's
 * speech service. This is a patient describing symptoms, so it is not an
 * implementation detail to be buried: the control that starts it says where the
 * audio goes, and starting it is always a deliberate press.
 *
 * WE STORE NO AUDIO. Nothing is recorded to disk, nothing is uploaded by this
 * application, nothing is attached to the patient record, and the transcript
 * lives in React state until the doctor saves it or navigates away.
 */

/** The slice of the Web Speech API actually used. */
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
  results: ArrayLike<
    ArrayLike<{ transcript: string }> & { isFinal: boolean }
  >;
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

export interface Dictation {
  state: DictationState;
  /** Words heard so far this run — final text plus whatever is still forming. */
  transcript: string;
  error: string | null;
  supported: boolean;
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
}: {
  /**
   * Called ONCE per completed run, with the final text. The caller decides what
   * to do with it — this hook never touches a draft itself.
   */
  onFinal?: (transcript: string) => void;
} = {}): Dictation {
  const [rawState, setState] = React.useState<DictationState>("ready");
  const [transcript, setTranscript] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  const recognition = React.useRef<SpeechRecognitionLike | null>(null);
  const finalText = React.useRef("");
  /** A cancelled run must deliver nothing, even though `onend` still fires. */
  const cancelled = React.useRef(false);
  /**
   * The latest callback, read from inside an engine event that fires long after
   * the render which created it. Synced in a layout effect rather than written
   * during render — a ref mutated mid-render is torn under concurrent
   * rendering, and this one decides where a doctor's words land.
   */
  const onFinalRef = React.useRef(onFinal);
  React.useLayoutEffect(() => {
    onFinalRef.current = onFinal;
  });

  /**
   * Are we on the client yet? `window` does not exist during SSR, so asking for
   * a speech engine there always answers "no" — and rendering a control on the
   * client that the server did not render is a hydration mismatch. The server
   * snapshot is `false`, the client snapshot is `true`, and React reconciles
   * the difference itself.
   */
  const mounted = React.useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const supported = mounted && recognitionCtor() !== null;

  /**
   * DERIVED, not stored. Support is a fact about the browser, not a state this
   * hook transitions into — keeping it in `useState` meant an effect writing
   * state on mount, which is a cascading render and, worse, a moment where the
   * control claimed to be ready in a browser that has no engine.
   */
  const state: DictationState = supported ? rawState : "unsupported";

  /** Always leave the microphone off when this unmounts. */
  React.useEffect(
    () => () => {
      recognition.current?.abort();
      recognition.current = null;
    },
    [],
  );

  const start = React.useCallback(() => {
    const Ctor = recognitionCtor();
    if (!Ctor) {
      setState("unsupported");
      return;
    }

    recognition.current?.abort();
    finalText.current = "";
    cancelled.current = false;
    setTranscript("");
    setError(null);

    const engine = new Ctor();
    engine.lang = DICTATION_LANG;
    // Clinical dictation is sentences, not single commands, so it must survive
    // the pauses a doctor takes while examining someone.
    engine.continuous = true;
    // Interim words are shown as they form; only final ones are kept.
    engine.interimResults = true;

    engine.onresult = (event) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const said = result?.[0]?.transcript ?? "";
        if (result?.isFinal) finalText.current += said;
        else interim += said;
      }
      setTranscript(finalText.current + interim);
    };

    engine.onerror = (event) => {
      const code = event.error ?? "unknown";
      if (code === "aborted") return; // Cancel and unmount both land here.
      setError(dictationErrorMessage(code));
      setState("error");
    };

    engine.onend = () => {
      recognition.current = null;
      if (cancelled.current) {
        setTranscript("");
        setState("ready");
        return;
      }
      const said = finalText.current.trim();
      setState((current) => (current === "error" ? "error" : "ready"));
      // Nothing heard is not a failure and must not clear anyone's draft.
      if (said !== "") onFinalRef.current?.(said);
    };

    recognition.current = engine;
    try {
      engine.start();
      setState("recording");
    } catch {
      setError(dictationErrorMessage("unknown"));
      setState("error");
    }
  }, []);

  const stop = React.useCallback(() => {
    if (!recognition.current) return;
    // Not `ready` yet: the engine still has the tail of the sentence.
    setState("transcribing");
    recognition.current.stop();
  }, []);

  const cancel = React.useCallback(() => {
    cancelled.current = true;
    finalText.current = "";
    recognition.current?.abort();
    recognition.current = null;
    setTranscript("");
    setError(null);
    setState("ready");
  }, []);

  const reset = React.useCallback(() => {
    setTranscript("");
    setError(null);
    // `unsupported` needs no special case here — it is derived above.
    setState("ready");
  }, []);

  return { state, transcript, error, supported, start, stop, cancel, reset };
}
