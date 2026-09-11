import type { MetricUnit, SourceLane } from "./measurement";

/**
 * The Owner Dashboard's vocabulary — every card, column and tab, declared once.
 *
 * Pure data. Pages render from this catalog rather than from inline literals,
 * so the set of numbers the owner can see is reviewable in one place, and a
 * privacy test can assert that nothing clinical is ever on it.
 *
 * `awaiting` is not decoration. It is the honest answer to "why is this tile
 * empty?" — the lane that owes the source, and the thing it owes. Two metrics
 * are blocked on a DEFINITION rather than on data: "active" (U-20) and
 * "estimated time saved" (O1D-4). Inventing either would put a fabricated
 * claim on the owner's console, so the catalog names the definition as the
 * blocker instead.
 */

export interface MetricSpec {
  key: string;
  label: string;
  unit: MetricUnit;
  awaiting: { lane: SourceLane; what: string };
}

// ---------------------------------------------------------------------------
// Overview — the ten top-level cards
// ---------------------------------------------------------------------------

export const OVERVIEW_CARDS = [
  { key: "totalDoctors", label: "Total Doctors", unit: "COUNT", awaiting: { lane: "F", what: "approved doctor-registration aggregate" } },
  { key: "activeToday", label: "Active Today", unit: "COUNT", awaiting: { lane: "F", what: "an agreed “active doctor” definition (U-20) and its aggregate" } },
  { key: "active7d", label: "Active 7 Days", unit: "COUNT", awaiting: { lane: "F", what: "an agreed “active doctor” definition (U-20) and its aggregate" } },
  { key: "active30d", label: "Active 30 Days", unit: "COUNT", awaiting: { lane: "F", what: "an agreed “active doctor” definition (U-20) and its aggregate" } },
  { key: "newDoctors", label: "New Doctors", unit: "COUNT", awaiting: { lane: "F", what: "approved doctor-registration aggregate" } },
  { key: "consultationsCompleted", label: "Consultations", unit: "COUNT", awaiting: { lane: "F", what: "approved consultation aggregate" } },
  { key: "prescriptionsFinalized", label: "Prescriptions", unit: "COUNT", awaiting: { lane: "F", what: "approved finalised-prescription aggregate" } },
  { key: "aiRequests", label: "AI Requests", unit: "COUNT", awaiting: { lane: "E", what: "an AI usage store and its aggregate" } },
  { key: "aiSpend", label: "AI Spend", unit: "USD", awaiting: { lane: "E", what: "AI cost measurement and its aggregate" } },
  { key: "voiceMinutes", label: "Voice Minutes", unit: "MINUTES", awaiting: { lane: "E", what: "transcription usage measurement and its aggregate" } },
] as const satisfies readonly MetricSpec[];

export type OverviewCardKey = (typeof OVERVIEW_CARDS)[number]["key"];

// ---------------------------------------------------------------------------
// Doctors — the thirteen columns
// ---------------------------------------------------------------------------

export interface DoctorColumnSpec extends MetricSpec {
  /**
   * Identity columns name the doctor and their pilot state. They are the only
   * text columns on the table, and they identify a DOCTOR — never a patient.
   */
  identity: boolean;
}

export const DOCTOR_COLUMNS = [
  { key: "doctor", label: "Doctor", unit: "COUNT", identity: true, awaiting: { lane: "F", what: "approved doctor directory aggregate" } },
  { key: "pilotStatus", label: "Pilot status", unit: "COUNT", identity: true, awaiting: { lane: "F", what: "an agreed pilot-status vocabulary (O1D-5)" } },
  { key: "lastActive", label: "Last active", unit: "TIMESTAMP", identity: false, awaiting: { lane: "F", what: "an agreed “active” definition (U-20)" } },
  { key: "activeDays", label: "Active days", unit: "DAYS", identity: false, awaiting: { lane: "F", what: "an agreed “active” definition (U-20)" } },
  { key: "sessions", label: "Sessions", unit: "COUNT", identity: false, awaiting: { lane: "F", what: "session measurement — no store exists" } },
  { key: "activeMinutes", label: "Active minutes", unit: "MINUTES", identity: false, awaiting: { lane: "F", what: "session measurement — no store exists" } },
  { key: "consultationsCompleted", label: "Consultations", unit: "COUNT", identity: false, awaiting: { lane: "F", what: "approved consultation aggregate" } },
  { key: "prescriptionsFinalized", label: "Rx", unit: "COUNT", identity: false, awaiting: { lane: "F", what: "approved finalised-prescription aggregate" } },
  { key: "aiRequests", label: "AI requests", unit: "COUNT", identity: false, awaiting: { lane: "E", what: "an AI usage store and its aggregate" } },
  { key: "tokens", label: "Tokens", unit: "TOKENS", identity: false, awaiting: { lane: "E", what: "an AI usage store and its aggregate" } },
  { key: "voiceMinutes", label: "Voice minutes", unit: "MINUTES", identity: false, awaiting: { lane: "E", what: "transcription usage measurement" } },
  { key: "aiCost", label: "AI cost", unit: "USD", identity: false, awaiting: { lane: "E", what: "AI cost measurement" } },
  { key: "timeSaved", label: "Estimated time saved", unit: "MINUTES", identity: false, awaiting: { lane: "A", what: "an approved time-saved formula (O1D-4)" } },
] as const satisfies readonly DoctorColumnSpec[];

export type DoctorColumnKey = (typeof DOCTOR_COLUMNS)[number]["key"];

