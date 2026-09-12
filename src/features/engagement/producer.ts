import {
  activeDays,
  clinicDay,
  deriveSessions,
  engagedMinutes,
  isActiveDoctor,
  minutesBySurface,
  DEFAULT_CLINIC_TIME_ZONE,
  MAX_ENGAGED_MINUTES_PER_DAY,
  type EngagedMinute,
} from "./engagement";
import {
  ACTIVITY_METRIC_CODES,
  NON_FEATURE_SENTINEL,
  O1A_SOURCE_STREAM,
  type ActivityContribution,
} from "./ports";
import { A_FEATURE_CODES, featureCodeForSurface, type EngagementSurface } from "./surfaces";

/**
 * The O1-A producer: a day's engaged minutes → O1-F's day-grain rows.
 *
 * Pure. No clock, no network, no storage. O1-A is the metric-definition
 * authority for what an engaged minute is; this is that definition expressed
 * in the shape O1-F's `ingest_activity_contribution` accepts.
 *
 * FOUR ROWS, THREE OF THEM WHOLE-DAY:
 *   DOCTOR_ENGAGED_MINUTES_DAILY  distinct qualifying minutes           '*'
 *   DOCTOR_SESSION_COUNT_DAILY    runs split by a 10-minute idle gap    '*'
 *   DOCTOR_ACTIVE_DAY             1 when any qualifying minute exists   '*'
 *   DOCTOR_FEATURE_TOUCH_DAILY    distinct minutes per feature          code
 *
 * The sentinel rules are O1-F's CHECK constraint, not a convention: `'*'` is
 * mandatory on the three whole-day metrics and forbidden on the per-feature
 * one. Getting it backwards is rejected by the database.
 */

/**
 * O1-F upserts a row only when `source_version` INCREASES, so the version has
 * to rise as the day accumulates and never depend on a wall clock.
 *
 * The snapshot's SIZE does exactly that. The minute store is an append-only
 * set, so a later snapshot is always a superset and its size is always greater
 * or equal. Equal size means the same set, and O1-F's `do update ... where
 * excluded.source_version > existing` correctly no-ops.
 *
 * A timestamp would have been wrong here: two app instances with a little
 * clock skew could stamp a fresher snapshot with a lower version, and the
 * fresher total would be silently discarded.
 */
export function snapshotVersion(minutes: readonly EngagedMinute[]): number {
  return minutes.length;
}

export interface ProducerInput {
  /** `doctor_profiles.id`, resolved server-side. */
  doctorId: string;
  /** The clinic day being produced, `YYYY-MM-DD`. */
  periodDay: string;
  /** Every minute the store holds for that doctor. Filtered to the day here. */
  minutes: readonly EngagedMinute[];
  timeZone?: string | null;
}

/**
 * Build the rows for one doctor and one clinic day.
 *
 * Minutes are filtered to `periodDay` in the location's timezone before any
 * arithmetic: a snapshot may legitimately straddle midnight, and a minute must
 * count towards the day the doctor was actually working.
 */
export function buildActivityContributions(input: ProducerInput): ActivityContribution[] {
  const zone = input.timeZone ?? DEFAULT_CLINIC_TIME_ZONE;
  const forDay = input.minutes.filter((m) => clinicDay(m.minuteBucket, zone) === input.periodDay);

  const version = snapshotVersion(forDay);
  const base = {
    doctorId: input.doctorId,
    periodDay: input.periodDay,
    sourceStream: O1A_SOURCE_STREAM,
    sourceVersion: version,
  } as const;

  // Capped, and never negative: O1-F's CHECK requires value >= 0, and a day
  // cannot hold more than 1440 minutes.
  const cap = (n: number) => Math.max(0, Math.min(n, MAX_ENGAGED_MINUTES_PER_DAY));

  const rows: ActivityContribution[] = [
    {
      ...base,
      metricCode: "DOCTOR_ENGAGED_MINUTES_DAILY",
      featureCode: NON_FEATURE_SENTINEL,
      value: cap(engagedMinutes(forDay)),
    },
    {
      ...base,
      metricCode: "DOCTOR_SESSION_COUNT_DAILY",
      featureCode: NON_FEATURE_SENTINEL,
      value: cap(deriveSessions(forDay).length),
    },
    {
      ...base,
      metricCode: "DOCTOR_ACTIVE_DAY",
      featureCode: NON_FEATURE_SENTINEL,
      value: isActiveDoctor(forDay) ? 1 : 0,
    },
  ];

  /**
   * Per-feature touches, including SETTINGS.
   *
   * Settings time is a real onboarding signal and is recorded here; it simply
   * cannot make a doctor ACTIVE, which is why `DOCTOR_ACTIVE_DAY` above counts
   * qualifying surfaces only.
   *
   * DETERMINISTIC, against the frozen vocabulary. Every mapped surface with a
   * minute produces a row. The only surface with no code is OWNER, which is
   * platform administration rather than a doctor feature.
   */
  const perSurface = minutesBySurface(forDay);
  for (const [surface, count] of Object.entries(perSurface) as Array<[EngagementSurface, number]>) {
    const code = featureCodeForSurface(surface);
    if (!code || !A_FEATURE_CODES.has(code) || count <= 0) continue;
    rows.push({
      ...base,
      metricCode: "DOCTOR_FEATURE_TOUCH_DAILY",
      featureCode: code,
      value: cap(count),
    });
  }

  return rows;
}

/**
 * Guard the rows before they reach the sink.
 *
 * Everything here is also a database constraint in `0047`. Checking it in the
 * producer means a conformance break shows up as a test failure with a reason,
 * rather than as a constraint violation from a privileged RPC in production.
 */
export function assertConformant(rows: readonly ActivityContribution[]): void {
  const allowed = new Set<string>(ACTIVITY_METRIC_CODES);
  for (const row of rows) {
    if (!allowed.has(row.metricCode)) {
      throw new Error(`activity metric not in the O1-F contract: ${row.metricCode}`);
    }
    if (row.sourceStream !== O1A_SOURCE_STREAM) {
      throw new Error(`source_stream must be ${O1A_SOURCE_STREAM}`);
    }
    if (!Number.isInteger(row.value) || row.value < 0) {
      throw new Error(`value must be a non-negative integer: ${row.metricCode}=${row.value}`);
    }
    if (!Number.isInteger(row.sourceVersion) || row.sourceVersion < 0) {
      throw new Error("source_version must be a non-negative integer");
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.periodDay)) {
      throw new Error(`period_day must be a date, never a timestamp: ${row.periodDay}`);
    }
    const isFeatureMetric = row.metricCode === "DOCTOR_FEATURE_TOUCH_DAILY";
    if (isFeatureMetric && row.featureCode === NON_FEATURE_SENTINEL) {
      throw new Error("DOCTOR_FEATURE_TOUCH_DAILY must not use the '*' sentinel");
    }
    if (!isFeatureMetric && row.featureCode !== NON_FEATURE_SENTINEL) {
      throw new Error(`${row.metricCode} must use the '*' sentinel`);
    }
    if (isFeatureMetric && !/^[a-z][a-z0-9_]{1,63}$/.test(row.featureCode)) {
      throw new Error(`feature_code is not registry-shaped: ${row.featureCode}`);
    }
  }
}

/** Clinic days present in a snapshot — which days need producing. */
export function daysInSnapshot(
  minutes: readonly EngagedMinute[],
  timeZone: string | null,
): string[] {
  return activeDays(minutes, timeZone ?? DEFAULT_CLINIC_TIME_ZONE);
}
