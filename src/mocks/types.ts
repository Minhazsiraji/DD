/**
 * Phase 1 data contracts.
 *
 * These are deliberately the shapes the real database will return, so that
 * swapping mock data for Drizzle queries in later phases is an import change,
 * not a rewrite of the dashboard. Do not add fields here that the approved
 * schema cannot produce.
 */

export type AppointmentStatus =
  | "REQUESTED"
  | "PENDING_CONFIRMATION"
  | "CONFIRMED"
  | "PAYMENT_PENDING"
  | "READY"
  | "CHECKED_IN"
  | "IN_QUEUE"
  | "IN_CONSULTATION"
  | "COMPLETED"
  | "CANCELLED"
  | "RESCHEDULED"
  | "NO_SHOW";

export type VisitType =
  | "NEW"
  | "FOLLOWUP"
  | "REPORT_REVIEW"
  | "PROCEDURE"
  | "EMERGENCY";

export type PaymentStatus = "UNPAID" | "PARTIAL" | "PAID" | "REFUNDED" | "WAIVED";

export type Severity = "none" | "caution" | "serious" | "critical";

export type Sex = "male" | "female" | "other";

/** Many patients do not know an exact birth date. Never fabricate one. */
export type DobPrecision = "DAY" | "MONTH" | "YEAR" | "AGE_ONLY";

/**
 * Where a doctor practises. A location is an ATTRIBUTE of an appointment or
 * encounter — it never owns patient data.
 *
 * Clinics and hospitals run their own systems; Doctor's Diary does not try to
 * be one. It is the doctor's own record of their own patients, wherever those
 * patients were seen.
 */
export type LocationType =
  | "OWN_CHAMBER"
  | "CLINIC"
  | "HOSPITAL"
  | "TELEMEDICINE";

export interface PracticeLocation {
  id: string;
  name: string;
  type: LocationType;
  address: string | null;
  consultationFee: number;
  followUpFee: number;
  slotMinutes: number;
  isActive: boolean;
}

export interface DoctorProfile {
  id: string;
  fullName: string;
  qualification: string;
  specialization: string;
  registrationNo: string;
  avatarUrl: string | null;
  /** The doctor's own practice name — the tenancy root, not a clinic. */
  practiceName: string;
}

export interface PatientAlert {
  id: string;
  severity: Severity;
  label: string;
}

export interface PatientSummary {
  id: string;
  /** Sequential within the doctor's own practice, e.g. AR-000124. */
  patientNumber: string;
  fullName: string;
  ageYears: number;
  dobPrecision: DobPrecision;
  sex: Sex;
  phone: string;
  bloodGroup: string | null;
  weightKg: number | null;
  allergies: string[];
  conditions: string[];
  alerts: PatientAlert[];
  lastVisitOn: string | null;
}

export interface QueueEntry {
  id: string;
  tokenNumber: number;
  queuePosition: number;
  patient: PatientSummary;
  visitType: VisitType;
  status: AppointmentStatus;
  paymentStatus: PaymentStatus;
  scheduledAt: string;
  /** Derived from median duration per (doctor, visitType) — not a fixed slot. */
  expectedAt: string;
  checkedInAt: string | null;
  isPriority: boolean;
}

export interface ScheduleSlot {
  id: string;
  time: string;
  patientName: string;
  visitType: VisitType;
  status: AppointmentStatus;
}

export interface PendingReport {
  id: string;
  patientName: string;
  patientNumber: string;
  testName: string;
  requestedOn: string;
  receivedOn: string | null;
  isAbnormal: boolean;
}

export interface FollowUpDue {
  id: string;
  patientName: string;
  patientNumber: string;
  reason: string;
  dueOn: string;
  status: "recommended" | "booked" | "completed" | "overdue";
}

export interface RecentPatient {
  id: string;
  patientNumber: string;
  fullName: string;
  ageYears: number;
  sex: Sex;
  seenOn: string;
  reason: string;
  /** Where this visit happened — the same patient may be seen anywhere. */
  locationName: string;
}

export interface AttentionItem {
  id: string;
  severity: Severity;
  title: string;
  detail: string;
}

export interface DashboardData {
  doctor: DoctorProfile;
  /** Everywhere this doctor practises. Switching context filters the day. */
  locations: PracticeLocation[];
  activeLocationId: string;
  todayISO: string;
  stats: {
    appointmentsToday: number;
    waiting: number;
    reportsPending: number;
    followUpsDue: number;
  };
  currentToken: number | null;
  currentPatient: QueueEntry | null;
  nextPatient: QueueEntry | null;
  queue: QueueEntry[];
  schedule: ScheduleSlot[];
  reports: PendingReport[];
  followUps: FollowUpDue[];
  recentPatients: RecentPatient[];
  attention: AttentionItem[];
}
