import type { MedicineField } from "./schema";

const BN_DIGITS = "০১২৩৪৫৬৭৮৯";

function asciiDigits(text: string) {
  return text.replace(/[০-৯]/gu, (digit) => String(BN_DIGITS.indexOf(digit)));
}

function clean(text: string) {
  return asciiDigits(text.normalize("NFC"))
    .trim()
    .replace(/[.।!?]+$/gu, "")
    .replace(/\s+/gu, " ");
}

function lower(text: string) {
  return clean(text).toLocaleLowerCase("en-US");
}

export const M6E_FIELD_ALIASES: Record<MedicineField, readonly string[]> = {
  displayName: ["medicine name", "medicine", "name field", "ওষুধের নাম", "ওষুধ নাম", "মেডিসিন নাম", "medicine nam"],
  brandName: ["brand", "brand name", "ব্র্যান্ড", "ব্র্যান্ড নাম", "brand nam"],
  genericName: ["generic", "generic name", "জেনেরিক", "জেনেরিক নাম", "generic nam"],
  strengthText: ["strength", "strength field", "স্ট্রেংথ", "স্ট্রেংথ ফিল্ড", "শক্তি"],
  doseText: ["dose", "dose field", "ডোজ", "ডোজ ফিল্ড"],
  dosageForm: ["dosage form", "form", "form field", "ডোজ ফর্ম", "ফর্ম", "ওষুধের ধরন"],
  route: ["route", "route field", "রুট", "রুট ফিল্ড", "প্রয়োগের পথ", "প্রয়োগের পথ"],
  scheduleText: ["schedule", "frequency", "schedule field", "frequency field", "সিডিউল", "ফ্রিকোয়েন্সি", "ফ্রিকোয়েন্সি", "সময়সূচি", "সময়সূচি"],
  durationText: ["duration", "duration field", "ডিউরেশন", "সময়কাল", "সময়কাল", "কতদিন"],
  quantityText: ["quantity", "quantity field", "পরিমাণ", "মোট পরিমাণ"],
  foodRelation: ["food relation", "food", "food field", "with food", "খাবার", "খাবারের সাথে", "খাবারের সম্পর্ক"],
  instructions: ["instructions", "instruction", "patient instructions", "instructions field", "ইনস্ট্রাকশন", "নির্দেশনা", "রোগীর নির্দেশনা"],
};

const SMALL_NUMBERS: Readonly<Record<string, number>> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
  "শূন্য": 0, "এক": 1, "একটি": 1, "একটা": 1, "দুই": 2, "দুটি": 2, "তিন": 3, "চার": 4,
  "পাঁচ": 5, "ছয়": 6, "ছয়": 6, "সাত": 7, "আট": 8, "নয়": 9, "নয়": 9, "দশ": 10,
  "এগারো": 11, "বারো": 12, "তেরো": 13, "চৌদ্দ": 14, "পনেরো": 15, "ষোলো": 16,
  "সতেরো": 17, "আঠারো": 18, "উনিশ": 19, "বিশ": 20,
  ek: 1, dui: 2, tin: 3, char: 4, pach: 5, panch: 5, choy: 6, sat: 7, at: 8, noy: 9, dosh: 10,
};

const HUNDREDS: Readonly<Record<string, number>> = {
  "one hundred": 100, "two hundred": 200, "three hundred": 300, "four hundred": 400, "five hundred": 500,
  "six hundred": 600, "seven hundred": 700, "eight hundred": 800, "nine hundred": 900,
  "একশ": 100, "একশো": 100, "দুইশ": 200, "দুইশো": 200, "তিনশ": 300, "তিনশো": 300,
  "চারশ": 400, "চারশো": 400, "পাঁচশ": 500, "পাঁচশো": 500, "ছয়শ": 600, "ছয়শ": 600,
  "ছয়শো": 600, "ছয়শো": 600, "সাতশ": 700, "সাতশো": 700, "আটশ": 800, "আটশো": 800,
  "নয়শ": 900, "নয়শ": 900, "নয়শো": 900, "নয়শো": 900,
  eksho: 100, duisho: 200, tinsho: 300, charsho: 400, pachsho: 500, panchsho: 500,
  choysho: 600, satsho: 700, atsho: 800, noysho: 900,
};