// ---------------------------------------------------------------------------
// Section metrics — the five detail tabs
// ---------------------------------------------------------------------------

export const ADOPTION_METRICS = [
  { key: "doctorsRegistered", label: "Doctors registered", unit: "COUNT", awaiting: { lane: "F", what: "approved doctor-registration aggregate" } },
  { key: "doctorsVerified", label: "Doctors verified", unit: "COUNT", awaiting: { lane: "F", what: "approved credential-verification aggregate" } },
  { key: "firstConsultation", label: "Reached first consultation", unit: "COUNT", awaiting: { lane: "F", what: "approved consultation aggregate" } },
  { key: "bookingEnabled", label: "Online booking enabled", unit: "COUNT", awaiting: { lane: "F", what: "approved booking-settings aggregate" } },
  { key: "publicProfiles", label: "Public profiles", unit: "COUNT", awaiting: { lane: "F", what: "approved public-profile aggregate" } },
  { key: "aiAdoption", label: "Using AI drafting", unit: "PERCENT", awaiting: { lane: "E", what: "an AI usage store and its aggregate" } },
] as const satisfies readonly MetricSpec[];

export const AI_USAGE_METRICS = [
  { key: "aiRequests", label: "AI requests", unit: "COUNT", awaiting: { lane: "E", what: "an AI usage store and its aggregate" } },
  { key: "inputTokens", label: "Input tokens", unit: "TOKENS", awaiting: { lane: "E", what: "an AI usage store and its aggregate" } },
  { key: "outputTokens", label: "Output tokens", unit: "TOKENS", awaiting: { lane: "E", what: "an AI usage store and its aggregate" } },
  { key: "voiceMinutes", label: "Voice minutes", unit: "MINUTES", awaiting: { lane: "E", what: "transcription usage measurement" } },
  { key: "acceptanceRate", label: "Drafts accepted", unit: "PERCENT", awaiting: { lane: "E", what: "draft decision measurement" } },
  { key: "providerErrorRate", label: "Provider error rate", unit: "PERCENT", awaiting: { lane: "E", what: "provider outcome measurement" } },
] as const satisfies readonly MetricSpec[];

export const COST_METRICS = [
  { key: "aiSpendUsd", label: "AI spend", unit: "USD", awaiting: { lane: "E", what: "AI cost measurement" } },
  { key: "voiceSpendUsd", label: "Voice spend", unit: "USD", awaiting: { lane: "E", what: "transcription cost measurement" } },
  { key: "fixedCostUsd", label: "Fixed platform cost", unit: "USD", awaiting: { lane: "F", what: "an approved fixed-cost record" } },
  { key: "totalOperatingUsd", label: "Total operating cost", unit: "USD", awaiting: { lane: "F", what: "fixed and variable cost aggregates" } },
  { key: "costPerActiveUsd", label: "Cost per active doctor", unit: "USD", awaiting: { lane: "F", what: "cost aggregates and an “active” definition (U-20)" } },
  { key: "totalOperatingBdt", label: "Total operating cost (BDT)", unit: "BDT", awaiting: { lane: "F", what: "cost aggregates and a pinned exchange rate" } },
] as const satisfies readonly MetricSpec[];

export const PILOT_HEALTH_METRICS = [
  { key: "consultationsAbandoned", label: "Consultations abandoned", unit: "COUNT", awaiting: { lane: "F", what: "approved consultation-outcome aggregate" } },
  { key: "prescriptionsCorrected", label: "Prescriptions corrected", unit: "COUNT", awaiting: { lane: "F", what: "approved prescription-correction aggregate" } },
  { key: "appointmentsNoShow", label: "Appointment no-shows", unit: "COUNT", awaiting: { lane: "F", what: "approved appointment-outcome aggregate" } },
  { key: "providerFailures", label: "AI provider failures", unit: "COUNT", awaiting: { lane: "E", what: "provider outcome measurement" } },
  { key: "providerRetries", label: "AI provider retries", unit: "COUNT", awaiting: { lane: "E", what: "provider outcome measurement" } },
  { key: "systemHealth", label: "System health signals", unit: "COUNT", awaiting: { lane: "F", what: "approved system-health signals" } },
] as const satisfies readonly MetricSpec[];

export const SECURITY_METRICS = [
  { key: "mfaEnrolled", label: "Doctors with MFA", unit: "PERCENT", awaiting: { lane: "F", what: "approved authentication aggregate" } },
  { key: "authFailures", label: "Failed sign-ins", unit: "COUNT", awaiting: { lane: "F", what: "approved authentication aggregate" } },
  { key: "privilegedGrants", label: "Privileged role grants", unit: "COUNT", awaiting: { lane: "F", what: "the platform staff-role model (not in P0)" } },
  { key: "selfGrantedRoles", label: "Self-granted roles", unit: "COUNT", awaiting: { lane: "F", what: "the platform staff-role model (not in P0)" } },
] as const satisfies readonly MetricSpec[];

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

export const DASHBOARD_TABS = [
  { slug: "", label: "Overview" },
  { slug: "doctors", label: "Doctors" },
  { slug: "adoption", label: "Adoption" },
  { slug: "ai-usage", label: "AI Usage" },
  { slug: "costs", label: "Costs" },
  { slug: "pilot-health", label: "Pilot Health" },
  { slug: "security", label: "Security" },
] as const;

export const DASHBOARD_BASE = "/owner/dashboard";

export function tabHref(slug: string): string {
  return slug ? `${DASHBOARD_BASE}/${slug}` : DASHBOARD_BASE;
}
