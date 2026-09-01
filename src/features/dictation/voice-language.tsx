"use client";

import * as React from "react";
import type { VoiceTranscriptionProviderId } from "./provider";

/**
 * Speech locales available to the UI, plus the transcription provider each
 * locale currently uses.
 *
 * This is intentionally configuration rather than a hard-coded browser rule.
 * Today both languages use the browser Web Speech adapter. Later Bangla can be
 * pointed at a higher-quality server provider by changing this mapping after
 * that provider's privacy/cost/security boundary is explicitly approved.
 */
export interface DictationLanguageOption {
  label: string;
  lang: string;
  provider: VoiceTranscriptionProviderId;
}

export const DICTATION_LANGUAGES: readonly DictationLanguageOption[] = [
  { label: "English", lang: "en-US", provider: "browser" },
  { label: "বাংলা", lang: "bn-BD", provider: "browser" },
];

export const DEFAULT_DICTATION_LANGUAGE = DICTATION_LANGUAGES[0]!.lang;

export function resolveDictationLanguage(lang: string): DictationLanguageOption {
  return (
    DICTATION_LANGUAGES.find((option) => option.lang === lang) ??
    DICTATION_LANGUAGES[0]!
  );
}

/**
 * App-tab preference only.
 *
 * A locale is not patient data, so it may be shared by dictation controls on
 * one loaded app tab. It is intentionally not persisted to browser storage,
 * Supabase, an encounter, or any server endpoint.
 */
let activeLanguage = DEFAULT_DICTATION_LANGUAGE;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return activeLanguage;
}

export function setVoiceLanguage(lang: string) {
  const next = resolveDictationLanguage(lang).lang;
  if (next === activeLanguage) return;
  activeLanguage = next;
  for (const listener of listeners) listener();
}

export function useVoiceLanguage(): DictationLanguageOption {
  const lang = React.useSyncExternalStore(subscribe, getSnapshot, () => DEFAULT_DICTATION_LANGUAGE);
  return resolveDictationLanguage(lang);
}

/** One compact shared selector; individual fields stay uncluttered. */
export function VoiceLanguageControl({ disabled = false }: { disabled?: boolean }) {
  const active = useVoiceLanguage();

  return (
    <label
      data-print-hidden
      className="inline-flex min-h-11 min-w-0 items-center gap-2 rounded-xl border border-hairline bg-white px-3 text-[13px] text-ink-secondary"
    >
      <span className="shrink-0 font-medium">Voice:</span>
      <select
        aria-label="Voice dictation language"
        value={active.lang}
        disabled={disabled}
        onChange={(event) => setVoiceLanguage(event.target.value)}
        className="min-w-0 max-w-32 bg-transparent font-semibold text-ink outline-none disabled:cursor-not-allowed disabled:opacity-55"
      >
        {DICTATION_LANGUAGES.map((option) => (
          <option key={option.lang} value={option.lang}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
