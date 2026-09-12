import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  parseActivitySummaryRow,
  parseCohortDetailRow,
  parsePilotStatusRow,
  parseServiceUsage,
  type ActivitySummaryRowRaw,
  type CohortDetailRowRaw,
  type CohortStatus,
  type ParticipationRow,
  type PilotStatusRowRaw,
  type ServiceUsage,
  type ServiceUsageRowRaw,
} from "./contract";
import type { MeasurementMap } from "./measurement";
import type { PeriodWindow } from "./periods";

/**
 * THE ONLY PLACE THE OWNER DASHBOARD TALKS TO A DATA SOURCE.
 *
 * This boundary is frozen by the O1-D integration contract. Pages and
 * components import from here and nowhere else; they never construct a
 * database client, never name a table, and never call an RPC directly.
 *
 * FIVE RULES, all of them load-bearing:
 *
 *   1. APPROVED RPCs ONLY. `APPROVED_OWNER_AGGREGATE_RPCS` is the complete
 *      list, it is a compile-time union, and `dashboard-privacy.test.ts` fails
 *      if any other name is called anywhere in the Owner surface.
 *
 *   2. THE CALLER'S SESSION, ALWAYS. Every call goes through the request-scoped
 *      client, so `assert_o1_owner_aal2()` inside each function is evaluated
 *      against the signed-in owner's own JWT. The service-role client is never
 *      imported here — it would turn a database-enforced boundary into an
 *      honour system.
 *
 *   3. NO CLINICAL ROW, EVER. Not a patient, an encounter, a prescription or a
 *      document — not directly, and not through a join. The Owner analytics
 *      plane is aggregate and control-plane only.
 *
 *   4. NO SECOND OPINION. Consent, k=5 suppression, "active doctor", lifecycle,
 *      coverage and cost completeness are computed inside O1-F. This module
 *      maps what F said. It does not check, adjust, widen or re-derive it.
 *
 *   5. FAIL CLOSED. Any error — the contract not deployed, permission refused,
 *      a network fault, a malformed row — becomes `Unavailable`. Never zero,
 *      never an empty list presented as "none". The error itself is not logged
 *      or rendered: an owner console is not the place to leak a backend's
 *      internals.
 *
 * CURRENT ENVIRONMENT: migration 0047 is frozen in the repository and is NOT
 * applied to the protected/Preview database. Every call below therefore fails
 * closed today, and the dashboard renders `Unavailable` throughout. That is the
 * correct reading — nothing here fabricates a value to fill the screen.
 */

/**
 * The approved Owner aggregate surface, from
 * `supabase/policies/0047_o1_owner_analytics_authority.sql`
 * (blob 357771e3ef0ff822958a8f99bb949f4f8382378d).
 *
 * F also grants `owner_doctor_activity(text, uuid, date, date)` and
 * `pilot_participation_state(text)`. Both are DELIBERATELY EXCLUDED here:
 * the first is a per-participation lookup that would need a doctor-shaped
 * identifier in a URL — exactly the probing interface O1-D is forbidden to
 * build — and the second returns `doctor_id`, an identity the dashboard has no
 * use for. `owner_pilot_cohort_detail` supplies the same measurements for a
 * whole cohort without either.
 */
export const APPROVED_OWNER_AGGREGATE_RPCS = [
  "owner_pilot_status",
  "owner_activity_summary",
  "owner_pilot_cohort_detail",
  "owner_service_usage_summary",
] as const;

export type ApprovedOwnerRpc = (typeof APPROVED_OWNER_AGGREGATE_RPCS)[number];

type RpcOutcome<T> = { ok: true; rows: T[] } | { ok: false };

async function callOwnerRpc<T>(fn: ApprovedOwnerRpc, args: Record<string, string>): Promise<RpcOutcome<T>> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc(fn, args);
    if (error) return { ok: false };
    if (data === null || data === undefined) return { ok: true, rows: [] };
    return { ok: true, rows: (Array.isArray(data) ? data : [data]) as T[] };
  } catch {
    return { ok: false };
  }
}

const bounds = (w: PeriodWindow) => ({ window_start: w.start, window_end: w.end });

// ---------------------------------------------------------------------------
// Pilot status — lifecycle counters per cohort
// ---------------------------------------------------------------------------

export type PilotStatusResult =
  | { state: "measured"; cohorts: CohortStatus[] }
  | { state: "unavailable" };

export async function readPilotStatus(window: PeriodWindow): Promise<PilotStatusResult> {
  const out = await callOwnerRpc<PilotStatusRowRaw>("owner_pilot_status", bounds(window));
  if (!out.ok) return { state: "unavailable" };

  const cohorts: CohortStatus[] = [];
  for (const row of out.rows) {
    const parsed = parsePilotStatusRow(row);
    if (parsed) cohorts.push(parsed);
  }
  return { state: "measured", cohorts };
}

// ---------------------------------------------------------------------------
// Activity summary — platform-wide, not per cohort
// ---------------------------------------------------------------------------

export type ActivitySummaryResult =
  | { state: "measured"; metrics: MeasurementMap }
  | { state: "unavailable" };

export async function readActivitySummary(window: PeriodWindow): Promise<ActivitySummaryResult> {
  const out = await callOwnerRpc<ActivitySummaryRowRaw>("owner_activity_summary", bounds(window));
  if (!out.ok || out.rows.length === 0) return { state: "unavailable" };
  return { state: "measured", metrics: parseActivitySummaryRow(out.rows[0]) };
}

// ---------------------------------------------------------------------------
// Cohort detail — one row per participation, no doctor identity
// ---------------------------------------------------------------------------

export type CohortDetailResult =
  | { state: "measured"; participations: ParticipationRow[] }
  | { state: "unavailable" };

export async function readCohortDetail(cohortCode: string, window: PeriodWindow): Promise<CohortDetailResult> {
  const out = await callOwnerRpc<CohortDetailRowRaw>("owner_pilot_cohort_detail", {
    target_cohort_code: cohortCode,
    ...bounds(window),
  });
  if (!out.ok) return { state: "unavailable" };

  const participations: ParticipationRow[] = [];
  for (const row of out.rows) {
    const parsed = parseCohortDetailRow(row);
    if (parsed) participations.push(parsed);
  }
  return { state: "measured", participations };
}

// ---------------------------------------------------------------------------
// Service usage — AI and Voice, by provider / model / kind / unit
// ---------------------------------------------------------------------------

export type ServiceUsageResult = { state: "measured"; usage: ServiceUsage } | { state: "unavailable" };

export async function readServiceUsage(cohortCode: string, window: PeriodWindow): Promise<ServiceUsageResult> {
  const out = await callOwnerRpc<ServiceUsageRowRaw>("owner_service_usage_summary", {
    target_cohort_code: cohortCode,
    ...bounds(window),
  });
  if (!out.ok) return { state: "unavailable" };
  return { state: "measured", usage: parseServiceUsage(out.rows) };
}
