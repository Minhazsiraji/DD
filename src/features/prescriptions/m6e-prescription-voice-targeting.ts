import { MEDICINE_FIELDS, type MedicineField } from "./schema";
import {
  canonicalizeM6EScheduleSpeech,
  parseM6EPrescriptionVoice,
  parseStructuredMedicineSpeech,
  type M6EPrescriptionVoiceIntent,
  type M6EVoiceMedicineField,
  type M6EVoiceParseContext,
} from "./m6e-prescription-voice-contract";

export type M6EVoiceDestination =
  | { kind: "MEDICINES"; medicineIndex: number | null }
  | { kind: "MEDICINE_FORM"; medicineIndex: number | null }
  | { kind: "MEDICINE_FIELD"; medicineIndex: number | null; field: M6EVoiceMedicineField }
  | { kind: "AUTOPILOT" };

export type M6EVoiceDestinationKind = M6EVoiceDestination["kind"];

export type M6EExpandedVoiceIntent =
  | M6EPrescriptionVoiceIntent
  | { type: "NEXT_SECTION" }
  | { type: "PREVIOUS_SECTION" }
  | { type: "NEXT_FIELD" }
  | { type: "PREVIOUS_FIELD" }
  | { type: "READ_FIELD"; field: M6EVoiceMedicineField };

export interface M6EExpandedVoiceContext extends M6EVoiceParseContext {
  destinationKind: M6EVoiceDestinationKind;
}

export const M6E_VOICE_FIELD_ORDER = MEDICINE_FIELDS.map((field) => field.key) as readonly MedicineField[];

export const M6E_VOICE_FIELD_LABELS: Record<M6EVoiceMedicineField, string> = {
  displayName: "Medicine name",
  brandName: "Brand",
  genericName: "Generic",
  strengthText: "Strength",
  doseText: "Dose",
  dosageForm: "Dosage form",
  route: "Route",
  scheduleText: "Schedule / Frequency",
  durationText: "Duration",
  quantityText: "Quantity",
  foodRelation: "Food relation",
  instructions: "Instructions",
};

export type M6EVoiceTargetOption = { value: string; label: string };

export function m6eVoiceTargetValue(destination: M6EVoiceDestination): string {
  if (destination.kind === "MEDICINE_FIELD") return `FIELD:${destination.field}`;
  return destination.kind;
}

export function m6eVoiceTargetOptions(editorOpen: boolean): readonly M6EVoiceTargetOption[] {
  const base: M6EVoiceTargetOption[] = [{ value: "MEDICINES", label: "Medicines" }];
  if (editorOpen) {
    base.push({ value: "MEDICINE_FORM", label: "Medicine" });
    for (const field of M6E_VOICE_FIELD_ORDER) {
      base.push({ value: `FIELD:${field}`, label: M6E_VOICE_FIELD_LABELS[field] });
    }
  }
  base.push({ value: "AUTOPILOT", label: "Autopilot" });
  return base;
}

const MEDICINES = [
  "medicine", "medicines", "medicine section", "go to medicine", "go to medicines",
  "go to medicine section", "open medicine section", "open medicines",
  "মেডিসিন", "মেডিসিন সেকশন", "মেডিসিনে যাও", "মেডিসিন সেকশনে যাও",
  "medicine e jao", "medicine section e jao", "medicine section kholo",
];
const AUTOPILOT = [
  "autopilot", "go to autopilot", "autopilot section", "autopilot proposal",
  "অটোপাইলট", "অটোপাইলট সেকশন", "autopilot e jao",
];
const NEXT_SECTION = ["next section", "পরের সেকশন", "next section e jao"];
const PREVIOUS_SECTION = ["previous section", "আগের সেকশন", "previous section e jao"];
const NEXT_FIELD = ["next field", "পরের ফিল্ড", "next field e jao"];
const PREVIOUS_FIELD = ["previous field", "আগের ফিল্ড", "previous field e jao"];
const BARE_NEXT = ["next", "পরেরটা"];
const BARE_PREVIOUS = ["previous", "আগেরটা"];

const FIELD_ALIASES: Record<M6EVoiceMedicineField, readonly string[]> = {
  displayName: ["medicine name", "name", "medicine field", "ওষুধের নাম", "মেডিসিন নাম"],
  brandName: ["brand", "brand name", "ব্র্যান্ড"],
  genericName: ["generic", "generic name", "জেনেরিক"],
  strengthText: ["strength", "strength field", "স্ট্রেংথ", "শক্তি"],
  doseText: ["dose", "dose field", "ডোজ"],
  dosageForm: ["dosage form", "form", "form field", "ডোজ ফর্ম", "ফর্ম"],
  route: ["route", "route field", "রুট"],
  scheduleText: ["frequency", "schedule", "frequency field", "schedule field", "ফ্রিকোয়েন্সি", "ফ্রিকোয়েন্সি", "সিডিউল"],
  durationText: ["duration", "duration field", "ডিউরেশন", "সময়কাল", "সময়কাল"],
  quantityText: ["quantity", "quantity field", "পরিমাণ"],
  foodRelation: ["food relation", "food", "food field", "after food field", "খাবার", "খাবারের সাথে"],
  instructions: ["instructions", "instruction", "instructions field", "নির্দেশনা", "ইনস্ট্রাকশন"],
};

