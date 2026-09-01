/**
 * The commercial catalog — the one place money is described.
 *
 * WHY THIS FILE EXISTS. Doctor's Diary was written for one country, and it
 * shows: a plan price column is literally named `monthly_price_bdt`, a taka
 * sign was hard-coded into the billing page, and a payment form asked for an
 * "Amount (BDT)". None of that was a decision anybody made — it was the first
 * currency anyone needed, typed in the first place it was needed.
 *
 * Everything commercial that varies by country now resolves through here:
 * currency, symbol, decimal places and grouping. A second country changes this
 * file and its configuration, not the pages.
 *
 * WHAT THIS FILE DELIBERATELY DOES NOT DO. It sets no price. Prices live in
 * `subscription_plans` in the database, where a platform owner can change them
 * without a deploy, and they arrive here already read. A default written into
 * this file would be a number nobody approved that renders anyway.
 */

export interface Currency {
  code: string;
  symbol: string;
  /** Minor units. Some currencies genuinely have none. */
  decimals: number;
  /** "৳500" vs "500 Ft" — a real difference, not decoration. */
  symbolFirst: boolean;
}

/**
 * Known currencies. Not the world — the ones this product can state correctly
 * today. An unknown code is rendered as the code itself, which is honest and
 * unambiguous, rather than guessed at with the wrong symbol.
 */
export const CURRENCIES: Record<string, Currency> = {
  BDT: { code: "BDT", symbol: "৳", decimals: 2, symbolFirst: true },
  INR: { code: "INR", symbol: "₹", decimals: 2, symbolFirst: true },
  PKR: { code: "PKR", symbol: "₨", decimals: 2, symbolFirst: true },
  LKR: { code: "LKR", symbol: "Rs", decimals: 2, symbolFirst: true },
  NPR: { code: "NPR", symbol: "Rs", decimals: 2, symbolFirst: true },
  USD: { code: "USD", symbol: "$", decimals: 2, symbolFirst: true },
  EUR: { code: "EUR", symbol: "€", decimals: 2, symbolFirst: true },
  GBP: { code: "GBP", symbol: "£", decimals: 2, symbolFirst: true },
  AED: { code: "AED", symbol: "AED", decimals: 2, symbolFirst: true },
  MYR: { code: "MYR", symbol: "RM", decimals: 2, symbolFirst: true },
};

/**
 * The platform's default currency, configurable per deployment.
 *
 * BDT is the fallback because that is where the pilot is, not because the
 * product assumes it. `NEXT_PUBLIC_` because the billing screens that render
 * money are reachable from client components.
 */
export const DEFAULT_CURRENCY_CODE = (
  process.env.NEXT_PUBLIC_PLATFORM_CURRENCY ?? "BDT"
)
  .trim()
  .toUpperCase();

/**
 * Resolve a currency, falling back to the platform default and then to a
 * code-only rendering. Never throws: a missing currency must not take a
 * billing page down.
 */
export function currency(code?: string | null): Currency {
  const wanted = (code ?? "").trim().toUpperCase();
  if (wanted && CURRENCIES[wanted]) return CURRENCIES[wanted]!;
  if (wanted) return { code: wanted, symbol: wanted, decimals: 2, symbolFirst: true };
  return CURRENCIES[DEFAULT_CURRENCY_CODE] ?? CURRENCIES.BDT!;
}

/**
 * Money as text — deterministic, never locale-dependent.
 *
 * `Intl.NumberFormat` with the runtime default locale produces different
 * output on the Node server and in the browser, which is a hydration mismatch
 * on a page showing a price. Grouping is done by hand for the same reason
 * every date helper in `lib/format.ts` is: the output must be byte-identical
 * on both sides.
 *
 * Returns null for a missing amount. A price nobody has set must render as
 * "not set", never as 0 — a doctor reading "৳0" would conclude the product is
 * free.
 */
export function formatMoney(
  amount: number | string | null | undefined,
  code?: string | null,
): string | null {
  if (amount === null || amount === undefined || amount === "") return null;
  const value = typeof amount === "string" ? Number(amount) : amount;
  if (!Number.isFinite(value)) return null;

  const cur = currency(code);
  const negative = value < 0;
  const fixed = Math.abs(value).toFixed(cur.decimals);
  const [whole = "0", fraction] = fixed.split(".");

  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const digits = fraction ? `${grouped}.${fraction}` : grouped;
  const body = cur.symbolFirst ? `${cur.symbol}${digits}` : `${digits} ${cur.symbol}`;
  return negative ? `-${body}` : body;
}

/**
 * A price and the currency it is in, together.
 *
 * Kept as a pair on purpose. An amount that travels without its currency is
 * how "500" ends up rendered with a taka sign in a country that does not use
 * one, and the two fields being separate in the database is exactly why that
 * keeps nearly happening.
 */
export interface Money {
  amount: number;
  currencyCode: string;
}

export function money(amount: number | string | null | undefined, code?: string | null): Money | null {
  if (amount === null || amount === undefined || amount === "") return null;
  const value = typeof amount === "string" ? Number(amount) : amount;
  if (!Number.isFinite(value)) return null;
  return { amount: value, currencyCode: currency(code).code };
}

export function renderMoney(value: Money | null): string | null {
  return value ? formatMoney(value.amount, value.currencyCode) : null;
}

/**
 * THE LEGACY COLUMN NAMES, QUARANTINED.
 *
 * `subscription_plans.monthly_price_bdt` and `annual_price_bdt` predate any
 * thought of a second country. Renaming them is a hand-written migration plus
 * a baseline restamp (see CLAUDE.md), which is not this change. Instead every
 * read of them goes through here, so the rename later touches one function and
 * nothing else in the app carries the assumption.
 *
 * The values themselves were never BDT-specific — they are plain numerics. The
 * currency they are quoted in is the platform's configured currency.
 */
export function planPrice(monthly: number | string | null | undefined): Money | null {
  return money(monthly, DEFAULT_CURRENCY_CODE);
}
