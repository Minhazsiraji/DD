/**
 * Money on the Owner Dashboard — exact in, honest out.
 *
 * O1-E holds cost as picodollars and hands O1-F an exact fixed-point decimal
 * in MINOR units (cents) at scale 10. Two properties of that contract have to
 * survive the trip to a screen, and both are easy to lose:
 *
 *   A POSITIVE COST NEVER PRINTS AS ZERO. A cost of 0.03 cents is real money
 *   spent; rounding it to "$0.00" tells the owner the opposite. Anything above
 *   zero but below one cent prints as "<$0.01".
 *
 *   NULL IS NOT ZERO. O1-F nulls the cost column when any contributing event
 *   has an unknown cost, precisely so a partial sum is never presented as a
 *   total. Null therefore renders as "Not measured", never as "$0.00".
 *
 * An exact zero — a complete slice that cost nothing, e.g. counted operations
 * that never reached a provider — is a real measurement and prints as "$0.00".
 *
 * Arithmetic here is string/BigInt fixed point. A float would reintroduce the
 * exact rounding error the picodollar unit exists to avoid.
 *
 * Pure: no I/O, no server-only import.
 */

import { NOT_MEASURED, type FormattedMeasurement } from "./measurement";

/** What O1-F puts in a cost column: an exact decimal, or nothing. */
export type MinorAmount = string | number | null | undefined;

/** Symbols we print in front of an amount. Anything else prints as a code. */
const SYMBOL: Record<string, string> = { USD: "$" };

interface Fixed {
  negative: boolean;
  /** Whole minor units (cents). */
  whole: bigint;
  /** Fractional part of one minor unit, as digits. */
  fraction: string;
}

/**
 * Parse an exact decimal in minor units. Returns null for anything that is not
 * a plain decimal — an exponent, a token, a NaN. Fails closed: the caller
 * renders "Not measured" rather than guessing.
 */
export function parseMinor(input: MinorAmount): Fixed | null {
  if (input === null || input === undefined) return null;

  let text: string;
  if (typeof input === "number") {
    if (!Number.isFinite(input)) return null;
    // toFixed avoids exponent notation for the small values that matter here.
    text = Math.abs(input) < 1e21 ? input.toFixed(12) : String(input);
  } else {
    text = input.trim();
  }

  if (!/^-?\d+(\.\d+)?$/.test(text)) return null;

  const negative = text.startsWith("-");
  const unsigned = negative ? text.slice(1) : text;
  const [intPart, fracPart = ""] = unsigned.split(".");
  return { negative, whole: BigInt(intPart), fraction: fracPart.replace(/0+$/, "") };
}

/** True when the amount is exactly zero — every digit, on both sides. */
export function isExactZero(f: Fixed): boolean {
  return f.whole === BigInt(0) && f.fraction === "";
}

/** True when the amount is above zero but below one whole minor unit. */
export function isSubMinor(f: Fixed): boolean {
  return !f.negative && f.whole === BigInt(0) && f.fraction !== "";
}

function group(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** Whole minor units → a major-unit string with exactly two decimals. */
function majorFromMinor(whole: bigint): string {
  const digits = whole.toString().padStart(3, "0");
  return `${group(digits.slice(0, -2))}.${digits.slice(-2)}`;
}

function withCurrency(amount: string, currency: string | null | undefined, negative: boolean): string {
  const sign = negative ? "-" : "";
  const code = (currency ?? "").trim().toUpperCase();
  if (code === "") return `${sign}${amount}`;
  const symbol = SYMBOL[code];
  return symbol ? `${sign}${symbol}${amount}` : `${sign}${code} ${amount}`;
}

/**
 * Format one cost. `currency` is whatever O1-F returned — it is never replaced
 * with an assumed default, because assuming USD on a BDT number is a lie with
 * a hundred-to-one error in it.
 */
export function formatCostMinor(input: MinorAmount, currency: string | null | undefined): FormattedMeasurement {
  const parsed = parseMinor(input);
  if (!parsed) {
    return {
      display: NOT_MEASURED,
      spoken:
        "Cost not measured. At least one contributing event has an unknown cost, so no total is published. This is not zero cost.",
      kind: "absent",
    };
  }

  if (isExactZero(parsed)) {
    const display = withCurrency("0.00", currency, false);
    return { display, spoken: `${display}. A measured zero: this slice is complete and cost nothing.`, kind: "value" };
  }

  if (isSubMinor(parsed)) {
    const display = `<${withCurrency("0.01", currency, false)}`;
    return {
      display,
      spoken: `Less than ${withCurrency("0.01", currency, false)}. A positive cost below one cent, not zero.`,
      kind: "value",
    };
  }

  // Round the fraction of a minor unit, half up, for display only.
  const roundUp = parsed.fraction !== "" && parsed.fraction.charCodeAt(0) >= "5".charCodeAt(0);
  const whole = roundUp ? parsed.whole + BigInt(1) : parsed.whole;
  const display = withCurrency(majorFromMinor(whole), currency, parsed.negative);
  return { display, spoken: display, kind: "value" };
}

export type CostTotal =
  | { state: "measured"; minor: string; currency: string | null }
  /** At least one contributing row was unknown, so there is no total. */
  | { state: "not-measured" };

/**
 * Total a set of cost cells that share one currency.
 *
 * COMPLETENESS IS ALL-OR-NOTHING, the same rule O1-E and O1-F apply upstream:
 * one unknown contributor and the total is "Not measured". Summing the known
 * rows and calling it a total would understate spend by an unknown amount and
 * look authoritative doing it.
 */
export function totalCostMinor(cells: readonly MinorAmount[], currency: string | null): CostTotal {
  const parsed: Fixed[] = [];
  for (const cell of cells) {
    const one = parseMinor(cell);
    if (!one) return { state: "not-measured" };
    parsed.push(one);
  }

  // One common scale, so the sum is exact integer arithmetic end to end.
  const scale = parsed.reduce((max, p) => Math.max(max, p.fraction.length), 0);
  const pow = BigInt(10) ** BigInt(scale);

  let total = BigInt(0);
  for (const p of parsed) {
    const digits = p.fraction.padEnd(scale, "0");
    const value = p.whole * pow + BigInt(digits === "" ? "0" : digits);
    total += p.negative ? -value : value;
  }

  const negative = total < BigInt(0);
  const abs = (negative ? -total : total).toString();
  const sign = negative ? "-" : "";
  const text =
    scale === 0 ? `${sign}${abs}` : `${sign}${abs.padStart(scale + 1, "0").slice(0, -scale)}.${abs.padStart(scale + 1, "0").slice(-scale)}`;

  return { state: "measured", minor: text, currency };
}
