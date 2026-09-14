import { describe, expect, it, vi } from "vitest";
import { ingestDurableEngagement, type DurableEngagementDeps } from "./durable-ingest";

function deps(overrides: Partial<DurableEngagementDeps> = {}): DurableEngagementDeps {
  return {
    now: () => new Date("2026-09-14T05:27:42.000Z"),
    resolveDoctorId: vi.fn(async () => "11111111-1111-4111-8111-111111111111"),
    recordMinute: vi.fn(async () => true),
    ...overrides,
  };
}

describe("durable engagement ingest", () => {
  it("accepts only the frozen surface and stamps Doctor/minute/timezone server-side", async () => {
    const d = deps();
    const result = await ingestDurableEngagement(
      { surface: "CONSULTATION" },
      { actorUserId: "22222222-2222-4222-8222-222222222222", clinicTimeZone: "Asia/Dhaka" },
      d,
    );

    expect(result).toEqual({ status: "RECORDED", rows: 1 });
    expect(d.resolveDoctorId).toHaveBeenCalledWith("22222222-2222-4222-8222-222222222222");
    expect(d.recordMinute).toHaveBeenCalledWith({
      doctorId: "11111111-1111-4111-8111-111111111111",
      minuteBucket: "2026-09-14T05:27:00.000Z",
      surface: "CONSULTATION",
      clinicTimeZone: "Asia/Dhaka",
    });
  });

  it("rejects unknown browser fields before resolving a Doctor", async () => {
    const d = deps();
    const result = await ingestDurableEngagement(
      { surface: "PATIENTS", doctorId: "attacker", timeZone: "UTC" },
      { actorUserId: "22222222-2222-4222-8222-222222222222", clinicTimeZone: "Asia/Dhaka" },
      d,
    );
    expect(result).toEqual({ status: "INVALID_BODY" });
    expect(d.resolveDoctorId).not.toHaveBeenCalled();
    expect(d.recordMinute).not.toHaveBeenCalled();
  });

  it("fails closed when the verified location has no timezone", async () => {
    const d = deps();
    const result = await ingestDurableEngagement(
      { surface: "DASHBOARD" },
      { actorUserId: "22222222-2222-4222-8222-222222222222", clinicTimeZone: null },
      d,
    );
    expect(result).toEqual({ status: "FAILED" });
    expect(d.resolveDoctorId).not.toHaveBeenCalled();
  });

  it("does not record staff sessions that have no canonical Doctor profile", async () => {
    const d = deps({ resolveDoctorId: vi.fn(async () => null) });
    const result = await ingestDurableEngagement(
      { surface: "QUEUE" },
      { actorUserId: "22222222-2222-4222-8222-222222222222", clinicTimeZone: "Asia/Dhaka" },
      d,
    );
    expect(result).toEqual({ status: "NOT_A_DOCTOR" });
    expect(d.recordMinute).not.toHaveBeenCalled();
  });

  it("treats a canonical duplicate minute as idempotent success", async () => {
    const d = deps({ recordMinute: vi.fn(async () => false) });
    const result = await ingestDurableEngagement(
      { surface: "PRESCRIPTION" },
      { actorUserId: "22222222-2222-4222-8222-222222222222", clinicTimeZone: "Asia/Dhaka" },
      d,
    );
    expect(result).toEqual({ status: "RECORDED", rows: 0 });
  });
});
