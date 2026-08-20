/**
 * Canonical BMDC normalisation vectors, asserted on BOTH sides.
 *
 * The database's `bmdc_normalized` generated column decides identity; the
 * TypeScript `normalizeBmdc()` only recognises and explains a clash. If the two
 * drift, the app stops predicting what the database will refuse — and starts
 * telling doctors a number is free moments before the write rejects it.
 *
 * Same arrangement as `normalization-vectors.mjs` for patient names.
 */
export const BMDC_VECTORS = [
  // input, canonical
  ["BMDC03029E", "BMDC03029E"],
  ["bmdc03029e", "BMDC03029E"],
  ["  BMDC03029E  ", "BMDC03029E"],
  ["BMDC 03029 E", "BMDC03029E"],
  ["BMDC-03029-E", "BMDC03029E"],
  ["BMDC.03029.E", "BMDC03029E"],
  ["bmdc / 03029 / e", "BMDC03029E"],
  ["B M D C 0 3 0 2 9 E", "BMDC03029E"],
  ["A-12345", "A12345"],
  ["a12345", "A12345"],
  ["12345", "12345"],
  // Blank in every disguise folds to nothing, so unnumbered doctors coexist.
  ["", null],
  ["   ", null],
  ["---", null],
  [" . - / ", null],
];
