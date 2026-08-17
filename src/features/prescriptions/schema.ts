import { z } from "zod";

/**
 * One medicine line, as the composer sees it.
 *
 * MEDICINE_FIELDS is the single description of the form: the editor renders
 * from it, the patch is built from it, and a suggestion populates through it.
 * The names match the RPC's patch keys exactly, so there is no translation
 * layer to drift.
 *
 * STRENGTH IS NOT DOSE (ADR 0011 §5). "500 mg" is what the tablet contains;
 * "1 tablet" is what the patient takes. They are separate fields and the
 * composer must never merge them.
 *
 * There is ONE schedule field. No structured frequency sits beside it waiting
 * to disagree with what prints.
 */
export type MedicineField =
  | "displayName"
  | "brandName"
  | "genericName"
  | "strengthText"
  | "doseText"
  | "dosageForm"
  | "route"
  | "scheduleText"
  | "durationText"
  | "quantityText"
  | "foodRelation"
  | "instructions";

export interface FieldSpec {
  key: MedicineField;
  label: string;
  placeholder: string;
  hint?: string;
  /** Rendered as a textarea rather than a single line. */
  multiline?: boolean;
  /** Free-typing is always allowed; these are one-tap accelerators. */
  options?: readonly string[];
  /** Column span in the 12-column composer grid, at sm and up. */
  span: 3 | 4 | 6 | 12;
}

/** Common in Bangladesh practice. Suggestions only — never a closed list. */
export const DOSAGE_FORMS = [
  "Tablet", "Capsule", "Syrup", "Suspension", "Drops", "Injection",
  "Inhaler", "Cream", "Ointment", "Sachet", "Suppository",
] as const;

export const ROUTES = [
  "Oral", "Topical", "IV", "IM", "SC", "Inhaled", "Nasal",
  "Ophthalmic", "Otic", "Rectal", "Sublingual",
] as const;

/** "1+0+1" is how a prescription is written here. It is the printable value. */
export const SCHEDULES = [
  "1+0+0", "0+0+1", "1+0+1", "1+1+1", "0+1+0", "1+1+1+1",
  "Every 6 hours", "Every 8 hours", "Once weekly", "STAT",
] as const;

export const DURATIONS = [
  "3 days", "5 days", "7 days", "10 days", "14 days", "1 month", "Continue",
] as const;

export const FOOD_RELATIONS = [
  "After food", "Before food", "With food", "Empty stomach", "At bedtime",
] as const;

export const MEDICINE_FIELDS: readonly FieldSpec[] = [
  {
    key: "displayName",
    label: "Medicine",
    placeholder: "Tab. Napa 500 mg",
    hint: "What prints on the prescription. Type anything — nothing has to be in the list.",
    span: 12,
  },
  { key: "brandName", label: "Brand", placeholder: "Napa", span: 6 },
  { key: "genericName", label: "Generic", placeholder: "Paracetamol", span: 6 },
  {
    key: "strengthText",
    label: "Strength",
    placeholder: "500 mg",
    hint: "What the product contains.",
    span: 4,
  },
  {
    key: "doseText",
    label: "Dose",
    placeholder: "1 tablet",
    hint: "What the patient takes each time.",
    span: 4,
  },
  { key: "dosageForm", label: "Form", placeholder: "Tablet", options: DOSAGE_FORMS, span: 4 },
  { key: "route", label: "Route", placeholder: "Oral", options: ROUTES, span: 4 },
  { key: "scheduleText", label: "Schedule", placeholder: "1+0+1", options: SCHEDULES, span: 4 },
  { key: "durationText", label: "Duration", placeholder: "7 days", options: DURATIONS, span: 4 },
  { key: "quantityText", label: "Quantity", placeholder: "10 tablets", span: 6 },
  {
    key: "foodRelation",
    label: "With food",
    placeholder: "After food",
    options: FOOD_RELATIONS,
    span: 6,
  },
  {
    key: "instructions",
    label: "Instructions for the patient",
    placeholder: "খাবারের পরে, দিনে দুইবার",
    multiline: true,
    span: 12,
  },
];

