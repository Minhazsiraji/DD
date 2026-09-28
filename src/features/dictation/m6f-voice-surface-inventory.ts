/** Source-first M6F audit. UI schemas create editable entries; controls are explicit. */
import { NEXT_VISIT_DATE, SECTIONS, TEXT_KEYS, VITALS } from "@/features/encounters/schema";
import { MEDICINE_FIELDS } from "@/features/prescriptions/schema";
import { M6E_FIELD_ALIASES } from "@/features/prescriptions/m6e-prescription-field-normalization";
import { M6F_CLOSED_ASR_RESTORATIONS } from "./m6f-action-grammar";
import { M6F_CONSULTATION_TARGETS } from "./m6f-consultation-controls";

export interface VoiceSurfaceEntry {
  canonicalId: string;
  page: "consultation" | "prescription";
  section: string;
  uiLabel: string;
  controlType: "textarea" | "text" | "number" | "date" | "radio" | "checkbox" | "list" | "action";
  sourceKey: string;
  editable: boolean;
  targetable: boolean;
  readable: boolean;
  clearable: boolean;
  replaceable: boolean;
  nextPreviousEligible: boolean;
  existingProtectedAction: string | null;
  aliasesEnglish: readonly string[];
  aliasesBangla: readonly string[];
  aliasesBanglish: readonly string[];
  asrRestorations: readonly string[];
}

const asrKeys = Object.keys(M6F_CLOSED_ASR_RESTORATIONS);
const consultationAliases = new Map(M6F_CONSULTATION_TARGETS.map((entry) => [entry.target, entry]));

function aliases(sourceKey: string, fallback: string) {
  const entry = consultationAliases.get(sourceKey as never);
  return {
    aliasesEnglish: entry?.aliasesEnglish ?? [fallback.toLocaleLowerCase("en-US")],
    aliasesBangla: entry?.aliasesBangla ?? [fallback],
    aliasesBanglish: entry?.aliasesBanglish ?? [`${fallback.toLocaleLowerCase("en-US")} e`],
    asrRestorations: asrKeys.filter((key) => entry?.aliasesBangla.some((alias) => alias.includes(key))),
  };
}

function splitMedicineAliases(values: readonly string[], label: string) {
  const bangla = values.filter((value) => /[\u0980-\u09ff]/u.test(value));
  const english = values.filter((value) => !/[\u0980-\u09ff]/u.test(value) && !/\b(?:nam|e|te|koro|dao)\b/iu.test(value));
  const banglish = values.filter((value) => /\b(?:nam|e|te|koro|dao)\b/iu.test(value));
  return {
    aliasesEnglish: english.length ? english : [label.toLocaleLowerCase("en-US")],
    aliasesBangla: bangla.length ? bangla : [`${label} ঘর`],
    aliasesBanglish: banglish.length ? banglish : [`${label.toLocaleLowerCase("en-US")} e`],
    asrRestorations: asrKeys.filter((key) => bangla.some((alias) => alias.includes(key))),
  };
}

function surface(input: Omit<VoiceSurfaceEntry, "aliasesEnglish" | "aliasesBangla" | "aliasesBanglish" | "asrRestorations"> & {
  en: readonly string[]; bn: readonly string[]; bl: readonly string[];
}): VoiceSurfaceEntry {
  const { en, bn, bl, ...entry } = input;
  return { ...entry, aliasesEnglish: en, aliasesBangla: bn, aliasesBanglish: bl, asrRestorations: asrKeys.filter((key) => bn.some((alias) => alias.includes(key))) };
}

function control(
  canonicalId: string, page: VoiceSurfaceEntry["page"], section: string, uiLabel: string,
  controlType: VoiceSurfaceEntry["controlType"], sourceKey: string, editable: boolean,
  flags: Partial<Pick<VoiceSurfaceEntry, "readable" | "clearable" | "replaceable" | "nextPreviousEligible">>,
  existingProtectedAction: string | null, en: readonly string[], bn: readonly string[], bl: readonly string[],
): VoiceSurfaceEntry {
  return surface({ canonicalId, page, section, uiLabel, controlType, sourceKey, editable, targetable: true,
    readable: flags.readable ?? true, clearable: flags.clearable ?? editable, replaceable: flags.replaceable ?? editable,
    nextPreviousEligible: flags.nextPreviousEligible ?? false, existingProtectedAction, en, bn, bl });
}

