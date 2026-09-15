/**
 * Temperature presentation helpers.
 *
 * Doctor's Diary keeps the authoritative encounter field in Celsius because
 * that is the existing database/API contract. The pilot UI presents
 * temperatures in Fahrenheit. Conversion happens only at the UI/snapshot
 * boundary so no clinical storage migration or unit ambiguity is introduced.
 */

export function celsiusToFahrenheit(celsius: number): number {
  return (celsius * 9) / 5 + 32;
}

export function fahrenheitToCelsius(fahrenheit: number): number {
  return ((fahrenheit - 32) * 5) / 9;
}

function compactOneDecimal(value: number): string {
  const rounded = Math.round((value + Number.EPSILON) * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/** Convert an authoritative Celsius value to the Fahrenheit text shown to users. */
export function celsiusValueToFahrenheitText(
  value: string | number | null | undefined,
): string | null {
  if (value === null || value === undefined || value === "") return null;
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return null;
  return compactOneDecimal(celsiusToFahrenheit(numeric));
}

/**
 * Convert a Fahrenheit input back to the Celsius string expected by the
 * existing draft/storage contract. Empty stays empty; malformed input is not
 * coerced into a clinical value.
 */
export function fahrenheitTextToCelsiusValue(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed === "") return "";
  const numeric = Number(trimmed);
  if (!Number.isFinite(numeric)) return null;
  return compactOneDecimal(fahrenheitToCelsius(numeric));
}

export function fahrenheitRangeFromCelsius(minC: number, maxC: number): string {
  return `${compactOneDecimal(celsiusToFahrenheit(minC))}–${compactOneDecimal(celsiusToFahrenheit(maxC))} °F`;
}