function parseNumber(raw: string): number | null {
  const value = lower(raw);
  if (/^\d+(?:\.\d+)?$/u.test(value)) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 && parsed <= 5000 ? parsed : null;
  }
  if (SMALL_NUMBERS[value] !== undefined) return SMALL_NUMBERS[value]!;
  if (HUNDREDS[value] !== undefined) return HUNDREDS[value]!;
  const words = value.split(/\s+/u);
  for (let cut = Math.min(2, words.length - 1); cut >= 1; cut -= 1) {
    const head = words.slice(0, cut).join(" ");
    const base = HUNDREDS[head];
    if (base === undefined) continue;
    const tail = words.slice(cut).join(" ");
    const remainder = SMALL_NUMBERS[tail];
    if (remainder !== undefined) return base + remainder;
  }
  return null;
}

function stripFieldPrefix(raw: string, field: MedicineField) {
  const value = clean(raw);
  const lowerValue = value.toLocaleLowerCase("en-US");
  for (const alias of [...M6E_FIELD_ALIASES[field]].sort((a, b) => b.length - a.length)) {
    const normalizedAlias = alias.toLocaleLowerCase("en-US");
    if (lowerValue === normalizedAlias) return "";
    if (lowerValue.startsWith(`${normalizedAlias} `)) {
      return value.slice(alias.length).trim().replace(/^(?:to|as|করো|দাও|koro|dao)\s+/iu, "");
    }
  }
  return value;
}

const STRENGTH_UNITS: Readonly<Record<string, string>> = {
  mg: "mg", milligram: "mg", milligrams: "mg", miligram: "mg", miligrams: "mg", "milli gram": "mg",
  mcg: "mcg", microgram: "mcg", micrograms: "mcg", g: "g", gram: "g", grams: "g",
  iu: "IU", unit: "unit", units: "units", "এমজি": "mg", "এম জি": "mg", "মিলিগ্রাম": "mg",
  "এমসিজি": "mcg", "এম সি জি": "mcg", "মাইক্রোগ্রাম": "mcg", "গ্রাম": "g",
  emji: "mg", "em ji": "mg",
};

function splitTrailingAlias(raw: string, aliases: Readonly<Record<string, string>>) {
  const value = lower(raw);
  for (const alias of Object.keys(aliases).sort((a, b) => b.length - a.length)) {
    if (value === alias) return { head: "", canonical: aliases[alias]! };
    if (value.endsWith(` ${alias}`)) {
      return { head: value.slice(0, -(alias.length + 1)).trim(), canonical: aliases[alias]! };
    }
  }
  return null;
}

function canonicalStrength(raw: string): string | null {
  const value = stripFieldPrefix(raw, "strengthText");
  const split = splitTrailingAlias(value, STRENGTH_UNITS);
  if (!split) return null;
  const amount = parseNumber(split.head);
  return amount === null ? null : `${amount} ${split.canonical}`;
}

const DOSE_UNITS: Readonly<Record<string, string>> = {
  tablet: "tablet", tablets: "tablet", tab: "tablet", tabs: "tablet",
  capsule: "capsule", capsules: "capsule", cap: "capsule", caps: "capsule",
  ml: "mL", "m l": "mL", puff: "puff", puffs: "puff", drop: "drop", drops: "drop",
  teaspoon: "teaspoon", teaspoons: "teaspoon", spoon: "teaspoon", spoons: "teaspoon",
  "ট্যাবলেট": "tablet", "ক্যাপসুল": "capsule", "এমএল": "mL", "এম এল": "mL",
  "পাফ": "puff", "ড্রপ": "drop", "ফোঁটা": "drop", "চামচ": "teaspoon",
  emel: "mL", "em el": "mL",
};

function pluralDoseUnit(unit: string, amount: number) {
  if (unit === "mL") return unit;
  if (amount === 1) return unit;
  if (unit === "teaspoon") return "teaspoons";
  return `${unit}s`;
}

function canonicalDose(raw: string): string | null {
  const value = stripFieldPrefix(raw, "doseText");
  const half = lower(value).match(/^(?:half(?: a)?|অর্ধেক|আধা|adha|ordhek)\s+(.+)$/iu);
  if (half) {
    const unit = DOSE_UNITS[lower(half[1]!)];
    return unit ? `Half ${unit}` : null;
  }
  const split = splitTrailingAlias(value, DOSE_UNITS);
  if (!split) return null;
  const amount = parseNumber(split.head);
  return amount === null ? null : `${amount} ${pluralDoseUnit(split.canonical, amount)}`;
}

