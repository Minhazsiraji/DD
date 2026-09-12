/**
 * The O1-F Owner contract, as this dashboard sees it.
 *
 * Every shape here mirrors a `returns table (...)` in the frozen migration
 * `supabase/policies/0047_o1_owner_analytics_authority.sql`. Nothing is
 * inferred and nothing is recomputed: consent, k=5 suppression, lifecycle,
 * "active doctor", coverage and cost completeness are all decided inside F and
 * arrive here already decided. This module's whole job is to turn a row of
 * that contract into typed presentation values without adding a second opinion.
 *
 * A row that does not match the contract is not repaired. It fails closed to
 * `Unavailable`, because a dashboard that guesses at a malformed row is worse
 * than one that admits it cannot read it.
 *
 * Pure: no I/O, no server-only import, no database client.
 */

import { measurementFromRow, measurementFromToken, type Measurement, type MeasurementMap } from "./measurement";

// ---------------------------------------------------------------------------
// Participation lifecycle — frozen vocabulary
// ---------------------------------------------------------------------------

/**
 * The complete lifecycle, exactly as `pilot_participation_status` declares it.
 * There is no ACTIVE, no PAUSED and no ONBOARDING: engagement is a separate
 * axis, and an ENROLLED doctor who did nothing this week is still ENROLLED.
 */
export const PARTICIPATION_LIFECYCLE = ["INVITED", "ENROLLED", "COMPLETED", "WITHDRAWN"] as const;

export type ParticipationLifecycle = (typeof PARTICIPATION_LIFECYCLE)[number];

export const LIFECYCLE_LABEL: Record<ParticipationLifecycle, string> = {
  INVITED: "Invited",
  ENROLLED: "Enrolled",
  COMPLETED: "Completed",
  WITHDRAWN: "Withdrawn",
};

export function parseLifecycle(value: unknown): ParticipationLifecycle | null {
  return typeof value === "string" && (PARTICIPATION_LIFECYCLE as readonly string[]).includes(value)
    ? (value as ParticipationLifecycle)
    : null;
}

// ---------------------------------------------------------------------------
// Time-saved confidence — frozen by O1-A
// ---------------------------------------------------------------------------

/**
 * The only confidence ladder. `STANDARD` is not a tier and never was; a value
 * outside this list is a contract violation, not a label to render.
 */
export const TIME_SAVED_CONFIDENCE = ["HIGH", "MEDIUM", "LOW", "NOT_MEASURED"] as const;

export type TimeSavedConfidence = (typeof TIME_SAVED_CONFIDENCE)[number];

export const CONFIDENCE_LABEL: Record<TimeSavedConfidence, string> = {
  HIGH: "High confidence",
  MEDIUM: "Medium confidence",
  LOW: "Low confidence",
  NOT_MEASURED: "Not measured",
};

export function parseConfidence(value: unknown): TimeSavedConfidence | null {
  return typeof value === "string" && (TIME_SAVED_CONFIDENCE as readonly string[]).includes(value)
    ? (value as TimeSavedConfidence)
    : null;
}

/**
 * Signed minutes, with the sign kept.
 *
 * A negative estimate means DD was SLOWER than the doctor's manual workflow.
 * That is a finding, not an error, and clamping it to zero would hide the one
 * number a pilot most needs to see.
 */
const SIGNED = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0, signDisplay: "exceptZero" });

export function formatSignedMinutes(minutes: number): string {
  return Number.isFinite(minutes) ? `${SIGNED.format(minutes)} min` : "Unavailable";
}

// ---------------------------------------------------------------------------
// owner_pilot_status(window_start, window_end)
// ---------------------------------------------------------------------------

export interface PilotStatusRowRaw {
  cohort_code?: unknown;
  invited_count?: unknown;
  enrolled_count?: unknown;
  completed_count?: unknown;
  withdrawn_count?: unknown;
  consented_count?: unknown;
  active_doctor_count?: unknown;
}

