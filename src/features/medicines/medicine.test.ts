import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  FORBIDDEN_ADVICE_PHRASES,
  MEDICINE_NORMALIZATION_VECTORS,
  MIN_SEARCH_LENGTH,
  SAVED_DEFAULTS_LABEL,
  defaultDisplayName,
  describeReference,
  draftFromReference,
  findSaved,
  isSearchable,
  normalizeMedicineText,
  sortLibrary,
  toRxDraftSeed,
  type DoctorMedicine,
  type MedicineReference,
} from "./medicine";

function source(file: string): string {
  return readFileSync(path.resolve(process.cwd(), file), "utf8");
}

/**
 * A file with its comments removed.
 *
 * Negative assertions must read the CODE. The prose in this feature names the
 * things it deliberately does not do — "recommended dose", "did you mean",
 * "similarity()" — so scanning raw text would make the explanation fail the
 * test, which pushes the explanation out rather than the defect.
 */
function code(file: string): string {
  return source(file)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\/[^\n]*/g, "");
}

/** SQL comments use a different syntax, so it needs its own stripper. */
function sqlCode(file: string): string {
  return source(file)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*--[^\n]*$/gm, "");
}

function ref(over: Partial<MedicineReference> = {}): MedicineReference {
  return {
    id: "ref-1",
    genericName: "Paracetamol",
    brandName: null,
    strengthText: "500 mg",
    dosageForm: "Tablet",
    manufacturer: null,
    countryCode: "BD",
    regulatorName: "DGDA",
    sourceKind: "MANUAL_SEED",
    lastVerifiedAt: null,
    ...over,
  };
}

function saved(over: Partial<DoctorMedicine> = {}): DoctorMedicine {
  return {
    id: "dm-1",
    medicineReferenceId: null,
    displayName: "Napa 500 mg",
    genericName: "Paracetamol",
    brandName: "Napa",
    strengthText: "500 mg",
    dosageForm: "Tablet",
    route: null,
    defaultDoseText: null,
    defaultScheduleText: null,
    defaultDurationText: null,
    defaultQuantityText: null,
    defaultFoodRelation: null,
    defaultInstructions: null,
    defaultIsPrn: false,
    isFavorite: false,
    usageCount: 0,
    lastUsedAt: null,
    isActive: true,
    ...over,
  };
}

describe("normalisation agrees with the database", () => {
  it("folds exactly as the vectors say", () => {
    for (const [input, expected] of MEDICINE_NORMALIZATION_VECTORS) {
      expect(normalizeMedicineText(input), JSON.stringify(input)).toBe(expected);
    }
  });

  /**
   * The rule exists twice — here and in `normalize_medicine_text()` plus the
   * `generated always as` columns. If they drift, a query stops matching rows
   * the database keyed, silently, looking exactly like "not in the catalogue".
   * So the SQL expression is pinned character-for-character.
   */
  it("is the same expression in SQL", () => {
    const sql = source("supabase/policies/0043_medicines_v1.sql");
    expect(sql).toContain(
      "lower(btrim(regexp_replace(coalesce(p_text, ''), '\\s+', ' ', 'g')))",
    );

    // And the generated columns fold identically, or stored keys and query
    // keys are produced by different rules.
    const schema = source("src/db/schema.ts");
    expect(schema).toContain(
      "lower(btrim(regexp_replace(generic_name, '\\\\s+', ' ', 'g')))",
    );
    expect(schema).toContain(
      "lower(btrim(regexp_replace(display_name, '\\\\s+', ' ', 'g')))",
    );
  });

  /**
   * `\\s` in the template literal, never `\s`. A single backslash is consumed
   * before Postgres sees it and the expression then collapses runs of the
   * letter "s" — "Bed rest" keys as "bed ret". This already happened once in
   * this codebase, in `doctor_phrases`.
   */
  it("emits a real whitespace class, not a collapsed letter s", () => {
    const migration = source("drizzle/migrations/0022_medicines_v1.sql");
    expect(migration).toContain("regexp_replace(generic_name, '\\s+', ' ', 'g')");
    expect(migration).not.toContain("regexp_replace(generic_name, 's+', ' ', 'g')");
  });
});

