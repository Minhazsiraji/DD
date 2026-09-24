import { M6D_COMMAND_ALIASES, M6D_SECTION_ALIASES } from "./m6d-command-catalogue";
import { parseBengaliClinicalNumber } from "./bengali-clinical-number";

export type M6DTarget =
  | "chiefComplaints"
  | "presentIllness"
  | "pastHistory"
  | "examination"
  | "assessment"
  | "advice"
  | "nextVisitNote";

export const M6D_TARGETS: readonly M6DTarget[] = [
  "chiefComplaints", "presentIllness", "pastHistory", "examination", "assessment", "advice", "nextVisitNote",
];

export type M6DNavigationIntent =
  | { type: "NAVIGATE"; target: M6DTarget }
  | { type: "NEXT" }
  | { type: "PREVIOUS" };

export type M6DStandaloneControlIntent =
  | { type: "PAUSE" }
  | { type: "RESUME" }
  | { type: "END" }
  | { type: "UNDO" }
  | { type: "REMOVE_LAST_SENTENCE" };

export type M6DDiagnosisIntent =
  | { type: "DIAGNOSIS_NAVIGATE" }
  | { type: "DIAGNOSIS_TARGET"; target: "title" | "certainty" | "note" }
  | { type: "DIAGNOSIS_CERTAINTY"; certainty: "PROVISIONAL" | "WORKING" | "CONFIRMED" | "RULED_OUT" }
  | { type: "DIAGNOSIS_REVIEW" };

export type M6DInvestigationIntent =
  | { type: "INVESTIGATION_NAVIGATE" }
  | { type: "INVESTIGATION_TARGET"; target: "field" };

export type M6DExtendedSection = "diagnoses" | "investigations";

export type M6DLocalIntent =
  | M6DNavigationIntent
  | M6DStandaloneControlIntent
  | M6DDiagnosisIntent
  | M6DInvestigationIntent
  | { type: "FOLLOW_UP_DATE"; amount: number; unit: "days" | "months" }
  | { type: "NOTE_EDIT"; operation: "ADD" | "REMOVE" | "REPLACE" | "REPLACE_LAST" | "CLEAR" | "READ"; value?: string; replacement?: string }
  | { type: "NONE" };

const SECTION_ALIASES = Object.entries(M6D_SECTION_ALIASES) as [M6DTarget, readonly string[]][];

export interface M6DCommandContext {
  activeTarget?: M6DTarget;
}

function clean(text: string) {
  return text.normalize("NFC").trim().replace(/[.।!?]+$/g, "").replace(/\s+/g, " ");
}

export function isM6DCommandLikeUtterance(text: string): boolean {
  const raw = clean(text);
  if (!raw) return false;
  const value = raw.toLocaleLowerCase("en-US");
  if (/^(?:please\s+)?(?:add|prescribe|order|open|go\s+to|finali[sz]e|delete|change|edit|modify|replace|remove|clear|read|bypass|skip)\b/i.test(value)) return true;
  if (/(?:^|\s)follow[- ]?up(?:\s|$)/i.test(value)) return true;
  return /(?:যোগ|দাও|করো|খোলো|যাও|মুছ|পরিবর্তন|বদল|পড়ো|প্রেসক্রিপশন)/u.test(raw);
}

export function nextM6DTarget(current: M6DTarget, direction: 1 | -1): M6DTarget {
  const index = Math.max(0, M6D_TARGETS.indexOf(current));
  return M6D_TARGETS[(index + direction + M6D_TARGETS.length) % M6D_TARGETS.length]!;
}

export function isM6DNavigationIntent(intent: M6DLocalIntent): intent is M6DNavigationIntent {
  return intent.type === "NAVIGATE" || intent.type === "NEXT" || intent.type === "PREVIOUS";
}

export function isM6DStandaloneControlIntent(intent: M6DLocalIntent): intent is M6DStandaloneControlIntent {
  return intent.type === "PAUSE" || intent.type === "RESUME" || intent.type === "END" ||
    intent.type === "UNDO" || intent.type === "REMOVE_LAST_SENTENCE";
}

export function isM6DDiagnosisIntent(intent: M6DLocalIntent): intent is M6DDiagnosisIntent {
  return intent.type === "DIAGNOSIS_NAVIGATE" || intent.type === "DIAGNOSIS_TARGET" ||
    intent.type === "DIAGNOSIS_CERTAINTY" || intent.type === "DIAGNOSIS_REVIEW";
}

