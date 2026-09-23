export interface NormalizedTranscript {
  raw: string;
  normalized: string;
}

const SMALL_NUMBERS: Readonly<Record<string, number>> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
};

const TENS: Readonly<Record<string, number>> = {
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};

const NUMBER_ATOM = "(?:\\d+(?:\\.\\d+)?|zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|point)(?![A-Za-z])";
const NUMBER_PHRASE = `${NUMBER_ATOM}(?:[ -]+(?:and[ -]+)?${NUMBER_ATOM})*`;

function parseSpokenNumber(value: string): string | null {
  const parts = value.toLocaleLowerCase("en-US").replace(/-/g, " ").split(/\s+point\s+/);
  if (parts.length > 2) return null;

  let current = 0;
  let sawNumber = false;
  for (const token of parts[0].split(/\s+/).filter((part) => part !== "and")) {
    if (/^\d+(?:\.\d+)?$/.test(token)) {
      current += Number(token);
      sawNumber = true;
      continue;
    }
    if (token === "hundred") {
      current = (current || 1) * 100;
      sawNumber = true;
      continue;
    }
    const amount = SMALL_NUMBERS[token] ?? TENS[token];
    if (amount === undefined) return null;
    current += amount;
    sawNumber = true;
  }
  if (!sawNumber || !Number.isFinite(current) || current > 999) return null;

  if (parts.length === 1) return String(current);
  let decimal = "";
  for (const token of parts[1].split(/\s+/)) {
    if (/^\d+$/.test(token)) {
      decimal += token;
      continue;
    }
    const digit = SMALL_NUMBERS[token];
    if (digit === undefined || digit >= 10) return null;
    decimal += String(digit);
  }
  return decimal ? `${current}.${decimal}` : null;
}

function normalizeMeasurement(text: string, cue: string): string {
  const pattern = new RegExp(`\\b(${cue})(\\s+)(${NUMBER_PHRASE})`, "gi");
  return text.replace(pattern, (match, label: string, spacing: string, spoken: string) => {
    const number = parseSpokenNumber(spoken);
    return number === null ? match : `${label}${spacing}${number}`;
  });
}

function normalizeBloodPressureSide(value: string, collapseLeadingEcho: boolean): string | null {
  if (collapseLeadingEcho) {
    const echo = value.toLocaleLowerCase("en-US").trim().match(/^([0-9])\s+([0-9]{2,3})$/);
    if (echo && echo[2].startsWith(echo[1])) return echo[2];
  }
  return parseSpokenNumber(value);
}

/**
 * Converts spoken numbers only when an explicit, allowlisted clinical
 * measurement cue makes the meaning deterministic. It deliberately leaves
 * ordinary prose and unlabelled word-numbers untouched and never adds units.
 */
export function normalizeClinicalNumbers(raw: string): string {
  const bloodPressure = new RegExp(
    `\\b(bp|b\\s+p|blood pressure)(\\s+)(${NUMBER_PHRASE})\\s+(?:by|over|slash|/)\\s+(${NUMBER_PHRASE})`,
    "gi",
  );
  let normalized = raw.replace(
    bloodPressure,
    (match, label: string, spacing: string, systolicSpoken: string, diastolicSpoken: string) => {
      const systolic = normalizeBloodPressureSide(systolicSpoken, false);
      const diastolic = normalizeBloodPressureSide(diastolicSpoken, true);
      const normalizedLabel = /^b\s*p$/i.test(label) ? "BP" : label;
      return systolic === null || diastolic === null
        ? match
        : `${normalizedLabel}${spacing}${systolic}/${diastolic}`;
    },
  );

  const oxygen = new RegExp(
    `\\b(spo2|sp\\s*o2|oxygen saturation)(\\s+)(${NUMBER_PHRASE})(\\s*(?:percent|per cent|%))?`,
    "gi",
  );
  normalized = normalized.replace(
    oxygen,
    (match, label: string, spacing: string, spoken: string, unit: string | undefined) => {
      const number = parseSpokenNumber(spoken);
      if (number === null) return match;
      const explicitUnit = unit ? "%" : "";
      return `${label}${spacing}${number}${explicitUnit}`;
    },
  );

  normalized = normalizeMeasurement(normalized, "pulse");
  normalized = normalized.replace(
    /\b(pulse)(\s+)(\d+(?:\.\d+)?)\s+slash\s+(minute|minutes|min)\b/gi,
    "$1$2$3/$4",
  );
  normalized = normalizeMeasurement(normalized, "temperature");
  normalized = normalizeMeasurement(normalized, "weight");
  return normalized;
}

/**
 * M6A normalization is intentionally conservative. It fixes transport/layout
 * noise but never translates, expands abbreviations, or manufactures clinical
 * meaning. Outside the allowlisted clinical-measurement patterns above,
 * Bangla, English, Banglish, numbers, units, medicine names and test names
 * remain the doctor's words for review.
 */
export function normalizeClinicalTranscript(raw: string): NormalizedTranscript {
  const normalized = normalizeClinicalNumbers(raw)
    .normalize("NFC")
    .replace(/[\t\r\n ]+/g, " ")
    .replace(/\s+([,.;:!?।])/g, "$1")
    .replace(/([,.;:!?।])(?=[^\s,.;:!?।])/g, "$1 ")
    .trim();

  return { raw, normalized };
}
