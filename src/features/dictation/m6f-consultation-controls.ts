import type { DraftKey, VitalKey } from "@/features/encounters/schema";
import { fahrenheitTextToCelsiusValue } from "@/features/encounters/temperature";
import { parseBengaliClinicalNumber } from "./bengali-clinical-number";
import { normalizeM6FCommandText, parseM6FAction, type M6FAction } from "./m6f-action-grammar";

export type M6FConsultationTarget =
  | DraftKey | "vitals" | "moreVitals" | "bloodPressure"
  | "diagnoses" | "diagnosisTitle" | "diagnosisCertainty" | "diagnosisNote"
  | "investigations" | "investigationSearch" | "stagedInvestigations"
  | "stagedInvestigationTitle" | "stagedInvestigationNote"
  | "confirmedInvestigationTitle" | "confirmedInvestigationNote"
  | "confirmInvestigations" | "prescription";

export interface M6FConsultationTargetSpec {
  target: M6FConsultationTarget;
  label: string;
  aliasesEnglish: readonly string[];
  aliasesBangla: readonly string[];
  aliasesBanglish: readonly string[];
}

export const M6F_CONSULTATION_TARGETS: readonly M6FConsultationTargetSpec[] = [
  ["chiefComplaints", "Chief complaints", ["chief complaint", "chief complaints", "complaint"], ["প্রধান অভিযোগ", "মূল অভিযোগ", "অভিযোগ"], ["chief complaint e", "complaint e"]],
  ["symptoms", "Symptoms", ["symptom", "symptoms"], ["উপসর্গ", "লক্ষণ", "উপসর্গে যাও"], ["symptom e", "symptoms e", "symptoms e jao"]],
  ["presentIllness", "History of present illness", ["history", "history of present illness", "present illness", "hpi"], ["বর্তমান অসুস্থতার ইতিহাস", "বর্তমান রোগের ইতিহাস", "হিস্ট্রি"], ["history te", "hpi te"]],
  ["pastHistory", "Past history", ["past history", "past medical history"], ["অতীত ইতিহাস", "পূর্ব ইতিহাস", "আগের রোগের ইতিহাস"], ["past history te"]],
  ["examination", "Examination", ["examination", "physical examination", "clinical examination"], ["শারীরিক পরীক্ষা", "ক্লিনিক্যাল পরীক্ষা"], ["examination e"]],
  ["assessment", "Assessment", ["assessment", "clinical impression", "impression"], ["মূল্যায়ন", "মূল্যায়ন", "ধারণা"], ["assessment e"]],
  ["advice", "Advice", ["advice", "treatment advice", "plan"], ["পরামর্শ", "উপদেশ"], ["advice e"]],
  ["nextVisitNote", "Follow-up", ["follow up", "follow-up", "follow up note", "next visit", "next visit note"], ["ফলো আপ", "ফলোআপ", "ফলো আপ নোট", "পরবর্তী ভিজিট"], ["follow up e", "follow up note e"]],
  ["nextVisitOn", "Follow-up date", ["follow up date", "follow-up date", "next visit date"], ["ফলো আপ তারিখ", "পরবর্তী ভিজিটের তারিখ"], ["follow up date e"]],
  ["vitals", "Vitals", ["vitals", "vital signs"], ["জীবনচিহ্ন", "ভাইটালস"], ["vitals e"]],
  ["bloodPressure", "Blood pressure", ["blood pressure", "bp"], ["রক্তচাপ", "ব্লাড প্রেসার"], ["blood pressure e", "bp te"]],
  ["vitalSystolic", "Systolic", ["systolic", "upper pressure"], ["সিস্টোলিক", "উপরের চাপ"], ["systolic e"]],
  ["vitalDiastolic", "Diastolic", ["diastolic", "lower pressure"], ["ডায়াস্টোলিক", "ডায়াস্টোলিক", "নিচের চাপ"], ["diastolic e"]],
  ["vitalTemperatureC", "Temperature", ["temperature", "temperature fahrenheit"], ["তাপমাত্রা", "টেম্পারেচার"], ["temperature e"]],
  ["vitalPulseBpm", "Pulse", ["pulse", "heart rate"], ["পালস", "হৃদস্পন্দন"], ["pulse e"]],
  ["vitalSpo2", "SpO2", ["spo2", "oxygen saturation", "oxygen"], ["অক্সিজেন স্যাচুরেশন", "এসপিওটু"], ["spo2 te", "oxygen saturation e"]],
  ["vitalWeightKg", "Weight", ["weight"], ["ওজন"], ["weight e"]],
  ["moreVitals", "More vitals", ["more vitals"], ["আরও ভাইটালস", "আরো ভাইটালস"], ["more vitals"]],
  ["vitalHeightCm", "Height", ["height"], ["উচ্চতা"], ["height e"]],
  ["vitalRespRate", "Respiratory rate", ["respiratory rate", "respiration rate", "breathing rate"], ["শ্বাসের হার", "রেসপিরেটরি রেট"], ["respiratory rate e"]],
  ["diagnoses", "Diagnosis", ["diagnosis", "diagnoses", "diagnosis list"], ["রোগ নির্ণয়", "রোগ নির্ণয়", "ডায়াগনসিস"], ["diagnosis e"]],
  ["diagnosisTitle", "Diagnosis name", ["diagnosis title", "diagnosis name"], ["রোগ নির্ণয়ের নাম", "ডায়াগনসিস নাম"], ["diagnosis title e"]],
  ["diagnosisCertainty", "Diagnosis certainty", ["diagnosis certainty", "certainty", "how certain"], ["নিশ্চিততা", "রোগ নির্ণয়ের নিশ্চিততা"], ["certainty te"]],
  ["diagnosisNote", "Diagnosis note", ["diagnosis note"], ["ডায়াগনসিস নোট", "রোগ নির্ণয়ের নোট"], ["diagnosis note e"]],
  ["investigations", "Investigations", ["investigation", "investigations", "test order"], ["ইনভেস্টিগেশন", "টেস্ট অর্ডার", "রক্ত পরীক্ষা"], ["investigation e"]],
  ["investigationSearch", "Investigation search", ["investigation search", "test search", "investigation title"], ["ইনভেস্টিগেশন সার্চ", "টেস্ট সার্চ", "পরীক্ষার নাম"], ["investigation search e"]],
  ["stagedInvestigations", "Staged investigations", ["staged investigations", "staged test list"], ["স্টেজড ইনভেস্টিগেশন", "পরীক্ষার খসড়া তালিকা"], ["staged investigation list"]],
  ["stagedInvestigationTitle", "Staged investigation title", ["staged investigation title", "staged test title"], ["স্টেজড পরীক্ষার নাম"], ["staged investigation title e"]],
  ["stagedInvestigationNote", "Staged investigation note", ["staged investigation note", "investigation note"], ["স্টেজড পরীক্ষার নোট", "পরীক্ষার নোট"], ["staged investigation note e"]],
  ["confirmedInvestigationTitle", "Confirmed investigation title", ["confirmed investigation title"], ["নিশ্চিত পরীক্ষার নাম"], ["confirmed investigation title e"]],
  ["confirmedInvestigationNote", "Confirmed investigation note", ["confirmed investigation note"], ["নিশ্চিত পরীক্ষার নোট"], ["confirmed investigation note e"]],
  ["confirmInvestigations", "Confirm investigations", ["confirm investigations"], ["ইনভেস্টিগেশন নিশ্চিত করো", "পরীক্ষা নিশ্চিত করো"], ["investigation confirm koro"]],
  ["prescription", "Prescription", ["prescription", "write prescription", "open prescription"], ["প্রেসক্রিপশন", "প্রেসক্রিপশন খোলো"], ["prescription kholo"]],
].map(([target, label, aliasesEnglish, aliasesBangla, aliasesBanglish]) => ({ target, label, aliasesEnglish, aliasesBangla, aliasesBanglish })) as readonly M6FConsultationTargetSpec[];

