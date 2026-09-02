/**
 * Medicine domain rules that are pure, so they can be tested without a database
 * and reused by a later prescription integration without dragging a client in.
 *
 * THE GOVERNING RULE OF THIS WHOLE FEATURE, stated once here:
 *
 *   The medicine library is REFERENCE AND RECALL. It is not clinical authority.
 *
 * A catalogue row says what is printed on a box. A saved default says what this
 * doctor typed last time. Neither says what a patient should take. Nothing in
 * this module decides, recommends, substitutes or prescribes, and the labels it
 * exports exist to keep that distinction on screen rather than only in a
 * comment.
 */

/** A row from the shared reference catalogue. Identity only — no monograph. */
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

/** One doctor's saved way of writing one medicine. Private to that doctor. */
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

/**
 * THE ONLY WORDING ALLOWED FOR A SAVED DEFAULT.
 *
 * "My saved defaults" is a statement about the doctor's own past behaviour and
 * is true. "Recommended dose" would be a clinical claim by Doctor's Diary about
 * a medicine, which we have no source for and no business making. The
 * difference is not cosmetic: one is recall, the other is advice.
 *
 * Exported as a constant so the UI cannot quietly drift into the other reading,
 * and so a test can assert the drift did not happen.
 */
export const SAVED_DEFAULTS_LABEL = "My saved defaults";

/**
 * Shown wherever defaults are displayed or edited. States who authored them and
 * who remains responsible, in the doctor's own terms.
 */
export const SAVED_DEFAULTS_DISCLAIMER =
  "These are defaults you saved yourself, not medical advice. " +
  "Doctor's Diary does not check doses, interactions or contraindications. " +
  "You review and confirm every prescription.";

/**
 * Wording that would turn recall into advice. Asserted against the UI by test.
 * If one of these ever becomes the right thing to say, it needs a licensed
 * source behind it and a decision record — not a copy edit.
 */
export const FORBIDDEN_ADVICE_PHRASES = [
  "recommended dose",
  "recommended dosage",
  "suggested dose",
  "standard dose",
  "usual dose",
  "safe dose",
  "correct dose",
] as const;

/**
 * Fold text for COMPARISON, never for display.
 *
 * This must agree exactly with `normalize_medicine_text()` in
 * `supabase/policies/0043_medicines_v1.sql` and with the `generated always as`
 * expressions on both tables. If they drift, a query the doctor types in the
 * browser stops matching rows the database keyed — silently, with no error, and
 * looking exactly like "that medicine isn't in the catalogue".
 *
 * `MEDICINE_NORMALIZATION_VECTORS` below is asserted against BOTH sides.
 */
