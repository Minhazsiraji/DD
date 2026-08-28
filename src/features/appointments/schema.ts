import { z } from "zod";
import type { ActionState } from "@/features/auth/schema";

/**
 * Appointment vocabulary and the state machine, as pure data.
 *
 * The DATABASE is the authority (appointment_transition_allowed) — this mirror
 * exists so the UI can decide which buttons to render without a round trip.
 * A test asserts the two agree; if they ever drift, the database wins and the
 * user sees an error instead of a wrong button, which is the safe direction.
 */

export const APPOINTMENT_STATUSES = [
  "SCHEDULED",
  "CONFIRMED",
  "ARRIVED",
  "IN_CONSULTATION",
  "COMPLETED",
  "CANCELLED",
  "NO_SHOW",
] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

export const VISIT_TYPES = [
  "NEW",
  "FOLLOW_UP",
  "REPORT_REVIEW",
  "PROCEDURE",
  "EMERGENCY",
] as const;
export type VisitType = (typeof VISIT_TYPES)[number];

export const CANCELLATION_REASONS = [
  "PATIENT_REQUEST",
  "PATIENT_UNWELL",
  "DOCTOR_UNAVAILABLE",
  "RESCHEDULED",
  "DUPLICATE",
  "OTHER",
] as const;
export type CancellationReason = (typeof CANCELLATION_REASONS)[number];

export const STATUS_LABEL: Record<AppointmentStatus, string> = {
  SCHEDULED: "Booked",
  CONFIRMED: "Confirmed",
  ARRIVED: "Waiting",
  IN_CONSULTATION: "With the doctor",
  COMPLETED: "Seen",
  CANCELLED: "Cancelled",
  NO_SHOW: "Did not come",
};

export const VISIT_TYPE_LABEL: Record<VisitType, string> = {
  NEW: "New patient",
  FOLLOW_UP: "Follow-up",
  REPORT_REVIEW: "Report review",
  PROCEDURE: "Procedure",
  EMERGENCY: "Emergency",
};

export const CANCELLATION_LABEL: Record<CancellationReason, string> = {
  PATIENT_REQUEST: "Patient asked to cancel",
  PATIENT_UNWELL: "Patient too unwell to travel",
  DOCTOR_UNAVAILABLE: "Doctor unavailable",
  RESCHEDULED: "Moved to another time",
  DUPLICATE: "Booked twice by mistake",
  OTHER: "Other",
};

