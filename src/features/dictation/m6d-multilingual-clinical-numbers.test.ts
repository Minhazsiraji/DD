import { describe, expect, it } from "vitest";
import { parseBengaliClinicalNumber } from "./bengali-clinical-number";
import { normalizeClinicalNumbers } from "./normalize";

describe("Bengali clinical number parser", () => {
  it.each([
    ["০", "0"], ["এক", "1"], ["দশ", "10"], ["ষাট", "60"],
    ["ছিয়ানব্বই", "96"], ["আটানব্বই", "98"],
    ["একশ এক", "101"], ["একশ আঠারো", "118"],
    ["একশ ১৮", "118"], ["100 আঠারো", "118"],
    ["একশ এক point five", "101.5"], ["একশ এক দশমিক পাঁচ", "101.5"],
  ])("parses %s as %s", (spoken, expected) => {
    expect(parseBengaliClinicalNumber(spoken)).toBe(expected);
  });

  it.each(["অনেক", "এক থেকে দুই", "তিন চার পাঁচ", "চারশ", "one hundred"]) (
    "rejects unsupported or ambiguous phrase %s",
    (spoken) => expect(parseBengaliClinicalNumber(spoken)).toBeNull(),
  );
});

describe("cue-scoped multilingual clinical measurement normalization", () => {
  it.each([
    ["BP একশ আঠারো by আশি", "BP 118/80"],
    ["BP 118 বাই 80", "BP 118/80"],
    ["বিপি একশ আঠারো বাই আশি", "BP 118/80"],
    ["pulse ছিয়ানব্বই per minute", "pulse 96 per minute"],
    ["temperature একশ এক point five", "temperature 101.5"],
    ["SpO2 আটানব্বই percent", "SpO2 98%"],
    ["weight ষাট kg", "weight 60 kg"],
    ["HR বিরাশি", "HR 82"],
    ["height একশ সত্তর cm", "height 170 cm"],
    ["respiratory rate আঠারো per minute", "respiratory rate 18 per minute"],
    ["পালস ছিয়ানব্বই per minute", "পালস 96 per minute"],
    ["তাপমাত্রা একশ এক point five", "তাপমাত্রা 101.5"],
    ["ওজন ষাট kg", "ওজন 60 kg"],
    ["শ্বাসের হার আঠারো", "শ্বাসের হার 18"],
  ])("normalizes %s only under its clinical cue", (spoken, expected) => {
    expect(normalizeClinicalNumbers(spoken)).toBe(expected);
  });

  it.each([
    "রোগীর বয়স ষাট বছর",
    "একশ আঠারো বাই আশি",
    "Patient took two tablets",
    "Fever for fourteen days",
  ])("leaves uncued prose unchanged: %s", (spoken) => {
    expect(normalizeClinicalNumbers(spoken)).toBe(spoken);
  });
});
