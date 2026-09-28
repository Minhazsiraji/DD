/**
 * M6F's deterministic multilingual command boundary.
 *
 * Only the closed control vocabulary below is restored. The raw transcript is
 * carried beside the canonical command text so clinical prose can always fall
 * through unchanged when no explicit command grammar matches.
 */

export type M6FVoiceLanguage = "english" | "bangla" | "banglish" | "mixed";

export type M6FAction =
  | "NAVIGATE" | "TARGET" | "FOCUS" | "OPEN" | "SHOW"
  | "WRITE" | "SET" | "INSERT" | "APPEND"
  | "CHANGE" | "EDIT" | "UPDATE" | "CORRECT" | "REPLACE"
  | "REMOVE" | "DELETE" | "CLEAR" | "ERASE"
  | "UNDO" | "CANCEL" | "DISCARD" | "READ"
  | "NEXT" | "PREVIOUS" | "SELECT" | "DESELECT"
  | "SEARCH" | "USE" | "PAUSE" | "RESUME" | "END"
  | "OPEN_REVIEW" | "PROHIBITED_FINALIZE";

export interface M6FNormalizedTranscript {
  rawTranscript: string;
  canonicalCommandText: string;
  language: M6FVoiceLanguage;
}

export interface M6FActionMatch extends M6FNormalizedTranscript {
  action: M6FAction;
  targetText: string;
  valueText: string;
}

const BN_DIGITS = "০১২৩৪৫৬৭৮৯";

/** Bengali-script spellings of English *controls*, never clinical prose. */
export const M6F_CLOSED_ASR_RESTORATIONS = {
  "মেডিসিন নেম": "medicine name", "ব্লাড প্রেসার": "blood pressure",
  "রেসপিরেটরি রেট": "respiratory rate", "ফলো আপ": "follow up",
  "প্রেসক্রিপশন": "prescription", "মেডিসিন": "medicine", "ব্র্যান্ড": "brand",
  "জেনেরিক": "generic", "স্ট্রেংথ": "strength", "ডোজ": "dose", "ফর্ম": "form",
  "রুট": "route", "শিডিউল": "schedule", "সিডিউল": "schedule",
  "ফ্রিকোয়েন্সি": "frequency", "ফ্রিকোয়েন্সি": "frequency", "ডিউরেশন": "duration",
  "কোয়ান্টিটি": "quantity", "কোয়ান্টিটি": "quantity", "ফুড": "food",
  "ইন্সট্রাকশন": "instruction", "ইনস্ট্রাকশন": "instruction", "ভাইটালস": "vitals",
  "সিস্টোলিক": "systolic", "ডায়াস্টোলিক": "diastolic", "ডায়াস্টোলিক": "diastolic",
  "টেম্পারেচার": "temperature", "পালস": "pulse", "এসপিওটু": "spo2",
  "ডায়াগনসিস": "diagnosis", "ডায়াগনসিস": "diagnosis", "ইনভেস্টিগেশন": "investigation",
  "অটোপাইলট": "autopilot", "রিভিউ": "review", "প্রিভিউ": "preview",
  "ক্লিয়ার": "clear", "ক্লিয়ার": "clear", "ডিলিট": "delete", "রিমুভ": "remove",
  "রিপ্লেস": "replace", "চেঞ্জ": "change", "এডিট": "edit", "আনডু": "undo",
  "ক্যানসেল": "cancel", "নেক্সট": "next", "প্রিভিয়াস": "previous",
  "প্রিভিয়াস": "previous", "সিলেক্ট": "select", "ডিসিলেক্ট": "deselect",
  "টার্গেট": "target", "ফোকাস": "focus", "সার্চ": "search", "ইউজ": "use",
  "অ্যাপ্লাই": "apply", "ডিসকার্ড": "discard", "পজ": "pause",
  "রিজিউম": "resume", "এন্ড": "end",
} as const;

