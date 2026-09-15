import { describe, expect, it } from "vitest";
import {
  celsiusToFahrenheit,
  celsiusValueToFahrenheitText,
  fahrenheitTextToCelsiusValue,
  fahrenheitToCelsius,
} from "./temperature";

describe("temperature presentation boundary", () => {
  it("shows normal body temperature in Fahrenheit", () => {
    expect(celsiusToFahrenheit(37)).toBeCloseTo(98.6, 8);
    expect(celsiusValueToFahrenheitText("37")).toBe("98.6");
  });

  it("converts Fahrenheit input back to the existing Celsius storage contract", () => {
    expect(fahrenheitToCelsius(98.6)).toBeCloseTo(37, 8);
    expect(fahrenheitTextToCelsiusValue("98.6")).toBe("37");
  });

  it("preserves blank as blank and refuses malformed input", () => {
    expect(fahrenheitTextToCelsiusValue("  ")).toBe("");
    expect(fahrenheitTextToCelsiusValue("not-a-temperature")).toBeNull();
    expect(celsiusValueToFahrenheitText(null)).toBeNull();
  });

  it("keeps one-decimal clinical precision without useless .0", () => {
    expect(celsiusValueToFahrenheitText("38.4")).toBe("101.1");
    expect(celsiusValueToFahrenheitText("40")).toBe("104");
  });
});