const M6F_CONSULTATION_TARGET_ORDER = M6F_CONSULTATION_TARGETS
  .map((entry) => entry.target)
  .filter((target, index, targets) => targets.indexOf(target) === index);

export function nextM6FConsultationTarget(
  current: M6FConsultationTarget,
  direction: 1 | -1,
): M6FConsultationTarget {
  const index = Math.max(0, M6F_CONSULTATION_TARGET_ORDER.indexOf(current));
  return M6F_CONSULTATION_TARGET_ORDER[
    (index + direction + M6F_CONSULTATION_TARGET_ORDER.length) % M6F_CONSULTATION_TARGET_ORDER.length
  ]!;
}

export type M6FConsultationIntent =
  | { type: "TARGET"; target: M6FConsultationTarget }
  | { type: "SET_DRAFT"; target: DraftKey; value: string }
  | { type: "SET_BP"; systolic: string; diastolic: string }
  | { type: "SET_FOLLOW_UP"; amount: number; unit: "days" | "months" }
  | { type: "CLEAR_DRAFT"; target: DraftKey }
  | { type: "READ_TARGET"; target: M6FConsultationTarget }
  | { type: "OPEN_PRESCRIPTION" }
  | { type: "PROTECTED_CONFIRM_INVESTIGATIONS" }
  | { type: "NONE" };

