import { describe, expect, it } from "vitest";
import { addCalendarDays, calendarDateInTimeZone, getFollowUpShortcuts } from "./follow-up-dates";

describe("M2 follow-up calendar shortcuts", () => {
  it("derives today from the chamber timezone rather than the viewer timezone", () => {
    const instant = new Date("2026-09-06T18:30:00.000Z");
    expect(calendarDateInTimeZone("Asia/Dhaka", instant)).toBe("2026-09-07");
    expect(calendarDateInTimeZone("America/New_York", instant)).toBe("2026-09-06");
  });

  it("adds literal calendar days without timezone conversion", () => {
    expect(addCalendarDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addCalendarDays("2028-02-28", 1)).toBe("2028-02-29");
  });

  it("returns no quick dates when the location timezone is absent or invalid", () => {
    expect(getFollowUpShortcuts(null)).toEqual([]);
    expect(getFollowUpShortcuts("Not/A_Timezone")).toEqual([]);
  });

  it("produces the agreed short intervals from the location day", () => {
    const instant = new Date("2026-09-06T10:00:00.000Z");
    expect(getFollowUpShortcuts("Asia/Dhaka", instant)).toEqual([
      { label: "Tomorrow", date: "2026-09-07" },
      { label: "3 days", date: "2026-09-09" },
      { label: "1 week", date: "2026-09-13" },
      { label: "2 weeks", date: "2026-09-20" },
    ]);
  });
});
