import "server-only";
import { z } from "zod";
import {
  DEFAULT_CLINIC_TIME_ZONE,
  clinicDay,
  isAcceptableBucket,
  minuteBucket,
} from "./engagement";
import type { ActivitySink, EngagementMinuteStore } from "./ports";
import { assertConformant, buildActivityContributions } from "./producer";
import { ENGAGEMENT_SURFACES } from "./surfaces";

/**
 * Server-side ingest of one engaged interaction.
 *
 * THE SERVER STAMPS EVERYTHING. The body carries one enum value and is
 * rejected if it carries anything else. The minute, the clinic day and the
 * doctor are all derived here from the server clock and the verified session —
 * never read from the browser.
 *
 * THE SHAPE OF THE PIPELINE, and why it has two halves:
 *
 *   record the minute   → the store holds the day's distinct minutes
 *   re-read the day     → the producer needs the whole day, not this request
 *   produce day totals  → O1-F stores totals with SET semantics
 *   ingest once         → one call carrying all four metrics
 *
 * O1-F keeps no per-event row and `service_role` cannot read
 * `activity_contributions` back, so the running total has to come from the
 * store. That is the whole reason the store exists.
 *
 * Deps are injected so every property below is provable in a unit test with no
 * network, no database and no Next runtime.
 */

/**
 * `strictObject`: an unknown key is a REJECTION, not a silently stripped
 * extra. A client sending `{ surface, url }` or `{ surface, patientId }` is
 * broken or hostile, and either way nothing it sent is recorded.
 */
export const engagementBodySchema = z.strictObject({
  surface: z.enum(ENGAGEMENT_SURFACES),
});

export interface IngestDeps {
  /** Server clock. */
  now: () => Date;
  /** Runtime `current_doctor_id()` → `doctor_profiles.id`, or null. */
  resolveDoctorId: () => Promise<string | null>;
  /** Active practice location's timezone, for the clinic day. */
  resolveTimeZone: () => Promise<string | null>;
  minuteStore: EngagementMinuteStore;
  activitySink: ActivitySink;
  /** Codes present in O1-F's `feature_registry`. Empty unless supplied. */
  registeredFeatureCodes?: ReadonlySet<string>;
}

export type IngestResult =
  | { status: "RECORDED"; rows: number }
  | { status: "INVALID_BODY" }
  | { status: "UNWIRED" }
  | { status: "NOT_A_DOCTOR" }
  | { status: "REJECTED_BUCKET" }
  | { status: "FAILED" };

export async function ingestEngagement(body: unknown, deps: IngestDeps): Promise<IngestResult> {
  const parsed = engagementBodySchema.safeParse(body);
  if (!parsed.success) return { status: "INVALID_BODY" };

  /**
   * Both halves must exist before anything else happens. Recording a minute
   * with no sink would drop it while appearing to work, and resolving the
   * doctor first would be a database round trip for nothing.
   */
  if (!deps.minuteStore.wired || !deps.activitySink.wired) return { status: "UNWIRED" };

  const doctorId = await deps.resolveDoctorId();
  // O1-A measures DOCTOR adoption. A staff session produces no minute.
  if (!doctorId) return { status: "NOT_A_DOCTOR" };

  const stampedAt = deps.now();
  const bucket = minuteBucket(stampedAt);
  if (!isAcceptableBucket(bucket, stampedAt)) return { status: "REJECTED_BUCKET" };

  const timeZone = (await deps.resolveTimeZone()) ?? DEFAULT_CLINIC_TIME_ZONE;
  const periodDay = clinicDay(bucket, timeZone);
  const minute = { minuteBucket: bucket, surface: parsed.data.surface };

  /**
   * POSITIVE MATCH, NOT EXCLUSION.
   *
   * This was written as `if (x === "UNWIRED") … if (x === "FAILED") …` and
   * anything else fell through to success — so an outcome this code did not
   * recognise was reported as RECORDED. Only the exact success literal may
   * continue; UNWIRED is passed through and everything else fails closed.
   */
  const recorded = await deps.minuteStore.record(doctorId, periodDay, minute);
  if (recorded !== "RECORDED") {
    return { status: recorded === "UNWIRED" ? "UNWIRED" : "FAILED" };
  }

  const snapshot = await deps.minuteStore.snapshot(doctorId, periodDay);
  // Same rule: a snapshot must be an array to be usable at all. Anything else
  // would mean sending a total computed from nothing.
  if (!Array.isArray(snapshot)) {
    return { status: snapshot === "UNWIRED" ? "UNWIRED" : "FAILED" };
  }

  const rows = buildActivityContributions({
    doctorId,
    periodDay,
    minutes: snapshot,
    registeredFeatureCodes: deps.registeredFeatureCodes,
    timeZone,
  });

  // Conformance is checked before a privileged RPC sees the rows, so a break
  // surfaces here rather than as a constraint violation in production.
  assertConformant(rows);

  const result = await deps.activitySink.ingest(rows);
  if (result.status === "RECORDED") return { status: "RECORDED", rows: rows.length };
  if (result.status === "UNWIRED") return { status: "UNWIRED" };
  return { status: "FAILED" };
}
