import { describe, it, expect } from "vitest";
import { translateSaveError, GENERIC_SAVE_ERROR } from "./errors";
import { buildPatch, changedKeys, validateVitals } from "./draft-patch";
import { emptyDraft, type DraftValues } from "./schema";

function draft(overrides: Partial<DraftValues> = {}): DraftValues {
  return { ...emptyDraft(), ...overrides };
}

describe("translateSaveError", () => {
  it("reads a version conflict as a decision, not a fault", () => {
    const r = translateSaveError(
      'new row violates: ENCOUNTER_VERSION_CONFLICT (SQLSTATE 40001)',
    );
    expect(r.kind).toBe("conflict");
    expect(r.unexpected).toBe(false);
    expect(r.message).toMatch(/your text is still here/i);
  });

  /**
   * The one thing this copy must never do. A doctor who believes their typing
   * is gone will retype notes that are sitting on the screen in front of them.
   */
  it("never suggests the typed text was lost", () => {
    const messages = [
      "ENCOUNTER_VERSION_CONFLICT",
      "ENCOUNTER_NOT_DRAFT",
      "VITAL_OUT_OF_RANGE",
      "PATCH_INVALID",
      "encounter not found",
      "something nobody has ever seen",
    ];
    for (const m of messages) {
      // "Nothing has been lost" is the reassurance, not a claim of loss — drop
      // the negation before looking for the words that would panic someone.
      const claim = translateSaveError(m).message.replace(/nothing has been lost/i, "");
      expect(claim).not.toMatch(/\blost\b|\bdiscarded\b|\bdeleted\b|\bgone\b/i);
    }
  });

  it("says so explicitly when it has no idea what went wrong", () => {
    expect(GENERIC_SAVE_ERROR).toMatch(/nothing has been lost/i);
  });

  it.each([
    ["ENCOUNTER_NOT_DRAFT", /already been closed/i],
    ["VITAL_OUT_OF_RANGE", /outside what can be measured/i],
    ["PATCH_EMPTY", /nothing has changed/i],
    ["APPOINTMENT_NOT_IN_CONSULTATION", /start the consultation from the queue/i],
  ])("recognises %s", (raw, expected) => {
    const r = translateSaveError(raw);
    expect(r.message).toMatch(expected);
    expect(r.kind).toBe("error");
  });

  /** Missing, not-yours and elsewhere get ONE answer, as the database intends. */
  it("does not distinguish why an encounter is unavailable", () => {
    expect(translateSaveError("encounter not found").message).toMatch(
      /no longer available at your current location/i,
    );
  });

  it("falls back to one stable sentence and flags it for logging", () => {
    const r = translateSaveError(
      'function public.save_encounter_sections(uuid) does not exist SQLSTATE 42883',
    );
    expect(r.message).toBe(GENERIC_SAVE_ERROR);
    expect(r.unexpected).toBe(true);
  });

  /** The fallback must never echo schema shape back to a doctor. */
  it("never leaks database detail", () => {
    const raw =
      'ERROR: relation "public.encounters" violates constraint "encounters_spo2_range" at character 42';
    const r = translateSaveError(raw);
    expect(r.message).not.toMatch(/encounters|constraint|relation|character|public\./);
  });
});

describe("buildPatch", () => {
  it("sends only what changed", () => {
    const baseline = draft({ chiefComplaints: "Fever", advice: "Rest" });
    const values = draft({ chiefComplaints: "Fever and cough", advice: "Rest" });
    expect(buildPatch(values, baseline)).toEqual({ chiefComplaints: "Fever and cough" });
  });

  it("sends nothing when nothing changed", () => {
    const same = draft({ examination: "Chest clear" });
    expect(buildPatch(same, same)).toEqual({});
    expect(changedKeys(same, same)).toEqual([]);
  });

  /**
   * The distinction the whole patch contract exists for: an emptied box is an
   * explicit CLEAR, not an omission. Without it a mistyped vital is permanent.
   */
  it("turns an emptied field into an explicit null", () => {
    const baseline = draft({ vitalSpo2: "97", assessment: "Viral" });
    const values = draft({ vitalSpo2: "", assessment: "" });
    expect(buildPatch(values, baseline)).toEqual({ vitalSpo2: null, assessment: null });
  });

  it("sends vitals as numbers and sections as text", () => {
    const patch = buildPatch(draft({ vitalPulseBpm: "88", advice: "Fluids" }), draft());
    expect(patch.vitalPulseBpm).toBe(88);
    expect(patch.advice).toBe("Fluids");
  });

  /** Whitespace-only is empty, and must not save a box full of spaces. */
  it("treats a whitespace-only edit as no change", () => {
    const baseline = draft({ advice: "Rest" });
    expect(buildPatch(draft({ advice: "  Rest  " }), baseline)).toEqual({});
  });

  it("does not confuse a zero with an empty box", () => {
    const patch = buildPatch(draft({ vitalSpo2: "0" }), draft({ vitalSpo2: "" }));
    expect(patch.vitalSpo2).toBe(0);
  });
});

describe("validateVitals", () => {
  /**
   * These are TECHNICAL bounds, not normal ranges. Every value here belongs to
   * a genuinely sick patient and must be recordable — refusing them would be
   * far worse than storing an odd number.
   */
  it.each([
    ["a severe tachycardia", { vitalPulseBpm: "220" }],
    ["a saturation of 60", { vitalSpo2: "60" }],
    ["a fever of 42", { vitalTemperatureC: "42" }],
    ["a hypertensive crisis", { vitalSystolic: "250", vitalDiastolic: "140" }],
    ["a newborn", { vitalWeightKg: "2.5", vitalHeightCm: "48" }],
    ["SpO2 at exactly 0", { vitalSpo2: "0" }],
    ["SpO2 at exactly 100", { vitalSpo2: "100" }],
  ])("accepts %s", (_label, values) => {
    expect(validateVitals(draft(values))).toEqual({});
  });

  it.each([
    ["an impossible saturation", { vitalSpo2: "900" }],
    ["a negative pulse", { vitalPulseBpm: "-70" }],
    ["a zero pulse", { vitalPulseBpm: "0" }],
    ["a unit slip in height", { vitalHeightCm: "3000" }],
    ["Fahrenheit in the Celsius box", { vitalTemperatureC: "98.6" }],
    ["a fractional pulse", { vitalPulseBpm: "72.4" }],
  ])("refuses %s", (_label, values) => {
    expect(Object.keys(validateVitals(draft(values)))).toHaveLength(1);
  });

  it("says nothing about an empty vital", () => {
    expect(validateVitals(draft({ vitalSpo2: "" }))).toEqual({});
  });

  /** The message names a measurement limit, never a judgement on the patient. */
  it("explains the limit without diagnosing", () => {
    const message = validateVitals(draft({ vitalSpo2: "900" })).vitalSpo2 ?? "";
    expect(message).toMatch(/typing or unit slip/i);
    expect(message).not.toMatch(/abnormal|invalid|dangerous/i);
  });
});