function normalizeCommand(text: string) {
  return text.normalize("NFC").trim().replace(/[.।!?]+$/gu, "").replace(/\s+/gu, " ").toLocaleLowerCase("en-US");
}

function exact(value: string, options: readonly string[]) {
  return options.includes(value);
}

function fieldFromTargetCommand(value: string): M6EVoiceMedicineField | null {
  for (const field of M6E_VOICE_FIELD_ORDER) {
    for (const alias of FIELD_ALIASES[field]) {
      if (
        value === alias ||
        value === `go to ${alias}` ||
        value === `${alias} e jao` ||
        value === `${alias} এ যাও`
      ) return field;
    }
  }
  return null;
}

function fieldFromReadCommand(value: string): M6EVoiceMedicineField | null {
  for (const field of M6E_VOICE_FIELD_ORDER) {
    for (const alias of FIELD_ALIASES[field]) {
      if (value === `read ${alias}` || value === `${alias} read`) return field;
    }
  }
  return null;
}

function fieldFromClearCommand(value: string): M6EVoiceMedicineField | null {
  for (const field of M6E_VOICE_FIELD_ORDER) {
    for (const alias of FIELD_ALIASES[field]) {
      if (value === `clear ${alias}` || value === `${alias} clear` || value === `${alias} clear koro`) return field;
    }
  }
  return null;
}

const STRUCTURED_TARGET_FIELDS = new Set<M6EVoiceMedicineField>([
  "strengthText", "doseText", "dosageForm", "route", "scheduleText", "durationText", "foodRelation",
]);

export function canonicalizeM6ETargetedFieldValue(field: M6EVoiceMedicineField, spoken: string): string {
  if (!STRUCTURED_TARGET_FIELDS.has(field)) return spoken;
  if (field === "scheduleText") {
    const schedule = canonicalizeM6EScheduleSpeech(spoken);
    if (schedule) return schedule;
  }
  const patch = parseStructuredMedicineSpeech(`Add medicine VoiceTarget ${spoken}`);
  const structured = patch?.[field];
  return typeof structured === "string" && structured.trim() ? structured : spoken;
}

export function parseM6EPrescriptionVoiceTargeting(
  text: string,
  context: M6EExpandedVoiceContext,
): M6EExpandedVoiceIntent {
  const raw = text.normalize("NFC").trim();
  const value = normalizeCommand(raw);
  if (!raw) return { type: "UNKNOWN", rawText: raw };

  if (exact(value, NEXT_SECTION)) return { type: "NEXT_SECTION" };
  if (exact(value, PREVIOUS_SECTION)) return { type: "PREVIOUS_SECTION" };
  if (exact(value, MEDICINES)) return { type: "TARGET_MEDICINES" };
  if (exact(value, AUTOPILOT)) return { type: "TARGET_AUTOPILOT" };

  if (exact(value, NEXT_FIELD)) return { type: "NEXT_FIELD" };
  if (exact(value, PREVIOUS_FIELD)) return { type: "PREVIOUS_FIELD" };

  if (exact(value, BARE_NEXT)) {
    if (context.destinationKind === "MEDICINE_FIELD") return { type: "NEXT_FIELD" };
    if (context.destinationKind === "MEDICINES") return { type: "NEXT_MEDICINE" };
    if (context.destinationKind === "AUTOPILOT" && context.autopilotProposalActive) return { type: "NEXT_AUTOPILOT_ITEM" };
    return { type: "UNKNOWN", rawText: raw };
  }
  if (exact(value, BARE_PREVIOUS)) {
    if (context.destinationKind === "MEDICINE_FIELD") return { type: "PREVIOUS_FIELD" };
    if (context.destinationKind === "MEDICINES") return { type: "PREVIOUS_MEDICINE" };
    if (context.destinationKind === "AUTOPILOT" && context.autopilotProposalActive) return { type: "PREVIOUS_AUTOPILOT_ITEM" };
    return { type: "UNKNOWN", rawText: raw };
  }

  const readField = fieldFromReadCommand(value);
  if (readField) return { type: "READ_FIELD", field: readField };
  if (exact(value, ["read", "read field"]) && context.fieldTarget) return { type: "READ_FIELD", field: context.fieldTarget };

  const clearField = fieldFromClearCommand(value);
  if (clearField) return { type: "CLEAR_FIELD", field: clearField };
  if (exact(value, ["clear field"]) && context.fieldTarget) return { type: "CLEAR_FIELD", field: context.fieldTarget };

  const targetField = fieldFromTargetCommand(value);
  if (targetField) return { type: "TARGET_FIELD", field: targetField };

  const base = parseM6EPrescriptionVoice(raw, context);
  if (base.type === "SET_FIELD") {
    return {
      ...base,
      value: canonicalizeM6ETargetedFieldValue(base.field, base.value),
    };
  }
  if (base.type === "REPLACE_FIELD" && context.fieldTarget) {
    return {
      ...base,
      from: canonicalizeM6ETargetedFieldValue(context.fieldTarget, base.from),
      to: canonicalizeM6ETargetedFieldValue(context.fieldTarget, base.to),
    };
  }
  return base;
}