describe("search is literal and never substitutes", () => {
  it("refuses a query shorter than the minimum", () => {
    expect(MIN_SEARCH_LENGTH).toBe(2);
    expect(isSearchable("")).toBe(false);
    expect(isSearchable("p")).toBe(false);
    expect(isSearchable(" p ")).toBe(false);
    expect(isSearchable("pa")).toBe(true);
  });

  /**
   * THE CENTRAL SAFETY PROPERTY OF THIS FEATURE.
   *
   * A search that offers a different molecule than the one typed is a
   * prescribing hazard. "Metformin" and "Metronidazole" share five letters;
   * any similarity threshold loose enough to forgive a typo is loose enough to
   * rank one against the other. So there is no fuzzy operator anywhere.
   */
  it("uses no fuzzy, phonetic or auto-correcting matcher in SQL", () => {
    const sql = sqlCode("supabase/policies/0043_medicines_v1.sql");
    for (const banned of [
      "similarity(",
      "% ",           // pg_trgm's similarity operator
      "<->",          // pg_trgm distance
      "levenshtein",
      "soundex",
      "metaphone",
      "difference(",
      "pg_trgm",
      "to_tsquery",   // stemming would match a different molecule's root
      "plainto_tsquery",
      "websearch_to_tsquery",
    ]) {
      expect(sql.includes(banned), `SQL must not use ${banned}`).toBe(false);
    }
    // What it DOES use: literal containment.
    expect(sql).toContain("like '%'");
  });

  /**
   * The search box transports what was typed and nothing else. It is never
   * handed the results, so it has nothing to re-rank, and it runs no matcher of
   * its own — matching happens in one auditable place, `search_medicines`.
   *
   * Asserted on identifiers rather than words: the component's visible copy
   * says "nothing is auto-corrected or substituted", and a word-scan would make
   * that promise fail the test that exists to keep it.
   */
  it("runs no matcher of its own and never re-ranks results", () => {
    const search = code("src/features/medicines/components/medicine-search.tsx");
    for (const banned of [
      "similarity(",
      "levenshtein",
      "distance(",
      "fuzzy",
      "didYouMean",
      ".sort(",
      ".filter(",
      "results",
    ]) {
      expect(search.includes(banned), `search box must not contain ${banned}`).toBe(false);
    }
  });

  /**
   * An empty result must stay empty. The UI says the medicine is not in the
   * catalogue and offers to let the doctor type it — it never fills the silence
   * with a plausible neighbour.
   */
  it("offers no alternative medicine when nothing matches", () => {
    const list = code("src/features/medicines/components/reference-list.tsx");
    expect(list).toContain("Not in the catalogue");
    expect(list.toLowerCase()).not.toContain("did you mean");
    expect(list.toLowerCase()).not.toContain("similar medicine");
  });
});

describe("a saved default is recall, never advice", () => {
  it("is labelled as the doctor's own", () => {
    expect(SAVED_DEFAULTS_LABEL).toBe("My saved defaults");
  });

  /**
   * The wording is load-bearing. "My saved defaults" is a true statement about
   * this doctor's past behaviour; "recommended dose" would be a clinical claim
   * by Doctor's Diary, which has no source for one.
   */
  it("never calls a default recommended, suggested, usual or safe", () => {
    /**
     * The files a doctor actually reads. `medicine.ts` is excluded because it
     * DECLARES the forbidden vocabulary — scanning it would fail on the list
     * whose whole job is to keep these words off the screen.
     */
    for (const file of [
      "src/features/medicines/components/library-list.tsx",
      "src/features/medicines/components/defaults-form.tsx",
      "src/features/medicines/components/reference-list.tsx",
      "src/app/(app)/medicines/page.tsx",
    ]) {
      const text = code(file).toLowerCase();
      for (const phrase of FORBIDDEN_ADVICE_PHRASES) {
        expect(text.includes(phrase), `${file} must not say "${phrase}"`).toBe(false);
      }
    }
  });

  /** The vocabulary lives in one place, so the rule cannot be half-applied. */
  it("keeps the forbidden vocabulary in the domain module", () => {
    expect(FORBIDDEN_ADVICE_PHRASES).toContain("recommended dose");
    expect(FORBIDDEN_ADVICE_PHRASES.length).toBeGreaterThanOrEqual(5);
  });

  it("states who authored the defaults and who is responsible", () => {
    const list = source("src/features/medicines/components/library-list.tsx");
    expect(list).toContain("SAVED_DEFAULTS_DISCLAIMER");
    const domain = source("src/features/medicines/medicine.ts");
    expect(domain).toMatch(/not medical advice/i);
    expect(domain).toMatch(/You review and confirm every prescription/i);
  });

  /**
   * Nothing is pre-filled. A dose appearing in the form without the doctor
   * typing it would be Doctor's Diary making a clinical suggestion.
   */
  it("invents no defaults when a catalogue row is saved", () => {
    const draft = draftFromReference(ref({ brandName: "Napa" }));
    expect(draft.displayName).toBe("Napa 500 mg");
    for (const key of [
      "defaultDoseText",
      "defaultScheduleText",
      "defaultDurationText",
      "defaultQuantityText",
      "defaultFoodRelation",
      "defaultInstructions",
    ] as const) {
      expect(draft[key], key).toBeNull();
    }
    expect(draft.defaultIsPrn).toBe(false);
  });
});

