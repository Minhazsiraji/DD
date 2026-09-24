import type { MedicineDraft, MedicineField } from "./schema";

export type M6EVoiceMedicineField = MedicineField;

export type M6EPrescriptionVoiceIntent =
  | { type: "OPEN_ADD" }
  | { type: "EDIT_MEDICINE"; index: number }
  | { type: "NEXT_MEDICINE" }
  | { type: "PREVIOUS_MEDICINE" }
  | { type: "REQUEST_REMOVE"; index: number }
  | { type: "TARGET_FIELD"; field: M6EVoiceMedicineField }
  | { type: "CLEAR_FIELD"; field: M6EVoiceMedicineField }
  | { type: "CLEAR_FORM" }
  | { type: "UNDO" }
  | { type: "CANCEL_EDITOR" }
  | { type: "REPLACE_FIELD"; from: string; to: string }
  | { type: "SET_FIELD"; field: M6EVoiceMedicineField; value: string }
  | { type: "STAGE_MEDICINE"; patch: Partial<MedicineDraft>; rawText: string }
  | { type: "GENERATE_AUTOPILOT" }
  | { type: "DISCARD_AUTOPILOT" }
  | { type: "APPLY_AUTOPILOT" }
  | { type: "REVIEW_PRESCRIPTION" }
  | { type: "PROHIBITED_FINALIZE" }
  | { type: "UNKNOWN"; rawText: string };

export interface M6EVoiceParseContext {
  editorOpen: boolean;
  fieldTarget: M6EVoiceMedicineField | null;
}

const BN_DIGITS = "০১২৩৪৫৬৭৮৯";

function clean(text: string) {
  return text.normalize("NFC").trim().replace(/[.।!?]+$/gu, "").replace(/\s+/gu, " ");
}

function asciiDigits(text: string) {
  return text.replace(/[০-৯]/gu, (digit) => String(BN_DIGITS.indexOf(digit)));
}

function normalized(text: string) {
  return asciiDigits(clean(text)).toLocaleLowerCase("en-US");
}

function exact(value: string, phrases: readonly string[]) {
  return phrases.includes(value);
}

const SMALL_NUMBERS: Readonly<Record<string, number>> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
  "শূন্য": 0, "এক": 1, "একটি": 1, "একটা": 1, "দুই": 2, "দুটি": 2, "তিন": 3, "চার": 4,
  "পাঁচ": 5, "ছয়": 6, "ছয়": 6, "সাত": 7, "আট": 8, "নয়": 9, "নয়": 9, "দশ": 10,
  "এগারো": 11, "বারো": 12, "তেরো": 13, "চৌদ্দ": 14, "পনেরো": 15, "ষোলো": 16,
  "সতেরো": 17, "আঠারো": 18, "উনিশ": 19, "বিশ": 20,
};

const BN_HUNDREDS: Readonly<Record<string, number>> = {
  "একশ": 100, "একশো": 100, "দুইশ": 200, "দুইশো": 200, "তিনশ": 300, "তিনশো": 300,
  "চারশ": 400, "চারশো": 400, "পাঁচশ": 500, "পাঁচশো": 500, "ছয়শ": 600, "ছয়শ": 600,
  "ছয়শো": 600, "ছয়শো": 600, "সাতশ": 700, "সাতশো": 700, "আটশ": 800, "আটশো": 800,
  "নয়শ": 900, "নয়শ": 900, "নয়শো": 900, "নয়শো": 900,
};

function parseBoundedNumber(raw: string): number | null {
  const value = normalized(raw);
  if (/^\d+(?:\.\d+)?$/u.test(value)) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 && number <= 5000 ? number : null;
  }
  if (SMALL_NUMBERS[value] !== undefined) return SMALL_NUMBERS[value]!;
  if (BN_HUNDREDS[value] !== undefined) return BN_HUNDREDS[value]!;
  const englishHundred = value.match(/^(one|two|three|four|five|six|seven|eight|nine) hundred(?: (one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty))?$/u);
  if (englishHundred) {
    const base = SMALL_NUMBERS[englishHundred[1]!]! * 100;
    const remainder = englishHundred[2] ? SMALL_NUMBERS[englishHundred[2]!]! : 0;
    return base + remainder;
  }
  const parts = value.split(/\s+/u);
  if (parts.length === 2 && BN_HUNDREDS[parts[0]!] !== undefined && SMALL_NUMBERS[parts[1]!] !== undefined) {
    return BN_HUNDREDS[parts[0]!]! + SMALL_NUMBERS[parts[1]!]!;
  }
  return null;
}