const FORM_ALIASES: Readonly<Record<string, string>> = {
  tablet: "Tablet", tab: "Tablet", "ট্যাবলেট": "Tablet",
  capsule: "Capsule", cap: "Capsule", "ক্যাপসুল": "Capsule",
  syrup: "Syrup", "সিরাপ": "Syrup", suspension: "Suspension", "সাসপেনশন": "Suspension",
  drop: "Drops", drops: "Drops", "ড্রপ": "Drops", "ফোঁটা": "Drops",
  injection: "Injection", inj: "Injection", "ইনজেকশন": "Injection",
  inhaler: "Inhaler", "ইনহেলার": "Inhaler", cream: "Cream", "ক্রিম": "Cream",
  ointment: "Ointment", "অয়েন্টমেন্ট": "Ointment", sachet: "Sachet", "স্যাশে": "Sachet",
  suppository: "Suppository", "সাপোজিটরি": "Suppository", "সাপোসিটরি": "Suppository",
};

function canonicalForm(raw: string): string | null {
  const value = lower(stripFieldPrefix(raw, "dosageForm"));
  return FORM_ALIASES[value] ?? null;
}

const ROUTE_ALIASES: Readonly<Record<string, string>> = {
  oral: "Oral", "by mouth": "Oral", mouth: "Oral", "মুখে": "Oral", mukhe: "Oral",
  topical: "Topical", "on skin": "Topical", "ত্বকে": "Topical", "চামড়ায়": "Topical", "চামড়ায়": "Topical",
  iv: "IV", intravenous: "IV", "শিরায়": "IV", "শিরায়": "IV",
  im: "IM", intramuscular: "IM", "মাংসে": "IM", "মাংসপেশিতে": "IM",
  sc: "SC", subcutaneous: "SC", "ত্বকের নিচে": "SC",
  inhaled: "Inhaled", inhalation: "Inhaled", "ইনহেল": "Inhaled", "শ্বাসের সাথে": "Inhaled",
  nasal: "Nasal", "নাকে": "Nasal", ophthalmic: "Ophthalmic", "চোখে": "Ophthalmic",
  otic: "Otic", "কানে": "Otic", rectal: "Rectal", "রেক্টাল": "Rectal", "পায়ুপথে": "Rectal", "পায়ুপথে": "Rectal",
  sublingual: "Sublingual", "under tongue": "Sublingual", "জিহ্বার নিচে": "Sublingual",
};

function canonicalRoute(raw: string): string | null {
  const value = lower(stripFieldPrefix(raw, "route"));
  return ROUTE_ALIASES[value] ?? null;
}

const FOOD_ALIASES: Readonly<Record<string, string>> = {
  "after food": "After food", "after meal": "After food", "after meals": "After food",
  "খাবারের পরে": "After food", "খাবারের পর": "After food", "খাওয়ার পরে": "After food", "খাওয়ার পরে": "After food",
  "khabarer pore": "After food", "khabar er por": "After food", "khabarer por": "After food",
  "before food": "Before food", "before meal": "Before food", "before meals": "Before food",
  "খাবারের আগে": "Before food", "খাওয়ার আগে": "Before food", "খাওয়ার আগে": "Before food",
  "khabarer age": "Before food", "khabar er age": "Before food",
  "with food": "With food", "with meal": "With food", "খাবারের সাথে": "With food", "খাবারের সঙ্গে": "With food",
  "khabarer sathe": "With food", "empty stomach": "Empty stomach", "খালি পেটে": "Empty stomach", "khali pete": "Empty stomach",
  "at bedtime": "At bedtime", bedtime: "At bedtime", "ঘুমানোর আগে": "At bedtime", "ghumanor age": "At bedtime",
};

function canonicalFood(raw: string): string | null {
  const value = lower(stripFieldPrefix(raw, "foodRelation"));
  return FOOD_ALIASES[value] ?? null;
}

const DURATION_UNITS: Readonly<Record<string, "day" | "week" | "month">> = {
  day: "day", days: "day", "দিন": "day", din: "day",
  week: "week", weeks: "week", "সপ্তাহ": "week", shoptaho: "week", soptaho: "week",
  month: "month", months: "month", "মাস": "month", mash: "month", mas: "month",
};

