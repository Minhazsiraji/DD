/**
 * Patient identity helpers — normalisation, age, duplicate scoring.
 *
 * Pure and dependency-free so the rules that decide "is this the same person?"
 * can be tested exhaustively. Every one of these runs on the server before a
 * write; none is a client-side-only control.
 *
 * SCOPE: duplicate detection compares records within ONE doctor's repository
 * only. There is no global patient identity (ADR 0002).
 */

const HONORIFICS =
  /^(md|mohammad|muhammad|mohd|mr|mrs|ms|miss|dr|prof|alhaj|hajj)\.?\s+/i;

/**
 * Lowercase, strip diacritics and punctuation, collapse whitespace, and drop a
 * leading honorific.
 *
 * "Md. Rahim  Hossain" and "Rahim Hossain" must land on the same string —
 * in Bangladesh "Md." is near-universal and inconsistently written, so leaving
 * it in makes duplicate detection useless.
 */
export function normalizeName(input: string): string {
  let s = input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip combining accents
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

  // Repeatedly, so "Md. Alhaj Rahim" reduces fully.
  let previous: string;
  do {
    previous = s;
    s = s.replace(HONORIFICS, "").trim();
  } while (s !== previous && s.length > 0);

  return s;
}

/**
 * Digits only, with Bangladeshi forms folded together:
 * +8801711000124 · 8801711000124 · 01711000124 → 01711000124
 *
 * Phone is the strongest duplicate signal a chamber has, so the same number
 * written three ways must compare equal.
 */
export function normalizePhone(input: string | null | undefined): string | null {
  if (!input) return null;
  const digits = input.replace(/\D/g, "");
  if (digits.length === 0) return null;

  if (digits.startsWith("880") && digits.length >= 12) return `0${digits.slice(3)}`;
  if (digits.length === 10 && digits.startsWith("1")) return `0${digits}`;
  return digits;
}

export type DobPrecision = "DAY" | "MONTH" | "YEAR" | "AGE_ONLY";

export interface AgeInput {
  dob?: string | null;
  dobPrecision?: DobPrecision;
  approxAgeYears?: number | null;
  ageRecordedOn?: string | null;
}

export interface Age {
  years: number | null;
  /** True when the age is estimated — render it with a "~" so nobody doses off it blindly. */
  isApproximate: boolean;
}

function parseISO(d: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  if (!m) return null;
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

/**
 * Age in whole years as of `todayISO`.
 *
 * AGE_ONLY records are aged FORWARD from when the age was taken — a patient
 * recorded as 40 three years ago is 43 now, not 40. Getting this wrong quietly
 * corrupts every age-based dose decision from then on.
 */
export function computeAge(input: AgeInput, todayISO: string): Age {
  const today = parseISO(todayISO);
  if (!today) return { years: null, isApproximate: false };

  const precision = input.dobPrecision ?? "DAY";

  if (precision === "AGE_ONLY") {
    if (input.approxAgeYears == null) return { years: null, isApproximate: true };
    const recorded = input.ageRecordedOn ? parseISO(input.ageRecordedOn) : null;
    const elapsed = recorded ? Math.max(0, today.y - recorded.y) : 0;
    return { years: input.approxAgeYears + elapsed, isApproximate: true };
  }

  if (!input.dob) return { years: null, isApproximate: precision !== "DAY" };
  const dob = parseISO(input.dob);
  if (!dob) return { years: null, isApproximate: precision !== "DAY" };

  let years = today.y - dob.y;
  // Only subtract the incomplete year when we actually know month/day.
  if (precision === "DAY" || precision === "MONTH") {
    const beforeBirthday =
      today.m < dob.m || (today.m === dob.m && precision === "DAY" && today.d < dob.d);
    if (beforeBirthday) years -= 1;
  }

  return { years: Math.max(0, years), isApproximate: precision !== "DAY" };
}

// ---------------------------------------------------------------------------
// Duplicate detection
// ---------------------------------------------------------------------------

export type DuplicateConfidence = "high" | "medium" | "low";

export interface DuplicateCandidate {
  id: string;
  fullName: string;
  nameNormalized: string;
  phoneNormalized: string | null;
  patientNumber: string;
  ageYears: number | null;
}

export interface DuplicateMatch extends DuplicateCandidate {
  confidence: DuplicateConfidence;
  reason: string;
}

/** Jaro-free, cheap token overlap. Good enough for names, and easy to reason about. */
function nameOverlap(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const at = new Set(a.split(" ").filter(Boolean));
  const bt = new Set(b.split(" ").filter(Boolean));
  if (at.size === 0 || bt.size === 0) return 0;
  let shared = 0;
  for (const t of at) if (bt.has(t)) shared += 1;
  return shared / Math.max(at.size, bt.size);
}

/**
 * Rank possible duplicates. NEVER auto-merges — this only produces a warning
 * for the doctor to judge. Two different people genuinely share a name and a
 * household phone, so a machine decision here would be wrong regularly and
 * expensive to undo.
 */
export function findDuplicates(
  input: { nameNormalized: string; phoneNormalized: string | null; ageYears?: number | null },
  candidates: readonly DuplicateCandidate[],
): DuplicateMatch[] {
  const matches: DuplicateMatch[] = [];

  for (const c of candidates) {
    const samePhone =
      Boolean(input.phoneNormalized) && input.phoneNormalized === c.phoneNormalized;
    const overlap = nameOverlap(input.nameNormalized, c.nameNormalized);
    const exactName = overlap === 1;

    const ageClose =
      input.ageYears != null && c.ageYears != null
        ? Math.abs(input.ageYears - c.ageYears) <= 2
        : null;

    let confidence: DuplicateConfidence | null = null;
    let reason = "";

    if (samePhone && exactName) {
      confidence = "high";
      reason = "Same name and phone number";
    } else if (samePhone && overlap >= 0.5) {
      confidence = "high";
      reason = "Same phone number, similar name";
    } else if (samePhone) {
      confidence = "medium";
      reason = "Same phone number";
    } else if (exactName && ageClose === true) {
      confidence = "high";
      reason = "Same name and a similar age";
    } else if (exactName && ageClose === null) {
      confidence = "medium";
      reason = "Same name";
    } else if (exactName && ageClose === false) {
      // Same name but clearly different age — very likely a different person.
      confidence = "low";
      reason = "Same name, but a different age";
    } else if (overlap >= 0.6) {
      confidence = "low";
      reason = "Similar name";
    }

    if (confidence) matches.push({ ...c, confidence, reason });
  }

  const order: Record<DuplicateConfidence, number> = { high: 0, medium: 1, low: 2 };
  return matches.sort((a, b) => order[a.confidence] - order[b.confidence]).slice(0, 5);
}

/** Formats an age for display, marking estimates so they are never read as exact. */
export function formatAge(age: Age): string {
  if (age.years == null) return "Age unknown";
  return `${age.isApproximate ? "~" : ""}${age.years}y`;
}
