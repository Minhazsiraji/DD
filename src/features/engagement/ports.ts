import type { EngagedMinute } from "./engagement";
import type { ManualBaseline, MeasuredDdWorkflow } from "./time-saved";

/**
 * THE WIRING BOUNDARY, against O1-F's published contract
 * (`supabase/policies/0047_o1_owner_analytics_authority.sql`).
 *
 * O1-F says it plainly: "O1-F does not create the interaction/minute producer.
 * O1-A remains the metric-definition authority for what counts as an engaged
 * minute; this function only accepts and idempotently stores whatever
 * day-grain totals a conformant, trusted server-side producer supplies."
 *
 * Each port below ships UNWIRED and answers honestly rather than dropping data
 * or inventing a zero.
 *
 * THE DIVISION OF AUTHORITY:
 *
 *   O1-A produces raw, privacy-safe day totals, and nothing else.
 *
 *   O1-F exclusively owns participation, consent, suppression and named
 *   visibility.
 *
 * So there is no participation gate, no consent gate and no named-appearance
 * decision anywhere in this application. Those are not A's to make, and A does
 * not describe how F makes them either — restating F's rules here would create
 * a second copy to drift out of step with the authority that enforces them.
 */

// ---------------------------------------------------------------------------
// O1-F activity sink — day-grain totals, SET not increment
// ---------------------------------------------------------------------------

/** The four metric codes O1-F's `activity_contributions` CHECK constraint allows. */
export const ACTIVITY_METRIC_CODES = [
  "DOCTOR_ACTIVE_DAY",
  "DOCTOR_ENGAGED_MINUTES_DAILY",
  "DOCTOR_SESSION_COUNT_DAILY",
  "DOCTOR_FEATURE_TOUCH_DAILY",
] as const;

export type ActivityMetricCode = (typeof ACTIVITY_METRIC_CODES)[number];

/**
 * O1-F's non-feature sentinel. Mandatory for the three whole-day metrics and
 * FORBIDDEN for `DOCTOR_FEATURE_TOUCH_DAILY`, enforced by a CHECK constraint.
 * It collapses the key to one row per doctor/day/metric so a minute, a session
 * or a day can never be split or double-counted across features.
 */
export const NON_FEATURE_SENTINEL = "*";

/** O1-A's stream name in O1-F's `source_stream` CHECK constraint. */
export const O1A_SOURCE_STREAM = "O1A_INTERACTION_METER";

/**
 * One row for `public.ingest_activity_contribution(...)`, argument for
 * argument. There is no field for a URL, a path, a patient, an encounter, a
 * prescription, an IP, a device or a timestamp — O1-F's raw tier has no
 * `timestamptz` at all, and `period_day` is a date.
 */
export interface ActivityContribution {
  metricCode: ActivityMetricCode;
  /** `doctor_profiles.id`, from the runtime's `current_doctor_id()`. */
  doctorId: string;
  /** Clinic day, `YYYY-MM-DD`, in the active location's timezone. */
  periodDay: string;
  featureCode: string;
  /** A whole-day total. Never a delta. */
  value: number;
  sourceStream: typeof O1A_SOURCE_STREAM;
  /**
   * Monotonic non-decreasing per (doctor, day). O1-F upserts only when this
   * INCREASES, so a stale or replayed snapshot can never overwrite a fresher
   * total. See `snapshotVersion` in `producer.ts` for how it is derived.
   */
  sourceVersion: number;
}

export type SinkResult =
  | { status: "RECORDED"; accepted: number }
  | { status: "UNWIRED" }
  | { status: "FAILED" };

export interface ActivitySink {
  readonly wired: boolean;
  ingest(rows: readonly ActivityContribution[]): Promise<SinkResult>;
}

/**
 * UNWIRED, and it cannot be wired from application code as things stand.
 *
 * O1-F grants EXECUTE on `ingest_activity_contribution` to `service_role`
 * only, revoked from `authenticated`. This codebase's single privileged handle
 * (`src/lib/supabase/service.ts`) deliberately returns `.storage` and nothing
 * else — never the client, never `.from()`, never `.rpc()` — and
 * `service-key-containment.test.ts` guards that. Wiring therefore needs a
 * reviewed change to that containment boundary, which is not O1-A's to make.
 */
