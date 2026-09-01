"use client";

import * as React from "react";
import type { VoiceTranscriptionProviderId } from "./provider";

export interface VoiceProviderOption {
  id: VoiceTranscriptionProviderId;
  label: string;
  providerLanguage: string;
}

export interface DictationLanguageOption {
  label: string;
  lang: string;
  preferredProvider: VoiceTranscriptionProviderId;
  providers: readonly VoiceProviderOption[];
}

/**
 * Browser and provider language codes are deliberately separate. Deepgram's
 * Nova-3 Bengali model uses `bn`; browser Web Speech continues to use `bn-BD`.
 */
export const DICTATION_LANGUAGES: readonly DictationLanguageOption[] = [
  {
    label: "English",
    lang: "en-US",
    preferredProvider: "browser",
    providers: [
      { id: "browser", label: "Browser", providerLanguage: "en-US" },
      { id: "deepgram", label: "Deepgram", providerLanguage: "en-US" },
    ],
  },
  {
    label: "বাংলা",
    lang: "bn-BD",
    preferredProvider: "deepgram",
    providers: [
      { id: "deepgram", label: "Deepgram", providerLanguage: "bn" },
      { id: "browser", label: "Browser fallback", providerLanguage: "bn-BD" },
    ],
  },
];

export const DEFAULT_DICTATION_LANGUAGE = DICTATION_LANGUAGES[0]!.lang;

export function resolveDictationLanguage(lang: string): DictationLanguageOption {
  return DICTATION_LANGUAGES.find((option) => option.lang === lang) ?? DICTATION_LANGUAGES[0]!;
}

let activeLanguage = DEFAULT_DICTATION_LANGUAGE;
let activeProvider: VoiceTranscriptionProviderId = resolveDictationLanguage(activeLanguage).preferredProvider;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return `${activeLanguage}|${activeProvider}`;
}

export function setVoiceLanguage(lang: string) {
  const next = resolveDictationLanguage(lang);
  activeLanguage = next.lang;
  activeProvider = next.preferredProvider;
  for (const listener of listeners) listener();
}

export function setVoiceProvider(provider: VoiceTranscriptionProviderId) {
  const language = resolveDictationLanguage(activeLanguage);
  if (!language.providers.some((option) => option.id === provider)) return;
  if (provider === activeProvider) return;
  activeProvider = provider;
  for (const listener of listeners) listener();
}

export function useVoiceLanguage() {
  React.useSyncExternalStore(subscribe, getSnapshot, () => `${DEFAULT_DICTATION_LANGUAGE}|browser`);
  const language = resolveDictationLanguage(activeLanguage);
  const provider =
    language.providers.find((option) => option.id === activeProvider) ??
    language.providers.find((option) => option.id === language.preferredProvider) ??
    language.providers[0]!;
  return { ...language, provider: provider.id, providerLanguage: provider.providerLanguage };
}

/** One compact shared selector; the doctor can explicitly choose browser fallback. */
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

      <label className="inline-flex min-h-11 min-w-0 items-center gap-2 rounded-xl border border-hairline bg-white px-3 text-[13px] text-ink-secondary">
        <span className="shrink-0 font-medium">Engine:</span>
        <select
          aria-label="Voice transcription provider"
          value={active.provider}
          disabled={disabled}
          onChange={(event) => setVoiceProvider(event.target.value as VoiceTranscriptionProviderId)}
          className="min-w-0 max-w-40 bg-transparent font-semibold text-ink outline-none disabled:cursor-not-allowed disabled:opacity-55"
        >
          {active.providers.map((option) => (
            <option key={option.id} value={option.id}>{option.label}</option>
          ))}
        </select>
      </label>
    </div>
  );
}
