import type { MetricUnit, SourceLane } from "./measurement";
import { periodQuery, type Period } from "./periods";

/**
 * The Owner Dashboard's vocabulary — every tab, tile and column, declared once.
 *
 * Pure data. Pages render from this catalog rather than from inline literals,
 * so the complete set of things an owner can be shown is reviewable in one
 * place, and a privacy test can assert that nothing clinical is ever on it.
 *
 * Every key here corresponds to a column O1-F actually publishes. Where F
 * publishes nothing — estimated time saved, security posture counters — the
 * spec carries the lane that owes the source, and the tile says so instead of
 * showing a number.
 */

export interface MetricSpec {
  key: string;
  label: string;
  unit: MetricUnit;
  /** Set only where no approved source exists yet. */
  awaiting?: { lane: SourceLane; what: string };
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

export const DASHBOARD_BASE = "/owner/dashboard";

export const DASHBOARD_TABS = [
  { slug: "", label: "Overview" },
  { slug: "doctors", label: "Doctors" },
  { slug: "adoption", label: "Adoption" },
  { slug: "ai-usage", label: "AI Usage" },
  { slug: "costs", label: "Costs" },
  { slug: "pilot-health", label: "Pilot Health" },
  { slug: "security", label: "Security" },
] as const;

export type DashboardTabSlug = (typeof DASHBOARD_TABS)[number]["slug"];

export function tabHref(slug: string): string {
  return slug ? `${DASHBOARD_BASE}/${slug}` : DASHBOARD_BASE;
}

// ---------------------------------------------------------------------------
// Cohort selection
// ---------------------------------------------------------------------------

export const COHORT_PARAM = "cohort";

/**
 * Resolve the cohort in the URL against the cohorts O1-F actually returned.
 *
 * A code that is not in F's own list is never passed back to the database: the
 * selector can only ever choose from what the approved surface published. This
 * is a cohort, not a doctor — there is no per-doctor selector anywhere in this
 * dashboard, and this is deliberately the only identifier the URL may carry.
 */
export function resolveCohort(
  params: Record<string, string | string[] | undefined>,
  available: readonly string[],
): string | null {
  if (available.length === 0) return null;
  const raw = params[COHORT_PARAM];
  const wanted = typeof raw === "string" ? raw : "";
  return available.includes(wanted) ? wanted : available[0];
}

/** Period plus cohort, so moving between tabs keeps both. */
export function dashboardQuery(period: Period, cohort: string | null): string {
  const q = new URLSearchParams(periodQuery(period));
  if (cohort) q.set(COHORT_PARAM, cohort);
  return q.toString();
}

// ---------------------------------------------------------------------------
// Platform activity — owner_activity_summary
// ---------------------------------------------------------------------------

export const ACTIVITY_TILES = [
  { key: "activeDoctors", label: "Active Doctors", unit: "COUNT" },
  { key: "sessions", label: "Sessions", unit: "SESSIONS" },
  { key: "engagedMinutes", label: "Engaged minutes", unit: "MINUTES" },
] as const satisfies readonly MetricSpec[];

// ---------------------------------------------------------------------------
// Pilot lifecycle — owner_pilot_status, per cohort
// ---------------------------------------------------------------------------

export const PILOT_STATUS_TILES = [
  { key: "invited", label: "Invited", unit: "COUNT" },
  { key: "enrolled", label: "Enrolled", unit: "COUNT" },
  { key: "completed", label: "Completed", unit: "COUNT" },
  { key: "withdrawn", label: "Withdrawn", unit: "COUNT" },
  { key: "consented", label: "Consented", unit: "COUNT" },
  { key: "activeDoctors", label: "Active Doctors", unit: "COUNT" },
] as const satisfies readonly MetricSpec[];

// ---------------------------------------------------------------------------
// Participation table — owner_pilot_cohort_detail
// ---------------------------------------------------------------------------

export interface ParticipationColumnSpec extends MetricSpec {
  /**
   * Identity columns describe the PARTICIPATION and its pilot state. They are
   * the only non-numeric columns, and they identify a pilot enrolment — never
   * a doctor by name and never a patient.
   */
  identity: boolean;
}

export const PARTICIPATION_COLUMNS = [
  { key: "participation", label: "Participation", unit: "COUNT", identity: true },
  { key: "lifecycle", label: "Participation status", unit: "COUNT", identity: true },
  { key: "enrolledOn", label: "Enrolled on", unit: "COUNT", identity: true },
  { key: "measurementStatus", label: "Measurement", unit: "COUNT", identity: true },
  { key: "activeDays", label: "Active days", unit: "DAYS", identity: false },
  { key: "engagedMinutes", label: "Engaged minutes", unit: "MINUTES", identity: false },
  { key: "sessions", label: "Sessions", unit: "SESSIONS", identity: false },
  { key: "featureTouches", label: "Feature touches", unit: "COUNT", identity: false },
] as const satisfies readonly ParticipationColumnSpec[];

// ---------------------------------------------------------------------------
// Adoption — what F measures, and what is still owed
// ---------------------------------------------------------------------------

export const ADOPTION_AWAITED = [
  {
    key: "dau",
    label: "DAU / WAU / MAU",
    unit: "COUNT",
    awaiting: { lane: "F", what: "a period-comparable active-doctor series (the approved surface answers one window at a time)" },
  },
  {
    key: "timeSaved",
    label: "Estimated time saved",
    unit: "MINUTES",
    awaiting: { lane: "A", what: "an approved manual baseline and the eligible-cohort median (O1D-4)" },
  },
] as const satisfies readonly MetricSpec[];

// ---------------------------------------------------------------------------
// Security — posture, not counters
// ---------------------------------------------------------------------------

export const SECURITY_AWAITED = [
  { key: "mfaEnrolment", label: "Owner MFA enrolment", unit: "PERCENT", awaiting: { lane: "F", what: "an approved security-posture aggregate" } },
  { key: "failedOwnerAuth", label: "Refused owner attempts", unit: "COUNT", awaiting: { lane: "F", what: "an approved security-posture aggregate" } },
  { key: "consentWithdrawals", label: "Consent withdrawals", unit: "COUNT", awaiting: { lane: "F", what: "an approved consent-event aggregate" } },
  { key: "suppressedBuckets", label: "Suppressed buckets", unit: "COUNT", awaiting: { lane: "F", what: "an approved suppression-count aggregate" } },
] as const satisfies readonly MetricSpec[];
