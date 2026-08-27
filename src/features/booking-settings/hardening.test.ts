import { describe, it, expect, beforeAll } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * Two properties that a routine edit could quietly undo.
 *
 * Behaviour is proven against real Postgres in
 * `scripts/verify-booking-settings.mjs`. These need no database.
 */
const POLICY = "supabase/policies/0036_booking_settings_hardening.sql";

let policy = "";
let code = "";

beforeAll(async () => {
  policy = await readFile(path.resolve(POLICY), "utf8");
  code = policy.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*--.*$/gm, "");
});

describe("enabling public booking requires present-tense membership", () => {
  it("checks practice_location_members, ACTIVE, role DOCTOR", () => {
    expect(code).toContain("practice_location_members");
    expect(code).toMatch(/m\.status = 'ACTIVE'/);
    expect(code).toMatch(/m\.role = 'DOCTOR'/);
    expect(code).toContain("NOT_ACTIVE_AT_LOCATION");
  });

  it("gates that check on ENABLING only, so the exit is never locked", () => {
    /*
     * A doctor who has left must always be able to switch booking off. A
     * safety control that can be locked out by the very condition it guards
     * against is not a safety control.
     */
    const guard = code.slice(code.indexOf("if p_enabled then"), code.indexOf("select bs.booking_enabled"));
    expect(guard, "membership must be checked inside the p_enabled branch").toContain(
      "NOT_ACTIVE_AT_LOCATION",
    );
  });

  it("derives the location from the chamber, never from the caller", () => {
    const params = policy.slice(
      policy.indexOf("save_doctor_booking_settings(") + "save_doctor_booking_settings(".length,
      policy.indexOf(")\nreturns uuid") === -1
        ? policy.indexOf("returns uuid")
        : policy.indexOf(")\nreturns uuid"),
    );
    expect(params, "a location parameter could disagree with the chamber").not.toMatch(
      /p_location|p_practice/,
    );
    expect(code).toMatch(/select dc\.practice_location_id into v_location/);
    expect(code, "and no doctor id is accepted either").toMatch(
      /v_doctor uuid := public\.current_doctor_id\(\)/,
    );
  });
});

describe("the audit is written where it cannot be lost", () => {
  it("inserts into audit_events inside the function", () => {
    /*
     * ADR 0007: `emitAudit` swallows failures by design, so it is the wrong
     * mechanism where the audit must not be lost. The row is written in the
     * same transaction as the setting — if it fails, the setting does not
     * change.
     */
    expect(code).toMatch(/insert into public\.audit_events/);
    const fn = code.slice(code.indexOf("as $$"), code.lastIndexOf("$$;"));
    expect(fn, "the audit must be inside the function body").toContain("audit_events");
  });

  it("distinguishes opening the door from tuning the settings", () => {
    expect(code).toContain("PUBLIC_BOOKING_ENABLED");
    expect(code).toContain("PUBLIC_BOOKING_DISABLED");
    expect(code).toContain("BOOKING_SETTINGS_UPDATED");
  });

  it("records who, where and the before/after state", () => {
    expect(code).toMatch(/v_location,\s*\n\s*v_user,/);
    expect(code).toContain("'wasEnabled', v_was_enabled");
    expect(code).toContain("'nowEnabled', p_enabled");
  });
});

describe("booking settings stay out of the clinical record", () => {
  it("touches no clinical table and no visibility", () => {
    for (const table of ["patients", "encounters", "prescriptions", "queue_entries"]) {
      expect(code, `must not reference ${table}`).not.toContain(`public.${table}`);
    }
    expect(code, "enabling booking must not publish a doctor").not.toContain("profile_visibility");
  });
});
