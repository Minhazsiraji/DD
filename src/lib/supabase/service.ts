import "server-only";
import { createClient } from "@supabase/supabase-js";
import { publicEnv, serviceRoleKey } from "@/lib/env";

/**
 * ⚠ SERVICE ROLE — RLS DOES NOT APPLY TO ANYTHING THIS TOUCHES. ⚠
 *
 * This is the one privileged client in the request path. The client itself is
 * deliberately private: callers receive only Storage or individually reviewed
 * O1 RPC wrappers. No caller can obtain `.from()` or an arbitrary `.rpc()`
 * handle from this module.
 *
 * O1 runtime persistence is RPC-only. The database functions own tenancy,
 * consent, allowlists, reconciliation generations and idempotency; this module
 * does not recreate any of those decisions in application code.
 */

let cached: ReturnType<typeof createClient> | null = null;

function privilegedClient() {
  if (typeof window !== "undefined") {
    throw new Error("The service-role client was requested from client code");
  }
  cached ??= createClient(publicEnv().NEXT_PUBLIC_SUPABASE_URL, serviceRoleKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}

async function privilegedRpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await privilegedClient().rpc(name, args);
  if (error) throw new Error("PRIVILEGED_RPC_FAILED");
  return data as T;
}

function safeCount(value: unknown, code: string): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(code);
  return parsed;
}

function onlyRow(value: unknown, code: string): Record<string, unknown> {
  if (!Array.isArray(value) || value.length !== 1 || !value[0] || typeof value[0] !== "object") {
    throw new Error(code);
  }
  return value[0] as Record<string, unknown>;
}

/** Storage, and nothing beyond the Storage API. */
export function serviceStorage() {
  return privilegedClient().storage;
}

/** Canonical user -> Doctor resolver owned by frozen O1-F-I2. */
export async function serviceResolveDoctorProfileIdForActor(
  actorUserId: string,
): Promise<string | null> {
  const data = await privilegedRpc<unknown>("resolve_doctor_profile_id_for_actor", {
    target_actor_user_id: actorUserId,
  });
  return typeof data === "string" ? data : null;
}

/** Canonical durable engaged-minute writer. Day is derived inside PostgreSQL. */
export async function serviceRecordEngagementMinute(input: {
  doctorId: string;
  minuteBucket: string;
  surface: string;
  clinicTimeZone: string;
}): Promise<boolean> {
  const data = await privilegedRpc<unknown>("record_engagement_minute", {
    target_doctor_id: input.doctorId,
    target_minute_bucket: input.minuteBucket,
    target_surface: input.surface,
    target_clinic_timezone: input.clinicTimeZone,
  });
  if (typeof data !== "boolean") throw new Error("O1A_MINUTE_RESULT_INVALID");
  return data;
}

/** Frozen O1-E allowlisted durable telemetry ingest. */
export async function serviceIngestAiVoiceTelemetryEvent(
  event: Record<string, unknown>,
): Promise<boolean> {
  const data = await privilegedRpc<unknown>("ingest_ai_voice_telemetry_event", {
    target_event: event,
  });
  if (typeof data !== "boolean") throw new Error("O1E_TELEMETRY_RESULT_INVALID");
  return data;
}

export interface ActivityDayWatermark {
  evidenceGeneration: number;
  eligibleDoctorCount: number;
}

export async function serviceGetActivityDayWatermark(periodDay: string): Promise<ActivityDayWatermark> {
  const row = onlyRow(
    await privilegedRpc<unknown>("get_activity_reconciliation_day_watermark", {
      target_period_day: periodDay,
    }),
    "O1F_DAY_WATERMARK_INVALID",
  );
  return {
    evidenceGeneration: safeCount(row.evidence_generation, "O1F_DAY_GENERATION_INVALID"),
    eligibleDoctorCount: safeCount(row.eligible_doctor_count, "O1F_DOCTOR_COUNT_INVALID"),
  };
}

export interface ActivityReconciliationDoctor {
  doctorId: string;
  evidenceGeneration: number;
  reconciledGeneration: number;
  clinicTimeZone: string | null;
  hasEvidence: boolean;
}

export async function serviceListActivityReconciliationDoctors(input: {
  periodDay: string;
  afterDoctorId: string | null;
  limit: number;
}): Promise<ActivityReconciliationDoctor[]> {
  const data = await privilegedRpc<unknown>("list_activity_reconciliation_doctors", {
    target_period_day: input.periodDay,
    target_after_doctor_id: input.afterDoctorId,
    target_limit: input.limit,
  });
  if (!Array.isArray(data)) throw new Error("O1F_DOCTOR_PAGE_INVALID");
  return data.map((raw) => {
    if (!raw || typeof raw !== "object") throw new Error("O1F_DOCTOR_ROW_INVALID");
    const row = raw as Record<string, unknown>;
    if (typeof row.doctor_id !== "string") throw new Error("O1F_DOCTOR_ID_INVALID");
    if (row.clinic_timezone !== null && typeof row.clinic_timezone !== "string") {
      throw new Error("O1F_DOCTOR_TIMEZONE_INVALID");
    }
    if (typeof row.has_evidence !== "boolean") throw new Error("O1F_DOCTOR_EVIDENCE_FLAG_INVALID");
    return {
      doctorId: row.doctor_id,
      evidenceGeneration: safeCount(row.evidence_generation, "O1F_DOCTOR_GENERATION_INVALID"),
      reconciledGeneration: safeCount(row.reconciled_generation, "O1F_DOCTOR_RECONCILED_INVALID"),
      clinicTimeZone: row.clinic_timezone,
      hasEvidence: row.has_evidence,
    };
  });
}