/** The five lifecycle counters plus the active-doctor counter, per cohort. */
export const PILOT_STATUS_KEYS = [
  "invited",
  "enrolled",
  "completed",
  "withdrawn",
  "consented",
  "activeDoctors",
] as const;

export type PilotStatusKey = (typeof PILOT_STATUS_KEYS)[number];

export interface CohortStatus {
  cohortCode: string;
  counts: Record<PilotStatusKey, Measurement>;
}

const token = (v: unknown): Measurement =>
  measurementFromToken(typeof v === "string" || typeof v === "number" ? v : null);

export function parsePilotStatusRow(row: PilotStatusRowRaw): CohortStatus | null {
  const cohortCode = typeof row.cohort_code === "string" ? row.cohort_code : null;
  if (!cohortCode) return null;
  return {
    cohortCode,
    counts: {
      invited: token(row.invited_count),
      enrolled: token(row.enrolled_count),
      completed: token(row.completed_count),
      withdrawn: token(row.withdrawn_count),
      consented: token(row.consented_count),
      activeDoctors: token(row.active_doctor_count),
    },
  };
}

// ---------------------------------------------------------------------------
// owner_activity_summary(window_start, window_end)
// ---------------------------------------------------------------------------

export interface ActivitySummaryRowRaw {
  active_doctor_count?: unknown;
  total_sessions?: unknown;
  total_engaged_minutes?: unknown;
}

export const ACTIVITY_SUMMARY_KEYS = ["activeDoctors", "sessions", "engagedMinutes"] as const;

export function parseActivitySummaryRow(row: ActivitySummaryRowRaw): MeasurementMap {
  return {
    activeDoctors: token(row.active_doctor_count),
    sessions: token(row.total_sessions),
    engagedMinutes: token(row.total_engaged_minutes),
  };
}

// ---------------------------------------------------------------------------
// owner_pilot_cohort_detail(cohort, window_start, window_end)
// ---------------------------------------------------------------------------

export interface CohortDetailRowRaw {
  participation_id?: unknown;
  status?: unknown;
  enrolled_on?: unknown;
  measurement_status?: unknown;
  engaged_minutes?: unknown;
  active_days?: unknown;
  session_count?: unknown;
  feature_touch_count?: unknown;
}

export const PARTICIPATION_METRIC_KEYS = ["engagedMinutes", "activeDays", "sessions", "featureTouches"] as const;

export type ParticipationMetricKey = (typeof PARTICIPATION_METRIC_KEYS)[number];

export interface ParticipationRow {
  /**
   * The pilot participation handle. It is the ONLY identifier on this table:
   * F's Owner contract publishes no doctor name, no doctor id and nothing
   * clinical, and the dashboard adds none.
   */
  participationId: string;
  lifecycle: ParticipationLifecycle | null;
  enrolledOn: string | null;
  /** F's own word for this row's measurement state. */
  measurementStatus: string;
  metrics: Record<ParticipationMetricKey, Measurement>;
}

const numeric = (v: unknown): number | string | null =>
  typeof v === "number" || typeof v === "string" ? v : null;

export function parseCohortDetailRow(row: CohortDetailRowRaw): ParticipationRow | null {
  const participationId = typeof row.participation_id === "string" ? row.participation_id : null;
  if (!participationId) return null;

  const status = typeof row.measurement_status === "string" ? row.measurement_status : null;
  return {
    participationId,
    lifecycle: parseLifecycle(row.status),
    enrolledOn: typeof row.enrolled_on === "string" ? row.enrolled_on : null,
    measurementStatus: status ?? "UNAVAILABLE",
    metrics: {
      engagedMinutes: measurementFromRow(status, numeric(row.engaged_minutes)),
      activeDays: measurementFromRow(status, numeric(row.active_days)),
      sessions: measurementFromRow(status, numeric(row.session_count)),
      featureTouches: measurementFromRow(status, numeric(row.feature_touch_count)),
    },
  };
}

