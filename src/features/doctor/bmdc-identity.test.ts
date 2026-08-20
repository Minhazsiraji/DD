import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { BMDC_VECTORS } from "../../../scripts/bmdc-vectors.mjs";
import { normalizeBmdc, isBmdcCollision, BMDC_TAKEN_MESSAGE } from "./identity";

/**
 * One BMDC registration number, one doctor.
 *
 * Two accounts holding one number is two accounts claiming to be the same
 * clinician, and that number prints on prescriptions. The DATABASE decides —
 * `db:verify:identity` proves the constraint against a real one. These guard
 * the TypeScript side and the wiring around it.
 */

describe("normalizeBmdc matches the database's generated column", () => {
  for (const [input, expected] of BMDC_VECTORS as [string, string | null][]) {
    it(`${JSON.stringify(input)} -> ${JSON.stringify(expected)}`, () => {
      expect(normalizeBmdc(input)).toBe(expected);
    });
  }

  it("treats null and undefined as no number", () => {
    expect(normalizeBmdc(null)).toBeNull();
    expect(normalizeBmdc(undefined)).toBeNull();
  });

  it("keeps genuinely different numbers apart", () => {
    // A folding rule that collapsed everything would pass every test above.
    expect(normalizeBmdc("BMDC03029E")).not.toBe(normalizeBmdc("BMDC03029F"));
    expect(normalizeBmdc("A-123")).not.toBe(normalizeBmdc("A-1234"));
  });
});

describe("the SQL and the TypeScript apply the same rule", () => {
  it("the generated column folds case and non-alphanumerics, and blanks to NULL", async () => {
    const migration = await readFile(
      path.resolve("drizzle/migrations/0015_high_captain_midlands.sql"),
      "utf8",
    );
    expect(migration).toMatch(/GENERATED ALWAYS AS/i);
    expect(migration).toMatch(/upper\(/i);
    expect(migration).toMatch(/regexp_replace\(/i);
    expect(migration).toMatch(/\[\^A-Za-z0-9\]/);
    expect(migration).toMatch(/nullif\(/i);
    // STORED, so the index can be built on it.
    expect(migration).toMatch(/STORED/i);
  });

  it("the unique index is partial, on the normalised value", async () => {
    const migration = await readFile(
      path.resolve("drizzle/migrations/0015_high_captain_midlands.sql"),
      "utf8",
    );
    expect(migration).toMatch(/CREATE UNIQUE INDEX "doctor_profiles_bmdc_unique"/);
    expect(migration).toMatch(/"bmdc_normalized"/);
    expect(migration).toMatch(/WHERE bmdc_normalized is not null/i);
  });
});

describe("a collision is explained, not dumped", () => {
  it("recognises the constraint by index name", () => {
    expect(
      isBmdcCollision({
        message: 'duplicate key value violates unique constraint "doctor_profiles_bmdc_unique"',
        code: "23505",
      }),
    ).toBe(true);
  });

  it("does not claim every unique violation is a BMDC clash", () => {
    expect(
      isBmdcCollision({
        message: 'duplicate key value violates unique constraint "doctor_profiles_user_id_key"',
        code: "23505",
      }),
    ).toBe(false);
    expect(isBmdcCollision(null)).toBe(false);
    expect(isBmdcCollision({ message: "network error" })).toBe(false);
  });

  it("never reveals who holds the number", () => {
    /**
     * A registration number identifies a real person, and the signup form is
     * reachable before authentication. Confirming that an account exists — or
     * naming it — would turn the form into a lookup.
     */
    expect(BMDC_TAKEN_MESSAGE).not.toMatch(/@|belongs to|registered to Dr|account of/i);
    expect(BMDC_TAKEN_MESSAGE).toMatch(/already registered/i);
    // And it says what to do next.
    expect(BMDC_TAKEN_MESSAGE).toMatch(/check the number|sign in/i);
  });
});

describe("both write paths translate the refusal", () => {
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

  for (const [label, file] of [
    ["onboarding", "src/features/onboarding/actions.ts"],
    ["settings", "src/features/doctor/actions.ts"],
  ] as const) {
    it(`${label} shows the field error instead of raw Postgres text`, async () => {
      const src = strip(await readFile(path.resolve(file), "utf8"));
      expect(src).toMatch(/isBmdcCollision\(error\)/);
      expect(src).toMatch(/bmdcRegistrationNo: \[BMDC_TAKEN_MESSAGE\]/);
      // The collision branch must come BEFORE the generic message.
      expect(src.indexOf("isBmdcCollision")).toBeLessThan(src.indexOf("unknown error"));
    });
  }
});

describe("the clinic phone is deliberately NOT an identity", () => {
  it("nothing makes practice_locations.phone unique", async () => {
    /**
     * Several doctors legitimately work at one clinic and share its phone
     * number. Making it unique would refuse the second doctor at a hospital.
     */
    const schema = await readFile(path.resolve("src/db/schema.ts"), "utf8");
    const block = schema.slice(
      schema.indexOf('practiceLocations = pgTable('),
      schema.indexOf("export const", schema.indexOf('practiceLocations = pgTable(') + 10),
    );
    expect(block).toMatch(/phone:/);
    expect(block).not.toMatch(/uniqueIndex\([^)]*\)[\s\S]{0,120}phone/);
  });
});