const noteEntries: VoiceSurfaceEntry[] = SECTIONS.map((field) => ({
  canonicalId: `consultation.note.${field.key}`, page: "consultation", section: "current visit", uiLabel: field.label,
  controlType: "textarea", sourceKey: field.key, editable: true, targetable: true, readable: true, clearable: true,
  replaceable: true, nextPreviousEligible: true, existingProtectedAction: null, ...aliases(field.key, field.label),
}));

const vitalEntries: VoiceSurfaceEntry[] = VITALS.map((field) => ({
  canonicalId: `consultation.vital.${field.key}`, page: "consultation", section: "vitals", uiLabel: field.label,
  controlType: "number", sourceKey: field.key, editable: true, targetable: true, readable: true, clearable: true,
  replaceable: true, nextPreviousEligible: field.key !== "vitalSystolic" && field.key !== "vitalDiastolic",
  existingProtectedAction: null, ...aliases(field.key, field.label),
}));

const medicineEntries: VoiceSurfaceEntry[] = MEDICINE_FIELDS.map((field) => ({
  canonicalId: `prescription.medicine.${field.key}`, page: "prescription", section: "medicine editor", uiLabel: field.label,
  controlType: field.multiline ? "textarea" : "text", sourceKey: field.key, editable: true, targetable: true,
  readable: true, clearable: true, replaceable: true, nextPreviousEligible: true,
  existingProtectedAction: "visible Add medicine or Save changes", ...splitMedicineAliases(M6E_FIELD_ALIASES[field.key], field.label),
}));

