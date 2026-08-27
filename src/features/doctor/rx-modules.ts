import { z } from "zod";

/**
 * The doctor's prescription sections — the shared description of them.
 *
 * One list, used by the settings screen, the server action and the tests, so a
 * module cannot exist in one place and not another. The DATABASE is still the
 * authority on which modules exist (`rx_module`) and on what a label may
 * contain; this mirrors those rules so the doctor is told at the keyboard
 * rather than after a round trip.
 */

export const RX_MODULES = [
  "CHIEF_COMPLAINT",
  "SYMPTOMS",
  "HISTORY",
  "VITALS",
  "EXAMINATION",
  "ASSESSMENT",
  "DIAGNOSIS",
  "INVESTIGATIONS",
  "ADVICE",
  "NEXT_VISIT",
  "ALLERGY",
  "LONG_TERM_MEDICINES",
] as const;

export type RxModule = (typeof RX_MODULES)[number];

/** The built-in heading — mirrors `rx_module_label()`. Shown when there is no custom one. */
export const RX_MODULE_LABEL: Record<RxModule, string> = {
  CHIEF_COMPLAINT: "Chief Complaint",
  SYMPTOMS: "Symptoms",
  HISTORY: "History",
  VITALS: "Vitals",
  EXAMINATION: "Examination",
  ASSESSMENT: "Assessment",
  DIAGNOSIS: "Diagnosis",
  INVESTIGATIONS: "Investigations / Tests",
  ADVICE: "Advice",
  NEXT_VISIT: "Next Visit",
  ALLERGY: "Allergies",
  LONG_TERM_MEDICINES: "Long-term Medicines",
};

/** Where each section's content comes from. It changes what a toggle MEANS. */
export const RX_MODULE_SOURCE: Record<RxModule, string> = {
  CHIEF_COMPLAINT: "What you write in the consultation",
  SYMPTOMS: "What you write in the consultation",
  HISTORY: "What you write in the consultation",
  VITALS: "The vitals recorded in the consultation",
  EXAMINATION: "What you write in the consultation",
  ASSESSMENT: "What you write in the consultation",
  DIAGNOSIS: "The diagnoses you add in the consultation",
  INVESTIGATIONS: "The tests you order in the consultation",
  ADVICE: "What you write in the consultation",
  NEXT_VISIT: "The follow-up you set in the consultation",
  ALLERGY: "The patient's record — copied onto the paper and frozen there",
  LONG_TERM_MEDICINES: "The patient's record — copied onto the paper and frozen there",
};

/**
 * Sections whose content is a PATIENT-LEVEL fact rather than something written
 * during the visit.
 *
 * Printing one copies today's list onto the paper permanently (ADR 0013 §5), so
 * the screen says so out loud. They are also the two that can legitimately
 * print without being used during a consultation.
 */
export const PATIENT_LEVEL_MODULES: readonly RxModule[] = ["ALLERGY", "LONG_TERM_MEDICINES"];

export interface RxModuleSetting {
  module: RxModule;
  useDuringConsultation: boolean;
  showOnPrint: boolean;
  /** The doctor's own heading. `null` means "use the built-in one". */
  printLabel: string | null;
}

/**
 * A custom heading, held to the same rule the database enforces.
 *
 * PLAIN TEXT ONLY — this string becomes a heading on a clinical document, so
 * anything that could carry markup is refused rather than escaped. Escaping is
 * a decision made in one renderer and forgotten in the next.
 */
export const LABEL_MAX = 40;
export const LABEL_FORBIDDEN = /[<>&"]/;

export function labelProblem(label: string): string | null {
  const trimmed = label.trim();
  if (trimmed === "") return null;
  if (trimmed.length > LABEL_MAX) return `Keep the heading to ${LABEL_MAX} characters or fewer.`;
  if (LABEL_FORBIDDEN.test(trimmed)) {
    return "A heading cannot contain < > & or \" — it is printed as plain text.";
  }
  return null;
}

export const rxModuleSettingSchema = z.object({
  module: z.enum(RX_MODULES),
  useDuringConsultation: z.boolean(),
  showOnPrint: z.boolean(),
  printLabel: z
    .string()
    .trim()
    .max(LABEL_MAX)
    .refine((v) => !LABEL_FORBIDDEN.test(v), "A heading is printed as plain text")
    .nullable(),
});

/**
 * The whole screen, in one payload.
 *
 * EVERY module every time, and the order of the array IS the order on the page.
 * A partial save is a half-applied reorder, which is a state nobody asked for —
 * and a screen that saved one toggle per click would turn reordering twelve
 * sections into twelve writes.
 */
export const rxModulesPayloadSchema = z
  .array(rxModuleSettingSchema)
  .length(RX_MODULES.length)
  .refine(
    (rows) => new Set(rows.map((r) => r.module)).size === RX_MODULES.length,
    "every section must appear exactly once",
  );

export type RxModulesPayload = z.infer<typeof rxModulesPayloadSchema>;

/**
 * Position is DERIVED from the order of the array, never carried in the UI.
 *
 * Spaced by ten so a later insertion needs no renumbering, and recomputed on
 * every save so two sections can never share a position — which would leave
 * the printed order down to a tiebreak nobody chose.
 */
export function withPositions(rows: RxModulesPayload) {
  return rows.map((row, i) => ({
    module: row.module,
    useDuringConsultation: row.useDuringConsultation,
    showOnPrint: row.showOnPrint,
    printLabel: row.printLabel === null || row.printLabel === "" ? null : row.printLabel,
    position: (i + 1) * 10,
  }));
}
