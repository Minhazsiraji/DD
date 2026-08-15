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
 */

export const LOCATION_ROLES = ["DOCTOR", "RECEPTIONIST", "LOCATION_ADMIN"] as const;
export type LocationRole = (typeof LOCATION_ROLES)[number];

export const RESOURCES = [
  "practice_location",
  "location_member",
  "doctor_profile",
  "patient",
  /**
   * Split deliberately. Lumping these together let reception read chronic
   * conditions and current medications — enough to infer a diagnosis such as
   * HIV from an antiretroviral. A drug-allergy flag is a front-desk safety
   * signal; a diagnosis is not.
   */
  "patient_allergy", // drug allergies — a safety flag, not a diagnosis
  "patient_clinical", // conditions, medications, alerts — diagnosis-revealing
  "patient_contact", // administrative; reception phones the family
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

/**
 * Anything not listed is denied. Default-deny is the point — adding a resource
 * without touching this file makes it inaccessible, which is the safe failure.
 */
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
    // A drug-allergy flag is a front-desk safety signal — reception may read
    // it, never author it.
    patient_allergy: R,
    // Conditions, medications and alerts reveal a diagnosis. Not the desk's.
    patient_clinical: NONE,
    patient_contact: RW,
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

  LOCATION_ADMIN: {
    practice_location: RW,
    location_member: RWD,
    doctor_profile: R,
    patient: RW,
    // Operational role. It sees no clinical content, by the same reasoning
    // that keeps private_notes away from it.
    patient_allergy: NONE,
    patient_clinical: NONE,
    patient_contact: R,
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
 * the row belongs to the caller's active clinic — see requireLocationContext.
 * Both checks are required; neither is sufficient alone.
 */
export function can(role: LocationRole, action: Action, resource: Resource): boolean {
  return MATRIX[role]?.[resource]?.includes(action) ?? false;
}

/**
 * Can a user holding ANY of `roles` perform the action?
 *
 * A user may hold several roles at one clinic (a solo doctor is both DOCTOR and
 * LOCATION_ADMIN of their own chamber), so permission is the union. This is what
 * request-path code should call — `can()` is the single-role primitive.
 *
 * Note the union never widens a denial that matters: `private_notes` is granted
 * only to DOCTOR, so adding LOCATION_ADMIN cannot unlock it, and vice versa.
 */
export function canAny(
  roles: readonly LocationRole[],
  action: Action,
  resource: Resource,
): boolean {
  return roles.some((role) => can(role, action, resource));
}

/** Every action a role may take on a resource. Useful for building UI. */
export function allowedActions(
  role: LocationRole,
  resource: Resource,
): readonly Action[] {
  return MATRIX[role]?.[resource] ?? [];
}

/** Roles permitted to manage clinic settings and membership. */
export function isLocationManager(role: LocationRole): boolean {
  return can(role, "update", "location_member");
}





