export type DoctorVoiceLanguagePreference = "english" | "bangla" | "banglish" | "mixed";

export interface DoctorVoiceAlias {
  phrase: string;
  canonicalUtterance: string;
}

export interface DoctorVoicePersonalizationProfile {
  version: 1;
  language: DoctorVoiceLanguagePreference;
  commandAliases: DoctorVoiceAlias[];
  fieldAliases: DoctorVoiceAlias[];
}

export const M6F_VOICE_PERSONALIZATION_STORAGE_KEY = "dd:m6f-voice-personalization:v1";

export const EMPTY_DOCTOR_VOICE_PROFILE: DoctorVoicePersonalizationProfile = {
  version: 1,
  language: "mixed",
  commandAliases: [],
  fieldAliases: [],
};

export const PERSONAL_COMMAND_TARGETS = [
  { id: "ADD_MEDICINE", label: "Add medicine", canonicalUtterance: "add medicine" },
  { id: "OPEN_PRESCRIPTION", label: "Open prescription", canonicalUtterance: "open prescription" },
  { id: "REVIEW_PRESCRIPTION", label: "Review prescription", canonicalUtterance: "review prescription" },
  { id: "CLEAR_CURRENT", label: "Clear current field", canonicalUtterance: "clear this field" },
  { id: "UNDO", label: "Undo last change", canonicalUtterance: "undo last change" },
  { id: "READ_CURRENT", label: "Read current field", canonicalUtterance: "read current field" },
  { id: "NEXT", label: "Next target", canonicalUtterance: "next field" },
  { id: "PREVIOUS", label: "Previous target", canonicalUtterance: "previous field" },
  { id: "END_VOICE", label: "End Voice", canonicalUtterance: "end voice" },
] as const;

export const PERSONAL_FIELD_TARGETS = [
  { id: "CHIEF_COMPLAINTS", label: "Chief complaints", canonicalUtterance: "chief complaints" },
  { id: "EXAMINATION", label: "Examination", canonicalUtterance: "examination" },
  { id: "BLOOD_PRESSURE", label: "Blood pressure", canonicalUtterance: "blood pressure" },
  { id: "DIAGNOSIS", label: "Diagnosis", canonicalUtterance: "diagnosis" },
  { id: "INVESTIGATION", label: "Investigation", canonicalUtterance: "investigation" },
  { id: "FOLLOW_UP", label: "Follow-up", canonicalUtterance: "follow up" },
  { id: "MEDICINE_NAME", label: "Medicine name", canonicalUtterance: "medicine name" },
  { id: "STRENGTH", label: "Strength", canonicalUtterance: "strength" },
  { id: "DOSE", label: "Dose", canonicalUtterance: "dose" },
  { id: "SCHEDULE", label: "Schedule", canonicalUtterance: "schedule" },
  { id: "DURATION", label: "Duration", canonicalUtterance: "duration" },
] as const;

const ALLOWED_CANONICAL_UTTERANCES = new Set<string>([
  ...PERSONAL_COMMAND_TARGETS.map((target) => target.canonicalUtterance),
  ...PERSONAL_FIELD_TARGETS.map((target) => target.canonicalUtterance),
]);

function normalizedAlias(value: string): string {
  return value.normalize("NFC").trim().replace(/[.।!?]+$/gu, "").replace(/\s+/gu, " ").toLocaleLowerCase("en-US");
}

export function validateDoctorVoiceAlias(phrase: string, existing: readonly DoctorVoiceAlias[]): string | null {
  const normalized = normalizedAlias(phrase);
  if (normalized.length < 2) return "Enter at least two characters.";
  if (normalized.length > 80) return "Keep a custom phrase within 80 characters.";
  if (existing.some((alias) => normalizedAlias(alias.phrase) === normalized)) return "That phrase is already configured.";
  return null;
}

export function applyDoctorVoicePersonalization(
  utterance: string,
  profile: DoctorVoicePersonalizationProfile,
): string {
  const normalized = normalizedAlias(utterance);
  const alias = [...profile.commandAliases, ...profile.fieldAliases]
    .find((candidate) => ALLOWED_CANONICAL_UTTERANCES.has(candidate.canonicalUtterance)
      && normalizedAlias(candidate.phrase) === normalized);
  return alias?.canonicalUtterance ?? utterance;
}

function safeAliases(value: unknown): DoctorVoiceAlias[] {
  if (!Array.isArray(value)) return [];
  return value.filter((candidate): candidate is DoctorVoiceAlias => {
    if (!candidate || typeof candidate !== "object") return false;
    const alias = candidate as Partial<DoctorVoiceAlias>;
    return typeof alias.phrase === "string"
      && alias.phrase.length <= 80
      && typeof alias.canonicalUtterance === "string"
      && ALLOWED_CANONICAL_UTTERANCES.has(alias.canonicalUtterance);
  });
}

export function loadDoctorVoicePersonalization(): DoctorVoicePersonalizationProfile {
  if (typeof window === "undefined") return EMPTY_DOCTOR_VOICE_PROFILE;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(M6F_VOICE_PERSONALIZATION_STORAGE_KEY) ?? "null") as Partial<DoctorVoicePersonalizationProfile> | null;
    if (!parsed || parsed.version !== 1) return EMPTY_DOCTOR_VOICE_PROFILE;
    return {
      version: 1,
      language: ["english", "bangla", "banglish", "mixed"].includes(parsed.language ?? "")
        ? parsed.language as DoctorVoiceLanguagePreference
        : "mixed",
      commandAliases: safeAliases(parsed.commandAliases),
      fieldAliases: safeAliases(parsed.fieldAliases),
    };
  } catch {
    return EMPTY_DOCTOR_VOICE_PROFILE;
  }
}

export function resolveDoctorVoiceUtterance(utterance: string): string {
  return applyDoctorVoicePersonalization(utterance, loadDoctorVoicePersonalization());
}