export interface M6FConsultationCommandContext {
  activeTarget?: M6FConsultationTarget;
  destination?: { kind: "note" | "diagnosis" | "investigation"; target: string };
}

export function m6fConsultationTargetForDestination(
  destination: NonNullable<M6FConsultationCommandContext["destination"]>,
): M6FConsultationTarget {
  if (destination.kind === "note") return destination.target as DraftKey;
  if (destination.kind === "investigation") return "investigationSearch";
  return destination.target === "title"
    ? "diagnosisTitle"
    : destination.target === "certainty"
      ? "diagnosisCertainty"
      : "diagnosisNote";
}

const ALL_ALIASES = M6F_CONSULTATION_TARGETS.flatMap((spec) =>
  [...spec.aliasesEnglish, ...spec.aliasesBangla, ...spec.aliasesBanglish]
    .map((alias) => ({ alias: normalizeM6FCommandText(alias).canonicalCommandText, target: spec.target })),
).sort((a, b) => b.alias.length - a.alias.length);

const NUMBER_WORDS: Readonly<Record<string, number>> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
  ek: 1, dui: 2, tin: 3, char: 4, pach: 5, panch: 5, choy: 6, sat: 7, at: 8, noy: 9, dosh: 10,
  ashi: 80, shottor: 70, sottor: 70, atharo: 18, chiyanobboi: 96,
  eksho: 100, duisho: 200, tinsho: 300, charsho: 400, pachsho: 500, panchsho: 500,
};

function parseNumber(text: string): number | null {
  const value = normalizeM6FCommandText(text).canonicalCommandText.replace(/\s*(?:kg|কেজি|cm|centimeter|centimeters|সেন্টিমিটার|bpm|percent|%|mmhg|°?f|fahrenheit|celsius)\s*$/iu, "").trim();
  if (/^\d+(?:\.\d+)?$/u.test(value)) return Number(value);
  const bengali = parseBengaliClinicalNumber(value);
  if (bengali !== null) return Number(bengali);
  if (NUMBER_WORDS[value] !== undefined) return NUMBER_WORDS[value]!;
  const hundred = value.match(/^(eksho|duisho|tinsho|charsho|pachsho|panchsho)(?:\s+(.+))?$/iu);
  if (hundred) {
    const base = NUMBER_WORDS[hundred[1]!.toLowerCase()]!;
    const tail = hundred[2] ? NUMBER_WORDS[hundred[2].toLowerCase()] : 0;
    return tail === undefined ? null : base + tail;
  }
  return null;
}

function targetAtStart(text: string) {
  return ALL_ALIASES.find(({ alias }) => text === alias || text.startsWith(`${alias} `)) ?? null;
}

function targetAtEnd(text: string) {
  return ALL_ALIASES.find(({ alias }) => text === alias || text.endsWith(` ${alias}`)) ?? null;
}

const EDIT_ACTIONS = new Set<M6FAction>(["WRITE", "SET", "INSERT", "APPEND", "CHANGE", "EDIT", "UPDATE", "CORRECT", "REPLACE"]);
const TARGET_ACTIONS = new Set<M6FAction>(["NAVIGATE", "TARGET", "FOCUS", "OPEN", "SHOW"]);
const CLEAR_ACTIONS = new Set<M6FAction>(["REMOVE", "DELETE", "CLEAR", "ERASE"]);

function draftTarget(target: M6FConsultationTarget): target is DraftKey {
  return ["chiefComplaints", "symptoms", "presentIllness", "pastHistory", "examination", "assessment", "advice", "nextVisitNote", "nextVisitOn",
    "vitalHeightCm", "vitalWeightKg", "vitalTemperatureC", "vitalPulseBpm", "vitalSystolic", "vitalDiastolic", "vitalRespRate", "vitalSpo2"].includes(target);
}

