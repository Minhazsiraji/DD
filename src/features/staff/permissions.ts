export const STAFF_ROLES = ["RECEPTIONIST", "ASSISTANT"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export const STAFF_STATUSES = ["ACTIVE", "TEMPORARILY_DISABLED", "REMOVED"] as const;
export type StaffStatus = (typeof STAFF_STATUSES)[number];

export const STAFF_PERMISSIONS = [
  "appointments.view",
  "appointments.manage",
  "patient.lookup",
  "arrival.manage",
  "queue.manage",
  "chamber.view",
  "intake.write",
  "document.attach",
  "investigation.prepare",
] as const;
export type StaffPermission = (typeof STAFF_PERMISSIONS)[number];

export const ROLE_CEILING: Record<StaffRole, readonly StaffPermission[]> = {
  RECEPTIONIST: [
    "appointments.view",
    "appointments.manage",
    "patient.lookup",
    "arrival.manage",
    "queue.manage",
    "chamber.view",
  ],
  ASSISTANT: [
    "patient.lookup",
    "appointments.view",
    "chamber.view",
    "intake.write",
    "document.attach",
    "investigation.prepare",
  ],
};

export const DOCTOR_ONLY_PERMISSIONS = [
  "diagnosis.finalize",
  "prescription.finalize",
  "prescription.sign",
  "clinical-record.override",
  "ownership.transfer",
  "security-role.escalation",
] as const;

export function roleAllowsPermission(role: StaffRole, permission: StaffPermission): boolean {
  return ROLE_CEILING[role].includes(permission);
}

export function normalizeStaffPermissions(
  role: StaffRole,
  requested: readonly string[],
): StaffPermission[] {
  const valid = new Set<StaffPermission>(ROLE_CEILING[role]);
  return [...new Set(requested)].filter((value): value is StaffPermission =>
    (STAFF_PERMISSIONS as readonly string[]).includes(value) && valid.has(value as StaffPermission),
  );
}

export function isStaffRole(value: string): value is StaffRole {
  return (STAFF_ROLES as readonly string[]).includes(value);
}

export function isStaffStatus(value: string): value is StaffStatus {
  return (STAFF_STATUSES as readonly string[]).includes(value);
}
