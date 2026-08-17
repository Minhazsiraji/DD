import { describe, it, expect } from "vitest";
import {
  MEDICINE_FIELDS,
  changedPatch,
  draftFromRow,
  emptyMedicine,
  medicineIsDirty,
  medicineInputSchema,
  patchFromDraft,
  type MedicineRow,
} from "./schema";

/**
 * The pure half of the composer.
 *
 * These helpers decide what is actually SENT to the database, so the safety
 * properties the reviewer asked for are provable here rather than only in a
 * browser: strength never merges into dose, an emptied box clears rather than
 * being ignored, an untouched field is never rewritten, and Bangla text
 * survives the round trip unchanged.
 */

function row(overrides: Partial<MedicineRow> = {}): MedicineRow {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    display_name: "Tab. Napa 500 mg",
    brand_name: "Napa",
    generic_name: "Paracetamol",
    strength_text: "500 mg",
    dose_text: "1 tablet",
    dosage_form: "Tablet",
    route: "Oral",
    schedule_text: "1+0+1",
    duration_text: "7 days",
    quantity_text: "14 tablets",
    food_relation: "After food",
    is_prn: false,
    instructions: "খাবারের পরে",
    substitution_allowed: true,
    position: 1,
    ...overrides,
  };
}

describe("the medicine field model", () => {
  it("keeps strength and dose as separate fields", () => {
    const keys = MEDICINE_FIELDS.map((f) => f.key);
    expect(keys).toContain("strengthText");
    expect(keys).toContain("doseText");

    const patch = patchFromDraft(draftFromRow(row()));
    expect(patch.strengthText).toBe("500 mg");
    expect(patch.doseText).toBe("1 tablet");
  });

  it("carries exactly one frequency representation", () => {
    // Two editable frequencies can disagree, and the printed one wins silently.
    const frequencyish = MEDICINE_FIELDS.filter((f) =>
      /schedule|frequency|timesPerDay|interval/i.test(f.key),
    );
    expect(frequencyish.map((f) => f.key)).toEqual(["scheduleText"]);
  });

  it("round-trips a stored row without altering any character", () => {
    const original = row();
    const patch = patchFromDraft(draftFromRow(original));
    expect(patch.displayName).toBe(original.display_name);
    expect(patch.instructions).toBe("খাবারের পরে");
    expect(patch.isPrn).toBe(false);
    expect(patch.substitutionAllowed).toBe(true);
  });

  it("preserves Unicode instructions verbatim through the patch", () => {
    const draft = emptyMedicine();
    draft.displayName = "ট্যাব. নাপা ৫০০ মি.গ্রা.";
    draft.instructions = "খাবারের পরে, দিনে দুইবার — ৭ দিন";
    const patch = patchFromDraft(draft);
    expect(patch.displayName).toBe("ট্যাব. নাপা ৫০০ মি.গ্রা.");
    expect(patch.instructions).toBe("খাবারের পরে, দিনে দুইবার — ৭ দিন");
  });

  it("accepts free text in every option-backed field", () => {
    // The chips are accelerators. A doctor must still be able to write
    // something the list has never heard of.
    const draft = emptyMedicine();
    draft.displayName = "Syp. Ambrox";
    draft.scheduleText = "2 spoons at night only if coughing";
    draft.dosageForm = "Nebuliser solution";
    const patch = patchFromDraft(draft);
    expect(patch.scheduleText).toBe("2 spoons at night only if coughing");
    expect(patch.dosageForm).toBe("Nebuliser solution");
  });
});

describe("patchFromDraft", () => {
  it("sends an emptied field as an explicit clear, not as an omission", () => {
    const draft = draftFromRow(row());
    draft.instructions = "   ";
    expect(patchFromDraft(draft).instructions).toBeNull();
  });

  it("trims surrounding whitespace before it reaches the record", () => {
    const draft = emptyMedicine();
    draft.displayName = "  Tab. Napa 500 mg  ";
    expect(patchFromDraft(draft).displayName).toBe("Tab. Napa 500 mg");
  });
});

describe("changedPatch", () => {
  it("sends nothing at all when nothing was touched", () => {
    const base = draftFromRow(row());
    expect(changedPatch({ ...base }, base)).toEqual({});
  });

  it("sends only the field that changed, leaving the rest untouched", () => {
    const base = draftFromRow(row());
    const draft = { ...base, doseText: "2 tablets" };
    expect(changedPatch(draft, base)).toEqual({ doseText: "2 tablets" });
  });

  it("clears a field the doctor emptied", () => {
    const base = draftFromRow(row());
    const draft = { ...base, durationText: "" };
    expect(changedPatch(draft, base)).toEqual({ durationText: null });
  });

  it("carries a flipped checkbox even though it is not text", () => {
    const base = draftFromRow(row());
    expect(changedPatch({ ...base, isPrn: true }, base)).toEqual({ isPrn: true });
    expect(changedPatch({ ...base, substitutionAllowed: false }, base)).toEqual({
      substitutionAllowed: false,
    });
  });

  it("does not treat re-typed whitespace as a change", () => {
    const base = draftFromRow(row());
    expect(changedPatch({ ...base, doseText: " 1 tablet " }, base)).toEqual({});
  });
});

describe("medicineIsDirty", () => {
  it("is false for an untouched new medicine", () => {
    expect(medicineIsDirty(emptyMedicine(), null)).toBe(false);
  });

  it("is true as soon as anything is typed into a new medicine", () => {
    expect(medicineIsDirty({ ...emptyMedicine(), displayName: "N" }, null)).toBe(true);
  });

  it("is true when a checkbox alone was changed on a new medicine", () => {
    expect(medicineIsDirty({ ...emptyMedicine(), isPrn: true }, null)).toBe(true);
    expect(medicineIsDirty({ ...emptyMedicine(), substitutionAllowed: false }, null)).toBe(true);
  });

  it("is false for an existing medicine reopened and not edited", () => {
    const base = draftFromRow(row());
    expect(medicineIsDirty({ ...base }, base)).toBe(false);
  });

  it("is true for an existing medicine with one edited field", () => {
    const base = draftFromRow(row());
    expect(medicineIsDirty({ ...base, scheduleText: "1+1+1" }, base)).toBe(true);
  });
});

describe("medicineInputSchema", () => {
  const valid = {
    prescriptionId: "22222222-2222-4222-8222-222222222222",
    expectedVersion: 3,
    patch: { displayName: "Tab. Napa 500 mg" },
  };

  it("accepts a well-formed medicine write", () => {
    expect(medicineInputSchema.safeParse(valid).success).toBe(true);
  });

  it("has no location field — the server takes it from the session", () => {
    const parsed = medicineInputSchema.parse({ ...valid, practiceLocationId: "anything" });
    expect(parsed).not.toHaveProperty("practiceLocationId");
  });

  it("rejects a version that could never have been earned", () => {
    expect(medicineInputSchema.safeParse({ ...valid, expectedVersion: 0 }).success).toBe(false);
    expect(medicineInputSchema.safeParse({ ...valid, expectedVersion: -1 }).success).toBe(false);
    expect(medicineInputSchema.safeParse({ ...valid, expectedVersion: 1.5 }).success).toBe(false);
  });

  it("rejects an id that is not a prescription id", () => {
    expect(medicineInputSchema.safeParse({ ...valid, prescriptionId: "1" }).success).toBe(false);
  });

  it("allows null in a patch, because null is how a field is cleared", () => {
    const parsed = medicineInputSchema.safeParse({ ...valid, patch: { instructions: null } });
    expect(parsed.success).toBe(true);
  });
});
