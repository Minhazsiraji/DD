import { describe, it, expect } from "vitest";
import {
  normalizeName,
  normalizePhone,
  computeAge,
  findDuplicates,
  formatAge,
  type DuplicateCandidate,
} from "./identity";

describe("normalizeName", () => {
  it("folds the honorifics people actually write", () => {
    const target = "rahim hossain";
    for (const variant of [
      "Rahim Hossain",
      "Md. Rahim Hossain",
      "MD Rahim  Hossain",
      "Mohammad Rahim Hossain",
      "  Rahim   Hossain  ",
      "Rahim-Hossain",
    ]) {
      expect(normalizeName(variant), variant).toBe(target);
    }
  });

  it("strips stacked honorifics", () => {
    expect(normalizeName("Md. Alhaj Rahim Hossain")).toBe("rahim hossain");
  });

  it("keeps distinct people distinct", () => {
    expect(normalizeName("Rahim Hossain")).not.toBe(normalizeName("Karim Hossain"));
  });

  it("does not reduce a name to nothing", () => {
    // A patient legitimately recorded only as "Md" must not normalise to "".
    expect(normalizeName("Md").length).toBeGreaterThan(0);
  });
});

describe("normalizePhone", () => {
  it("folds Bangladeshi formats to one form", () => {
    for (const v of [
      "+8801711000124",
      "8801711000124",
      "01711000124",
      "01711-000124",
      "+880 1711 000124",
    ]) {
      expect(normalizePhone(v), v).toBe("01711000124");
    }
  });

  it("returns null for empty input rather than an empty string", () => {
    // Null must not compare equal to another null phone during dedupe.
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone(null)).toBeNull();
    expect(normalizePhone("   ")).toBeNull();
  });
});

describe("computeAge", () => {
  const today = "2026-08-08";

  it("computes exact age and subtracts an unreached birthday", () => {
    expect(computeAge({ dob: "1990-08-07", dobPrecision: "DAY" }, today)).toEqual({
      years: 36,
      isApproximate: false,
    });
    expect(computeAge({ dob: "1990-08-09", dobPrecision: "DAY" }, today)).toEqual({
      years: 35,
      isApproximate: false,
    });
  });

  it("marks year-only birth dates as approximate", () => {
    const a = computeAge({ dob: "1990-01-01", dobPrecision: "YEAR" }, today);
    expect(a.years).toBe(36);
    expect(a.isApproximate).toBe(true);
  });

  it("ages an AGE_ONLY record forward from when it was recorded", () => {
    // Recorded as 40 in 2023 — the patient is 43 now, not still 40.
    const a = computeAge(
      { dobPrecision: "AGE_ONLY", approxAgeYears: 40, ageRecordedOn: "2023-05-01" },
      today,
    );
    expect(a.years).toBe(43);
    expect(a.isApproximate).toBe(true);
  });

  it("returns null rather than guessing when nothing is known", () => {
    expect(computeAge({}, today).years).toBeNull();
    expect(computeAge({ dobPrecision: "AGE_ONLY" }, today).years).toBeNull();
  });

  it("never returns a negative age", () => {
    expect(computeAge({ dob: "2030-01-01", dobPrecision: "DAY" }, today).years).toBe(0);
  });

  it("flags estimates when formatted", () => {
    expect(formatAge({ years: 43, isApproximate: true })).toBe("~43y");
    expect(formatAge({ years: 43, isApproximate: false })).toBe("43y");
    expect(formatAge({ years: null, isApproximate: false })).toBe("Age unknown");
  });
});

describe("findDuplicates", () => {
  const candidate = (over: Partial<DuplicateCandidate> = {}): DuplicateCandidate => ({
    id: "p1",
    fullName: "Rahim Hossain",
    nameNormalized: "rahim hossain",
    phoneNormalized: "01711000124",
    patientNumber: "AA-000001",
    ageYears: 40,
    ...over,
  });

  it("flags same name and phone as high confidence", () => {
    const [m] = findDuplicates(
      { nameNormalized: "rahim hossain", phoneNormalized: "01711000124", ageYears: 40 },
      [candidate()],
    );
    expect(m.confidence).toBe("high");
  });

  it("treats a matching phone alone as worth a look", () => {
    const [m] = findDuplicates(
      { nameNormalized: "someone else", phoneNormalized: "01711000124", ageYears: 30 },
      [candidate()],
    );
    expect(m.confidence).toBe("medium");
    expect(m.reason).toMatch(/phone/i);
  });

  it("downgrades a same-name match when the age clearly differs", () => {
    // Father and son sharing a name is common; a machine must not call it a dupe.
    const [m] = findDuplicates(
      { nameNormalized: "rahim hossain", phoneNormalized: null, ageYears: 12 },
      [candidate({ phoneNormalized: null })],
    );
    expect(m.confidence).toBe("low");
  });

  it("does not match two people who merely share a surname", () => {
    const matches = findDuplicates(
      { nameNormalized: "karim ahmed", phoneNormalized: null, ageYears: 50 },
      [candidate({ nameNormalized: "rahim hossain", phoneNormalized: null })],
    );
    expect(matches).toEqual([]);
  });

  it("never treats two missing phone numbers as a match", () => {
    const matches = findDuplicates(
      { nameNormalized: "different person", phoneNormalized: null, ageYears: 20 },
      [candidate({ nameNormalized: "another person", phoneNormalized: null })],
    );
    expect(matches).toEqual([]);
  });

  it("returns nothing when there is nothing to compare against", () => {
    expect(
      findDuplicates({ nameNormalized: "rahim hossain", phoneNormalized: "01711000124" }, []),
    ).toEqual([]);
  });

  it("ranks high confidence first and caps the list", () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      candidate({ id: `p${i}`, patientNumber: `AA-${i}` }),
    );
    const matches = findDuplicates(
      { nameNormalized: "rahim hossain", phoneNormalized: "01711000124", ageYears: 40 },
      many,
    );
    expect(matches.length).toBeLessThanOrEqual(5);
    expect(matches[0].confidence).toBe("high");
  });
});
