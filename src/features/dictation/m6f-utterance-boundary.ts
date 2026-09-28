export const M6F_ENGLISH_SILENCE_FINALIZE_MS = 800;
export const M6F_MULTILINGUAL_SILENCE_FINALIZE_MS = 1400;

export type M6FVoiceLifecycleEvent =
  | "onPreview"
  | "onProviderFinal"
  | "onUtteranceEnd"
  | "commitUtterance"
  | "onFinal"
  | "restart";

export interface M6FVoiceLifecycleTraceEntry {
  event: M6FVoiceLifecycleEvent;
  language: string;
  rawFragment: string;
  atMs: number;
  reason: string;
}

/** Language-aware application boundary; provider endpointing is unchanged. */
export function m6fSilenceFinalizeMs(language: string): number {
  return language === "bn-BD" || language === "bn-BD-mixed"
    ? M6F_MULTILINGUAL_SILENCE_FINALIZE_MS
    : M6F_ENGLISH_SILENCE_FINALIZE_MS;
}

/**
 * Provider-final is a streaming stability signal, not a Doctor utterance
 * boundary. Only provider utterance-end or the language-aware silence timer
 * may request an application commit.
 */
export function shouldCommitM6FProviderFinal(): false {
  return false;
}

/** Synthetic-only instrumentation used by provider-like lifecycle fixtures. */
export function createM6FSyntheticVoiceTrace() {
  const entries: M6FVoiceLifecycleTraceEntry[] = [];
  return {
    record(entry: M6FVoiceLifecycleTraceEntry) {
      entries.push({ ...entry });
    },
    snapshot() {
      return entries.map((entry) => ({ ...entry }));
    },
  };
}
