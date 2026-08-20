/**
 * Doctor identity — the BMDC registration number.
 *
 * A BMDC number identifies a clinician. Two accounts holding one is two
 * accounts claiming to be the same person, and it prints on prescriptions, so
 * it is an identity attribute rather than a profile field.
 */

/**
 * The canonical form used for COMPARISON only.
 *
 * Mirrors the `bmdc_normalized` generated column in `schema.ts`, and must stay
 * identical to it: case-folded, and stripped of everything that is not a letter
 * or a digit, so spacing, hyphens, dots and slashes cannot make one number look
 * like two. `bmdc-identity.test.ts` asserts both sides against the same vectors.
 *
 * The DATABASE is the authority. This exists so the app can recognise a clash
 * before asking, and can explain one afterwards — never so it can decide.
 */
export function normalizeBmdc(input: string | null | undefined): string | null {
  if (input == null) return null;
  const folded = input.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return folded === "" ? null : folded;
}

/**
 * Does this error mean "another doctor already registered that number"?
 *
 * Matched on the INDEX NAME, not on the message text: Postgres wording differs
 * by version and locale, and PostgREST wraps it differently again depending on
 * whether the write came through an RPC or a table.
 */
export function isBmdcCollision(error: { message?: string; code?: string } | null): boolean {
  if (!error) return false;
  const text = error.message ?? "";
  return /doctor_profiles_bmdc_unique/.test(text) || (error.code === "23505" && /bmdc/i.test(text));
}

/**
 * What the doctor is told.
 *
 * Deliberately does NOT say who holds it. That would confirm the existence of
 * another account from an unauthenticated signup form, and a registration
 * number is enough to identify a real person. It says what is wrong and what to
 * do, and no more.
 */
export const BMDC_TAKEN_MESSAGE =
  "That BMDC registration number is already registered to another account. " +
  "Check the number, or sign in to the account that already uses it.";
