import { z } from "zod";

/**
 * The consultation draft, as the UI sees it.
 *
 * SECTIONS and VITALS are the single description of the clinical form: the
 * editor renders from them, the patch is built from them, and the client-side
 * bounds are copied from the CHECK constraints in schema.ts. Two lists that
 * must agree would eventually stop agreeing.
 */

export type SectionKey =
  | "chiefComplaints"
  | "presentIllness"
  | "pastHistory"
  | "examination"
  | "assessment"
  | "advice";

export interface SectionField {
  key: SectionKey;
  label: string;
  placeholder: string;
  /** Roughly how tall the box starts. Doctors write very different amounts. */
  rows: number;
}

export const SECTIONS: readonly SectionField[] = [
  {
    key: "chiefComplaints",
    label: "Chief complaints",
    placeholder: "What brought them in, in their words",
    rows: 3,
  },
  {
    key: "presentIllness",
    label: "History of present illness",
    placeholder: "Onset, duration, course, associated symptoms",
    rows: 5,
  },
  {
    key: "pastHistory",
    label: "Past history",
    placeholder: "Previous illness, surgery, family and personal history",
    rows: 4,
  },
  {
    key: "examination",
    label: "Examination",
    placeholder: "General and systemic findings",
    rows: 5,
  },
  {
    key: "assessment",
    label: "Assessment",
    placeholder: "Working impression",
    rows: 3,
  },
  {
    key: "advice",
    label: "Advice",
    placeholder: "Instructions, follow-up, red flags to return for",
    rows: 3,
  },
];

export interface VitalField {
  key: VitalKey;
  label: string;
  unit: string;
  /** Mirrors the database CHECK. The database is the boundary; this is manners. */
  min: number;
  max: number;
  /** SpO2 and temperature admit their lower bound; the rest need > 0. */
  minInclusive: boolean;
  step: string;
  /** Whole numbers only — the RPC rejects a fractional pulse rather than round it. */
  integer: boolean;
}

export const VITALS: readonly VitalField[] = [
  { key: "vitalHeightCm", label: "Height", unit: "cm", min: 0, max: 300, minInclusive: false, step: "0.1", integer: false },
  { key: "vitalWeightKg", label: "Weight", unit: "kg", min: 0, max: 700, minInclusive: false, step: "0.1", integer: false },
  { key: "vitalTemperatureC", label: "Temperature", unit: "°C", min: 10, max: 50, minInclusive: true, step: "0.1", integer: false },
  { key: "vitalPulseBpm", label: "Pulse", unit: "bpm", min: 0, max: 400, minInclusive: false, step: "1", integer: true },
  { key: "vitalSystolic", label: "Systolic", unit: "mmHg", min: 0, max: 400, minInclusive: false, step: "1", integer: true },
  { key: "vitalDiastolic", label: "Diastolic", unit: "mmHg", min: 0, max: 300, minInclusive: false, step: "1", integer: true },
  { key: "vitalRespRate", label: "Respiratory rate", unit: "/min", min: 0, max: 200, minInclusive: false, step: "1", integer: true },
  { key: "vitalSpo2", label: "SpO₂", unit: "%", min: 0, max: 100, minInclusive: true, step: "1", integer: true },
];

export type VitalKey =
  | "vitalHeightCm"
  | "vitalWeightKg"
  | "vitalTemperatureC"
  | "vitalPulseBpm"
  | "vitalSystolic"
  | "vitalDiastolic"
  | "vitalRespRate"
  | "vitalSpo2";

export type DraftKey = SectionKey | VitalKey;

/**
 * Editor state is ALL STRINGS, including the vitals.
 *
 * A number input holds text until it is submitted, and "" has to stay
 * distinguishable from 0 — coercing early is how a half-typed "1" becomes a
 * recorded pulse of 1. The conversion to number-or-null happens once, at the
 * patch boundary.
 */
export type DraftValues = Record<DraftKey, string>;

/** What the RPC accepts: absent = untouched, value = set, null = clear. */
export type DraftPatch = Partial<Record<DraftKey, string | number | null>>;

const SECTION_KEYS = SECTIONS.map((s) => s.key) as SectionKey[];
const VITAL_BY_KEY = new Map(VITALS.map((v) => [v.key, v]));

export const DRAFT_KEYS: DraftKey[] = [...SECTION_KEYS, ...VITALS.map((v) => v.key)];

/**
 * Server-side patch validation.
 *
 * The RPC validates all of this again and is the real boundary — this exists so
 * a mistake in our own client produces a sentence rather than a database error,
 * and so an unknown key is refused before it reaches Postgres.
 */
export const draftPatchSchema = z
  .record(z.string(), z.union([z.string(), z.number(), z.null()]))
  .superRefine((patch, ctx) => {
    const keys = Object.keys(patch);
    if (keys.length === 0) {
      ctx.addIssue({ code: "custom", message: "Nothing to save." });
      return;
    }
    for (const key of keys) {
      if (!DRAFT_KEYS.includes(key as DraftKey)) {
        ctx.addIssue({ code: "custom", message: `Unknown field: ${key}` });
        continue;
      }
      const value = patch[key];
      if (value === null) continue;

      const vital = VITAL_BY_KEY.get(key as VitalKey);
      if (!vital) {
        if (typeof value !== "string") {
          ctx.addIssue({ code: "custom", message: `${key} must be text.` });
        }
        continue;
      }
      if (typeof value !== "number" || !Number.isFinite(value)) {
        ctx.addIssue({ code: "custom", message: `${vital.label} must be a number.` });
        continue;
      }
      if (vital.integer && !Number.isInteger(value)) {
        ctx.addIssue({ code: "custom", message: `${vital.label} must be a whole number.` });
        continue;
      }
      const tooLow = vital.minInclusive ? value < vital.min : value <= vital.min;
      if (tooLow || value > vital.max) {
        ctx.addIssue({ code: "custom", message: vitalRangeMessage(vital) });
      }
    }
  });

/**
 * Said the way a clinician would read it — a plausibility limit, not a verdict
 * on the patient. "Out of range" would suggest we think the reading is
 * abnormal; we only think it cannot have been measured.
 */
export function vitalRangeMessage(vital: VitalField): string {
  const low = vital.minInclusive ? vital.min : vital.min + (vital.integer ? 1 : 0.1);
  return `${vital.label} should be between ${low} and ${vital.max} ${vital.unit}. Check the value — this looks like a typing or unit slip rather than a measurement.`;
}

/** Empty editor state, so a new draft and a loaded one have the same shape. */
export function emptyDraft(): DraftValues {
  return Object.fromEntries(DRAFT_KEYS.map((k) => [k, ""])) as DraftValues;
}

export const saveInputSchema = z.object({
  encounterId: z.uuid(),
  expectedVersion: z.number().int().positive(),
  patch: draftPatchSchema,
});

export type SaveInput = z.infer<typeof saveInputSchema>;

/** Lives here rather than in draft-state so the Server Action can return it. */
export type SaveResult =
  | { ok: true; version: number; savedAt: string }
  /**
   * Someone else's save landed first. Carries the server's text so the doctor
   * can see what they would be writing over — never resolved automatically.
   */
  | { ok: false; kind: "conflict"; version: number; values: DraftValues; message: string }
  | { ok: false; kind: "error"; message: string };
