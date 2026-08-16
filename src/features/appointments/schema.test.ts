import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  ALLOWED_TRANSITIONS,
  APPOINTMENT_STATUSES,
  canTransition,
  canReschedule,
  isTerminal,
  PRIMARY_ACTION,
  todayInDhaka,
  addDays,
  timeInZone,
  bookingSchema,
  rescheduleSchema,
  statusChangeSchema,
} from "./schema";

/**
 * The state machine exists in TWO places: this file, so the UI can decide which
 * buttons to render without a round trip, and the database, which is the
 * authority. Drift between them shows a doctor a button that then fails.
 */
describe("the TypeScript mirror matches the database", () => {
  it("allows exactly what appointment_transition_allowed allows", async () => {
    const sqlPath = path.resolve("supabase/policies/0008_appointment_transactions.sql");
    const sql = await readFile(sqlPath, "utf8");

    // Parse the `when 'X' then to_status in ('A','B')` arms out of the function.
    const arms = [...sql.matchAll(/when\s+'(\w+)'\s+then to_status in \(([^)]*)\)/g)];
    expect(arms.length, "found no transition arms — did the SQL move?").toBeGreaterThan(0);

    const fromSql: Record<string, string[]> = {};
    for (const [, from, list] of arms) {
      fromSql[from!] = [...list!.matchAll(/'(\w+)'/g)].map((m) => m[1]!);
    }

    // Terminal states have no arm at all; the SQL falls through to `else false`.
    for (const status of APPOINTMENT_STATUSES) {
      const expected = [...(fromSql[status] ?? [])].sort();
      const actual = [...ALLOWED_TRANSITIONS[status]].sort();
      expect(actual, `transitions from ${status}`).toEqual(expected);
    }
  });
});

describe("the state machine", () => {
  it("lets a booked patient arrive, confirm, cancel or no-show", () => {
    expect(canTransition("SCHEDULED", "ARRIVED")).toBe(true);
    expect(canTransition("SCHEDULED", "CONFIRMED")).toBe(true);
    expect(canTransition("SCHEDULED", "CANCELLED")).toBe(true);
    expect(canTransition("SCHEDULED", "NO_SHOW")).toBe(true);
  });

  it("never skips the consultation", () => {
    expect(canTransition("SCHEDULED", "COMPLETED")).toBe(false);
    expect(canTransition("ARRIVED", "COMPLETED")).toBe(false);
    expect(canTransition("CONFIRMED", "IN_CONSULTATION")).toBe(false);
  });

  it("treats COMPLETED, CANCELLED and NO_SHOW as final", () => {
    for (const status of ["COMPLETED", "CANCELLED", "NO_SHOW"] as const) {
      expect(isTerminal(status)).toBe(true);
      expect(ALLOWED_TRANSITIONS[status]).toEqual([]);
      expect(canReschedule(status)).toBe(false);
    }
  });

  it("offers a primary action only where one exists", () => {
    for (const status of APPOINTMENT_STATUSES) {
      const action = PRIMARY_ACTION[status];
      if (!action) {
        expect(isTerminal(status)).toBe(true);
        continue;
      }
      expect(canTransition(status, action.to)).toBe(true);
    }
  });
});

describe("clinic-day arithmetic", () => {
  it("uses Dhaka's day, not the runtime's", () => {
    // 20:00 UTC on 31 Aug is already 02:00 on 1 Sep in Dhaka.
    expect(todayInDhaka(new Date("2026-08-31T20:00:00Z"))).toBe("2026-09-01");
    // 17:00 UTC is 23:00 the same day.
    expect(todayInDhaka(new Date("2026-08-31T17:00:00Z"))).toBe("2026-08-31");
  });

  it("moves across month and year boundaries", () => {
    expect(addDays("2026-08-31", 1)).toBe("2026-09-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(addDays("2026-03-01", 0)).toBe("2026-03-01");
  });

  it("renders times in the clinic's timezone regardless of the server's", () => {
    // 04:30 UTC is 10:30 in Dhaka.
    expect(timeInZone("2026-09-01T04:30:00Z")).toMatch(/10:30/);
  });
});

describe("form contracts", () => {
  const patient = "11111111-1111-4111-8111-111111111111";
  const doctor = "22222222-2222-4222-8222-222222222222";

  it("requires a real patient and doctor", () => {
    expect(
      bookingSchema.safeParse({
        patientId: "not-a-uuid",
        ownerDoctorId: doctor,
        scheduledFor: "2026-09-01T10:00",
      }).success,
    ).toBe(false);
  });

  it("rejects a half-typed date", () => {
    for (const bad of ["2026-09-01", "10:00", "", "2026-09-01 10:00"]) {
      expect(
        bookingSchema.safeParse({
          patientId: patient,
          ownerDoctorId: doctor,
          scheduledFor: bad,
        }).success,
        bad,
      ).toBe(false);
    }
  });

  it("accepts a well-formed booking and defaults sensibly", () => {
    const parsed = bookingSchema.safeParse({
      patientId: patient,
      ownerDoctorId: doctor,
      scheduledFor: "2026-09-01T10:00",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.durationMinutes).toBe(15);
      expect(parsed.data.visitType).toBe("NEW");
    }
  });

  it("keeps appointment lengths within a plausible range", () => {
    const base = { patientId: patient, ownerDoctorId: doctor, scheduledFor: "2026-09-01T10:00" };
    expect(bookingSchema.safeParse({ ...base, durationMinutes: 1 }).success).toBe(false);
    expect(bookingSchema.safeParse({ ...base, durationMinutes: 600 }).success).toBe(false);
  });

  it("only accepts known statuses and reasons", () => {
    expect(
      statusChangeSchema.safeParse({ appointmentId: patient, toStatus: "DELETED" }).success,
    ).toBe(false);
    expect(
      statusChangeSchema.safeParse({
        appointmentId: patient,
        toStatus: "CANCELLED",
        reason: "BECAUSE",
      }).success,
    ).toBe(false);
  });

  it("requires a new time to reschedule", () => {
    expect(rescheduleSchema.safeParse({ appointmentId: patient, scheduledFor: "" }).success).toBe(
      false,
    );
  });
});
