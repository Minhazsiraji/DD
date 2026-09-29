import { M6D_COMMAND_ALIASES } from "./m6d-command-catalogue";
import {
  M6F_INVENTORY_METRICS,
  M6F_VOICE_SURFACE_INVENTORY,
  type VoiceSurfaceEntry,
} from "./m6f-voice-surface-inventory";

export type VoiceGuideLanguage = "english" | "bangla" | "banglish";
export type VoiceGuideCertificationStatus = "VERIFIED" | "CONTEXTUAL" | "FAILED" | "UNSUPPORTED";

export interface VoiceGuideCertification {
  canonicalId: string;
  status: VoiceGuideCertificationStatus;
  requiredContext: string | null;
}

export interface VoiceGuideControl {
  id: string;
  label: string;
  examples: Record<VoiceGuideLanguage, string>;
  note: string;
}

function requiredAlias(values: readonly string[], value: string): string {
  const found = values.find((alias) => alias === value);
  if (!found) throw new Error(`Voice Guide example is no longer in runtime aliases: ${value}`);
  return found;
}

/**
 * General examples are selected from the runtime command catalogue itself.
 * If a command is removed or renamed, module construction fails instead of the
 * guide silently continuing to advertise a stale phrase.
 */
export const M6F_VOICE_GUIDE_CONTROLS: readonly VoiceGuideControl[] = [
  {
    id: "clear",
    label: "Clear current field",
    examples: {
      english: requiredAlias(M6D_COMMAND_ALIASES.clear, "clear current field"),
      bangla: requiredAlias(M6D_COMMAND_ALIASES.clear, "এই ফিল্ড ক্লিয়ার করো"),
      banglish: requiredAlias(M6D_COMMAND_ALIASES.clear, "field clear koro"),
    },
    note: "Clears only the current authoritative editable target.",
  },
  {
    id: "undo",
    label: "Undo last change",
    examples: {
      english: requiredAlias(M6D_COMMAND_ALIASES.undo, "undo last change"),
      bangla: requiredAlias(M6D_COMMAND_ALIASES.undo, "আনডু করো"),
      banglish: requiredAlias(M6D_COMMAND_ALIASES.undo, "last change undo koro"),
    },
    note: "Restores the last reversible Voice edit in the active workflow.",
  },
  {
    id: "remove-last",
    label: "Remove last sentence or line",
    examples: {
      english: requiredAlias(M6D_COMMAND_ALIASES.removeLastSentence, "remove last sentence"),
      bangla: requiredAlias(M6D_COMMAND_ALIASES.removeLastSentence, "শেষ বাক্য মুছে দাও"),
      banglish: requiredAlias(M6D_COMMAND_ALIASES.removeLastSentence, "last sentence remove koro"),
    },
    note: "Applies to the current editable text destination.",
  },
  {
    id: "read",
    label: "Read current field",
    examples: {
      english: requiredAlias(M6D_COMMAND_ALIASES.read, "read current field"),
      bangla: requiredAlias(M6D_COMMAND_ALIASES.read, "এই ফিল্ড পড়ো"),
      banglish: requiredAlias(M6D_COMMAND_ALIASES.read, "current section pore shonao"),
    },
    note: "Returns temporary Voice feedback; it does not create a second clinical record.",
  },
  {
    id: "replace",
    label: "Replace text",
    examples: {
      english: "replace fever with dengue",
      bangla: "জ্বর এর জায়গায় ডেঙ্গু দাও",
      banglish: "fever er jaygay dengue dao",
    },
    note: "Requires a complete replace command and changes only the current target.",
  },
  {
    id: "next",
    label: "Next target",
    examples: {
      english: requiredAlias(M6D_COMMAND_ALIASES.next, "next field"),
      bangla: requiredAlias(M6D_COMMAND_ALIASES.next, "পরের ঘর"),
      banglish: requiredAlias(M6D_COMMAND_ALIASES.next, "next e jao"),
    },
    note: "Moves within the ordered targets supported by the current workflow.",
  },
  {
    id: "previous",
    label: "Previous target",
    examples: {
      english: requiredAlias(M6D_COMMAND_ALIASES.previous, "previous field"),
      bangla: requiredAlias(M6D_COMMAND_ALIASES.previous, "আগের ঘর"),
      banglish: requiredAlias(M6D_COMMAND_ALIASES.previous, "previous e jao"),
    },
    note: "Moves backward within the current workflow's supported target order.",
  },
] as const;

export const M6F_VOICE_GUIDE_SAFETY = [
  {
    title: "Vitals stay contextual",
    description:
      "A bare observation such as “BP 110/80” changes structured vitals only when Blood pressure or Vitals is the current target. In a clinical note it remains dictation. Use an explicit command such as “Set BP 110/80” to change it from elsewhere.",
  },
  {
    title: "Investigations remain staged",
    description:
      "Voice can prepare and edit staged investigations. The visible Confirm investigations action remains the authority boundary.",
  },
  {
    title: "Medicines remain staged",
    description:
      "Search, variant selection and field edits prepare the medicine form. Voice does not press Add medicine or Save changes for the doctor.",
  },
  {
    title: "Autopilot requires Apply",
    description:
      "Generate, select, edit and discard operate on proposals. Only the doctor's explicit Apply selected action changes the draft.",
  },
  {
    title: "Finalization is prohibited",
    description:
      "Voice cannot Finalize, Sign, Complete or Finish a prescription. Review and final approval remain visible doctor-controlled actions.",
  },
] as const;

