"use client";

import * as React from "react";

export interface DictationLanguageOption {
  label: string;
  lang: string;
  providerLanguage: "en-US" | "bn";
}

/**
 * Deepgram Nova-3 is the only DD STT baseline in PA1-C1. The UI selects only
 * language; it does not expose a second transcription engine.
 */
export const DICTATION_LANGUAGES: readonly DictationLanguageOption[] = [
  { label: "English", lang: "en-US", providerLanguage: "en-US" },
  { label: "বাংলা", lang: "bn-BD", providerLanguage: "bn" },
];

export const DEFAULT_DICTATION_LANGUAGE = DICTATION_LANGUAGES[0]!.lang;

export function resolveDictationLanguage(lang: string): DictationLanguageOption {
  return DICTATION_LANGUAGES.find((option) => option.lang === lang) ?? DICTATION_LANGUAGES[0]!;
}

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
  const next = resolveDictationLanguage(lang);
  if (activeLanguage === next.lang) return;
  activeLanguage = next.lang;
  for (const listener of listeners) listener();
}

export function useVoiceLanguage() {
  React.useSyncExternalStore(subscribe, getSnapshot, () => DEFAULT_DICTATION_LANGUAGE);
  return resolveDictationLanguage(activeLanguage);
}

/** Generic control only. PA1-C1 does not wire it into a clinical screen. */
export function VoiceLanguageControl({ disabled = false }: { disabled?: boolean }) {
  const active = useVoiceLanguage();

  return (
    <div data-print-hidden className="flex min-w-0 flex-wrap items-center gap-2">
      <label className="inline-flex min-h-11 min-w-0 items-center gap-2 rounded-xl border border-hairline bg-white px-3 text-[13px] text-ink-secondary">
        <span className="shrink-0 font-medium">Voice:</span>
        <select
          aria-label="Voice dictation language"
          value={active.lang}
          disabled={disabled}
          onChange={(event) => setVoiceLanguage(event.target.value)}
          className="min-w-0 max-w-32 bg-transparent font-semibold text-ink outline-none disabled:cursor-not-allowed disabled:opacity-55"
        >
          {DICTATION_LANGUAGES.map((option) => (
            <option key={option.lang} value={option.lang}>{option.label}</option>
          ))}
        </select>
      </label>
      <span className="text-[11px] font-medium text-ink-muted">Deepgram Nova-3</span>
    </div>
  );
}
