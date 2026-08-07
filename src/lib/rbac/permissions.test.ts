import { describe, it, expect } from "vitest";
import {
  can,
  canAny,
  allowedActions,
  isClinicManager,
  CLINIC_ROLES,
  RESOURCES,
  ACTIONS,
  type ClinicRole,
} from "./permissions";

describe("permission matrix", () => {
  it("denies by default for every unlisted role/resource/action triple", () => {
    // Nothing may be granted that the matrix does not explicitly list.
    for (const role of CLINIC_ROLES) {
      for (const resource of RESOURCES) {
        for (const action of ACTIONS) {
          const granted = can(role, action, resource);
          if (granted) {
            expect(allowedActions(role, resource)).toContain(action);
          }
        }
      }
    }
  });

  it("never grants delete on clinical records to anyone", () => {
    // Medical records are soft-deleted, never destroyed.
    const clinical = ["encounter", "prescription", "private_notes"] as const;
    for (const role of CLINIC_ROLES) {
      for (const resource of clinical) {
        expect(can(role, "delete", resource)).toBe(false);
      }
    }
  });
});

describe("RECEPTIONIST restrictions", () => {
  const role: ClinicRole = "RECEPTIONIST";

  it("has no access to clinical notes in any form", () => {
    for (const action of ACTIONS) {
      expect(can(role, action, "private_notes")).toBe(false);
      expect(can(role, action, "encounter")).toBe(false);
      expect(can(role, action, "investigation_result")).toBe(false);
    }
  });

  it("cannot author or edit clinical content on a patient", () => {
    expect(can(role, "read", "patient_clinical")).toBe(true); // may see allergy flags
    expect(can(role, "create", "patient_clinical")).toBe(false);
    expect(can(role, "update", "patient_clinical")).toBe(false);
  });

  it("can run the front desk", () => {
    expect(can(role, "create", "appointment")).toBe(true);
    expect(can(role, "update", "queue")).toBe(true);
    expect(can(role, "create", "payment")).toBe(true);
    expect(can(role, "create", "patient")).toBe(true);
  });

  it("may hand over a prescription but never write one", () => {
    expect(can(role, "read", "prescription")).toBe(true);
    expect(can(role, "create", "prescription")).toBe(false);
    expect(can(role, "update", "prescription")).toBe(false);
  });

  it("cannot manage membership, read the audit log, or use the AI assistant", () => {
    expect(can(role, "create", "clinic_member")).toBe(false);
    expect(can(role, "read", "audit_log")).toBe(false);
    expect(can(role, "read", "ai_assistant")).toBe(false);
    expect(isClinicManager(role)).toBe(false);
  });
});

describe("CLINIC_ADMIN restrictions", () => {
  const role: ClinicRole = "CLINIC_ADMIN";

  it("NEVER reads a doctor's private notes — there is no admin override", () => {
    for (const action of ACTIONS) {
      expect(can(role, action, "private_notes")).toBe(false);
    }
  });

  it("cannot author clinical content", () => {
    expect(can(role, "create", "encounter")).toBe(false);
    expect(can(role, "update", "encounter")).toBe(false);
    expect(can(role, "create", "prescription")).toBe(false);
    expect(can(role, "update", "patient_clinical")).toBe(false);
  });

  it("cannot use the AI assistant", () => {
    expect(can(role, "read", "ai_assistant")).toBe(false);
  });

  it("manages the clinic and its members", () => {
    expect(can(role, "update", "clinic")).toBe(true);
    expect(can(role, "create", "clinic_member")).toBe(true);
    expect(can(role, "delete", "clinic_member")).toBe(true);
    expect(can(role, "read", "audit_log")).toBe(true);
    expect(isClinicManager(role)).toBe(true);
  });
});

describe("DOCTOR access", () => {
  const role: ClinicRole = "DOCTOR";

  it("owns the clinical record", () => {
    expect(can(role, "create", "encounter")).toBe(true);
    expect(can(role, "update", "encounter")).toBe(true);
    expect(can(role, "read", "private_notes")).toBe(true);
    expect(can(role, "update", "private_notes")).toBe(true);
    expect(can(role, "create", "prescription")).toBe(true);
    expect(can(role, "read", "ai_assistant")).toBe(true);
  });

  it("is not a clinic manager by default", () => {
    // Practising at a clinic does not make you its administrator.
    expect(can(role, "update", "clinic")).toBe(false);
    expect(can(role, "create", "clinic_member")).toBe(false);
    expect(isClinicManager(role)).toBe(false);
  });

  it("does not settle payments", () => {
    expect(can(role, "read", "payment")).toBe(true);
    expect(can(role, "create", "payment")).toBe(false);
  });
});

describe("canAny — multiple roles at one clinic", () => {
  // The solo-practitioner case: own chamber, so both doctor and administrator.
  const solo: ClinicRole[] = ["DOCTOR", "CLINIC_ADMIN"];

  it("unions the permissions of every role held", () => {
    expect(canAny(solo, "create", "encounter")).toBe(true); // from DOCTOR
    expect(canAny(solo, "create", "clinic_member")).toBe(true); // from CLINIC_ADMIN
    expect(canAny(solo, "update", "clinic")).toBe(true); // from CLINIC_ADMIN
    expect(canAny(solo, "read", "private_notes")).toBe(true); // from DOCTOR
  });

  it("adding CLINIC_ADMIN never unlocks anything DOCTOR alone could not do", () => {
    for (const resource of RESOURCES) {
      for (const action of ACTIONS) {
        if (canAny(solo, action, resource)) {
          expect(
            can("DOCTOR", action, resource) || can("CLINIC_ADMIN", action, resource),
          ).toBe(true);
        }
      }
    }
  });

  it("still denies what no held role grants", () => {
    const reception: ClinicRole[] = ["RECEPTIONIST"];
    expect(canAny(reception, "read", "private_notes")).toBe(false);
    expect(canAny(reception, "create", "encounter")).toBe(false);

    // Reception + admin together still cannot reach clinical notes.
    const deskAndAdmin: ClinicRole[] = ["RECEPTIONIST", "CLINIC_ADMIN"];
    expect(canAny(deskAndAdmin, "read", "private_notes")).toBe(false);
    expect(canAny(deskAndAdmin, "create", "encounter")).toBe(false);
  });

  it("grants nothing for an empty role list", () => {
    for (const resource of RESOURCES) {
      for (const action of ACTIONS) {
        expect(canAny([], action, resource)).toBe(false);
      }
    }
  });
});

describe("private_notes is doctor-exclusive", () => {
  it("only DOCTOR has any access at all", () => {
    const withAccess = CLINIC_ROLES.filter((r) =>
      ACTIONS.some((a) => can(r, a, "private_notes")),
    );
    expect(withAccess).toEqual(["DOCTOR"]);
  });
});