describe("presentation", () => {
  it("never hides the molecule behind a brand", () => {
    expect(describeReference(ref({ brandName: "Napa" }))).toBe(
      "Napa 500 mg — Paracetamol (Tablet)",
    );
    // Generic-only entries are complete entries and read cleanly.
    expect(describeReference(ref())).toBe("Paracetamol 500 mg (Tablet)");
  });

  it("leaves no empty punctuation when fields are absent", () => {
    const bare = describeReference(
      ref({ brandName: null, strengthText: null, dosageForm: null }),
    );
    expect(bare).toBe("Paracetamol");
    expect(bare).not.toMatch(/—|\(\)|\s{2}/);
  });

  it("names a saved entry the way a prescription would print it", () => {
    expect(defaultDisplayName(ref({ brandName: "Napa" }))).toBe("Napa 500 mg");
    expect(defaultDisplayName(ref({ strengthText: null }))).toBe("Paracetamol");
  });
});

describe("the personal library", () => {
  it("puts favourites first, then most recently used", () => {
    const rows = [
      saved({ id: "a", displayName: "Aaa", usageCount: 99 }),
      saved({ id: "b", displayName: "Bbb", lastUsedAt: "2026-08-01T00:00:00Z" }),
      saved({ id: "c", displayName: "Ccc", isFavorite: true }),
      saved({ id: "d", displayName: "Ddd", lastUsedAt: "2026-08-20T00:00:00Z" }),
    ];
    expect(sortLibrary(rows).map((r) => r.id)).toEqual(["c", "d", "b", "a"]);
  });

  it("does not mutate the array it was given", () => {
    const rows = [saved({ id: "a" }), saved({ id: "b", isFavorite: true })];
    const before = rows.map((r) => r.id);
    sortLibrary(rows);
    expect(rows.map((r) => r.id)).toEqual(before);
  });

  /**
   * The "already saved" answer must be the same answer the INSERT would give,
   * or the row offers Add and the write then fails as a duplicate.
   */
  it("recognises an already-saved medicine by the database's own key", () => {
    const library = [saved({ displayName: "  napa   500 MG ", strengthText: "500 mg" })];
    expect(findSaved(library, ref({ brandName: "Napa" }))).toBeDefined();
  });

  it("treats a different strength as a different saved medicine", () => {
    const library = [saved({ displayName: "Napa 500 mg", strengthText: "500 mg" })];
    expect(
      findSaved(library, ref({ brandName: "Napa", strengthText: "665 mg" })),
    ).toBeUndefined();
  });
});

describe("the prescription integration boundary", () => {
  /**
   * `toRxDraftSeed` is the entire declared contract for a later integration:
   * a field copy into an editable draft. It is not wired to anything on this
   * branch, and it must never do more than copy.
   */
  it("copies saved text and infers nothing", () => {
    const seed = toRxDraftSeed(
      saved({
        defaultDoseText: "1 tablet",
        defaultScheduleText: "1+0+1",
        defaultDurationText: "3 days",
        defaultFoodRelation: "After food",
        defaultIsPrn: true,
      }),
    );
    expect(seed).toEqual({
      displayName: "Napa 500 mg",
      brandName: "Napa",
      genericName: "Paracetamol",
      strengthText: "500 mg",
      dosageForm: "Tablet",
      route: null,
      doseText: "1 tablet",
      scheduleText: "1+0+1",
      durationText: "3 days",
      quantityText: null,
      foodRelation: "After food",
      instructions: null,
      isPrn: true,
    });
  });

  it("passes empty defaults through as empty, never as a filled-in guess", () => {
    const seed = toRxDraftSeed(saved());
    expect(seed.doseText).toBeNull();
    expect(seed.scheduleText).toBeNull();
    expect(seed.durationText).toBeNull();
  });
});