export const M6F_VOICE_GUIDE_CERTIFICATION: readonly VoiceGuideCertification[] =
  M6F_VOICE_SURFACE_INVENTORY.map((entry) => {
    const contextual = entry.editable || entry.page === "prescription" || Boolean(entry.existingProtectedAction);
    return {
      canonicalId: entry.canonicalId,
      status: contextual ? "CONTEXTUAL" : "VERIFIED",
      requiredContext: contextual
        ? entry.existingProtectedAction
          ? `${entry.section}; ${entry.existingProtectedAction}`
          : entry.editable
            ? `${entry.section}; active editable target`
            : entry.section
        : null,
    };
  });

export const M6F_VOICE_GUIDE_CERTIFICATION_TOTALS = {
  total: M6F_VOICE_GUIDE_CERTIFICATION.length,
  verified: M6F_VOICE_GUIDE_CERTIFICATION.filter((row) => row.status === "VERIFIED").length,
  contextual: M6F_VOICE_GUIDE_CERTIFICATION.filter((row) => row.status === "CONTEXTUAL").length,
  failed: M6F_VOICE_GUIDE_CERTIFICATION.filter((row) => row.status === "FAILED").length,
  unsupported: M6F_VOICE_GUIDE_CERTIFICATION.filter((row) => row.status === "UNSUPPORTED").length,
} as const;

export const M6F_VOICE_GUIDE = {
  entries: M6F_VOICE_SURFACE_INVENTORY,
  metrics: M6F_INVENTORY_METRICS,
  controls: M6F_VOICE_GUIDE_CONTROLS,
  safety: M6F_VOICE_GUIDE_SAFETY,
  certification: M6F_VOICE_GUIDE_CERTIFICATION,
  certificationTotals: M6F_VOICE_GUIDE_CERTIFICATION_TOTALS,
} as const;

export function aliasesForGuideLanguage(
  entry: VoiceSurfaceEntry,
  language: VoiceGuideLanguage,
): readonly string[] {
  if (language === "bangla") return entry.aliasesBangla;
  if (language === "banglish") return entry.aliasesBanglish;
  return entry.aliasesEnglish;
}

const VALUE_EXAMPLES: Readonly<Record<string, Record<VoiceGuideLanguage, string>>> = {
  bloodPressure: { english: "Then say: 110 over 80", bangla: "তারপর বলুন: ১১০ বাই ৮০", banglish: "Then say: eksho dosh by ashi" },
  vitalPulseBpm: { english: "Then say: 96", bangla: "তারপর বলুন: ৯৬", banglish: "Then say: chiyanobboi" },
  vitalWeightKg: { english: "Then say: 70 kg", bangla: "তারপর বলুন: ৭০ কেজি", banglish: "Then say: 70 kg" },
  vitalHeightCm: { english: "Then say: 170 cm", bangla: "তারপর বলুন: ১৭০ সেন্টিমিটার", banglish: "Then say: 170 cm" },
  vitalTemperatureC: { english: "Then say: 98.6 Fahrenheit", bangla: "তারপর বলুন: ৯৮.৬ ফারেনহাইট", banglish: "Then say: 98.6 Fahrenheit" },
  vitalSpo2: { english: "Then say: 98 percent", bangla: "তারপর বলুন: ৯৮ শতাংশ", banglish: "Then say: 98 percent" },
  vitalRespRate: { english: "Then say: 18", bangla: "তারপর বলুন: ১৮", banglish: "Then say: 18" },
  displayName: { english: "Then say: Napa 500 mg", bangla: "তারপর বলুন: নাপা ৫০০ মিলিগ্রাম", banglish: "Then say: Napa 500 mg" },
  doseText: { english: "Then say: 1 tablet", bangla: "তারপর বলুন: ১ ট্যাবলেট", banglish: "Then say: 1 tablet" },
  scheduleText: { english: "Then say: 1+0+1", bangla: "তারপর বলুন: ১+০+১", banglish: "Then say: 1+0+1" },
  durationText: { english: "Then say: 7 days", bangla: "তারপর বলুন: ৭ দিন", banglish: "Then say: 7 din" },
};

export function valueExampleForGuide(
  entry: VoiceSurfaceEntry,
  language: VoiceGuideLanguage,
): string | null {
  const explicit = VALUE_EXAMPLES[entry.sourceKey]?.[language];
  if (explicit) return explicit;
  if (!entry.editable) return null;
  if (entry.controlType === "textarea" || entry.controlType === "text") {
    if (language === "bangla") return "টার্গেট করার পরে স্বাভাবিকভাবে লেখাটি বলুন।";
    if (language === "banglish") return "Target korar por normal vabe text bolun.";
    return "After targeting, dictate the value naturally.";
  }
  return null;
}
