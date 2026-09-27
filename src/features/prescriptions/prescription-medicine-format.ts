import type { BundleItem } from "./review-bundle";
import { hasExactTrailingStrength } from "./medicine-display";

export interface PrescriptionMedicinePresentation {
  position: number;
  name: string;
  subtitle: string | null;
  strength: string | null;
  dose: string | null;
  administration: string | null;
  schedule: string | null;
  scheduleInterpretation: string | null;
  duration: string | null;
  quantity: string | null;
  foodRelation: string | null;
  isPrn: boolean;
  substitutionAllowed: boolean;
  instructions: string | null;
}

const SCHEDULE_INTERPRETATION: Readonly<Record<string, string>> = {
  "1+0+0": "Morning",
  "0+1+0": "Noon",
  "0+0+1": "Night",
  "1+0+1": "Morning & evening",
  "1+1+1": "Morning, noon & night",
  "1+1+1+1": "4 times daily",
};

/**
 * A dosage form is only a dose unit when the form itself is countable.
 *
 * Syrup does not establish mL, an inhaler does not establish puffs, and an
 * injection does not establish mL or vials. Those remain explicitly labelled
 * as an incomplete numeric dose instead of acquiring a guessed unit.
 */
const COUNTABLE_FORM_UNIT: Readonly<Record<string, { one: string; many: string }>> = {
  tablet: { one: "tablet", many: "tablets" },
  capsule: { one: "capsule", many: "capsules" },
  drops: { one: "drop", many: "drops" },
  sachet: { one: "sachet", many: "sachets" },
  suppository: { one: "suppository", many: "suppositories" },
};

/**
 * Quantity units are deliberately narrower than dose units. Tablet and
 * capsule are unambiguously countable inventory units; other forms need an
 * explicit unit in `quantity_text` (for example, `100 mL`).
 */
const SAFE_QUANTITY_FORM_UNIT: Readonly<Record<string, { one: string; many: string }>> = {
  tablet: { one: "tablet", many: "tablets" },
  capsule: { one: "capsule", many: "capsules" },
};

export function cleanPrescriptionText(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed === "" ? null : trimmed;
}

function normalized(value: string): string {
  return value.normalize("NFC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("en-US");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

/** Exact phrase containment, so `Para` is not treated as `Paracetamol`. */
function alreadySaid(primary: string, candidate: string): boolean {
  const phrase = normalized(candidate);
  if (!phrase) return true;
  const expression = new RegExp(
    `(?:^|[^\\p{L}\\p{N}])${escapeRegExp(phrase)}(?:$|[^\\p{L}\\p{N}])`,
    "iu",
  );
  return expression.test(normalized(primary));
}

function uniquePart(
  part: string | null,
  primary: string,
  seen: Set<string>,
): string | null {
  const value = cleanPrescriptionText(part);
  if (!value || alreadySaid(primary, value)) return null;
  const key = normalized(value);
  if (seen.has(key)) return null;
  seen.add(key);
  return value;
}

function numericDose(value: string): number | null {
  if (!/^\d+(?:\.\d+)?$/u.test(value)) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Preserve an explicit dose verbatim. A bare numeric dose gains a unit only
 * when the structured dosage form makes that unit deterministic.
 */
export function formatDoseForDisplay(
  doseText: string | null | undefined,
  dosageForm: string | null | undefined,
): string | null {
  const dose = cleanPrescriptionText(doseText);
  if (!dose) return null;

  const number = numericDose(dose);
  if (number === null) return dose;

  const form = cleanPrescriptionText(dosageForm);
  const unit = form ? COUNTABLE_FORM_UNIT[normalized(form)] : undefined;
  if (!unit) return `Dose: ${dose}`;
  return `${dose} ${number === 1 ? unit.one : unit.many}`;
}

/** Interpret only the exact familiar notation named by the product contract. */
export function formatScheduleForDisplay(
  scheduleText: string | null | undefined,
): { schedule: string | null; interpretation: string | null } {
  const schedule = cleanPrescriptionText(scheduleText);
  if (!schedule) return { schedule: null, interpretation: null };

  const compact = schedule.replace(/\s+/gu, "");
  const interpretation = SCHEDULE_INTERPRETATION[compact] ?? null;
  if (!interpretation) return { schedule, interpretation: null };
  return { schedule: compact, interpretation };
}

function quantityForDisplay(
  quantityText: string | null | undefined,
  dosageForm: string | null | undefined,
): string | null {
  const quantity = cleanPrescriptionText(quantityText);
  if (!quantity) return null;

  // Normalize an existing label without changing the authoritative value.
  const value = quantity.replace(/^qty\s*:\s*/iu, "").trim();
  const number = numericDose(value);
  if (number === null) return `Qty: ${value}`;

  const form = cleanPrescriptionText(dosageForm);
  const unit = form ? SAFE_QUANTITY_FORM_UNIT[normalized(form)] : undefined;
  if (!unit) return `Qty: ${value}`;
  return `Qty: ${value} ${number === 1 ? unit.one : unit.many}`;
}

/**
 * The one prescription-medicine presentation model used by Review and print.
 * It changes no stored value and performs no clinical calculation.
 */
export function formatPrescriptionMedicine(item: BundleItem): PrescriptionMedicinePresentation {
  const name = item.display_name.trim();
  const strengthText = cleanPrescriptionText(item.strength_text);
  const strength = hasExactTrailingStrength(name, strengthText) ? null : strengthText;
  const primary = [name, strength].filter(Boolean).join(" ");

  const seenSecondary = new Set<string>();
  const generic = uniquePart(item.generic_name, primary, seenSecondary);
  const administration = [
    uniquePart(item.dosage_form, primary, seenSecondary),
    uniquePart(item.route, primary, seenSecondary),
  ].filter((value): value is string => value !== null);
  const schedule = formatScheduleForDisplay(item.schedule_text);

  return {
    position: item.position,
    name,
    subtitle: generic ?? null,
    strength,
    dose: formatDoseForDisplay(item.dose_text, item.dosage_form),
    administration: administration.length > 0 ? administration.join(" · ") : null,
    schedule: schedule.schedule,
    scheduleInterpretation: schedule.interpretation,
    duration: cleanPrescriptionText(item.duration_text),
    quantity: quantityForDisplay(item.quantity_text, item.dosage_form),
    foodRelation: cleanPrescriptionText(item.food_relation),
    isPrn: item.is_prn,
    substitutionAllowed: item.substitution_allowed,
    instructions: cleanPrescriptionText(item.instructions),
  };
}