function canonicalDuration(raw: string): string | null {
  const value = stripFieldPrefix(raw, "durationText").replace(/^(?:for|জন্য|jonyo)\s+/iu, "").trim();
  const lowered = lower(value);
  if (["continue", "ongoing", "চালিয়ে যান", "চালিয়ে যান", "চলবে", "cholbe", "continue koro"].includes(lowered)) return "Continue";
  const split = splitTrailingAlias(value, DURATION_UNITS);
  if (!split) return null;
  const amount = parseNumber(split.head);
  if (amount === null) return null;
  return `${amount} ${split.canonical}${amount === 1 ? "" : "s"}`;
}

const QUANTITY_UNITS: Readonly<Record<string, string>> = {
  tablet: "tablet", tablets: "tablet", tab: "tablet", tabs: "tablet", "ট্যাবলেট": "tablet",
  capsule: "capsule", capsules: "capsule", cap: "capsule", caps: "capsule", "ক্যাপসুল": "capsule",
  sachet: "sachet", sachets: "sachet", "স্যাশে": "sachet", bottle: "bottle", bottles: "bottle", "বোতল": "bottle",
  vial: "vial", vials: "vial", ampoule: "ampoule", ampoules: "ampoule", ampule: "ampoule", ampules: "ampoule",
  ml: "mL", "m l": "mL", "এমএল": "mL", "এম এল": "mL", emel: "mL", "em el": "mL",
  drop: "drop", drops: "drop", "ড্রপ": "drop", "ফোঁটা": "drop", puff: "puff", puffs: "puff", "পাফ": "puff",
};

function pluralQuantityUnit(unit: string, amount: number) {
  if (unit === "mL") return unit;
  if (amount === 1) return unit;
  if (unit === "ampoule") return "ampoules";
  return `${unit}s`;
}

function canonicalQuantity(raw: string): string | null {
  const value = stripFieldPrefix(raw, "quantityText");
  const split = splitTrailingAlias(value, QUANTITY_UNITS);
  if (!split) return null;
  const amount = parseNumber(split.head);
  return amount === null ? null : `${amount} ${pluralQuantityUnit(split.canonical, amount)}`;
}

