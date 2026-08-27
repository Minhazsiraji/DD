import { describe, expect, it } from "vitest";
import { appointmentSerials } from "./serial";

const base = {
  ownerDoctorId: "doctor-a",
  practiceLocationId: "location-a",
  sessionDate: "2026-09-02",
};

describe("appointment serial", () => {
  it("uses creation order, not input order", () => {
    const rows = [
      { ...base, id: "b", createdAt: "2026-08-27T03:00:02.000Z" },
      { ...base, id: "a", createdAt: "2026-08-27T03:00:01.000Z" },
    ];
    const serial = appointmentSerials(rows);
    expect(serial.get("a")).toBe(1);
    expect(serial.get("b")).toBe(2);
  });

  it("breaks identical timestamps deterministically by appointment id", () => {
    const serial = appointmentSerials([
      { ...base, id: "0002", createdAt: "2026-08-27T03:00:00.000Z" },
      { ...base, id: "0001", createdAt: "2026-08-27T03:00:00.000Z" },
    ]);
    expect(serial.get("0001")).toBe(1);
    expect(serial.get("0002")).toBe(2);
  });

  it("resets per doctor, chamber and clinic day", () => {
    const serial = appointmentSerials([
      { ...base, id: "a", createdAt: "2026-08-27T03:00:00.000Z" },
      { ...base, id: "b", ownerDoctorId: "doctor-b", createdAt: "2026-08-27T03:00:01.000Z" },
      { ...base, id: "c", practiceLocationId: "location-b", createdAt: "2026-08-27T03:00:02.000Z" },
      { ...base, id: "d", sessionDate: "2026-09-03", createdAt: "2026-08-27T03:00:03.000Z" },
    ]);
    expect([...serial.values()]).toEqual([1, 1, 1, 1]);
  });

  it("does not care whether an earlier row is later cancelled", () => {
    const serial = appointmentSerials([
      { ...base, id: "a", createdAt: "2026-08-27T03:00:00.000Z", status: "CANCELLED" },
      { ...base, id: "b", createdAt: "2026-08-27T03:00:01.000Z", status: "SCHEDULED" },
    ]);
    expect(serial.get("a")).toBe(1);
    expect(serial.get("b")).toBe(2);
  });
});
