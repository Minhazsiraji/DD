import { describe, expect, it } from "vitest";
import { previousCompletedClinicDay } from "./close-schedule";

describe("O1 activity close scheduling", () => {
  const now = new Date("2026-09-14T20:30:00.000Z");

  it("selects the previous completed Dhaka clinic date", () => {
    expect(previousCompletedClinicDay(now, "Asia/Dhaka")).toBe("2026-09-14");
  });

  it("uses the configured clinic calendar rather than a UTC date guess", () => {
    expect(previousCompletedClinicDay(now, "Pacific/Kiritimati")).toBe("2026-09-14");
    expect(previousCompletedClinicDay(now, "Etc/GMT+12")).toBe("2026-09-13");
  });

  it("fails closed for a missing or invalid timezone", () => {
    expect(() => previousCompletedClinicDay(now, "")).toThrow("O1_PILOT_CLOSE_TIME_ZONE_REQUIRED");
    expect(() => previousCompletedClinicDay(now, "Mars/Olympus")).toThrow(
      "O1_PILOT_CLOSE_TIME_ZONE_INVALID",
    );
  });
});
