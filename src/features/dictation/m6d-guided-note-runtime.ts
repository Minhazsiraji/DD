import { insertTranscript } from "./dictation";
import { normalizeClinicalNumbers } from "./normalize";

/**
 * Production Guided Voice note-field path for a provider-final transcript.
 * This is deliberately pure: it prepares an editable draft value and performs
 * no autosave, clinical action, staging, confirmation, or finalization.
 */
export function applyGuidedVoiceFinalToNote(existing: string, providerFinalTranscript: string) {
  const normalizedTranscript = normalizeClinicalNumbers(providerFinalTranscript);
  const insertion = insertTranscript(existing, normalizedTranscript, existing.length);
  return { normalizedTranscript, value: insertion.text };
}
