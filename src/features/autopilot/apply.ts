import type { AutopilotPrescription } from "./contracts";
import type { MedicineRow } from "@/features/prescriptions/schema";

export const AUTOPILOT_REVIEW_LABEL = "AI-generated proposal — review before applying";

const clean = (value: string | null | undefined) => (value ?? "").trim().toLocaleLowerCase();

export function medicineIdentity(value: {
  displayName?: string | null;
  strengthText?: string | null;
  dosageForm?: string | null;
}) {
  return [clean(value.displayName), clean(value.strengthText), clean(value.dosageForm)].join("|");
}

export function medicineExactKey(value: {
  displayName?: string | null; brandName?: string | null; genericName?: string | null;
  strengthText?: string | null; doseText?: string | null; dosageForm?: string | null;
  route?: string | null; scheduleText?: string | null; durationText?: string | null;
  quantityText?: string | null; foodRelation?: string | null; instructions?: string | null;
  isPrn?: boolean | null; substitutionAllowed?: boolean | null;
}) {
  return [value.displayName, value.brandName, value.genericName, value.strengthText,
    value.doseText, value.dosageForm, value.route, value.scheduleText, value.durationText,
    value.quantityText, value.foodRelation, value.instructions,
    String(value.isPrn ?? false), String(value.substitutionAllowed ?? true)].map(clean).join("|");
}

export function storedMedicineExactKey(row: MedicineRow) {
  return medicineExactKey({ displayName: row.display_name, brandName: row.brand_name,
    genericName: row.generic_name, strengthText: row.strength_text, doseText: row.dose_text,
    dosageForm: row.dosage_form, route: row.route, scheduleText: row.schedule_text,
    durationText: row.duration_text, quantityText: row.quantity_text, foodRelation: row.food_relation,
    instructions: row.instructions, isPrn: row.is_prn, substitutionAllowed: row.substitution_allowed });
}

export function incompleteMedicineReason(medicine: AutopilotPrescription["medicines"][number]): string | null {
  if (!medicine.displayName) return "Medicine name is required.";
  if (!medicine.doseText) return "Dose is required.";
  if (!/\p{L}/u.test(medicine.doseText)) return "Dose must include its unit/form.";
  if (!medicine.dosageForm) return "Dosage form is required.";
  if (!medicine.route) return "Route is required.";
  if (!medicine.scheduleText) return "Frequency/schedule is required.";
  if (!medicine.durationText) return "Duration is required.";
  if (medicine.needsReview.length > 0) return "Resolve medicine uncertainties before applying.";
  return null;
}

export function duplicateMedicineDecision(
  medicine: AutopilotPrescription["medicines"][number], existing: MedicineRow[],
): "append" | "skip-exact" | "conflict" {
  const exact = medicineExactKey(medicine);
  if (existing.some((row) => storedMedicineExactKey(row) === exact)) return "skip-exact";
  const identity = medicineIdentity(medicine);
  if (existing.some((row) => medicineIdentity({ displayName: row.display_name, strengthText: row.strength_text, dosageForm: row.dosage_form }) === identity)) return "conflict";
  return "append";
}

export function investigationKey(name: string | null, note: string | null) {
  return `${clean(name)}|${clean(note)}`;
}

export function applyableInvestigations(proposal: AutopilotPrescription) {
  return proposal.investigations.filter((row) => row.name && row.needsReview.length === 0 &&
    row.sourceRefs.some((ref) => ref.kind === "consultation"));
}