/** Mirrors public.appointment_transition_allowed. Asserted equal in the tests. */
export const ALLOWED_TRANSITIONS: Record<AppointmentStatus, readonly AppointmentStatus[]> = {
  SCHEDULED: ["CONFIRMED", "ARRIVED", "CANCELLED", "NO_SHOW"],
  CONFIRMED: ["ARRIVED", "CANCELLED", "NO_SHOW"],
  ARRIVED: ["IN_CONSULTATION", "CANCELLED", "NO_SHOW"],
  IN_CONSULTATION: ["COMPLETED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: [],
};

export const TERMINAL_STATUSES: readonly AppointmentStatus[] = [
  "COMPLETED",
  "CANCELLED",
  "NO_SHOW",
];

export function isTerminal(status: AppointmentStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

export function canTransition(from: AppointmentStatus, to: AppointmentStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/** Rescheduling is not a status change — it cancels and re-books. */
export function canReschedule(status: AppointmentStatus): boolean {
  return !isTerminal(status);
}

/**
 * The action a receptionist most likely wants next, given the status. Shown as
 * the primary button so the common path is one tap on a busy desk.
 *
 * THERE IS NO ENTRY FOR `IN_CONSULTATION` (C-006), AND THERE MUST NOT BE.
 *
 * This map once carried `{ to: "COMPLETED", label: "Finish consultation" }`,
 * which rendered a button on the appointments screen that completed the
 * APPOINTMENT and nothing else. The patient left the live queue, the day moved
 * on, and the encounter stayed DRAFT — a visit that had plainly happened,
 * recorded as still in progress, with nothing on any screen looking wrong.
 * Reception and the location admin could press it too.
 *
 * Finishing a visit closes the notes AND the appointment together, so it lives
 * where the notes are: `FinishConsultation` on the consultation screen, through
 * `finish_consultation`. A second button here — even a correct one — would be
 * two controls with the same words and different authority, which is how the
 * wrong one gets pressed on a busy desk.
 *
 * The database refuses this transition through the desk's API regardless; see
 * `0038_finish_consultation_authority.sql`. This map is the affordance, not the
 * control.
 */
export const PRIMARY_ACTION: Partial<
  Record<AppointmentStatus, { to: AppointmentStatus; label: string }>
> = {
  SCHEDULED: { to: "ARRIVED", label: "Patient has arrived" },
  CONFIRMED: { to: "ARRIVED", label: "Patient has arrived" },
  ARRIVED: { to: "IN_CONSULTATION", label: "Start consultation" },
};

export const STATUS_ACTION_LABEL: Record<AppointmentStatus, string> = {
  SCHEDULED: "Reopen",
  CONFIRMED: "Confirm",
  ARRIVED: "Patient has arrived",
  IN_CONSULTATION: "Start consultation",
  COMPLETED: "Finish consultation",
  CANCELLED: "Cancel",
  NO_SHOW: "Mark as did not come",
};

// ---------------------------------------------------------------------------
// Form contracts
// ---------------------------------------------------------------------------

/**
 * A local date+time as typed, e.g. "2026-09-01T15:30".
 *
 * Kept as text through validation and converted with the LOCATION's timezone on
 * the server. Trusting `new Date(value)` here would resolve it in the browser's
 * timezone, which is not necessarily the clinic's.
 */
const localDateTime = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Pick a date and time");

export const bookingSchema = z.object({
  patientId: z.uuid("Choose a patient"),
  ownerDoctorId: z.uuid("Choose a doctor"),
  scheduledFor: localDateTime,
  durationMinutes: z.coerce.number().int().min(5).max(240).default(15),
  visitType: z.enum(VISIT_TYPES).default("NEW"),
  reason: z.string().trim().max(300).optional().or(z.literal("")),
});

export const rescheduleSchema = z.object({
  appointmentId: z.uuid(),
  scheduledFor: localDateTime,
  durationMinutes: z.coerce.number().int().min(5).max(240).optional(),
  note: z.string().trim().max(300).optional().or(z.literal("")),
});

export const statusChangeSchema = z.object({
  appointmentId: z.uuid(),
  toStatus: z.enum(APPOINTMENT_STATUSES),
  reason: z.enum(CANCELLATION_REASONS).optional(),
  note: z.string().trim().max(300).optional().or(z.literal("")),
});

export interface AppointmentActionState extends ActionState {
  appointmentId?: string;
  values?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Presentation helpers
// ---------------------------------------------------------------------------

/**
 * The clinic day for a date input, as YYYY-MM-DD.
 *
 * Deliberately string arithmetic: building a Date and reading it back applies
 * the runtime's timezone and can shift the day, which is exactly the bug the
 * database side avoids with session_date.
 */
export function todayInDhaka(now: Date = new Date()): string {
  // Asia/Dhaka is UTC+6 year-round — no daylight saving to track.
  const shifted = new Date(now.getTime() + 6 * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 10);
}

export function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/** "10:30 am" from an ISO timestamp, rendered in the clinic's timezone. */
export function timeInZone(iso: string, timeZone = "Asia/Dhaka"): string {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone,
  }).format(new Date(iso));
}

export function dateInZone(iso: string, timeZone = "Asia/Dhaka"): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone,
  }).format(new Date(iso));
}

/** Sort key for a day's list: waiting patients first, then by time. */
export const STATUS_ORDER: Record<AppointmentStatus, number> = {
  IN_CONSULTATION: 0,
  ARRIVED: 1,
  CONFIRMED: 2,
  SCHEDULED: 3,
  COMPLETED: 4,
  NO_SHOW: 5,
  CANCELLED: 6,
};
