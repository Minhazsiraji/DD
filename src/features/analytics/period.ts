import type { AnalyticsPeriod } from "./doctor-analytics-types";

function addCalendarDays(date: string, amount: number): string {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + amount);
  return value.toISOString().slice(0, 10);
}
export function analyticsDateRange(localToday: string, period: AnalyticsPeriod) {
  const startDate = addCalendarDays(localToday, -(period - 1));
  const endDateExclusive = addCalendarDays(localToday, 1);
  return { startDate, endDateExclusive, endDateInclusive: localToday };
}