export const M6F_VOICE_SURFACE_INVENTORY: readonly VoiceSurfaceEntry[] = [
  ...noteEntries,
  control("consultation.followUp.section", "consultation", "follow-up", "Follow-up", "action", "followUp", false, {}, null, ["follow-up", "next visit"], ["ফলো আপ", "পরবর্তী ভিজিট"], ["follow up e"]),
  control("consultation.followUp.date", "consultation", "follow-up", "Follow-up date", "date", NEXT_VISIT_DATE, true, { nextPreviousEligible: false }, null, ["follow-up date", "next visit date"], ["ফলো আপ তারিখ", "পরবর্তী ভিজিটের তারিখ"], ["follow up date e"]),
  control("consultation.followUp.note", "consultation", "follow-up", "Follow-up note", "text", "nextVisitNote", true, { nextPreviousEligible: true }, null, ["follow-up note", "next visit note"], ["ফলো আপ নোট"], ["follow up note e"]),
  control("consultation.vitals.section", "consultation", "vitals", "Vitals", "action", "vitals", false, {}, null, ["vitals"], ["ভাইটালস"], ["vitals e"]),
  control("consultation.vitals.bloodPressure", "consultation", "vitals", "Blood pressure", "action", "bloodPressure", false, { nextPreviousEligible: true }, null, ["blood pressure", "BP"], ["রক্তচাপ", "ব্লাড প্রেসার"], ["bp te"]),
  ...vitalEntries,
  control("consultation.vitals.more", "consultation", "vitals", "More vitals", "action", "moreVitals", false, {}, null, ["more vitals"], ["আরও ভাইটালস"], ["more vitals kholo"]),
  control("consultation.diagnosis.section", "consultation", "diagnosis", "Diagnosis", "list", "diagnoses", false, {}, "Add diagnosis", ["diagnosis", "diagnosis list"], ["রোগ নির্ণয়", "ডায়াগনসিস"], ["diagnosis e"]),
  control("consultation.diagnosis.title", "consultation", "diagnosis", "Diagnosis name", "text", "diagnosisTitle", true, { nextPreviousEligible: true }, "Add diagnosis", ["diagnosis title", "diagnosis name"], ["রোগ নির্ণয়ের নাম"], ["diagnosis title e"]),
  control("consultation.diagnosis.certainty", "consultation", "diagnosis", "Diagnosis certainty", "radio", "diagnosisCertainty", true, { clearable: false, replaceable: true, nextPreviousEligible: true }, "Add diagnosis", ["diagnosis certainty", "certainty"], ["নিশ্চিততা"], ["certainty te"]),
  control("consultation.diagnosis.note", "consultation", "diagnosis", "Diagnosis note", "textarea", "diagnosisNote", true, { nextPreviousEligible: true }, "Add diagnosis", ["diagnosis note"], ["ডায়াগনসিস নোট"], ["diagnosis note e"]),
  control("consultation.investigation.section", "consultation", "investigation", "Investigation", "list", "investigations", false, {}, "Confirm investigations", ["investigation", "test order"], ["ইনভেস্টিগেশন", "টেস্ট অর্ডার"], ["investigation e"]),
  control("consultation.investigation.search", "consultation", "investigation", "Investigation search", "text", "investigationSearch", true, {}, "stage result explicitly", ["investigation search", "test search"], ["ইনভেস্টিগেশন সার্চ", "টেস্ট সার্চ"], ["investigation search e"]),
  control("consultation.investigation.stagedList", "consultation", "investigation", "Staged investigations", "list", "stagedInvestigations", false, { nextPreviousEligible: true }, "Confirm investigations", ["staged investigations"], ["স্টেজড ইনভেস্টিগেশন"], ["staged investigation list"]),
  control("consultation.investigation.stagedTitle", "consultation", "investigation", "Staged investigation title", "text", "stagedInvestigationTitle", true, {}, "Confirm investigations", ["staged investigation title"], ["স্টেজড পরীক্ষার নাম"], ["staged investigation title e"]),
  control("consultation.investigation.stagedNote", "consultation", "investigation", "Staged investigation note", "textarea", "stagedInvestigationNote", true, {}, "Confirm investigations", ["staged investigation note"], ["স্টেজড পরীক্ষার নোট"], ["staged investigation note e"]),
  control("consultation.investigation.confirmedTitle", "consultation", "investigation", "Confirmed investigation title", "text", "confirmedInvestigationTitle", true, {}, "Save correction", ["confirmed investigation title"], ["নিশ্চিত পরীক্ষার নাম"], ["confirmed investigation title e"]),
  control("consultation.investigation.confirmedNote", "consultation", "investigation", "Confirmed investigation note", "textarea", "confirmedInvestigationNote", true, {}, "Save correction", ["confirmed investigation note"], ["নিশ্চিত পরীক্ষার নোট"], ["confirmed investigation note e"]),
  control("consultation.investigation.confirm", "consultation", "investigation", "Confirm investigations", "action", "confirmInvestigations", false, {}, "visible Confirm investigations button", ["confirm investigations"], ["পরীক্ষা নিশ্চিত করো"], ["investigation confirm koro"]),
  control("consultation.prescription.open", "consultation", "prescription", "Write prescription", "action", "prescription", false, {}, "opens draft only", ["write prescription", "open prescription"], ["প্রেসক্রিপশন খোলো"], ["prescription kholo"]),
  control("prescription.medicines.section", "prescription", "medicines", "Medicines", "list", "medicines", false, { nextPreviousEligible: true }, "saved list only", ["medicines", "medicine list"], ["ওষুধ", "মেডিসিন"], ["medicine list e"]),
  control("prescription.medicine.form", "prescription", "medicine editor", "New/Edit medicine form", "action", "editor", false, {}, "visible Add medicine or Save changes", ["new medicine", "medicine form"], ["নতুন ওষুধ", "মেডিসিন ফর্ম"], ["medicine add koro"]),
  ...medicineEntries,
  control("prescription.medicine.prn", "prescription", "medicine editor", "As needed (PRN)", "checkbox", "isPrn", true, { clearable: true, replaceable: true, nextPreviousEligible: true }, "draft toggle only", ["PRN", "as needed"], ["প্রয়োজনে"], ["proyojone"]),
  control("prescription.medicine.substitution", "prescription", "medicine editor", "Substitution allowed", "checkbox", "substitutionAllowed", true, { clearable: true, replaceable: true, nextPreviousEligible: true }, "draft toggle only", ["substitution allowed", "no substitution"], ["বিকল্প ব্র্যান্ড চলবে", "বিকল্প নয়"], ["substitution allow koro"]),
  control("prescription.results", "prescription", "results", "Medicine variants", "list", "variantMatches", false, { nextPreviousEligible: true }, "selection stages draft only", ["medicine variants", "medicine results"], ["মেডিসিন ভ্যারিয়েন্ট"], ["variant gulo"]),
  control("prescription.saved", "prescription", "results", "Saved medicines", "list", "savedMedicines", false, { nextPreviousEligible: true }, "remove requires confirmation", ["saved medicines"], ["সেভ করা ওষুধ"], ["saved medicine list"]),
  control("prescription.history.signed", "prescription", "history", "Signed medicine history", "list", "signedHistory", false, { nextPreviousEligible: true }, "selection stages only", ["signed medicine history"], ["সাইনড মেডিসিন হিস্ট্রি"], ["signed medicine history kholo"]),
  control("prescription.history.reuse", "prescription", "history", "Reuse previous prescription", "action", "reuseHistory", false, {}, "reuse remains guarded", ["reuse previous prescription"], ["আগের প্রেসক্রিপশন ব্যবহার করো"], ["previous prescription reuse koro"]),
  control("prescription.history.recent", "prescription", "history", "Recent", "list", "recent", false, {}, "history view only", ["recent medicines"], ["সাম্প্রতিক ওষুধ"], ["recent medicine kholo"]),
  control("prescription.history.frequent", "prescription", "history", "Frequent", "list", "frequent", false, {}, "history view only", ["frequent medicines"], ["বেশি ব্যবহৃত ওষুধ"], ["frequent medicine kholo"]),
  control("prescription.history.favorites", "prescription", "history", "Favorites", "list", "favorites", false, {}, "selection stages only", ["favorite medicines"], ["পছন্দের ওষুধ"], ["favorite medicine kholo"]),
  control("prescription.history.mine", "prescription", "history", "My Medicines", "list", "myMedicines", false, {}, "selection stages only", ["my medicines"], ["আমার ওষুধ"], ["my medicine kholo"]),
  ...([
    ["destination", "Autopilot", "autopilot", "explicit Apply selected"], ["generate", "Generate", "generateAutopilot", "proposal only"],
    ["proposal", "Autopilot proposal", "autopilotProposal", "proposal only"], ["select", "Select proposal medicine", "selectProposal", "selection only"],
    ["edit", "Edit proposal medicine", "editProposal", "proposal only"], ["remove", "Remove proposal medicine", "removeProposal", "proposal only"],
    ["discard", "Discard proposal", "discardProposal", "discard only"], ["apply", "Apply selected", "applySelected", "explicit Apply selected"],
    ["navigation", "Next/Previous proposal", "proposalNavigation", "proposal only"],
  ] as const).map(([id, label, sourceKey, boundary]) => control(`prescription.autopilot.${id}`, "prescription", "autopilot", label, id === "proposal" ? "list" : "action", sourceKey, false, { nextPreviousEligible: id === "proposal" || id === "navigation" }, boundary, [label.toLocaleLowerCase("en-US")], [`অটোপাইলট ${label}`], [`autopilot ${id} koro`])),
  control("prescription.review", "prescription", "review", "Review / Preview", "action", "review", false, {}, "voice finalization prohibited", ["review prescription", "preview prescription"], ["প্রেসক্রিপশন রিভিউ", "প্রেসক্রিপশন প্রিভিউ"], ["prescription review koro"]),
];

