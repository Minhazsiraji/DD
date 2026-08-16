import { describe, it, expect } from "vitest";
import { groupQueue, isMutable, waitedMinutes, waitLabel, type QueueRow } from "./schema";

const row = (over: Partial<QueueRow>): QueueRow => ({
  appointmentId: over.appointmentId ?? "a",
  patientId: "p",
  patientName: "Patient",
  patientNumber: "AA-000001",
  ownerDoctorId: "d",
  doctorName: "Dr A",
  tokenNumber: 1,
  status: "ARRIVED",
  visitType: "NEW",
  scheduledFor: "2026-09-01T04:00:00Z",
  arrivedAt: null,
  calledAt: null,
  callCount: 0,
  skippedAt: null,
  skipCount: 0,
  priority: 0,
  priorityReason: null,
  priorityNote: null,
  ...over,
});

describe("groupQueue", () => {
  it("splits the room into with-doctor, waiting and skipped", () => {
    const rows = [
      row({ appointmentId: "c", status: "IN_CONSULTATION" }),
      row({ appointmentId: "w", status: "ARRIVED" }),
      row({ appointmentId: "s", status: "ARRIVED", skippedAt: "2026-09-01T05:00:00Z" }),
    ];
    const g = groupQueue(rows);
    expect(g.withDoctor.map((r) => r.appointmentId)).toEqual(["c"]);
    expect(g.waiting.map((r) => r.appointmentId)).toEqual(["w"]);
    expect(g.skipped.map((r) => r.appointmentId)).toEqual(["s"]);
  });

  /**
   * The database already applied priority and token order. Re-sorting here
   * would be the second copy of the rule that ADR 0009 exists to prevent, so
   * grouping must be a FILTER — order in, same order out.
   */
  it("preserves the database's order and never re-sorts", () => {
    const rows = [
      row({ appointmentId: "third", tokenNumber: 9, priority: 0 }),
      row({ appointmentId: "first", tokenNumber: 1, priority: 1 }),
      row({ appointmentId: "second", tokenNumber: 5, priority: 0 }),
    ];
    expect(groupQueue(rows).waiting.map((r) => r.appointmentId)).toEqual([
      "third",
      "first",
      "second",
    ]);
  });

  it("treats a skipped patient as still in the room, not gone", () => {
    const rows = [row({ status: "ARRIVED", skippedAt: "2026-09-01T05:00:00Z" })];
    const g = groupQueue(rows);
    expect(g.skipped).toHaveLength(1);
    expect(g.waiting).toHaveLength(0);
  });

  it("returns empty groups for an empty room", () => {
    const g = groupQueue([]);
    expect(g.withDoctor).toEqual([]);
    expect(g.waiting).toEqual([]);
    expect(g.skipped).toEqual([]);
  });
});

describe("isMutable", () => {
  it("allows queue actions only while the patient is waiting", () => {
    expect(isMutable(row({ status: "ARRIVED" }))).toBe(true);
    expect(isMutable(row({ status: "ARRIVED", skippedAt: "x" }))).toBe(true);
  });

  it("refuses them once the consultation has started", () => {
    // The database refuses too — this is the UI agreeing, not the control.
    expect(isMutable(row({ status: "IN_CONSULTATION" }))).toBe(false);
    expect(isMutable(row({ status: "COMPLETED" }))).toBe(false);
    expect(isMutable(row({ status: "CANCELLED" }))).toBe(false);
  });
});

describe("waiting time", () => {
  const arrived = "2026-09-01T04:00:00Z";
  const at = (mins: number) => new Date(arrived).getTime() + mins * 60_000;

  it("counts whole minutes since arrival", () => {
    expect(waitedMinutes(arrived, at(0))).toBe(0);
    expect(waitedMinutes(arrived, at(12))).toBe(12);
    expect(waitedMinutes(arrived, at(59.9))).toBe(59);
  });

  it("has no answer for someone who has not arrived", () => {
    expect(waitedMinutes(null, Date.now())).toBeNull();
    expect(waitLabel(null)).toBeNull();
  });

  it("never reports a negative wait from a clock skew", () => {
    expect(waitedMinutes(arrived, at(-5))).toBeNull();
  });

  it("reads naturally past an hour", () => {
    expect(waitLabel(0)).toBe("just arrived");
    expect(waitLabel(1)).toBe("1 min");
    expect(waitLabel(45)).toBe("45 min");
    expect(waitLabel(60)).toBe("1 hr");
    expect(waitLabel(75)).toBe("1 hr 15 min");
    expect(waitLabel(120)).toBe("2 hr");
  });
});