const ACTION_ALIASES: Readonly<Record<M6FAction, readonly string[]>> = {
  NAVIGATE: ["go to", "move to", "যাও", "যান", "jao", "jan", "e jao"],
  TARGET: ["target", "টার্গেট"], FOCUS: ["focus", "ফোকাস"],
  OPEN: ["open", "খোলো", "খুলুন", "খুলে দাও", "খুলে দিন", "kholo", "khulun"],
  SHOW: ["show", "দেখাও", "দেখান", "dekhao"],
  WRITE: ["write", "লিখো", "লিখুন", "লিখে দাও", "লিখে দিন", "likho", "likhun", "likhe dao"],
  SET: ["set", "দাও", "দিন", "dao", "din"], INSERT: ["insert", "ঢোকাও"],
  APPEND: ["append", "add text", "যোগ করো", "যোগ করুন", "jog koro"],
  CHANGE: ["change", "বদলাও", "বদলান", "change koro"], EDIT: ["edit", "edit koro"],
  UPDATE: ["update", "আপডেট", "update koro"], CORRECT: ["correct", "সংশোধন করো"],
  REPLACE: ["replace", "প্রতিস্থাপন করো", "replace koro"],
  REMOVE: ["remove", "বাদ দাও", "বাদ দিন", "remove koro"],
  DELETE: ["delete", "মুছো", "মুছুন", "মুছে দাও", "মুছে দিন", "delete koro", "muche dao"],
  CLEAR: ["clear", "খালি করো", "খালি করুন", "clear koro"], ERASE: ["erase"],
  UNDO: ["undo", "undo koro", "শেষটা ফেরত"], CANCEL: ["cancel", "বাতিল", "cancel koro"],
  DISCARD: ["discard", "discard koro", "ফেলে দাও"],
  READ: ["read", "পড়ো", "পড়ো", "পড়ুন", "পড়ুন", "পড়ে শোনাও", "পড়ে শোনাও", "pore shonao", "poro"],
  NEXT: ["next", "পরের", "পরবর্তী", "next e jao"], PREVIOUS: ["previous", "আগের", "ager field", "previous e jao"],
  SELECT: ["select", "বেছে নাও", "নাও", "select koro"], DESELECT: ["deselect", "unselect", "বাদ দাও"],
  SEARCH: ["search", "find", "lookup", "খুঁজো", "খুঁজুন", "khojo", "search koro"],
  USE: ["use", "ব্যবহার করো", "নাও", "use koro"], PAUSE: ["pause", "বিরতি", "একটু থামো", "pause koro"],
  RESUME: ["resume", "continue voice", "আবার শুরু করো", "চালিয়ে যাও", "চালিয়ে যাও", "resume koro"],
  END: ["end voice", "stop voice", "ভয়েস বন্ধ করো", "ভয়েস বন্ধ করো", "voice bondho koro"],
  OPEN_REVIEW: ["open review", "review prescription", "preview prescription", "prescription review koro"],
  PROHIBITED_FINALIZE: ["finalize prescription", "finalise prescription", "sign prescription", "complete prescription", "finish prescription", "prescription final koro"],
};

const SORTED_ACTIONS = (Object.entries(ACTION_ALIASES) as [M6FAction, readonly string[]][])
  .flatMap(([action, aliases]) => aliases.map((alias) => ({ action, alias })))
  .sort((a, b) => b.alias.length - a.alias.length);

function clean(text: string): string {
  return text.normalize("NFC").replace(/[০-৯]/gu, (digit) => String(BN_DIGITS.indexOf(digit)))
    .replace(/[,.।!?;:]+$/gu, "").replace(/\s+/gu, " ").trim();
}

function languageOf(text: string): M6FVoiceLanguage {
  const bangla = /[\u0980-\u09ff]/u.test(text);
  const latin = /[a-z]/iu.test(text);
  if (bangla && latin) return "mixed";
  if (bangla) return "bangla";
  if (/\b(?:koro|korun|dao|din|jao|jan|kholo|khulun|likho|pore|ager|khojo|nao)\b/iu.test(text)) return "banglish";
  return "english";
}

export function normalizeM6FCommandText(rawTranscript: string): M6FNormalizedTranscript {
  const raw = clean(rawTranscript);
  let canonical = raw.toLocaleLowerCase("en-US");
  for (const [spoken, restored] of Object.entries(M6F_CLOSED_ASR_RESTORATIONS).sort((a, b) => b[0].length - a[0].length)) {
    canonical = canonical.replaceAll(spoken, restored);
  }
  return { rawTranscript: raw, canonicalCommandText: canonical, language: languageOf(raw) };
}

function exactAction(value: string): { action: M6FAction; alias: string } | null {
  return SORTED_ACTIONS.find(({ alias }) => value === alias) ?? null;
}

/**
 * Parses only explicit command shapes. Target resolution is deliberately left
 * to page-specific closed alias tables.
 */
export function parseM6FAction(rawTranscript: string): M6FActionMatch | null {
  const normalized = normalizeM6FCommandText(rawTranscript);
  const text = normalized.canonicalCommandText;
  if (!text) return null;

  const exact = exactAction(text);
  if (exact) return { ...normalized, action: exact.action, targetText: "", valueText: "" };

  for (const { action, alias } of SORTED_ACTIONS) {
    if (text.startsWith(`${alias} `)) {
      return { ...normalized, action, targetText: text.slice(alias.length + 1).trim(), valueText: "" };
    }
    if (text.endsWith(` ${alias}`)) {
      return { ...normalized, action, targetText: text.slice(0, -(alias.length + 1)).trim(), valueText: "" };
    }
  }
  return null;
}

export function m6fActionAliases(action: M6FAction): readonly string[] {
  return ACTION_ALIASES[action];
}

export const M6F_ACTION_ALIAS_COUNT = Object.values(ACTION_ALIASES).reduce((sum, aliases) => sum + aliases.length, 0);
