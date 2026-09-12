/**
 * Exact fixed-point money for AI / Voice cost accounting (O1-E-R3).
 *
 * ONE INTERNAL UNIT: THE PICODOLLAR. 1 USD = 10^12 pUSD, held as a `bigint`.
 *
 * Why picodollars rather than whole micros: providers quote token prices per
 * MILLION tokens. A price of R micros per 1,000,000 tokens is exactly R
 * picodollars per token, so `tokens × R` is an exact integer with no division
 * at all. Whole micros would force a rounding step on every call, and a
 * rounding step is where a positive sub-cent cost quietly becomes zero.
 *
 * THE THREE VALUES THIS MODULE KEEPS APART
 *
 *   null  unknown or incomplete. Never summed as 0, never displayed as $0.00.
 *   0     an authoritative known zero, e.g. a call that never reached a provider.
 *   > 0   positive at every stage. Nothing here rounds a positive value to 0,
 *         and nothing here rounds a sub-cent value up to a whole cent.
 *
 * Rounding happens in exactly one place — `formatUsdForDisplay`, in front of a
 * human — and is never written back into a value that is later summed.
 *
 * BigInt LITERALS (`123n`) are deliberately not used: the app compiles to
 * ES2017, where they are unavailable. `BigInt(...)` works at that target.
 */

export type Picousd = bigint;

const ZERO = BigInt(0);
const TEN = BigInt(10);

/** 1 USD micro = 10^6 pUSD. */
export const PICOUSD_PER_MICRO = BigInt(1_000_000);
/** 1 USD minor unit (cent) = 10^-2 USD = 10^10 pUSD. */
export const PICOUSD_PER_MINOR = BigInt(10_000_000_000);

/** Exact scale of the L0 `estimated_cost_usd_micros` decimal. */
export const MICROS_DECIMAL_SCALE = 6;
/**
 * Exact scale of the E→F `estimated_cost_minor` decimal.
 *
 * Ten, not six. Internal precision is one picodollar, and one picodollar is
 * 10^-10 of a cent; any smaller scale would have to round at the boundary,
 * which O1-E-R3 forbids. The O1-F column therefore needs scale >= 10.
 */
export const MINOR_DECIMAL_SCALE = 10;

export class MoneyError extends Error {
  constructor(public readonly code: "NEGATIVE_AMOUNT" | "INVALID_DECIMAL" | "EXCESS_PRECISION") {
    super(code);
    this.name = "MoneyError";
  }
}

function assertNonNegative(value: bigint): void {
  if (value < ZERO) throw new MoneyError("NEGATIVE_AMOUNT");
}

function pow10(scale: number): bigint {
  let result = BigInt(1);
  for (let i = 0; i < scale; i++) result *= TEN;
  return result;
}

/**
 * Render a non-negative integer as an exact decimal with a fixed scale.
 * `formatFixed(BigInt(300_000_000), 6)` → "300.000000". Never rounds.
 */
export function formatFixed(value: bigint, scale: number): string {
  assertNonNegative(value);
  const digits = value.toString();
  if (scale === 0) return digits;
  const padded = digits.padStart(scale + 1, "0");
  return `${padded.slice(0, padded.length - scale)}.${padded.slice(padded.length - scale)}`;
}

/**
 * Parse an exact non-negative decimal at a fixed scale. Rejects anything that
 * would need rounding, so a value can never lose precision on the way in.
 */
export function parseFixed(text: string, scale: number): bigint {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) throw new MoneyError("INVALID_DECIMAL");
  const whole = match[1]!;
  const fraction = match[2] ?? "";
  if (fraction.length > scale) throw new MoneyError("EXCESS_PRECISION");
  return BigInt(whole) * pow10(scale) + BigInt(fraction.padEnd(scale, "0") || "0");
}

export function picousdFromMicros(micros: bigint): Picousd {
  assertNonNegative(micros);
  return micros * PICOUSD_PER_MICRO;
}

/** L0 representation: exact USD micros, scale 6. "300.000000" for 300 micros. */
export function picousdToMicrosDecimal(value: Picousd): string {
  return formatFixed(value, MICROS_DECIMAL_SCALE);
}

export function microsDecimalToPicousd(text: string): Picousd {
  return parseFixed(text, MICROS_DECIMAL_SCALE);
}

/**
 * E→F representation: exact USD minor units, scale 10. A pure scale change —
 * 300 micros → "0.0300000000". Not 0, and not 1.
 */
export function picousdToMinorDecimal(value: Picousd): string {
  return formatFixed(value, MINOR_DECIMAL_SCALE);
}

export function minorDecimalToPicousd(text: string): Picousd {
  return parseFixed(text, MINOR_DECIMAL_SCALE);
}

/**
 * Sum where any unknown makes the whole sum unknown.
 *
 * This is the rule that stops a partial known sum being reported as complete:
 * one null contributor and the answer is null, not the total of the others.
 * The sum of no contributors is an authoritative zero.
 */
export function sumOrUnknown(values: readonly (Picousd | null)[]): Picousd | null {
  let total = ZERO;
  for (const value of values) {
    if (value === null) return null;
    assertNonNegative(value);
    total += value;
  }
  return total;
}

/**
 * Human presentation — the ONLY place a cost is rounded.
 *
 *   null              → "Unknown"   never "$0.00"
 *   exactly 0         → "$0.00"
 *   0 < v < 1 cent    → "<$0.01"    never "$0.00", never "$0.01"
 *   v >= 1 cent       → rounded half-up to the cent
 *
 * The argument is the exact E→F minor decimal. The formatted string is for
 * display only and must never be parsed back or summed.
 */
export function formatUsdForDisplay(minorDecimal: string | null): string {
  if (minorDecimal === null) return "Unknown";
  const value = minorDecimalToPicousd(minorDecimal);
  if (value === ZERO) return "$0.00";
  if (value < PICOUSD_PER_MINOR) return "<$0.01";
  const cents = (value + PICOUSD_PER_MINOR / BigInt(2)) / PICOUSD_PER_MINOR;
  const dollars = cents / BigInt(100);
  const remainder = cents % BigInt(100);
  return `$${dollars.toString()}.${remainder.toString().padStart(2, "0")}`;
}