const INDEX_WORD = "(?:\\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|এক|দুই|তিন|চার|পাঁচ|ছয়|ছয়|সাত|আট|নয়|নয়|দশ)";

function medicineIndex(value: string): number | null {
  const match = value.match(new RegExp(`(?:medicine|med|মেডিসিন|ওষুধ)\\s*(${INDEX_WORD})`, "iu"));
  if (!match) return null;
  const parsed = parseBoundedNumber(match[1]!);
  return parsed && Number.isInteger(parsed) && parsed >= 1 && parsed <= 50 ? parsed : null;
}

const FIELD_ALIASES: readonly [M6EVoiceMedicineField, readonly string[]][] = [
  ["displayName", ["medicine name", "medicine", "name field", "মেডিসিন নাম", "ওষুধের নাম", "ওষুধ নাম"]],
  ["strengthText", ["strength", "strength field", "স্ট্রেংথ", "শক্তি"]],
  ["doseText", ["dose", "dose field", "ডোজ"]],
  ["scheduleText", ["schedule", "frequency", "schedule field", "frequency field", "ফ্রিকোয়েন্সি", "ফ্রিকোয়েন্সি", "সিডিউল"]],
  ["durationText", ["duration", "duration field", "ডিউরেশন", "সময়কাল", "সময়কাল"]],
  ["dosageForm", ["dosage form", "form field", "form", "ডোজ ফর্ম", "ফর্ম"]],
  ["route", ["route", "route field", "রুট"]],
  ["quantityText", ["quantity", "quantity field", "পরিমাণ"]],
  ["foodRelation", ["food relation", "with food", "food field", "খাবার", "খাবারের সাথে"]],
  ["instructions", ["instructions", "instruction", "instructions field", "ইনস্ট্রাকশন", "নির্দেশনা"]],
  ["brandName", ["brand", "brand name", "ব্র্যান্ড"]],
  ["genericName", ["generic", "generic name", "জেনেরিক"]],
];

function fieldFromExact(value: string): M6EVoiceMedicineField | null {
  for (const [field, aliases] of FIELD_ALIASES) if (exact(value, aliases)) return field;
  return null;
}

const UNIT_ALIAS: Readonly<Record<string, string>> = {
  mg: "mg", mcg: "mcg", g: "g", gram: "g", grams: "g", iu: "IU", unit: "unit", units: "units",
  "এমজি": "mg", "এম জি": "mg", "মিলিগ্রাম": "mg", "এমসিজি": "mcg", "এম সি জি": "mcg", "গ্রাম": "g",
};

const DOSE_UNIT_ALIAS: Readonly<Record<string, string>> = {
  tablet: "tablet", tablets: "tablets", tab: "tablet", tabs: "tablets", capsule: "capsule", capsules: "capsules",
  cap: "capsule", caps: "capsules", ml: "mL", "m l": "mL", puff: "puff", puffs: "puffs", drop: "drop", drops: "drops",
  teaspoon: "teaspoon", teaspoons: "teaspoons", "ট্যাবলেট": "tablet", "ক্যাপসুল": "capsule", "এমএল": "mL", "এম এল": "mL",
  "পাফ": "puff", "ড্রপ": "drop", "চামচ": "teaspoon",
};

const FORM_ALIAS: Readonly<Record<string, string>> = {
  tablet: "Tablet", tab: "Tablet", "ট্যাবলেট": "Tablet", capsule: "Capsule", cap: "Capsule", "ক্যাপসুল": "Capsule",
  syrup: "Syrup", "সিরাপ": "Syrup", suspension: "Suspension", "সাসপেনশন": "Suspension", drops: "Drops", drop: "Drops", "ড্রপ": "Drops",
  injection: "Injection", "ইনজেকশন": "Injection", inhaler: "Inhaler", "ইনহেলার": "Inhaler", cream: "Cream", "ক্রিম": "Cream",
  ointment: "Ointment", "অয়েন্টমেন্ট": "Ointment", sachet: "Sachet", "স্যাশে": "Sachet",
};

