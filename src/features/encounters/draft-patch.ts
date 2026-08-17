import {
  DRAFT_KEYS,
  VITALS,
  vitalRangeMessage,
  type DraftKey,
  type DraftPatch,
  type DraftValues,
  type VitalKey,
} from "./schema";

/**
 * Turning what is on the screen into what the database is asked to change.
 *
 * Pure, and deliberately in its own module: the hook that uses it imports a
 * Server Action, and this logic — which decides what gets overwritten and what
 * gets cleared — has to be directly testable without dragging the server in.
 */

const VITAL_KEYS = new Set<string>(VITALS.map((v) => v.key));

/** Which fields differ from the last known saved state. */
export function changedKeys(values: DraftValues, baseline: DraftValues): DraftKey[] {
  return DRAFT_KEYS.filter((key) => values[key].trim() !== baseline[key].trim());
}

/**
 * Editor strings to the RPC's patch shape.
 *
 * An emptied box becomes `null` — an explicit CLEAR, which is a different
 * instruction from leaving the field out. Only changed keys are included, so a
 * save never touches a field this screen did not edit, and two people working
 * on one consultation collide only where they genuinely both typed.
 */
export function buildPatch(values: DraftValues, baseline: DraftValues): DraftPatch {
  const patch: DraftPatch = {};

  for (const key of changedKeys(values, baseline)) {
    const raw = values[key].trim();

    if (raw === "") {
      patch[key] = null;
      continue;
    }
    if (VITAL_KEYS.has(key)) {
      patch[key] = Number(raw);
      continue;
    }
    patch[key] = raw;
  }
  return patch;
}

/**
 * Bounds checked here too, so a slip is caught before it becomes a round trip
 * and a red banner. The database is still the boundary — this is the courtesy.
 */
export function validateVitals(values: DraftValues): Partial<Record<VitalKey, string>> {
  const errors: Partial<Record<VitalKey, string>> = {};

  for (const vital of VITALS) {
    const raw = values[vital.key].trim();
    if (raw === "") continue;

    const n = Number(raw);
    if (!Number.isFinite(n)) {
      errors[vital.key] = `${vital.label} must be a number.`;
      continue;
    }
    if (vital.integer && !Number.isInteger(n)) {
      errors[vital.key] = `${vital.label} must be a whole number.`;
      continue;
    }
    const tooLow = vital.minInclusive ? n < vital.min : n <= vital.min;
    if (tooLow || n > vital.max) errors[vital.key] = vitalRangeMessage(vital);
  }
  return errors;
}