export function normalizeMedicineText(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Shared expectations for the folding rule, in the same spirit as
 * `scripts/normalization-vectors.mjs` for patient names: the rule exists twice
 * (TypeScript and SQL) and neither copy is allowed to be the only one checked.
 */
export const MEDICINE_NORMALIZATION_VECTORS: ReadonlyArray<readonly [string, string]> = [
  ["Napa", "napa"],
  ["NAPA", "napa"],
  ["  Napa  ", "napa"],
  ["Napa   Extend", "napa extend"],
  ["Napa\tExtend", "napa extend"],
  ["Napa\nExtend", "napa extend"],
  ["Paracetamol 500 mg", "paracetamol 500 mg"],
  // A hyphen is NOT whitespace: "Co-trimoxazole" and "Co trimoxazole" are
  // different strings to a pharmacist and we do not merge them behind the
  // doctor's back.
  ["Co-trimoxazole", "co-trimoxazole"],
  ["", ""],
];

/** The minimum query length the catalogue will answer. Below it: no search. */
export const MIN_SEARCH_LENGTH = 2;

/**
 * Is this query long enough to search?
 *
 * A single character matches most of a catalogue, which is a scan wearing a
 * search's clothes: slow, and a list of a thousand near-identical names is
 * exactly the condition under which the wrong row gets tapped.
 */
export function isSearchable(query: string): boolean {
  return normalizeMedicineText(query).length >= MIN_SEARCH_LENGTH;
}

/**
 * How a medicine reads on one line: "Napa 500 mg — Paracetamol (Tablet)".
 *
 * Brand first when there is one, because that is what a doctor writes and what
 * a patient buys; the generic follows so the molecule is never hidden. Every
 * part is optional and absent parts leave no empty punctuation.
 */
export function describeReference(m: MedicineReference): string {
  const head = [m.brandName ?? m.genericName, m.strengthText].filter(Boolean).join(" ");
  const parts = [head];
  if (m.brandName && m.genericName) parts.push(`— ${m.genericName}`);
  if (m.dosageForm) parts.push(`(${m.dosageForm})`);
  return parts.filter(Boolean).join(" ");
}

/**
 * The name a saved library entry gets when a doctor adds it from the catalogue.
 *
 * This is `prescription_items.display_name`'s shape — brand and strength, the
 * text a doctor actually writes on a prescription — NOT the fuller descriptive
 * line above. A later Rx integration copies this field straight across.
 */
export function defaultDisplayName(m: MedicineReference): string {
  return [m.brandName ?? m.genericName, m.strengthText].filter(Boolean).join(" ").trim();
}

/**
 * Turn a catalogue row into the starting shape of a personal entry.
 *
 * NOTHING IS INVENTED. Every default field comes back null: we do not know what
 * this doctor's habit is until they tell us, and a pre-filled dose that nobody
 * chose is precisely the "DD-generated default presented as medical guidance"
 * this feature must never produce. The doctor types their own, once.
 */
export function draftFromReference(m: MedicineReference): DoctorMedicineDefaults {
  return {
    displayName: defaultDisplayName(m),
    genericName: m.genericName,
    brandName: m.brandName,
    strengthText: m.strengthText,
    dosageForm: m.dosageForm,
    route: null,
    defaultDoseText: null,
    defaultScheduleText: null,
    defaultDurationText: null,
    defaultQuantityText: null,
    defaultFoodRelation: null,
    defaultInstructions: null,
    defaultIsPrn: false,
  };
}

/** The editable half of a personal entry. */
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

/**
 * THE PRESCRIPTION INTEGRATION BOUNDARY — declared, not crossed.
 *
 * This is the exact shape a later Rx integration will receive when a doctor
 * picks a saved medicine. It is deliberately a PLAIN OBJECT and deliberately
 * unused by any prescription code on this branch: the Rx composer is being
 * changed by another loop right now, and wiring it here would collide.
 *
 * What the later integration must still do, and what this shape cannot do for
 * it: the doctor sees these values in an EDITABLE draft row, changes whatever
 * they want, presses Add, reviews the whole prescription, and only then
 * finalises. This function hands over text. It does not add a medicine, does
 * not touch `prescription_items`, and confers no finalisation authority — there
 * is no code path from here to `finalize_prescription`, and
 * `medicine-boundary.test.ts` fails if one appears.
 */
export interface RxDraftSeed {
  displayName: string;
  brandName: string | null;
  genericName: string | null;
  strengthText: string | null;
  dosageForm: string | null;
  route: string | null;
  doseText: string | null;
  scheduleText: string | null;
  durationText: string | null;
  quantityText: string | null;
  foodRelation: string | null;
  instructions: string | null;
  isPrn: boolean;
}

/**
 * Map a saved entry onto that shape. A field copy and nothing else — no
 * defaulting, no inference, no substitution. What the doctor saved is what the
 * draft row starts as, and every one of these is editable before it is added.
 */
export function toRxDraftSeed(m: DoctorMedicine): RxDraftSeed {
  return {
    displayName: m.displayName,
    brandName: m.brandName,
    genericName: m.genericName,
    strengthText: m.strengthText,
    dosageForm: m.dosageForm,
    route: m.route,
    doseText: m.defaultDoseText,
    scheduleText: m.defaultScheduleText,
    durationText: m.defaultDurationText,
    quantityText: m.defaultQuantityText,
    foodRelation: m.defaultFoodRelation,
    instructions: m.defaultInstructions,
    isPrn: m.defaultIsPrn,
  };
}

/**
 * Order a personal library for reading: favourites, then most recently used,
 * then most used, then alphabetical.
 *
 * `lastUsedAt` before `usageCount` on purpose — a medicine used twice this week
 * is more likely the next one wanted than one used forty times last year.
 */
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

/**
 * Does this doctor already have this medicine saved?
 *
 * Matches the database's unique key — normalised display name plus strength —
 * so the answer the UI gives ("Saved" instead of "Add") is the same answer the
 * insert would give. A different rule here would show "Add" on a row that then
 * fails as a duplicate.
 */
export function findSaved(
  library: readonly DoctorMedicine[],
  reference: MedicineReference,
): DoctorMedicine | undefined {
  const name = normalizeMedicineText(defaultDisplayName(reference));
  const strength = reference.strengthText ?? null;
  return library.find(
    (row) =>
      normalizeMedicineText(row.displayName) === name &&
      (row.strengthText ?? null) === strength,
  );
}