export function isM6DInvestigationIntent(intent: M6DLocalIntent): intent is M6DInvestigationIntent {
  return intent.type === "INVESTIGATION_NAVIGATE" || intent.type === "INVESTIGATION_TARGET";
}

export function resolveM6DExtendedSectionStep(
  current: M6DExtendedSection,
  direction: 1 | -1,
): M6DExtendedSection | null {
  if (current === "diagnoses" && direction === 1) return "investigations";
  if (current === "investigations" && direction === -1) return "diagnoses";
  return null;
}

export function removeM6DLastSentence(text: string): string {
  const trimmed = text.trimEnd();
  if (!trimmed) return "";
  const withoutTrailingStop = trimmed.replace(/[.!?।]+$/u, "").trimEnd();
  const punctuationBoundary = Math.max(
    withoutTrailingStop.lastIndexOf("."),
    withoutTrailingStop.lastIndexOf("!"),
    withoutTrailingStop.lastIndexOf("?"),
    withoutTrailingStop.lastIndexOf("।"),
  );
  const lineBoundary = withoutTrailingStop.lastIndexOf("\n");
  const boundary = Math.max(punctuationBoundary, lineBoundary);
  if (boundary < 0) return "";
  return withoutTrailingStop.slice(0, boundary === lineBoundary ? boundary : boundary + 1).trimEnd();
}

export function m6dNavigationCommandKey(intent: M6DNavigationIntent): string {
  return intent.type === "NAVIGATE" ? `NAVIGATE:${intent.target}` : intent.type;
}

export function resolveM6DNavigationTarget(intent: M6DNavigationIntent, current: M6DTarget): M6DTarget {
  if (intent.type === "NAVIGATE") return intent.target;
  return nextM6DTarget(current, intent.type === "NEXT" ? 1 : -1);
}

function sectionFromAlias(value: string): M6DTarget | null {
  for (const [target, aliases] of SECTION_ALIASES) if (aliases.includes(value)) return target;
  return null;
}

function isAlias(value: string, aliases: readonly string[]): boolean {
  return aliases.includes(value);
}

function parseRelativeAmount(raw: string): number | null {
  const normalized = raw.toLocaleLowerCase("en-US").trim();
  const asciiDigits = normalized.replace(/[০-৯]/g, (digit) => String("০১২৩৪৫৬৭৮৯".indexOf(digit)));
  if (/^\d{1,3}$/.test(asciiDigits)) return Number(asciiDigits);
  const words: Record<string, number> = {
    one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
    eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, twenty: 20, thirty: 30,
    ek: 1, dui: 2, tin: 3,
    "এক": 1, "একটি": 1, "দুই": 2, "দুটি": 2, "তিন": 3, "চার": 4, "পাঁচ": 5, "ছয়": 6, "ছয়": 6, "সাত": 7, "আট": 8, "নয়": 9, "নয়": 9, "দশ": 10, "চৌদ্দ": 14, "ত্রিশ": 30,
  };
  const bengali = parseBengaliClinicalNumber(normalized);
  return words[normalized] ?? (bengali === null ? null : Number(bengali));
}

function stripNavigationPrefix(value: string): string {
  return value
    .replace(/^(?:go to|open|show|move to|switch to)\s+/i, "")
    .replace(/^(?:যাও|খোলো|দেখাও|যান|খুলুন)\s+/u, "")
    .trim();
}

function relativeDate(amount: number, unit: string): M6DLocalIntent {
  return unit === "month" || unit === "months" || unit === "মাস"
    ? { type: "FOLLOW_UP_DATE", amount, unit: "months" }
    : { type: "FOLLOW_UP_DATE", amount: unit === "week" || unit === "weeks" || unit === "সপ্তাহ" ? amount * 7 : amount, unit: "days" };
}

