import type { MedicineField } from "./schema";

/**
 * Free-text prescription fields where voice may assist the editable draft.
 *
 * Form, route and food relation stay chip/type driven for now: they already
 * have compact accelerators and adding microphone controls to every small field
 * would add clutter without changing the trusted Add/Review/Finalize path.
 */
export const PRESCRIPTION_DICTATION_FIELDS = [
  "displayName",
  "brandName",
  "genericName",
  "strengthText",
  "doseText",
  "scheduleText",
  "durationText",
  "quantityText",
  "instructions",
] as const satisfies readonly MedicineField[];

const DICTATABLE = new Set<MedicineField>(PRESCRIPTION_DICTATION_FIELDS);

export function medicineFieldSupportsDictation(field: MedicineField): boolean {
  return DICTATABLE.has(field);
}
