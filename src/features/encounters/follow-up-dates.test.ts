import { describe, expect, it } from "vitest";
import {
  addCalendarDays,
  addCalendarMonths,
  calendarDateInTimeZone,
  getFollowUpShortcuts,
} from "./follow-up-dates";

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

  it("adds 1, 2 and 3 true calendar months", () => {
    expect(addCalendarMonths("2026-09-06", 1)).toBe("2026-10-06");
    expect(addCalendarMonths("2026-09-06", 2)).toBe("2026-11-06");
    expect(addCalendarMonths("2026-09-06", 3)).toBe("2026-12-06");
  });

  it("crosses years using calendar months", () => {
    expect(addCalendarMonths("2026-11-30", 2)).toBe("2027-01-30");
    expect(addCalendarMonths("2026-12-31", 1)).toBe("2027-01-31");
  });

  it("clamps leap-year February at its valid last day", () => {
    expect(addCalendarMonths("2028-01-31", 1)).toBe("2028-02-29");
    expect(addCalendarMonths("2028-02-29", 12)).toBe("2029-02-28");
  });

  it("clamps 29, 30 and 31-day edges without fixed-day approximation", () => {
    expect(addCalendarMonths("2027-01-29", 1)).toBe("2027-02-28");
    expect(addCalendarMonths("2027-01-30", 1)).toBe("2027-02-28");
    expect(addCalendarMonths("2027-03-31", 1)).toBe("2027-04-30");
    expect(addCalendarMonths("2027-03-31", 2)).toBe("2027-05-31");
  });

  it("rejects impossible source dates instead of normalising them", () => {
    expect(addCalendarMonths("2027-02-29", 1)).toBeNull();
    expect(addCalendarMonths("2026-13-01", 1)).toBeNull();
  });

  it("returns no quick dates when the location timezone is absent or invalid", () => {
    expect(getFollowUpShortcuts(null)).toEqual([]);
    expect(getFollowUpShortcuts("Not/A_Timezone")).toEqual([]);
  });

  it("produces day and month shortcuts from the active location day", () => {
    const instant = new Date("2026-09-06T10:00:00.000Z");
    expect(getFollowUpShortcuts("Asia/Dhaka", instant)).toEqual([
      { label: "Tomorrow", date: "2026-09-07" },
      { label: "3 days", date: "2026-09-09" },
      { label: "1 week", date: "2026-09-13" },
      { label: "2 weeks", date: "2026-09-20" },
      { label: "1 month", date: "2026-10-06" },
      { label: "2 months", date: "2026-11-06" },
      { label: "3 months", date: "2026-12-06" },
    ]);
  });

  it("resolves chamber timezone before month arithmetic across a UTC date boundary", () => {
    const instant = new Date("2026-01-31T18:30:00.000Z");
    const dhaka = getFollowUpShortcuts("Asia/Dhaka", instant);
    const utc = getFollowUpShortcuts("UTC", instant);
    expect(calendarDateInTimeZone("Asia/Dhaka", instant)).toBe("2026-02-01");
    expect(calendarDateInTimeZone("UTC", instant)).toBe("2026-01-31");
    expect(dhaka.find((item) => item.label === "1 month")?.date).toBe("2026-03-01");
    expect(utc.find((item) => item.label === "1 month")?.date).toBe("2026-02-28");
  });
});