export type MedicineDraft = Record<MedicineField, string> & {
  isPrn: boolean;
  substitutionAllowed: boolean;
};

export function emptyMedicine(): MedicineDraft {
  const base = Object.fromEntries(MEDICINE_FIELDS.map((f) => [f.key, ""])) as Record<
    MedicineField,
    string
  >;
  return { ...base, isPrn: false, substitutionAllowed: true };
}

/** A stored row, as `prescription_detail` returns it (snake_case from the RPC). */
export interface MedicineRow {
  id: string;
  display_name: string;
  brand_name: string | null;
  generic_name: string | null;
  strength_text: string | null;
  dose_text: string | null;
  dosage_form: string | null;
  route: string | null;
  schedule_text: string | null;
  duration_text: string | null;
  quantity_text: string | null;
  food_relation: string | null;
  is_prn: boolean;
  instructions: string | null;
  substitution_allowed: boolean;
  position: number;
}

const COLUMN: Record<MedicineField, keyof MedicineRow> = {
  displayName: "display_name",
  brandName: "brand_name",
  genericName: "generic_name",
  strengthText: "strength_text",
  doseText: "dose_text",
  dosageForm: "dosage_form",
  route: "route",
  scheduleText: "schedule_text",
  durationText: "duration_text",
  quantityText: "quantity_text",
  foodRelation: "food_relation",
  instructions: "instructions",
};

export function draftFromRow(row: MedicineRow): MedicineDraft {
  const draft = emptyMedicine();
  for (const f of MEDICINE_FIELDS) {
    draft[f.key] = (row[COLUMN[f.key]] as string | null) ?? "";
  }
  draft.isPrn = row.is_prn;
  draft.substitutionAllowed = row.substitution_allowed;
  return draft;
}

/**
 * Editor state to the RPC's patch shape.
 *
 * An emptied box sends `null` — an explicit CLEAR, distinct from omitting the
 * field. The same contract the notes editor uses, for the same reason: a
 * mistyped instruction has to be removable.
 */
export function patchFromDraft(draft: MedicineDraft): Record<string, string | boolean | null> {
  const patch: Record<string, string | boolean | null> = {};
  for (const f of MEDICINE_FIELDS) {
    const value = draft[f.key].trim();
    patch[f.key] = value === "" ? null : value;
  }
  patch.isPrn = draft.isPrn;
  patch.substitutionAllowed = draft.substitutionAllowed;
  return patch;
}

/** Only what actually changed, so an edit never rewrites a field untouched. */
export function changedPatch(
  draft: MedicineDraft,
  base: MedicineDraft,
): Record<string, string | boolean | null> {
  const patch: Record<string, string | boolean | null> = {};
  for (const f of MEDICINE_FIELDS) {
    if (draft[f.key].trim() !== base[f.key].trim()) {
      const value = draft[f.key].trim();
      patch[f.key] = value === "" ? null : value;
    }
  }
  if (draft.isPrn !== base.isPrn) patch.isPrn = draft.isPrn;
  if (draft.substitutionAllowed !== base.substitutionAllowed) {
    patch.substitutionAllowed = draft.substitutionAllowed;
  }
  return patch;
}

export function medicineIsDirty(draft: MedicineDraft, base: MedicineDraft | null): boolean {
  if (!base) {
    return (
      MEDICINE_FIELDS.some((f) => draft[f.key].trim() !== "") ||
      draft.isPrn ||
      !draft.substitutionAllowed
    );
  }
  return Object.keys(changedPatch(draft, base)).length > 0;
}

/**
 * The client never names a location. The server takes it from the session, and
 * the RPC re-checks it — a caller-supplied location would be one more thing to
 * verify and one more way to be wrong.
 */
export const medicineInputSchema = z.object({
  prescriptionId: z.uuid(),
  expectedVersion: z.number().int().positive(),
  patch: z.record(z.string(), z.union([z.string(), z.boolean(), z.null()])),
});

export interface Suggestion extends MedicineDraft {
  timesUsed: number;
}