export const M6F_SOURCE_TEXT_KEYS = TEXT_KEYS;
export const M6F_EDITABLE_SOURCE_KEYS = [...TEXT_KEYS, ...VITALS.map((field) => field.key), ...MEDICINE_FIELDS.map((field) => field.key), "nextVisitOn", "diagnosisTitle", "diagnosisCertainty", "diagnosisNote", "investigationSearch", "stagedInvestigationTitle", "stagedInvestigationNote", "confirmedInvestigationTitle", "confirmedInvestigationNote", "isPrn", "substitutionAllowed"] as const;
export const M6F_DISCOVERED_GAPS = M6F_VOICE_SURFACE_INVENTORY.filter((entry) => entry.editable && !entry.targetable);

export const M6F_INVENTORY_METRICS = {
  targets: M6F_VOICE_SURFACE_INVENTORY.length,
  editable: M6F_VOICE_SURFACE_INVENTORY.filter((entry) => entry.editable).length,
  unsupported: M6F_DISCOVERED_GAPS.length,
  aliasesEnglish: M6F_VOICE_SURFACE_INVENTORY.reduce((sum, entry) => sum + entry.aliasesEnglish.length, 0),
  aliasesBangla: M6F_VOICE_SURFACE_INVENTORY.reduce((sum, entry) => sum + entry.aliasesBangla.length, 0),
  aliasesBanglish: M6F_VOICE_SURFACE_INVENTORY.reduce((sum, entry) => sum + entry.aliasesBanglish.length, 0),
  asrRestorations: Object.keys(M6F_CLOSED_ASR_RESTORATIONS).length,
} as const;