export interface ActivityReconciliationContext {
  evidenceGeneration: number;
  reconciledGeneration: number;
  clinicTimeZone: string | null;
  retainedMinuteCount: number;
}

export async function serviceGetActivityReconciliationContext(input: {
  doctorId: string;
  periodDay: string;
}): Promise<ActivityReconciliationContext> {
  const row = onlyRow(
    await privilegedRpc<unknown>("get_activity_reconciliation_context", {
      target_doctor_id: input.doctorId,
      target_period_day: input.periodDay,
    }),
    "O1F_RECONCILIATION_CONTEXT_INVALID",
  );
  if (row.clinic_timezone !== null && typeof row.clinic_timezone !== "string") {
    throw new Error("O1F_RECONCILIATION_TIMEZONE_INVALID");
  }
  return {
    evidenceGeneration: safeCount(row.evidence_generation, "O1F_RECONCILIATION_GENERATION_INVALID"),
    reconciledGeneration: safeCount(row.reconciled_generation, "O1F_RECONCILIATION_RECEIPT_INVALID"),
    clinicTimeZone: row.clinic_timezone,
    retainedMinuteCount: safeCount(row.retained_minute_count, "O1F_RETAINED_COUNT_INVALID"),
  };
}

export interface ActivityReconciliationMinute {
  minuteBucket: string;
  surface: string;
}

export async function serviceReadActivityReconciliationMinutes(input: {
  doctorId: string;
  periodDay: string;
  generation: number;
  afterMinuteBucket: string | null;
  afterSurface: string | null;
  limit: number;
}): Promise<ActivityReconciliationMinute[]> {
  const data = await privilegedRpc<unknown>("read_activity_reconciliation_minutes", {
    target_doctor_id: input.doctorId,
    target_period_day: input.periodDay,
    target_generation: input.generation,
    target_after_minute_bucket: input.afterMinuteBucket,
    target_after_surface: input.afterSurface,
    target_limit: input.limit,
  });
  if (!Array.isArray(data)) throw new Error("O1F_MINUTE_PAGE_INVALID");
  return data.map((raw) => {
    if (!raw || typeof raw !== "object") throw new Error("O1F_MINUTE_ROW_INVALID");
    const row = raw as Record<string, unknown>;
    if (typeof row.minute_bucket !== "string" || typeof row.surface !== "string") {
      throw new Error("O1F_MINUTE_ROW_INVALID");
    }
    return { minuteBucket: row.minute_bucket, surface: row.surface };
  });
}

export async function serviceIngestActivityContribution(input: {
  metricCode: string;
  doctorId: string;
  periodDay: string;
  featureCode: string;
  value: number;
  sourceStream: string;
  sourceVersion: number;
}): Promise<void> {
  await privilegedRpc<unknown>("ingest_activity_contribution", {
    target_metric_code: input.metricCode,
    target_doctor_id: input.doctorId,
    target_period_day: input.periodDay,
    target_feature_code: input.featureCode,
    target_value: input.value,
    target_source_stream: input.sourceStream,
    target_source_version: input.sourceVersion,
  });
}

export async function serviceAcknowledgeActivityReconciliation(input: {
  doctorId: string;
  periodDay: string;
  generation: number;
}): Promise<void> {
  await privilegedRpc<unknown>("acknowledge_activity_reconciliation", {
    target_doctor_id: input.doctorId,
    target_period_day: input.periodDay,
    target_generation: input.generation,
  });
}

export async function serviceAcknowledgeActivityReconciliationDay(input: {
  periodDay: string;
  observedGeneration: number;
  observedDoctorCount: number;
}): Promise<void> {
  await privilegedRpc<unknown>("acknowledge_activity_reconciliation_day", {
    target_period_day: input.periodDay,
    target_observed_generation: input.observedGeneration,
    target_observed_doctor_count: input.observedDoctorCount,
  });
}

export async function serviceFinalizeActivityMeasurementDay(input: {
  periodDay: string;
  sourceVersion: number;
}): Promise<void> {
  await privilegedRpc<unknown>("finalize_activity_measurement_day", {
    target_period_day: input.periodDay,
    target_source_version: input.sourceVersion,
    target_ingestion_complete: true,
  });
}

/** True when the deployment is configured for privileged server operations. */
export function canFreezeSignatures(): boolean {
  return typeof window === "undefined" && Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
}
