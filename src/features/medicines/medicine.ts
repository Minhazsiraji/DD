/**
 * Medicine domain rules: reference and recall, never clinical authority.
 */
export interface MedicineReference {
  id: string;
  genericName: string;
  brandName: string | null;
  strengthText: string | null;
  dosageForm: string | null;
  manufacturer: string | null;
  countryCode: string;
  regulatorName: string | null;
  sourceKind: "MANUAL_SEED" | "DOCTOR_CONTRIBUTED" | "LICENSED_IMPORT";
  lastVerifiedAt: string | null;
}

export interface DoctorMedicine {
  id: string;
  medicineReferenceId: string | null;
  displayName: string;
  genericName: string | null;
  brandName: string | null;
  strengthText: string | null;
  dosageForm: string | null;
  route: string | null;
  defaultDoseText: string | null;
  defaultScheduleText: string | null;
  defaultDurationText: string | null;
  defaultQuantityText: string | null;
  defaultFoodRelation: string | null;
  defaultInstructions: string | null;
  defaultIsPrn: boolean;
  isFavorite: boolean;
  usageCount: number;
  lastUsedAt: string | null;
  isActive: boolean;
}

export const SAVED_DEFAULTS_LABEL = "My saved defaults";
export const SAVED_DEFAULTS_DISCLAIMER =
  "These are defaults you saved yourself, not medical advice. " +
  "Doctor's Diary does not check doses, interactions or contraindications. " +
  "You review and confirm every prescription.";

export const FORBIDDEN_ADVICE_PHRASES = [
  "recommended dose", "recommended dosage", "suggested dose", "standard dose",
  "usual dose", "safe dose", "correct dose",
] as const;

export function normalizeMedicineText(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

export const MEDICINE_NORMALIZATION_VECTORS: ReadonlyArray<readonly [string, string]> = [
  ["Napa", "napa"], ["NAPA", "napa"], ["  Napa  ", "napa"],
  ["Napa   Extend", "napa extend"], ["Napa\tExtend", "napa extend"],
  ["Napa\nExtend", "napa extend"], ["Paracetamol 500 mg", "paracetamol 500 mg"],
  ["Co-trimoxazole", "co-trimoxazole"], ["", ""],
];

export interface ProvenanceLines { source: string; regulator: string | null }
export function provenanceLines(m: MedicineReference): ProvenanceLines {
  const origin = m.sourceKind === "MANUAL_SEED" ? "Entered manually"
    : m.sourceKind === "DOCTOR_CONTRIBUTED" ? "Added by a doctor" : "Licensed reference data";
  const regulator = m.regulatorName
    ? `Market regulator: ${m.regulatorName} — ${m.lastVerifiedAt ? "entry checked against its recorded source" : "entry not verified against regulator source"}`
    : null;
  return {
    source: regulator ? origin : `${origin} · ${m.lastVerifiedAt ? "checked against its recorded source" : "not verified against a source"}`,
    regulator,
  };
}

export const FORBIDDEN_REGULATOR_PHRASES = [
  "verified by", "approved by", "supplied by", "sourced from", "according to dgda",
  "dgda verified", "cdsco verified", "dgda-verified", "regulator verified", "official",
  "registered with",
] as const;

export const MIN_SEARCH_LENGTH = 2;
export function isSearchable(query: string): boolean {
  return normalizeMedicineText(query).length >= MIN_SEARCH_LENGTH;
}

export function describeReference(m: MedicineReference): string {
  const head = [m.brandName ?? m.genericName, m.strengthText].filter(Boolean).join(" ");
  const parts = [head];
  if (m.brandName && m.genericName) parts.push(`— ${m.genericName}`);
  if (m.dosageForm) parts.push(`(${m.dosageForm})`);
  return parts.filter(Boolean).join(" ");
}

export function defaultDisplayName(m: MedicineReference): string {
  return [m.brandName ?? m.genericName, m.strengthText].filter(Boolean).join(" ").trim();
}

export interface DoctorMedicineDefaults {
  displayName: string;
  genericName: string | null;
  brandName: string | null;
  strengthText: string | null;
  dosageForm: string | null;
  route: string | null;
  defaultDoseText: string | null;
  defaultScheduleText: string | null;
  defaultDurationText: string | null;
  defaultQuantityText: string | null;
  defaultFoodRelation: string | null;
  defaultInstructions: string | null;
  defaultIsPrn: boolean;
}

export function draftFromReference(m: MedicineReference): DoctorMedicineDefaults {
  return {
    displayName: defaultDisplayName(m), genericName: m.genericName, brandName: m.brandName,
    strengthText: m.strengthText, dosageForm: m.dosageForm, route: null,
    defaultDoseText: null, defaultScheduleText: null, defaultDurationText: null,
    defaultQuantityText: null, defaultFoodRelation: null, defaultInstructions: null,
    defaultIsPrn: false,
  };
}

export interface RxDraftSeed {
  displayName: string; brandName: string | null; genericName: string | null;
  strengthText: string | null; dosageForm: string | null; route: string | null;
  doseText: string | null; scheduleText: string | null; durationText: string | null;
  quantityText: string | null; foodRelation: string | null; instructions: string | null;
  isPrn: boolean;
}

export function toRxDraftSeed(m: DoctorMedicine): RxDraftSeed {
  return {
    displayName: m.displayName, brandName: m.brandName, genericName: m.genericName,
    strengthText: m.strengthText, dosageForm: m.dosageForm, route: m.route,
    doseText: m.defaultDoseText, scheduleText: m.defaultScheduleText,
    durationText: m.defaultDurationText, quantityText: m.defaultQuantityText,
    foodRelation: m.defaultFoodRelation, instructions: m.defaultInstructions,
    isPrn: m.defaultIsPrn,
  };
}

export function sortLibrary(rows: readonly DoctorMedicine[]): DoctorMedicine[] {
  return [...rows].sort((a, b) => {
    if (a.isFavorite !== b.isFavorite) return a.isFavorite ? -1 : 1;
    const at = a.lastUsedAt ? Date.parse(a.lastUsedAt) : 0;
    const bt = b.lastUsedAt ? Date.parse(b.lastUsedAt) : 0;
    if (at !== bt) return bt - at;
    if (a.usageCount !== b.usageCount) return b.usageCount - a.usageCount;
    return a.displayName.localeCompare(b.displayName);
  });
}

export function findSaved(library: readonly DoctorMedicine[], reference: MedicineReference): DoctorMedicine | undefined {
  const name = normalizeMedicineText(defaultDisplayName(reference));
  const strength = reference.strengthText ?? null;
  return library.find((row) => normalizeMedicineText(row.displayName) === name && (row.strengthText ?? null) === strength);
}