const NUMBER_PHRASE = "(?:\\d+(?:\\.\\d+)?|(?:one|two|three|four|five|six|seven|eight|nine) hundred(?: (?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty))?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|এক|একটি|একটা|দুই|দুটি|তিন|চার|পাঁচ|ছয়|ছয়|সাত|আট|নয়|নয়|দশ|এগারো|বারো|তেরো|চৌদ্দ|পনেরো|ষোলো|সতেরো|আঠারো|উনিশ|বিশ|একশ|একশো|দুইশ|দুইশো|তিনশ|তিনশো|চারশ|চারশো|পাঁচশ|পাঁচশো|ছয়শ|ছয়শ|ছয়শো|ছয়শো|সাতশ|সাতশো|আটশ|আটশো|নয়শ|নয়শ|নয়শো|নয়শো)";

function firstMatchIndex(matches: Array<RegExpMatchArray | null>) {
  const indexes = matches.flatMap((match) => typeof match?.index === "number" ? [match.index] : []);
  return indexes.length ? Math.min(...indexes) : null;
}

function stagePrefix(raw: string) {
  const pattern = /^(?:please\s+)?(?:add(?:\s+medicine)?|new medicine|medicine add(?: koro| করো)?|মেডিসিন\s*(?:add|যোগ)(?:\s*koro|\s*করো)?|ওষুধ\s*(?:add|যোগ)(?:\s*koro|\s*করো)?|ওষুধ যোগ করো)\s+/iu;
  const match = raw.match(pattern);
  return match ? { explicit: true, text: raw.slice(match[0].length).trim() } : { explicit: false, text: raw };
}

