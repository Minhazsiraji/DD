import { describe, it, expect } from "vitest";
import { normalizeName, normalizePhone } from "./identity";
import { NAME_VECTORS, PHONE_VECTORS } from "../../../scripts/normalization-vectors.mjs";

/**
 * The TypeScript half of the normalisation parity check.
 *
 * The same vectors are asserted against the SQL functions in
 * verify-appointments.mjs. Both sides must agree, because a patient registered
 * by a doctor (TypeScript) and the same patient walked in at reception (SQL)
 * have to land on the same search key or duplicate detection quietly stops
 * working — with no failing test to say so.
 */
describe("normalisation parity — TypeScript side", () => {
  it.each(NAME_VECTORS)("normalizeName(%j) === %j", (input, expected) => {
    expect(normalizeName(input as string)).toBe(expected);
  });

  it.each(PHONE_VECTORS)("normalizePhone(%j) === %j", (input, expected) => {
    expect(normalizePhone(input as string | null)).toBe(expected);
  });
});