function parseFollowUpDate(raw: string, activeTarget?: M6DTarget): M6DLocalIntent | null {
  const explicitEnglish = raw.match(/^(?:set\s+)?(?:review|next visit|next appointment|follow[- ]?up)(?:\s+date)?\s+(?:after|in)\s+([\w-]+)\s+(day|days|week|weeks|month|months)$/i);
  if (explicitEnglish) {
    const amount = parseRelativeAmount(explicitEnglish[1]!);
    return amount && amount > 0 ? relativeDate(amount, explicitEnglish[2]!.toLowerCase()) : null;
  }

  const explicitBangla = raw.match(/^(?:পরবর্তী ভিজিট|ফলো ?আপ|ফলোআপ)\s+([\p{L}\p{M}\d০-৯]+)\s*(দিন|সপ্তাহ|মাস)\s*(?:পরে|পর)?$/u);
  if (explicitBangla) {
    const amount = parseRelativeAmount(explicitBangla[1]!);
    return amount && amount > 0 ? relativeDate(amount, explicitBangla[2]!) : null;
  }

  const explicitBanglish = raw.match(/^(?:follow[- ]?up|next visit|next appointment)\s+([\w-]+)\s+(day|days|week|weeks|month|months|din)\s+(?:por|pore)$/i);
  if (explicitBanglish) {
    const amount = parseRelativeAmount(explicitBanglish[1]!);
    return amount && amount > 0 ? relativeDate(amount, explicitBanglish[2]!.toLowerCase()) : null;
  }

  if (activeTarget !== "nextVisitNote") return null;
  const contextual = raw.toLocaleLowerCase("en-US");
  if (["tomorrow", "আগামীকাল", "kal"].includes(contextual)) return { type: "FOLLOW_UP_DATE", amount: 1, unit: "days" };

  const mixedInterval = contextual.match(/^(.+?)\s+(দিন|day|days|সপ্তাহ|week|weeks|মাস|month|months)\s+(?:পরে|পর|pore|por)$/iu);
  if (mixedInterval) {
    const amount = parseRelativeAmount(mixedInterval[1]!);
    return amount && amount > 0 ? relativeDate(amount, mixedInterval[2]!.toLowerCase()) : null;
  }

  const englishInterval = contextual.match(/^(?:(?:after|in)\s+)?([\w-]+)\s+(day|days|week|weeks|month|months)$/i);
  if (englishInterval) {
    const amount = parseRelativeAmount(englishInterval[1]!);
    return amount && amount > 0 ? relativeDate(amount, englishInterval[2]!) : null;
  }

  const banglaInterval = contextual.match(/^([\p{L}\p{M}\d০-৯]+)\s*(দিন|সপ্তাহ|মাস)\s*(?:পরে|পর)$/u);
  if (banglaInterval) {
    const amount = parseRelativeAmount(banglaInterval[1]!);
    return amount && amount > 0 ? relativeDate(amount, banglaInterval[2]!) : null;
  }

  const banglishInterval = contextual.match(/^([\w-]+)\s+(din|day|days|week|weeks|month|months)\s+(?:por|pore)$/i);
  if (banglishInterval) {
    const amount = parseRelativeAmount(banglishInterval[1]!);
    return amount && amount > 0 ? relativeDate(amount, banglishInterval[2]!) : null;
  }
  return null;
}

export function parseM6DAppendText(text: string): string | null {
  const raw = clean(text);
  const patterns = [
    /^(?:add text|add note|add to note|append|include)\s+(.+)$/i,
    /^(?:add)\s+(.+)$/i,
    /^(?:নোটে যোগ করো|নোটে যোগ করুন|যোগ করো|যোগ করুন|লিখো|লিখুন)\s+(.+)$/u,
  ];
  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (match?.[1]?.trim()) return match[1].trim();
  }
  return null;
}