export function parseStructuredMedicineSpeech(rawText: string): Partial<MedicineDraft> | null {
  const raw = clean(rawText);
  const staged = stagePrefix(raw);
  const text = staged.text;
  const value = normalized(text);
  const patch: Partial<MedicineDraft> = {};

  const strengthMatch = value.match(new RegExp(`(${NUMBER_PHRASE})\\s*(mg|mcg|g|gram|grams|iu|unit|units|এমজি|এম জি|মিলিগ্রাম|এমসিজি|এম সি জি|গ্রাম)(?=\\s|$|,|;)`, "iu"));
  if (strengthMatch) {
    const amount = parseBoundedNumber(strengthMatch[1]!);
    const unit = UNIT_ALIAS[normalized(strengthMatch[2]!)] ?? strengthMatch[2]!;
    if (amount !== null) patch.strengthText = `${amount} ${unit}`;
  }

  const doseMatch = value.match(new RegExp(`(${NUMBER_PHRASE})\\s*(tablet|tablets|tab|tabs|capsule|capsules|cap|caps|ml|m l|puff|puffs|drop|drops|teaspoon|teaspoons|ট্যাবলেট|ক্যাপসুল|এমএল|এম এল|পাফ|ড্রপ|চামচ)(?=\\s|$|,|;)`, "iu"));
  if (doseMatch) {
    const amount = parseBoundedNumber(doseMatch[1]!);
    const unit = DOSE_UNIT_ALIAS[normalized(doseMatch[2]!)] ?? doseMatch[2]!;
    if (amount !== null) patch.doseText = `${amount} ${unit}`;
    const formKey = normalized(doseMatch[2]!).replace(/s$/u, "");
    if (FORM_ALIAS[formKey]) patch.dosageForm = FORM_ALIAS[formKey];
  }

  const scheduleCode = value.match(/\b\d\s*\+\s*\d\s*\+\s*\d(?:\s*\+\s*\d)?\b/u);
  if (scheduleCode) patch.scheduleText = scheduleCode[0]!.replace(/\s+/gu, "");
  else if (/(?:once daily|once a day|one time daily|দিনে একবার|দিনে 1 বার)/iu.test(value)) patch.scheduleText = "Once daily";
  else if (/(?:twice daily|two times daily|2 times daily|দিনে দুইবার|দিনে 2 বার)/iu.test(value)) patch.scheduleText = "Twice daily";
  else if (/(?:three times daily|3 times daily|দিনে তিনবার|দিনে 3 বার)/iu.test(value)) patch.scheduleText = "Three times daily";
  else if (/(?:four times daily|4 times daily|দিনে চারবার|দিনে 4 বার)/iu.test(value)) patch.scheduleText = "Four times daily";
  else {
    const everyHours = value.match(/every\s+(\d{1,2})\s+hours?/iu);
    if (everyHours) patch.scheduleText = `Every ${everyHours[1]} hours`;
  }

  const durationMatch = value.match(new RegExp(`(?:for\\s+)?(${NUMBER_PHRASE})\\s*(day|days|week|weeks|month|months|দিন|সপ্তাহ|মাস)(?=\\s|$|,|;)`, "iu"));
  if (durationMatch) {
    const amount = parseBoundedNumber(durationMatch[1]!);
    const rawUnit = normalized(durationMatch[2]!);
    const baseUnit = rawUnit === "দিন" ? "day" : rawUnit === "সপ্তাহ" ? "week" : rawUnit === "মাস" ? "month" : rawUnit.replace(/s$/u, "");
    if (amount !== null) patch.durationText = `${amount} ${baseUnit}${amount === 1 ? "" : "s"}`;
  } else if (/\bcontinue\b|চালিয়ে যান|চালিয়ে যান/iu.test(value)) patch.durationText = "Continue";

  if (/\bafter food\b|after meal|খাবারের পরে/iu.test(value)) patch.foodRelation = "After food";
  else if (/\bbefore food\b|before meal|খাবারের আগে/iu.test(value)) patch.foodRelation = "Before food";
  else if (/\bwith food\b|খাবারের সাথে/iu.test(value)) patch.foodRelation = "With food";
  else if (/\bempty stomach\b|খালি পেটে/iu.test(value)) patch.foodRelation = "Empty stomach";
  else if (/\bat bedtime\b|ঘুমানোর আগে/iu.test(value)) patch.foodRelation = "At bedtime";

  if (/\b(?:oral|by mouth)\b|মুখে/iu.test(value)) patch.route = "Oral";
  else if (/\btopical\b|ত্বকে/iu.test(value)) patch.route = "Topical";
  else if (/\binhaled\b|ইনহেল/iu.test(value)) patch.route = "Inhaled";

  if (/\b(?:as needed|prn)\b|প্রয়োজনে|প্রয়োজনে/iu.test(value)) patch.isPrn = true;
  if (/\bno substitution\b|substitution not allowed|বিকল্প নয়|বিকল্প নয়/iu.test(value)) patch.substitutionAllowed = false;

  const formMatch = value.match(/\b(tablet|tab|capsule|cap|syrup|suspension|drops?|injection|inhaler|cream|ointment|sachet)\b|(?:ট্যাবলেট|ক্যাপসুল|সিরাপ|সাসপেনশন|ড্রপ|ইনজেকশন|ইনহেলার|ক্রিম|অয়েন্টমেন্ট|স্যাশে)/iu);
  if (formMatch) {
    const key = normalized(formMatch[0]!).replace(/s$/u, "");
    if (FORM_ALIAS[key]) patch.dosageForm = FORM_ALIAS[key];
  }

  const markerIndex = firstMatchIndex([strengthMatch, doseMatch, scheduleCode, durationMatch, formMatch]);
  let nameCandidate = markerIndex === null ? text : text.slice(0, markerIndex).trim();
  nameCandidate = nameCandidate.replace(/^(?:tablet|tab|capsule|cap|syrup|মেডিসিন|ওষুধ)\.?\s+/iu, "").replace(/[,:;-]+$/u, "").trim();
  if (nameCandidate && (markerIndex !== null || staged.explicit)) patch.displayName = nameCandidate;

  return Object.keys(patch).length > 0 ? patch : null;
}

