import type { DobPrecision, Sex, VisitType } from "@/mocks/types";

/**
 * Formatting helpers.
 *
 * All date formatting is explicit and locale-pinned so that server and client
 * produce byte-identical output. Never use `toLocaleDateString()` with the
 * runtime default locale in a rendered component — it differs between the
 * Node server and the browser and causes hydration mismatches.
 */

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

/** "2026-08-07" -> "7 Aug 2026" */
export function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** "2026-08-07" -> "7 Aug" */
export function formatDateShort(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  if (!m || !d) return iso;
  return `${d} ${MONTHS[m - 1]}`;
}

/** "18:05" -> "6:05 PM" */
export function formatTime(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return hhmm;
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, "0")} ${period}`;
}

/** Whole days between two ISO dates (b - a). */
export function daysBetween(aISO: string, bISO: string): number {
  const a = Date.parse(`${aISO}T00:00:00Z`);
  const b = Date.parse(`${bISO}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

/** "3 days overdue" / "due today" / "in 2 days" — relative to a supplied today. */
export function relativeDueLabel(dueISO: string, todayISO: string): string {
  const diff = daysBetween(todayISO, dueISO);
  if (diff === 0) return "Due today";
  if (diff === 1) return "Due tomorrow";
  if (diff === -1) return "1 day overdue";
  if (diff < 0) return `${Math.abs(diff)} days overdue`;
  return `In ${diff} days`;
}

/**
 * Both spellings on purpose.
 *
 * The mocks use lowercase ("male"); the DATABASE enum is uppercase ("MALE"),
 * and adds "UNKNOWN" for a walk-in whose sex nobody asked. Keying only on the
 * mock values rendered a literal "undefined" next to every real patient's age.
 */
const SEX_LABEL: Record<string, string> = {
  male: "M",
  female: "F",
  other: "Other",
  MALE: "M",
  FEMALE: "F",
  OTHER: "Other",
  UNKNOWN: "",
};

/**
 * Age is rendered with its precision so an estimated age is never mistaken for
 * a known one — this matters for weight/age-based dosing.
 */
export function formatAgeSex(
  ageYears: number,
  sex: Sex | string,
  precision: DobPrecision = "DAY",
): string {
  const approx = precision === "AGE_ONLY" || precision === "YEAR" ? "~" : "";
  const label = SEX_LABEL[sex] ?? "";
  // Nothing recorded: show the age alone rather than a dash that reads as data.
  return label ? `${approx}${ageYears}y · ${label}` : `${approx}${ageYears}y`;
}

export const VISIT_TYPE_LABEL: Record<VisitType, string> = {
  NEW: "New patient",
  FOLLOWUP: "Follow-up",
  REPORT_REVIEW: "Report review",
  PROCEDURE: "Procedure",
  EMERGENCY: "Emergency",
};

/** Two-letter initials for avatar fallbacks. */
export function initials(fullName: string): string {
  const parts = fullName.replace(/^Dr\.?\s+/i, "").trim().split(/\s+/);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase();
}