export function parseM6DLocalCommand(text: string, context: M6DCommandContext = {}): M6DLocalIntent {
  const raw = clean(text);
  const value = raw.toLocaleLowerCase("en-US");

  if (isAlias(value, M6D_COMMAND_ALIASES.next)) return { type: "NEXT" };
  if (isAlias(value, M6D_COMMAND_ALIASES.previous)) return { type: "PREVIOUS" };

  if (isAlias(value, M6D_COMMAND_ALIASES.pause)) return { type: "PAUSE" };
  if (isAlias(value, M6D_COMMAND_ALIASES.resume)) return { type: "RESUME" };
  if (isAlias(value, M6D_COMMAND_ALIASES.end)) return { type: "END" };
  if (isAlias(value, M6D_COMMAND_ALIASES.undo)) return { type: "UNDO" };
  if (isAlias(value, M6D_COMMAND_ALIASES.removeLastSentence)) return { type: "REMOVE_LAST_SENTENCE" };

  if (isAlias(value, M6D_COMMAND_ALIASES.diagnosisNavigate)) return { type: "DIAGNOSIS_NAVIGATE" };
  if (isAlias(value, M6D_COMMAND_ALIASES.diagnosisTitle)) return { type: "DIAGNOSIS_TARGET", target: "title" };
  if (isAlias(value, M6D_COMMAND_ALIASES.diagnosisCertainty)) return { type: "DIAGNOSIS_TARGET", target: "certainty" };
  if (isAlias(value, M6D_COMMAND_ALIASES.diagnosisNote)) return { type: "DIAGNOSIS_TARGET", target: "note" };
  if (isAlias(value, M6D_COMMAND_ALIASES.provisional)) return { type: "DIAGNOSIS_CERTAINTY", certainty: "PROVISIONAL" };
  if (isAlias(value, M6D_COMMAND_ALIASES.working)) return { type: "DIAGNOSIS_CERTAINTY", certainty: "WORKING" };
  if (isAlias(value, M6D_COMMAND_ALIASES.confirmed)) return { type: "DIAGNOSIS_CERTAINTY", certainty: "CONFIRMED" };
  if (isAlias(value, M6D_COMMAND_ALIASES.ruledOut)) return { type: "DIAGNOSIS_CERTAINTY", certainty: "RULED_OUT" };
  if (isAlias(value, M6D_COMMAND_ALIASES.diagnosisReview)) return { type: "DIAGNOSIS_REVIEW" };

  if (isAlias(value, M6D_COMMAND_ALIASES.investigationNavigate)) return { type: "INVESTIGATION_NAVIGATE" };
  if (isAlias(value, M6D_COMMAND_ALIASES.investigationField)) return { type: "INVESTIGATION_TARGET", target: "field" };

  const followUpDate = parseFollowUpDate(raw, context.activeTarget);
  if (followUpDate) return followUpDate;

  if (isAlias(value, M6D_COMMAND_ALIASES.clear)) return { type: "NOTE_EDIT", operation: "CLEAR" };
  if (isAlias(value, M6D_COMMAND_ALIASES.read)) return { type: "NOTE_EDIT", operation: "READ" };

  // Deepgram can occasionally flush the previous sentence and the next short
  // edit command in the same finalized utterance. Accept a trailing protected
  // edit only when it begins after a real sentence boundary; do not fuzzy-match
  // clinical prose in the middle of a sentence.
  let match = raw.match(/(?:^|[.!?।]\s+)(?:replace|change|correct)\s+(?:the\s+)?(?:last sentence|last line)\s+(?:with|to|by)\s+(.+)$/i);
  if (match) return { type: "NOTE_EDIT", operation: "REPLACE_LAST", replacement: match[1]!.trim() };
  match = raw.match(/(?:^|[.!?।]\s+)(?:শেষ বাক্য|শেষ লাইন)\s+(?:বদলে|পরিবর্তন করে)\s+(.+)$/u);
  if (match) return { type: "NOTE_EDIT", operation: "REPLACE_LAST", replacement: match[1]!.trim() };
  if (["replace last sentence", "replace last line", "replace the last sentence", "replace the last line", "change last sentence", "change last line", "change the last sentence", "change the last line", "correct last sentence", "correct last line", "correct the last sentence", "correct the last line", "শেষ বাক্য বদলাও", "শেষ লাইন বদলাও", "শেষ বাক্য পরিবর্তন করো", "শেষ লাইন পরিবর্তন করো"].includes(value)) {
    return { type: "NOTE_EDIT", operation: "REPLACE_LAST" };
  }

  match = raw.match(/^(?:replace|change|correct)\s+(.+?)\s+(?:with|to|by)\s+(.+)$/i);
  if (match) return { type: "NOTE_EDIT", operation: "REPLACE", value: match[1]!.trim(), replacement: match[2]!.trim() };
  match = raw.match(/^(.+?)\s+(?:এর বদলে|বদলে|পরিবর্তন করে)\s+(.+)$/u);
  if (match) return { type: "NOTE_EDIT", operation: "REPLACE", value: match[1]!.trim(), replacement: match[2]!.trim() };
  match = raw.match(/^(.+?)\s+(?:change kore|replace kore|er jaygay)\s+(.+)$/i);
  if (match) return { type: "NOTE_EDIT", operation: "REPLACE", value: match[1]!.trim(), replacement: match[2]!.trim() };

  match = raw.match(/^(?:remove|delete|erase)\s+(.+)$/i);
  if (match) return { type: "NOTE_EDIT", operation: "REMOVE", value: match[1]!.trim() };
  match = raw.match(/^(.+?)\s+(?:বাদ দাও|মুছে দাও|মুছো|সরাও)$/u);
  if (match) return { type: "NOTE_EDIT", operation: "REMOVE", value: match[1]!.trim() };

  const stripped = stripNavigationPrefix(value);
  const target = sectionFromAlias(stripped);
  if (target) return { type: "NAVIGATE", target };
  return { type: "NONE" };
}