function canonicalVital(target: VitalKey, raw: string): string | null {
  const number = parseNumber(raw);
  if (number === null || !Number.isFinite(number)) return null;
  if (target === "vitalTemperatureC") return fahrenheitTextToCelsiusValue(String(number));
  return String(number);
}

function maySetBareVital(
  target: M6FConsultationTarget,
  context: M6FConsultationCommandContext,
): boolean {
  return context.activeTarget === target || context.activeTarget === "vitals";
}

function parseBloodPressureValues(text: string): { systolic: string; diastolic: string } | null {
  const match = text.match(/^(.+?)\s*(?:by|over|বাই|ওভার|\/|এর উপর)\s*(.+?)$/iu);
  if (!match) return null;
  const systolic = parseNumber(match[1]!);
  const diastolic = parseNumber(match[2]!);
  return systolic !== null && diastolic !== null &&
    systolic >= 60 && systolic <= 300 &&
    diastolic >= 30 && diastolic <= 200 &&
    systolic - diastolic >= 10
    ? { systolic: String(systolic), diastolic: String(diastolic) }
    : null;
}

const LABELLED_VITALS: readonly [VitalKey, RegExp][] = [
  ["vitalPulseBpm", /^(?:pulse|heart rate|পালস|হৃদস্পন্দন)\s+(.+)$/iu],
  ["vitalTemperatureC", /^(?:temperature|temperature fahrenheit|তাপমাত্রা|টেম্পারেচার)\s+(.+)$/iu],
  ["vitalSpo2", /^(?:spo2|oxygen saturation|oxygen|অক্সিজেন স্যাচুরেশন|এসপিওটু)\s+(.+)$/iu],
  ["vitalWeightKg", /^(?:weight|ওজন)\s+(.+)$/iu],
  ["vitalHeightCm", /^(?:height|উচ্চতা)\s+(.+)$/iu],
  ["vitalRespRate", /^(?:respiratory rate|respiration rate|breathing rate|শ্বাসের হার|রেসপিরেটরি রেট)\s+(.+)$/iu],
  ["vitalSystolic", /^(?:systolic|upper pressure|সিস্টোলিক|উপরের চাপ)\s+(.+)$/iu],
  ["vitalDiastolic", /^(?:diastolic|lower pressure|ডায়াস্টোলিক|ডায়াস্টোলিক|নিচের চাপ)\s+(.+)$/iu],
];