// ---------------------------------------------------------------------------
// owner_service_usage_summary(cohort, window_start, window_end)
// ---------------------------------------------------------------------------

export interface ServiceUsageRowRaw {
  status?: unknown;
  provider_id?: unknown;
  model_id?: unknown;
  service_kind?: unknown;
  unit?: unknown;
  quantity_total?: unknown;
  event_count?: unknown;
  estimated_cost_minor?: unknown;
  currency_code?: unknown;
}

export interface ServiceUsageRow {
  providerId: string | null;
  modelId: string | null;
  serviceKind: string | null;
  unit: string | null;
  quantity: Measurement;
  events: Measurement;
  /** Exact minor-unit decimal, or null when F withheld an incomplete total. */
  costMinor: string | number | null;
  currency: string | null;
}

export interface ServiceUsage {
  /** Buckets F was willing to publish. */
  rows: ServiceUsageRow[];
  /** F's overall verdict when it published no buckets at all. */
  status: "OK" | "NOT_MEASURED" | "UNAVAILABLE" | "INSUFFICIENT_COHORT";
  /**
   * True when F appended its suppression marker: some provider/model bucket
   * exists but falls under k=5. The dashboard must say so — an omitted row
   * would read as "that provider was never used".
   */
  hasSuppressedBuckets: boolean;
}

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);

export function parseServiceUsage(rows: readonly ServiceUsageRowRaw[]): ServiceUsage {
  const published: ServiceUsageRow[] = [];
  let hasSuppressedBuckets = false;
  let overall: ServiceUsage["status"] = "UNAVAILABLE";
  let sawOk = false;

  for (const row of rows) {
    const status = text(row.status) ?? "UNAVAILABLE";

    if (status === "INSUFFICIENT_COHORT") {
      hasSuppressedBuckets = true;
      if (!sawOk) overall = "INSUFFICIENT_COHORT";
      continue;
    }
    if (status !== "OK") {
      if (!sawOk) overall = status === "NOT_MEASURED" ? "NOT_MEASURED" : "UNAVAILABLE";
      continue;
    }

    sawOk = true;
    overall = "OK";

    // F publishes one all-null OK row to mean "complete, and nothing happened".
    if (text(row.provider_id) === null && text(row.unit) === null) continue;

    published.push({
      providerId: text(row.provider_id),
      modelId: text(row.model_id),
      serviceKind: text(row.service_kind),
      unit: text(row.unit),
      quantity: measurementFromToken(numeric(row.quantity_total)),
      events: measurementFromToken(numeric(row.event_count)),
      costMinor: numeric(row.estimated_cost_minor),
      currency: text(row.currency_code),
    });
  }

  return { rows: published, status: rows.length === 0 ? "UNAVAILABLE" : overall, hasSuppressedBuckets };
}

/** Units O1-E measures in, spelled for a human without changing their meaning. */
export const UNIT_LABEL: Record<string, string> = {
  INPUT_TOKENS: "Input tokens",
  CACHED_INPUT_TOKENS: "Cached input tokens",
  OUTPUT_TOKENS: "Output tokens",
  AUDIO_MILLIS: "Audio milliseconds",
  OPERATIONS: "Operations",
  PROVIDER_CALLS: "Provider calls",
  VOICE_GRANTS: "Voice grants",
  PROPOSALS_PRODUCED: "Proposals produced",
  PROPOSALS_ACCEPTED: "Proposals accepted",
  PROPOSALS_EDITED: "Proposals edited",
  PROPOSALS_REJECTED: "Proposals rejected",
  PROPOSALS_EXPIRED: "Proposals expired",
};

export const SERVICE_KIND_LABEL: Record<string, string> = {
  AI_PROPOSAL: "AI proposal",
  VOICE_STT: "Voice transcription",
};

/** An unknown code is shown verbatim rather than hidden or renamed. */
export function labelFor(map: Record<string, string>, code: string | null): string {
  if (code === null) return "—";
  return map[code] ?? code;
}
