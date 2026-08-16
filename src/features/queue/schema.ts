import { z } from "zod";
import type { ActionState } from "@/features/auth/schema";
import type { AppointmentStatus, VisitType } from "@/features/appointments/schema";

/**
 * Queue vocabulary, as pure data.
 *
 * ORDERING IS NOT HERE ON PURPOSE. `get_queue()` returns rows already ordered,
 * and re-sorting them in the client would be a second copy of the rule that
 * ADR 0009 exists to prevent. The UI only groups what the database sends.
 */

export const PRIORITY_REASONS = [
  "EMERGENCY",
  "ELDERLY",
  "CHILD",
  "PREGNANT",
  "DISABILITY",
  "UNWELL_WAITING",
  "DOCTOR_INSTRUCTION",
  "STAFF_OR_FAMILY",
  "OTHER",
] as const;
export type PriorityReason = (typeof PRIORITY_REASONS)[number];

export const PRIORITY_REASON_LABEL: Record<PriorityReason, string> = {
  EMERGENCY: "Emergency",
  ELDERLY: "Elderly",
  CHILD: "Young child",
  PREGNANT: "Pregnant",
  DISABILITY: "Disability",
  UNWELL_WAITING: "Too unwell to wait",
  DOCTOR_INSTRUCTION: "Doctor asked for them",
  STAFF_OR_FAMILY: "Staff or family",
  OTHER: "Other",
};

export interface QueueRow {
  appointmentId: string;
  patientId: string;
  patientName: string;
  patientNumber: string;
  ownerDoctorId: string;
  doctorName: string | null;
  tokenNumber: number | null;
  status: AppointmentStatus;
  visitType: VisitType;
  scheduledFor: string;
  arrivedAt: string | null;
  calledAt: string | null;
  callCount: number;
  skippedAt: string | null;
  skipCount: number;
  priority: number;
  priorityReason: PriorityReason | null;
  priorityNote: string | null;
}

/**
 * The three groups the screen shows, in the order the database returned them.
 *
 * `withDoctor` is read-only: once the consultation starts the database refuses
 * every queue action, so offering one would be a button that cannot work.
 */
export interface QueueGroups {
  withDoctor: QueueRow[];
  waiting: QueueRow[];
  skipped: QueueRow[];
}

export function groupQueue(rows: QueueRow[]): QueueGroups {
  return {
    withDoctor: rows.filter((r) => r.status === "IN_CONSULTATION"),
    waiting: rows.filter((r) => r.status === "ARRIVED" && !r.skippedAt),
    skipped: rows.filter((r) => r.status === "ARRIVED" && Boolean(r.skippedAt)),
  };
}

/** Queue actions are only ever offered on a patient who is still waiting. */
export function isMutable(row: QueueRow): boolean {
  return row.status === "ARRIVED";
}

export const priorityInputSchema = z.object({
  appointmentId: z.uuid(),
  reason: z.enum(PRIORITY_REASONS, { message: "Choose why they are going first" }),
  note: z.string().trim().max(200).optional().or(z.literal("")),
});

export const queueActionSchema = z.object({
  appointmentId: z.uuid(),
  note: z.string().trim().max(200).optional().or(z.literal("")),
});

export interface QueueActionState extends ActionState {
  appointmentId?: string;
}

/** "Waiting 12 min" — computed from arrival, in whole minutes. */
export function waitedMinutes(arrivedAt: string | null, now: number): number | null {
  if (!arrivedAt) return null;
  const ms = now - new Date(arrivedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  return Math.floor(ms / 60000);
}

export function waitLabel(minutes: number | null): string | null {
  if (minutes === null) return null;
  if (minutes < 1) return "just arrived";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} hr` : `${hours} hr ${rest} min`;
}
