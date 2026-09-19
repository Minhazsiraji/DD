/**
 * The permission matrix — the single source of truth for who may do what.
 *
 * This is deliberately pure and dependency-free so it can be exhaustively
 * tested without a database. RLS enforces the same boundaries in Postgres as a
 * second line of defence; the two must be kept in agreement.
 *
 * Two rules that are easy to get wrong and are asserted in the tests:
 *   1. RECEPTIONIST never gains clinical-note access, at any location, ever.
 *   2. LOCATION_ADMIN is an OPERATIONAL role. It never reads a doctor's
 *      private notes. There is no admin override.
 *
 * Staff Management V1 adds ASSISTANT as a deliberately inert broad
 * location-entry role. Doctor-scoped Team permissions are NOT represented by
 * this matrix; they are checked separately by the Staff Management grant layer.
 * This prevents a location membership alone from becoming delegated authority.
 */

export const LOCATION_ROLES = ["DOCTOR", "RECEPTIONIST", "LOCATION_ADMIN", "ASSISTANT"] as const;
export type LocationRole = (typeof LOCATION_ROLES)[number];

export const RESOURCES = [
  "practice_location",
  "location_member",
  "doctor_profile",
  "patient",
  "patient_allergy",
  "patient_clinical",
  "patient_contact",
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

type Matrix = Record<LocationRole, Partial<Record<Resource, readonly Action[]>>>;

const R = ["read"] as const;
const RW = ["read", "create", "update"] as const;
const RWD = ["read", "create", "update", "delete"] as const;
const NONE = [] as const;

const MATRIX: Matrix = {
  DOCTOR: {
    practice_location: R,
    location_member: R,
    doctor_profile: RW,
    patient: RW,
    patient_allergy: RWD,
    patient_clinical: RWD,
    patient_contact: RWD,
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
    practice_location: R,
    location_member: NONE,
    doctor_profile: R,
    patient: RW,
    patient_allergy: R,
    patient_clinical: NONE,
    patient_contact: RW,
    encounter: NONE,
    private_notes: NONE,
    prescription: R,
    investigation_result: NONE,
    document: ["read", "create"],
    appointment: RW,
    queue: RW,
    payment: RW,
    audit_log: NONE,
    ai_assistant: NONE,
  },

  LOCATION_ADMIN: {
    practice_location: RW,
    location_member: RWD,
    doctor_profile: R,
    patient: RW,
    patient_allergy: NONE,
    patient_clinical: NONE,
    patient_contact: R,
    encounter: R,
    private_notes: NONE,
    prescription: R,
    investigation_result: R,
    document: RW,
    appointment: RW,
    queue: RW,
    payment: RWD,
    audit_log: R,
    ai_assistant: NONE,
  },

  /**
   * ASSISTANT is intentionally not an application-RBAC grant. It is only the
   * broad location-entry marker used by Doctor-scoped Staff Management.
   * `requireStaffPermission()` + RLS/RPC helpers decide every delegated action.
   */
  ASSISTANT: {
    practice_location: R,
    location_member: NONE,
    doctor_profile: NONE,
    patient: NONE,
    patient_allergy: NONE,
    patient_clinical: NONE,
    patient_contact: NONE,
    encounter: NONE,
    private_notes: NONE,
    prescription: NONE,
    investigation_result: NONE,
    document: NONE,
    appointment: NONE,
    queue: NONE,
    payment: NONE,
    audit_log: NONE,
    ai_assistant: NONE,
  },
};

export function can(role: LocationRole, action: Action, resource: Resource): boolean {
  return MATRIX[role]?.[resource]?.includes(action) ?? false;
}

export function canAny(
  roles: readonly LocationRole[],
  action: Action,
  resource: Resource,
): boolean {
  return roles.some((role) => can(role, action, resource));
}

export function allowedActions(
  role: LocationRole,
  resource: Resource,
): readonly Action[] {
  return MATRIX[role]?.[resource] ?? [];
}

export function isLocationManager(role: LocationRole): boolean {
  return can(role, "update", "location_member");
}