export const unwiredActivitySink: ActivitySink = {
  wired: false,
  async ingest() {
    return { status: "UNWIRED" };
  },
};

// ---------------------------------------------------------------------------
// Minute store — the piece O1-F explicitly does not provide
// ---------------------------------------------------------------------------

export type MinuteRecordResult = "RECORDED" | "UNWIRED" | "FAILED";
export type MinuteSnapshot = readonly EngagedMinute[] | "UNWIRED" | "FAILED";

/**
 * Transient per-doctor, per-day set of engaged minutes.
 *
 * WHY THIS HAS TO EXIST. O1-F stores day TOTALS with SET semantics and keeps
 * no per-event row, and `service_role` has no read grant on
 * `activity_contributions`. So the producer cannot ask the sink what today's
 * total is; to send a correct total it must know the day's distinct minutes
 * itself. A stateless request cannot, and browser state is neither trustworthy
 * nor shared across a doctor's devices.
 *
 * DATA MINIMISATION IS PART OF THE CONTRACT for whoever wires this:
 *   - hold only (doctor_id, period_day, minute bucket, surface) — never a
 *     path, a patient, an IP or a device;
 *   - retain at most 48 hours, enough for the fold to run and be re-run, then
 *     discard. This is minute-precision behavioural data about a clinician and
 *     is more sensitive than the day totals it produces; it is an input, not a
 *     record.
 */
export interface EngagementMinuteStore {
  readonly wired: boolean;
  record(doctorId: string, periodDay: string, minute: EngagedMinute): Promise<MinuteRecordResult>;
  /** Every minute recorded for that doctor on that clinic day. */
  snapshot(doctorId: string, periodDay: string): Promise<MinuteSnapshot>;
}

/** UNWIRED: no store exists. Creating one needs SQL, which O1-A may not add. */
export const unwiredMinuteStore: EngagementMinuteStore = {
  wired: false,
  async record() {
    return "UNWIRED";
  },
  async snapshot() {
    return "UNWIRED";
  },
};

// ---------------------------------------------------------------------------
// Time-saved inputs
// ---------------------------------------------------------------------------

/**
 * UNWIRED, and not provided by O1-F either: `0047` defines no baseline store,
 * so the manual-workflow baseline has no owner yet. Until it does, every
 * time-saved figure is `null` with a reason — never a guess.
 */
export interface TimeSavedInputsPort {
  readonly wired: boolean;
  baseline(doctorId: string): Promise<ManualBaseline | null | "UNWIRED">;
  /** Eligible-cohort aggregate: COMPLETED encounters that produced a FINALIZED Rx. */
  measuredWorkflow(doctorId: string, periodDay: string): Promise<MeasuredDdWorkflow | "UNWIRED">;
}

export const unwiredTimeSavedInputsPort: TimeSavedInputsPort = {
  wired: false,
  async baseline() {
    return "UNWIRED";
  },
  async measuredWorkflow() {
    return "UNWIRED";
  },
};

// ---------------------------------------------------------------------------
// The single swap point
// ---------------------------------------------------------------------------

export interface EngagementPorts {
  minuteStore: EngagementMinuteStore;
  activitySink: ActivitySink;
  timeSavedInputs: TimeSavedInputsPort;
}

/**
 * Where wiring happens, and the only place. Today every port is unwired on
 * purpose; connecting a real contract edits this function and nothing upstream.
 */
export function getEngagementPorts(): EngagementPorts {
  return {
    minuteStore: unwiredMinuteStore,
    activitySink: unwiredActivitySink,
    timeSavedInputs: unwiredTimeSavedInputsPort,
  };
}

/** Engagement can only be produced when BOTH halves of the pipeline exist. */
export function engagementPipelineWired(ports: EngagementPorts = getEngagementPorts()): boolean {
  return ports.minuteStore.wired && ports.activitySink.wired;
}
