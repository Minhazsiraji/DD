import "server-only";
import { notMeasured, type Measurement } from "./measurement";
import {
  ADOPTION_METRICS,
  AI_USAGE_METRICS,
  COST_METRICS,
  DOCTOR_COLUMNS,
  OVERVIEW_CARDS,
  PILOT_HEALTH_METRICS,
  SECURITY_METRICS,
  type MetricSpec,
} from "./catalog";
import type { Period } from "./periods";

/**
 * THE ONE PLACE THE OWNER DASHBOARD MAY OBTAIN A NUMBER.
 *
 * ── Current state: NO approved aggregate interface exists. ──
 *
 * Audited on the integration base: the only owner-facing RPCs are the claims
 * and payments review queues. Database V2 P0 ships `metric_rollups`, but no
 * owner READ interface over it, and it lives in the isolated V2 track the
 * running application does not connect to. AI usage and cost have no store at
 * all. So every metric below is `not-measured` — and that is the honest answer,
 * not a placeholder for zero.
 *
 * ── The contract for whoever wires the first real source (F / A / E) ──
 *
 *  1. Call ONLY an approved, owner-gated, aggregate-returning RPC through the
 *     caller's own session (`createSupabaseServerClient`). Add its name to
 *     `APPROVED_OWNER_AGGREGATE_RPCS` below; `dashboard-privacy.test.ts`
 *     fails on any `rpc()` whose name is not on that list.
 *  2. NEVER `.from(<table>)`. The dashboard reads no table directly — not a
 *     clinical one, not an operational one. Aggregation happens behind the
 *     boundary, in the database, and only numbers cross.
 *  3. NEVER the service-role client. RLS must apply to the owner exactly as
 *     it does to anyone else; the owner is not a clinical superuser.
 *  4. An error or a malformed answer becomes `{ state: "unavailable" }` —
 *     never 0, never a silently-dropped row.
 *  5. The row shape carries doctor identity and counts ONLY. No patient
 *     identifier, diagnosis, prescription text, transcript, prompt or other
 *     clinical payload may appear in any type this module returns.
 *
 * This module deliberately imports no database client today. The strongest
 * available proof that it opens no query surface is that it cannot.
 */

/**
 * Owner-facing aggregate RPCs this module is permitted to call.
 *
 * EMPTY until an approved interface is delivered. Adding a name here is the
 * reviewable act that turns a tile from "Not measured" into a number.
 */
export const APPROVED_OWNER_AGGREGATE_RPCS: readonly string[] = [];

export type MeasurementMap = Record<string, Measurement>;

/**
 * THE SEAM. Every section reads through here, with the owner's period.
 *
 * No approved source exists, so today every metric resolves to not-measured
 * and the period is not consulted. It is still threaded through deliberately:
 * the period is the contract F/A/E will fill, and a reader that did not accept
 * it would force every page to change on the day the first source arrives.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- see above: the period is the contract, consumed once a source exists.
async function readSection(specs: readonly MetricSpec[], period: Period): Promise<MeasurementMap> {
  return Object.fromEntries(specs.map((s) => [s.key, notMeasured(s.awaiting.lane)]));
}

export const readOverview = (period: Period) => readSection(OVERVIEW_CARDS, period);
export const readAdoption = (period: Period) => readSection(ADOPTION_METRICS, period);
export const readAiUsage = (period: Period) => readSection(AI_USAGE_METRICS, period);
export const readCosts = (period: Period) => readSection(COST_METRICS, period);
export const readPilotHealth = (period: Period) => readSection(PILOT_HEALTH_METRICS, period);
export const readSecurity = (period: Period) => readSection(SECURITY_METRICS, period);

/**
 * One doctor as the Doctors table sees them.
 *
 * `doctorLabel` names a DOCTOR — the platform's customer — never a patient.
 * Every other field is a measurement keyed by column, so a column the source
 * has not measured renders "Not measured" in that cell rather than 0.
 */
export interface DoctorRow {
  doctorRef: string;
  doctorLabel: string;
  pilotStatus: string | null;
  cells: MeasurementMap;
}

export type DoctorRowsResult =
  | { state: "measured"; rows: DoctorRow[]; asOf: string }
  | { state: "unavailable" }
  | { state: "not-measured"; lane: "F" };

/**
 * The doctor directory itself has no approved source, so there are no rows —
 * not an empty list presented as "no doctors". The table renders its full
 * column set and says the directory is not measured yet.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- the period is the contract, consumed once a source exists.
export async function readDoctorRows(period: Period): Promise<DoctorRowsResult> {
  return { state: "not-measured", lane: "F" };
}

/** Exposed for tests: every column the table can render. */
export const DOCTOR_COLUMN_KEYS = DOCTOR_COLUMNS.map((c) => c.key);