function normalizedScheduleWords(raw: string) {
  return lower(stripFieldPrefix(raw, "scheduleText"))
    .replace(/[,;&]+/gu, " ")
    .replace(/\b(?:and|then)\b/giu, " ")
    .replace(/(?:এবং|আর|ও)/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

export function canonicalizeM6EScheduleSpeech(raw: string): string | null {
  const original = lower(stripFieldPrefix(raw, "scheduleText"));
  const plusParts = original.split(/\s*(?:\+|plus|যোগ)\s*/iu);
  if ((plusParts.length === 3 || plusParts.length === 4) && plusParts.every((part) => part.trim())) {
    const values = plusParts.map((part) => parseNumber(part));
    if (values.every((value) => value === 0 || value === 1)) return values.join("+");
  }
  if (/^(?:0|1)\s+(?:0|1)\s+(?:0|1)(?:\s+(?:0|1))?$/u.test(original)) return original.split(/\s+/u).join("+");

  const value = normalizedScheduleWords(raw);
  const exact = (phrases: readonly string[]) => phrases.includes(value);

  if (exact(["morning only", "only morning", "sokal only", "sudhu sokal", "সকাল শুধু", "শুধু সকাল", "সকালে শুধু"])) return "1+0+0";
  if (exact(["noon only", "midday only", "afternoon only", "dupur only", "sudhu dupur", "দুপুর শুধু", "শুধু দুপুর", "দুপুরে শুধু"])) return "0+1+0";
  if (exact(["night only", "at night only", "rat only", "rate only", "sudhu rat", "রাত শুধু", "শুধু রাত", "রাতে শুধু"])) return "0+0+1";
  if (exact(["morning night", "morning at night", "sokal rat", "sokal rate", "সকাল রাত", "সকাল রাতে", "সকালে রাতে"])) return "1+0+1";
  if (exact(["morning noon night", "morning afternoon night", "morning midday night", "sokal dupur rat", "sokal dupur rate", "সকাল দুপুর রাত", "সকাল দুপুর রাতে", "সকালে দুপুরে রাতে"])) return "1+1+1";

  if (/^(?:twice daily|two times? daily|2 times? daily|daily (?:two|2|to) times?|two times? a day|2 times? a day)$/iu.test(value)) return "1+0+1";
  if (/^(?:দিনে দুইবার|প্রতিদিন দুইবার|রোজ দুইবার|dine dui bar|protidin dui bar|roj dui bar)$/iu.test(value)) return "1+0+1";
  if (/^(?:three times? daily|3 times? daily|daily (?:three|3) times?|three times? a day|3 times? a day)$/iu.test(value)) return "1+1+1";
  if (/^(?:দিনে তিনবার|প্রতিদিন তিনবার|রোজ তিনবার|dine tin bar|protidin tin bar|roj tin bar)$/iu.test(value)) return "1+1+1";
  if (/^(?:four times? daily|4 times? daily|daily (?:four|4) times?|four times? a day|4 times? a day)$/iu.test(value)) return "1+1+1+1";
  if (/^(?:দিনে চারবার|প্রতিদিন চারবার|রোজ চারবার|dine char bar|protidin char bar|roj char bar)$/iu.test(value)) return "1+1+1+1";
  if (/^(?:once daily|once a day|one time daily|daily one time|দিনে একবার|প্রতিদিন একবার|রোজ একবার|dine ek bar)$/iu.test(value)) return "Once daily";
  if (/^(?:once weekly|weekly once|সপ্তাহে একবার|shoptaho(?:y| e)? ekbar|soptaho(?:y| e)? ekbar)$/iu.test(value)) return "Once weekly";
  if (/^(?:stat|স্ট্যাট)$/iu.test(value)) return "STAT";

  const everyHours = value.match(/^(?:every|প্রতি|proti)\s+(.+?)\s+(?:hours?|ঘণ্টা|ঘন্টা|ghonta)(?:\s+por por)?$/iu);
  if (everyHours) {
    const hours = parseNumber(everyHours[1]!);
    if (hours !== null && Number.isInteger(hours) && hours >= 1 && hours <= 24) return `Every ${hours} hours`;
  }
  return null;
}

export function canonicalizeM6EFieldSpeech(field: MedicineField, spoken: string): string {
  const original = clean(spoken);
  if (!original) return original;
  const canonical = field === "strengthText" ? canonicalStrength(original)
    : field === "doseText" ? canonicalDose(original)
    : field === "dosageForm" ? canonicalForm(original)
    : field === "route" ? canonicalRoute(original)
    : field === "scheduleText" ? canonicalizeM6EScheduleSpeech(original)
    : field === "durationText" ? canonicalDuration(original)
    : field === "quantityText" ? canonicalQuantity(original)
    : field === "foodRelation" ? canonicalFood(original)
    : null;
  return canonical ?? original;
}

const BARE_DIRECT_FIELDS = new Set<MedicineField>([
  "strengthText", "doseText", "dosageForm", "route", "scheduleText", "durationText", "quantityText", "foodRelation",
]);

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function parseM6EDirectFieldSpeech(raw: string): { field: MedicineField; value: string } | null {
  const input = clean(raw);
  for (const field of Object.keys(M6E_FIELD_ALIASES) as MedicineField[]) {
    for (const alias of [...M6E_FIELD_ALIASES[field]].sort((a, b) => b.length - a.length)) {
      const escaped = escapeRegExp(alias);
      const explicit = input.match(new RegExp(`^(?:change|set|update|সেট|পরিবর্তন|বদলাও)\\s+${escaped}\\s+(?:to\\s+|as\\s+|করো\\s+|দাও\\s+|koro\\s+|dao\\s+)?(.+)$`, "iu"));
      if (explicit?.[1]?.trim()) return { field, value: explicit[1].trim() };
      const suffixVerb = input.match(new RegExp(`^${escaped}\\s+(?:set|change|update|সেট|পরিবর্তন|বদলাও|করো|দাও|koro|dao)\\s+(.+)$`, "iu"));
      if (suffixVerb?.[1]?.trim()) return { field, value: suffixVerb[1].trim() };
      if (!BARE_DIRECT_FIELDS.has(field)) continue;
      const bare = input.match(new RegExp(`^${escaped}\\s+(?:to\\s+|as\\s+|করো\\s+|দাও\\s+|koro\\s+|dao\\s+)?(.+)$`, "iu"));
      if (bare?.[1]?.trim()) return { field, value: bare[1].trim() };
    }
  }
  return null;
}
