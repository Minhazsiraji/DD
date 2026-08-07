/**
 * The permission matrix — the single source of truth for who may do what.
 *
 * This is deliberately pure and dependency-free so it can be exhaustively
 * tested without a database. RLS enforces the same boundaries in Postgres as a
 * second line of defence; the two must be kept in agreement.
 *
 * Two rules that are easy to get wrong and are asserted in the tests:
 *   1. RECEPTIONIST never gains clinical-note access, at any clinic, ever.
 *   2. CLINIC_ADMIN is an OPERATIONAL role. It never reads a doctor's
 *      private notes. There is no admin override.
 */

export const CLINIC_ROLES = ["DOCTOR", "RECEPTIONIST", "CLINIC_ADMIN"] as const;
export type ClinicRole = (typeof CLINIC_ROLES)[number];

export const RESOURCES = [
  "clinic",
  "clinic_member",
  "doctor_profile",
  "patient",
  "patient_clinical", // allergies, conditions, clinical flags
  "encounter",
  "private_notes",
  "prescription",
  "investigation_result",
  "document",
  "appointment",
  "queue",
  "payment",
  "audit_log",
  "ai_assistant",
] as const;
export type Resource = (typeof RESOURCES)[number];

export const ACTIONS = ["read", "create", "update", "delete"] as const;
export type Action = (typeof ACTIONS)[number];

type Matrix = Record<ClinicRole, Partial<Record<Resource, readonly Action[]>>>;

const R = ["read"] as const;
const RW = ["read", "create", "update"] as const;
const RWD = ["read", "create", "update", "delete"] as const;
const NONE = [] as const;

/**
 * Anything not listed is denied. Default-deny is the point — adding a resource
 * without touching this file makes it inaccessible, which is the safe failure.
 */
const MATRIX: Matrix = {
  DOCTOR: {
    clinic: R,
    clinic_member: R,
    doctor_profile: RW,
    patient: RW,
    patient_clinical: RW,
    encounter: RW,
    private_notes: RW,
    prescription: RW,
    investigation_result: RW,
    document: RW,
    appointment: RW,
    queue: RW,
    payment: R,
    audit_log: R,
    ai_assistant: RW,
  },

  RECEPTIONIST: {
    clinic: R,
    clinic_member: NONE,
    doctor_profile: R,
    patient: RW,
    // Read-only on allergies/conditions: reception must be able to see a
    // safety flag, but must never edit or author clinical content.
    patient_clinical: R,
    encounter: NONE,
    private_notes: NONE,
    prescription: R, // print/hand over only
    investigation_result: NONE, // metadata surfaces via document, not the result body
    document: ["read", "create"],
    appointment: RWD,
    queue: RW,
    payment: RW,
    audit_log: NONE,
    ai_assistant: NONE,
  },

  CLINIC_ADMIN: {
    clinic: RW,
    clinic_member: RWD,
    doctor_profile: R,
    patient: RW,
    patient_clinical: R,
    encounter: R,
    private_notes: NONE, // operational role — no clinical-note access, ever
    prescription: R,
    investigation_result: R,
    document: RW,
    appointment: RWD,
    queue: RW,
    payment: RWD,
    audit_log: R,
    ai_assistant: NONE,
  },
};

/**
 * Can `role` perform `action` on `resource`?
 *
 * This answers the ROLE question only. Callers must separately establish that
 * the row belongs to the caller's active clinic — see requireClinicContext.
 * Both checks are required; neither is sufficient alone.
 */
export function can(role: ClinicRole, action: Action, resource: Resource): boolean {
  return MATRIX[role]?.[resource]?.includes(action) ?? false;
}

/** Every action a role may take on a resource. Useful for building UI. */
export function allowedActions(
  role: ClinicRole,
  resource: Resource,
): readonly Action[] {
  return MATRIX[role]?.[resource] ?? [];
}

/** Roles permitted to manage clinic settings and membership. */
export function isClinicManager(role: ClinicRole): boolean {
  return can(role, "update", "clinic_member");
}