export function parseM6FConsultationCommand(
  rawTranscript: string,
  context: M6FConsultationCommandContext = {},
): M6FConsultationIntent {
  const { canonicalCommandText: text } = normalizeM6FCommandText(rawTranscript);
  if (!text) return { type: "NONE" };

  const followUp = text.match(/^(?:follow up date|follow up তারিখ|follow-up date|next visit date|পরবর্তী ভিজিটের তারিখ)\s+(.+?)(?:\s+(?:dao|দাও|দিন|set|koro|করো))?$/iu);
  if (followUp) {
    const relative = followUp[1]!.trim();
    if (["tomorrow", "kal", "agamikal", "কাল", "আগামীকাল"].includes(relative)) return { type: "SET_FOLLOW_UP", amount: 1, unit: "days" };
    if (["day after tomorrow", "porshu", "পরশু"].includes(relative)) return { type: "SET_FOLLOW_UP", amount: 2, unit: "days" };
    const interval = relative.match(/^(.+?)\s+(day|days|din|দিন|week|weeks|shoptaho|soptaho|সপ্তাহ|month|months|mash|mas|মাস)(?:\s+(?:later|after|pore|পর|পরে))?$/iu);
    if (interval) {
      const amount = parseNumber(interval[1]!);
      if (amount !== null && amount > 0) {
        const unit = interval[2]!.toLocaleLowerCase("en-US");
        if (/^(?:month|months|mash|mas|মাস)$/iu.test(unit)) return { type: "SET_FOLLOW_UP", amount, unit: "months" };
        return { type: "SET_FOLLOW_UP", amount: /^(?:week|weeks|shoptaho|soptaho|সপ্তাহ)$/iu.test(unit) ? amount * 7 : amount, unit: "days" };
      }
    }
  }

  const explicitBp = text.match(/^(?:set|record|write)\s+(?:blood pressure|bp|রক্তচাপ)\s+(.+)$/iu)
    ?? text.match(/^(?:blood pressure|bp|রক্তচাপ)\s+(.+?)\s+(?:set koro|set korun|set করো|set করুন|dao|দাও|din|দিন)$/iu);
  if (explicitBp) {
    const values = parseBloodPressureValues(explicitBp[1]!);
    if (values) return { type: "SET_BP", ...values };
  }

  const labelledBp = text.match(/^(?:blood pressure|bp|রক্তচাপ)\s+(.+)$/iu);
  if (labelledBp && maySetBareVital("bloodPressure", context)) {
    const values = parseBloodPressureValues(labelledBp[1]!);
    if (values) return { type: "SET_BP", ...values };
  }

  if (context.activeTarget === "bloodPressure") {
    const values = parseBloodPressureValues(text);
    if (values) return { type: "SET_BP", ...values };
  }

  for (const [target, pattern] of LABELLED_VITALS) {
    const labelled = text.match(pattern);
    if (!labelled || !maySetBareVital(target, context)) continue;
    const value = canonicalVital(target, labelled[1]!);
    if (value !== null) return { type: "SET_DRAFT", target, value };
  }

  if (context.activeTarget?.startsWith("vital") && draftTarget(context.activeTarget)) {
    const value = canonicalVital(context.activeTarget as VitalKey, text);
    if (value !== null) return { type: "SET_DRAFT", target: context.activeTarget, value };
  }

  const direct = targetAtStart(text);
  if (direct && text !== direct.alias) {
    const remainder = text.slice(direct.alias.length).trim()
      .replace(/^(?:to|as|value|set|write|put|দাও|দিন|dao|din)\s+/iu, "")
      .replace(/\s+(?:set|write|put|করো|করুন|koro|dao|দাও|দিন)$/iu, "").trim();
    if (/^(?:go|jao|jan|যাও|যান|kholo|খোলো)$/iu.test(remainder)) return { type: "TARGET", target: direct.target };
    if (remainder && draftTarget(direct.target)) {
      if (direct.target.startsWith("vital")) {
        const explicitSuffix = /\s+(?:set koro|set korun|set করো|set করুন|dao|দাও|din|দিন)$/iu.test(text);
        if (!explicitSuffix && !maySetBareVital(direct.target, context)) return { type: "NONE" };
        const value = canonicalVital(direct.target as VitalKey, remainder);
        if (value !== null) return { type: "SET_DRAFT", target: direct.target, value };
      } else if (direct.target === "nextVisitOn") {
        // Relative dates remain owned by the frozen timezone-aware M6D path.
      } else return { type: "SET_DRAFT", target: direct.target, value: remainder };
    }
  }

  const action = parseM6FAction(text);
  if (action) {
    const after = targetAtStart(action.targetText);
    const before = targetAtEnd(action.targetText);
    const resolved = after ?? before;
    if (resolved) {
      if (resolved.target === "prescription" && (TARGET_ACTIONS.has(action.action) || action.action === "WRITE")) return { type: "OPEN_PRESCRIPTION" };
      if (resolved.target === "confirmInvestigations") return { type: "PROTECTED_CONFIRM_INVESTIGATIONS" };
      if (TARGET_ACTIONS.has(action.action)) return { type: "TARGET", target: resolved.target };
      if (action.action === "READ") return { type: "READ_TARGET", target: resolved.target };
      if (CLEAR_ACTIONS.has(action.action) && draftTarget(resolved.target)) return { type: "CLEAR_DRAFT", target: resolved.target };
      if (EDIT_ACTIONS.has(action.action) && draftTarget(resolved.target)) {
        const value = action.targetText.replace(resolved.alias, "").replace(/^(?:to|as)\s+/iu, "").trim();
        if (value) {
          if (resolved.target.startsWith("vital")) {
            const canonical = canonicalVital(resolved.target as VitalKey, value);
            if (canonical !== null) return { type: "SET_DRAFT", target: resolved.target, value: canonical };
          } else if (resolved.target !== "nextVisitOn") return { type: "SET_DRAFT", target: resolved.target, value };
        }
      }
    }
  }

  const exact = targetAtStart(text);
  return exact && exact.alias === text ? { type: "TARGET", target: exact.target } : { type: "NONE" };
}
