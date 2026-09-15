import type { AuditAction } from "./emit";

/**
 * Medicine-specific audit vocabulary carried forward from the proven V1 lane.
 * Values are ids-only events; medicine names/doses/schedules never enter audit.
 *
 * Kept in a Medicine-owned file so frozen/shared audit infrastructure does not
 * need to be rewritten during M4 reconciliation.
 */
export const M4_MEDICINE_AUDIT_ACTIONS = [
  "doctor_medicine.added",
  "doctor_medicine.defaults_updated",
  "doctor_medicine.archived",
  "doctor_medicine.restored",
] as const;

/** Compile-time guard. If shared AuditAction has not admitted these values yet,
 * M4 actions must use the bounded adapter below rather than widening emit.ts.
 */
export type M4MedicineAuditAction = (typeof M4_MEDICINE_AUDIT_ACTIONS)[number];

export function asAuditAction(action: M4MedicineAuditAction): AuditAction {
  return action as AuditAction;
}
