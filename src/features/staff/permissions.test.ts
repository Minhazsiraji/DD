import { describe, expect, it } from "vitest";
import {
  DOCTOR_ONLY_PERMISSIONS,
  ROLE_CEILING,
  STAFF_PERMISSIONS,
  normalizeStaffPermissions,
  roleAllowsPermission,
} from "./permissions";

describe("Staff Management role ceilings", () => {
  it("keeps Receptionist operational only", () => {
    expect(ROLE_CEILING.RECEPTIONIST).toEqual([
      "appointments.view",
      "appointments.manage",
      "patient.lookup",
      "arrival.manage",
      "queue.manage",
      "chamber.view",
    ]);
    expect(roleAllowsPermission("RECEPTIONIST", "intake.write")).toBe(false);
    expect(roleAllowsPermission("RECEPTIONIST", "document.attach")).toBe(false);
    expect(roleAllowsPermission("RECEPTIONIST", "investigation.prepare")).toBe(false);
  });

  it("keeps Assistant inside the CENTRAL-approved bounded support envelope", () => {
    expect(ROLE_CEILING.ASSISTANT).toEqual([
      "patient.lookup",
      "appointments.view",
      "chamber.view",
      "intake.write",
      "document.attach",
      "investigation.prepare",
    ]);
    expect(roleAllowsPermission("ASSISTANT", "appointments.manage")).toBe(false);
    expect(roleAllowsPermission("ASSISTANT", "arrival.manage")).toBe(false);
    expect(roleAllowsPermission("ASSISTANT", "queue.manage")).toBe(false);
  });

  it("contains no prescription draft/finalization capability", () => {
    expect(STAFF_PERMISSIONS).not.toContain("draft.prepare");
    expect(STAFF_PERMISSIONS.some((permission) => permission.startsWith("prescription."))).toBe(false);
    expect(DOCTOR_ONLY_PERMISSIONS).toContain("prescription.finalize");
    expect(DOCTOR_ONLY_PERMISSIONS).toContain("prescription.sign");
    expect(DOCTOR_ONLY_PERMISSIONS).toContain("diagnosis.finalize");
  });

  it("drops permissions above the selected role ceiling", () => {
    expect(
      normalizeStaffPermissions("ASSISTANT", [
        "patient.lookup",
        "intake.write",
        "appointments.manage",
        "prescription.finalize",
      ]),
    ).toEqual(["patient.lookup", "intake.write"]);
  });
});