const FINALIZE = [
  "finalize prescription", "finalise prescription", "sign prescription", "complete prescription", "prescription finalize",
  "prescription sign", "প্রেসক্রিপশন ফাইনাল", "প্রেসক্রিপশন সাইন", "প্রেসক্রিপশন complete", "final prescription koro",
];
const REVIEW = ["review prescription", "prescription review", "open prescription review", "go to review", "প্রেসক্রিপশন রিভিউ", "review prescription koro"];
const GENERATE = ["generate with autopilot", "generate autopilot", "autopilot generate", "autopilot দিয়ে generate", "autopilot দিয়ে generate", "অটোপাইলট জেনারেট করো"];
const DISCARD = ["discard proposal", "discard autopilot", "autopilot discard", "discard", "প্রপোজাল বাতিল", "proposal bad dao"];
const APPLY = ["apply selected", "apply proposal", "apply to draft", "autopilot apply", "apply autopilot", "প্রপোজাল apply করো", "proposal apply koro"];
const OPEN_ADD = ["add medicine", "add a medicine", "new medicine", "medicine add", "medicine add koro", "মেডিসিন add করো", "মেডিসিন যোগ করো", "ওষুধ যোগ করো"];
const NEXT = ["next medicine", "go to next medicine", "পরের medicine", "পরের মেডিসিন", "next medicine e jao"];
const PREVIOUS = ["previous medicine", "go to previous medicine", "আগের medicine", "আগের মেডিসিন", "previous medicine e jao"];
const CLEAR_FORM = ["clear medicine form", "clear current medicine", "medicine form clear koro", "মেডিসিন ফর্ম clear করো", "ওষুধ ফর্ম পরিষ্কার করো"];
const CANCEL = ["cancel medicine", "cancel medicine edit", "close medicine form", "medicine cancel koro", "মেডিসিন cancel করো"];
const UNDO = ["undo", "undo medicine", "medicine undo", "আনডু", "undo koro"];

export function parseM6EPrescriptionVoice(text: string, context: M6EVoiceParseContext): M6EPrescriptionVoiceIntent {
  const raw = clean(text);
  const value = normalized(raw);
  if (!raw) return { type: "UNKNOWN", rawText: raw };

  if (exact(value, FINALIZE)) return { type: "PROHIBITED_FINALIZE" };
  if (exact(value, REVIEW)) return { type: "REVIEW_PRESCRIPTION" };
  if (exact(value, GENERATE)) return { type: "GENERATE_AUTOPILOT" };
  if (exact(value, DISCARD)) return { type: "DISCARD_AUTOPILOT" };
  if (exact(value, APPLY)) return { type: "APPLY_AUTOPILOT" };
  if (exact(value, OPEN_ADD)) return { type: "OPEN_ADD" };
  if (exact(value, NEXT)) return { type: "NEXT_MEDICINE" };
  if (exact(value, PREVIOUS)) return { type: "PREVIOUS_MEDICINE" };
  if (exact(value, CLEAR_FORM)) return { type: "CLEAR_FORM" };
  if (exact(value, CANCEL)) return { type: "CANCEL_EDITOR" };
  if (exact(value, UNDO)) return { type: "UNDO" };

  const index = medicineIndex(value);
  if (index !== null && /(?:edit|এডিট|সম্পাদনা)/iu.test(value)) return { type: "EDIT_MEDICINE", index };
  if (index !== null && /(?:remove|delete|বাদ|মুছ)/iu.test(value)) return { type: "REQUEST_REMOVE", index };

  for (const [field, aliases] of FIELD_ALIASES) {
    for (const alias of aliases) {
      if (value === `clear ${alias}` || value === `${alias} clear` || value === `${alias} clear koro`) return { type: "CLEAR_FIELD", field };
    }
  }

  const targetField = fieldFromExact(value);
  if (targetField) return { type: "TARGET_FIELD", field: targetField };

  const replace = raw.match(/^replace\s+(.+?)\s+(?:with|by)\s+(.+)$/iu) ?? raw.match(/^(.+?)\s+replace\s+(?:kore|করে)\s+(.+)$/iu);
  if (replace) return { type: "REPLACE_FIELD", from: replace[1]!.trim(), to: replace[2]!.trim() };

  if (context.editorOpen && context.fieldTarget) {
    return { type: "SET_FIELD", field: context.fieldTarget, value: raw };
  }

  const patch = parseStructuredMedicineSpeech(raw);
  const staged = stagePrefix(raw).explicit;
  if (patch && (context.editorOpen || staged)) return { type: "STAGE_MEDICINE", patch, rawText: raw };

  return { type: "UNKNOWN", rawText: raw };
}
