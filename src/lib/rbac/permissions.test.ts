import { describe, it, expect } from "vitest";
import {
  can,
  canAny,
  allowedActions,
  isLocationManager,
  LOCATION_ROLES,
  RESOURCES,
  ACTIONS,
  type LocationRole,
} from "./permissions";

describe("permission matrix", () => {
  it("denies by default for every unlisted role/resource/action triple", () => {
    // Nothing may be granted that the matrix does not explicitly list.
    for (const role of LOCATION_ROLES) {
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
    for (const role of LOCATION_ROLES) {
      for (const resource of clinical) {
        expect(can(role, "delete", resource)).toBe(false);
      }
    }
  });
});

describe("RECEPTIONIST restrictions", () => {
  const role: LocationRole = "RECEPTIONIST";

  it("has no access to clinical notes in any form", () => {
    for (const action of ACTIONS) {
      expect(can(role, action, "private_notes")).toBe(false);
      expect(can(role, action, "encounter")).toBe(false);
      expect(can(role, action, "investigation_result")).toBe(false);
    }
  });

  it("may read a drug-allergy flag but never author one", () => {
    // A front-desk safety signal, and not a diagnosis.
    expect(can(role, "read", "patient_allergy")).toBe(true);
    expect(can(role, "create", "patient_allergy")).toBe(false);
    expect(can(role, "update", "patient_allergy")).toBe(false);
  });

  it("CANNOT read conditions, medications or alerts", () => {
    // These reveal a diagnosis — an antiretroviral in the medication list
    // discloses HIV status to whoever is on the front desk.
    for (const action of ACTIONS) {
      expect(can(role, action, "patient_clinical")).toBe(false);
    }
  });

  it("maintains contact details, which carry no clinical meaning", () => {
    expect(can(role, "read", "patient_contact")).toBe(true);
    expect(can(role, "update", "patient_contact")).toBe(true);
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
    expect(can(role, "create", "location_member")).toBe(false);
    expect(can(role, "read", "audit_log")).toBe(false);
    expect(can(role, "read", "ai_assistant")).toBe(false);
    expect(isLocationManager(role)).toBe(false);
  });
});

describe("LOCATION_ADMIN restrictions", () => {
  const role: LocationRole = "LOCATION_ADMIN";

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

  it("reads no clinical content at all", () => {
    for (const action of ACTIONS) {
      expect(can(role, action, "patient_clinical")).toBe(false);
      expect(can(role, action, "patient_allergy")).toBe(false);
    }
  });

  it("cannot use the AI assistant", () => {
    expect(can(role, "read", "ai_assistant")).toBe(false);
  });

  it("manages the clinic and its members", () => {
    expect(can(role, "update", "practice_location")).toBe(true);
    expect(can(role, "create", "location_member")).toBe(true);
    expect(can(role, "delete", "location_member")).toBe(true);
    expect(can(role, "read", "audit_log")).toBe(true);
    expect(isLocationManager(role)).toBe(true);
  });
});

describe("DOCTOR access", () => {
  const role: LocationRole = "DOCTOR";

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
    expect(can(role, "update", "practice_location")).toBe(false);
    expect(can(role, "create", "location_member")).toBe(false);
    expect(isLocationManager(role)).toBe(false);
  });

  it("does not settle payments", () => {
    expect(can(role, "read", "payment")).toBe(true);
    expect(can(role, "create", "payment")).toBe(false);
  });
});

describe("canAny — multiple roles at one clinic", () => {
  // The solo-practitioner case: own chamber, so both doctor and administrator.
  const solo: LocationRole[] = ["DOCTOR", "LOCATION_ADMIN"];

  it("unions the permissions of every role held", () => {
    expect(canAny(solo, "create", "encounter")).toBe(true); // from DOCTOR
    expect(canAny(solo, "create", "location_member")).toBe(true); // from LOCATION_ADMIN
    expect(canAny(solo, "update", "practice_location")).toBe(true); // from LOCATION_ADMIN
    expect(canAny(solo, "read", "private_notes")).toBe(true); // from DOCTOR
  });

  it("adding LOCATION_ADMIN never unlocks anything DOCTOR alone could not do", () => {
    for (const resource of RESOURCES) {
      for (const action of ACTIONS) {
        if (canAny(solo, action, resource)) {
          expect(
            can("DOCTOR", action, resource) || can("LOCATION_ADMIN", action, resource),
          ).toBe(true);
        }
      }
    }
  });

  it("still denies what no held role grants", () => {
    const reception: LocationRole[] = ["RECEPTIONIST"];
    expect(canAny(reception, "read", "private_notes")).toBe(false);
    expect(canAny(reception, "create", "encounter")).toBe(false);

    // Reception + admin together still cannot reach clinical notes.
    const deskAndAdmin: LocationRole[] = ["RECEPTIONIST", "LOCATION_ADMIN"];
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
    const withAccess = LOCATION_ROLES.filter((r) =>
      ACTIONS.some((a) => can(r, a, "private_notes")),
    );
    expect(withAccess).toEqual(["DOCTOR"]);
  });
});


