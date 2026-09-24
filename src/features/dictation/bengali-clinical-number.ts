const BENGALI_DIGITS = "০১২৩৪৫৬৭৮৯";

const CARDINALS: Readonly<Record<string, number>> = {
  "শূন্য": 0, "জিরো": 0, "এক": 1, "একটি": 1, "দুই": 2, "দুটি": 2, "তিন": 3, "চার": 4,
  "পাঁচ": 5, "ছয়": 6, "ছয়": 6, "সাত": 7, "আট": 8, "নয়": 9, "নয়": 9,
  "দশ": 10, "এগারো": 11, "বারো": 12, "তেরো": 13, "চৌদ্দ": 14, "পনেরো": 15,
  "ষোলো": 16, "সতেরো": 17, "আঠারো": 18, "উনিশ": 19, "বিশ": 20,
  "একুশ": 21, "বাইশ": 22, "তেইশ": 23, "চব্বিশ": 24, "পঁচিশ": 25, "ছাব্বিশ": 26,
  "সাতাশ": 27, "আঠাশ": 28, "ঊনত্রিশ": 29, "উনত্রিশ": 29, "ত্রিশ": 30,
  "একত্রিশ": 31, "বত্রিশ": 32, "তেত্রিশ": 33, "চৌত্রিশ": 34,
  "পঁয়ত্রিশ": 35, "পঁয়ত্রিশ": 35, "ছত্রিশ": 36, "সাঁইত্রিশ": 37, "আটত্রিশ": 38,
  "ঊনচল্লিশ": 39, "উনচল্লিশ": 39, "চল্লিশ": 40, "একচল্লিশ": 41,
  "বিয়াল্লিশ": 42, "বিয়াল্লিশ": 42, "তেতাল্লিশ": 43, "চুয়াল্লিশ": 44, "চুয়াল্লিশ": 44,
  "পঁয়তাল্লিশ": 45, "পঁয়তাল্লিশ": 45, "ছেচল্লিশ": 46, "সাতচল্লিশ": 47,
  "আটচল্লিশ": 48, "ঊনপঞ্চাশ": 49, "উনপঞ্চাশ": 49, "পঞ্চাশ": 50,
  "একান্ন": 51, "বাহান্ন": 52, "তিপ্পান্ন": 53, "চুয়ান্ন": 54, "চুয়ান্ন": 54,
  "পঞ্চান্ন": 55, "ছাপ্পান্ন": 56, "সাতান্ন": 57, "আটান্ন": 58,
  "ঊনষাট": 59, "উনষাট": 59, "ষাট": 60, "একষট্টি": 61, "বাষট্টি": 62,
  "তেষট্টি": 63, "চৌষট্টি": 64, "পঁয়ষট্টি": 65, "পঁয়ষট্টি": 65,
  "ছেষট্টি": 66, "সাতষট্টি": 67, "আটষট্টি": 68, "ঊনসত্তর": 69, "উনসত্তর": 69,
  "সত্তর": 70, "একাত্তর": 71, "বাহাত্তর": 72, "তিয়াত্তর": 73, "তিয়াত্তর": 73,
  "চুয়াত্তর": 74, "চুয়াত্তর": 74, "পঁচাত্তর": 75, "ছিয়াত্তর": 76, "ছিয়াত্তর": 76,
  "সাতাত্তর": 77, "আটাত্তর": 78, "ঊনআশি": 79, "উনআশি": 79, "আশি": 80,
  "একাশি": 81, "বিরাশি": 82, "তিরাশি": 83, "চুরাশি": 84, "পঁচাশি": 85,
  "ছিয়াশি": 86, "ছিয়াশি": 86, "সাতাশি": 87, "আটাশি": 88,
  "ঊননব্বই": 89, "উননব্বই": 89, "নব্বই": 90, "একানব্বই": 91,
  "বিরানব্বই": 92, "তিরানব্বই": 93, "চুরানব্বই": 94, "পঁচানব্বই": 95,
  "ছিয়ানব্বই": 96, "ছিয়ানব্বই": 96, "সাতানব্বই": 97, "আটানব্বই": 98,
  "নিরানব্বই": 99, "একশ": 100, "একশো": 100, "শত": 100,
};

const ENGLISH_DIGITS: Readonly<Record<string, number>> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
};

export const BENGALI_CLINICAL_NUMBER_WORDS = Object.freeze(Object.keys(CARDINALS));

function toAsciiDigits(value: string): string {
  return value.replace(/[০-৯]/g, (digit) => String(BENGALI_DIGITS.indexOf(digit)));
}

function parseInteger(raw: string): number | null {
  const value = toAsciiDigits(raw.normalize("NFC").trim());
  if (/^\d{1,3}$/.test(value)) {
    const number = Number(value);
    return number <= 300 ? number : null;
  }
  const tokens = value.split(/[\s-]+/).filter(Boolean);
  if (tokens.length === 0) return null;
  const tokenValue = (token: string): number | null => {
    if (/^\d{1,3}$/.test(token)) return Number(token);
    if (token === "দুইশ" || token === "দুইশো") return 200;
    if (token === "তিনশ" || token === "তিনশো") return 300;
    return CARDINALS[token] ?? null;
  };
  if (tokens.length === 1) return tokenValue(tokens[0]!);
  if (tokens.length !== 2) return null;
  const hundreds = tokenValue(tokens[0]!);
  const remainder = tokenValue(tokens[1]!);
  if (hundreds === null || remainder === null || hundreds < 100 || hundreds % 100 !== 0 || remainder >= 100) return null;
  const total = hundreds + remainder;
  return total <= 300 ? total : null;
}

/** Parses only explicit Bengali/Bengali-digit number phrases in the clinical 0–300 range. */
export function parseBengaliClinicalNumber(raw: string): string | null {
  const parts = raw.normalize("NFC").trim().split(/\s+(?:দশমিক|point)\s+/iu);
  if (parts.length > 2) return null;
  const integer = parseInteger(parts[0] ?? "");
  if (integer === null) return null;
  if (parts.length === 1) return String(integer);

  const decimalTokens = toAsciiDigits(parts[1] ?? "").split(/\s+/).filter(Boolean);
  let decimal = "";
  for (const token of decimalTokens) {
    if (/^\d+$/.test(token)) {
      decimal += token;
      continue;
    }
    const digit = CARDINALS[token] ?? ENGLISH_DIGITS[token.toLocaleLowerCase("en-US")];
    if (digit === undefined || digit > 9) return null;
    decimal += String(digit);
  }
  return decimal ? `${integer}.${decimal}` : null;
}
