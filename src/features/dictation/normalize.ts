export interface NormalizedTranscript {
  raw: string;
  normalized: string;
}

/**
 * M6A normalization is intentionally conservative. It fixes transport/layout
 * noise but never translates, expands abbreviations, or manufactures clinical
 * meaning. Bangla, English, Banglish, numbers, units, medicine names and test
 * names remain the doctor's words for review.
 */
export function normalizeClinicalTranscript(raw: string): NormalizedTranscript {
  const normalized = raw
    .normalize("NFC")
    .replace(/[\t\r\n ]+/g, " ")
    .replace(/\s+([,.;:!?।])/g, "$1")
    .replace(/([,.;:!?।])(?=[^\s,.;:!?।])/g, "$1 ")
    .trim();

  return { raw, normalized };
}
