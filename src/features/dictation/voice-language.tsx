"use client";

import * as React from "react";

export interface DictationLanguageOption {
  label: string;
  lang: string;
  providerLanguage: "en-US" | "bn";
}

/**
 * Build-time pilot switch. It is intentionally public because it controls UI/provider
 * selection only; provider credentials remain server-side behind /api/voice/token.
 */
export const LIVE_VOICE_ENABLED = process.env.NEXT_PUBLIC_LIVE_VOICE_ENABLED === "true";

export const DICTATION_LANGUAGES: readonly DictationLanguageOption[] = [
  { label: "English", lang: "en-US", providerLanguage: "en-US" },
  { label: "বাংলা", lang: "bn-BD", providerLanguage: "bn" },
  // Banglish means natural code-mixed clinical language with each language kept
  // in its native script: English stays English and Bangla stays বাংলা. It is
  // not Romanized Bangla. Live pilot currently uses the Bengali Nova-3 stream
  // as the conservative baseline until the mixed-language benchmark qualifies
  // a provider/configuration at the >=95% clinical-concept target.
  { label: "Banglish (বাংলা + English)", lang: "bn-BD-mixed", providerLanguage: "bn" },
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
          className="min-w-0 max-w-56 bg-transparent font-semibold text-ink outline-none disabled:cursor-not-allowed disabled:opacity-55"
        >
          {DICTATION_LANGUAGES.map((option) => (
            <option key={option.lang} value={option.lang}>{option.label}</option>
          ))}
        </select>
      </label>
      <span className="text-[11px] font-medium text-ink-muted">
        Deepgram Nova-3 · {LIVE_VOICE_ENABLED ? "live pilot" : "mock mode"}
      </span>
    </div>
  );
}
