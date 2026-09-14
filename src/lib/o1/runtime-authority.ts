import "server-only";

import {
  serviceAcknowledgeActivityReconciliation,
  serviceAcknowledgeActivityReconciliationDay,
  serviceFinalizeActivityMeasurementDay,
  serviceGetActivityDayWatermark,
  serviceGetActivityReconciliationContext,
  serviceIngestActivityContribution,
  serviceIngestAiVoiceTelemetryEvent,
  serviceListActivityReconciliationDoctors,
  serviceReadActivityReconciliationMinutes,
  serviceRecordEngagementMinute,
  serviceResolveDoctorProfileIdForActor,
  type ActivityDayWatermark,
  type ActivityReconciliationContext,
  type ActivityReconciliationDoctor,
  type ActivityReconciliationMinute,
} from "@/lib/supabase/service";

/**
 * The only application boundary allowed to invoke O1's privileged runtime RPCs.
 * It deliberately exposes domain operations rather than a Supabase client or
 * generic RPC primitive.
 */
export async function resolveRuntimeDoctorId(actorUserId: string): Promise<string | null> {
  return serviceResolveDoctorProfileIdForActor(actorUserId);
}

export async function persistRuntimeEngagementMinute(input: {
  doctorId: string;
  minuteBucket: string;
  surface: string;
  clinicTimeZone: string;
}): Promise<boolean> {
  return serviceRecordEngagementMinute(input);
}

export async function persistRuntimeAiVoiceTelemetry(
  event: Record<string, unknown>,
): Promise<boolean> {
  return serviceIngestAiVoiceTelemetryEvent(event);
}

export function getRuntimeActivityDayWatermark(periodDay: string): Promise<ActivityDayWatermark> {
  return serviceGetActivityDayWatermark(periodDay);
}

export function listRuntimeActivityReconciliationDoctors(input: {
  periodDay: string;
  afterDoctorId: string | null;
  limit: number;
}): Promise<ActivityReconciliationDoctor[]> {
  return serviceListActivityReconciliationDoctors(input);
}

export function getRuntimeActivityReconciliationContext(input: {
  doctorId: string;
  periodDay: string;
}): Promise<ActivityReconciliationContext> {
  return serviceGetActivityReconciliationContext(input);
}

export function readRuntimeActivityReconciliationMinutes(input: {
  doctorId: string;
  periodDay: string;
  generation: number;
  afterMinuteBucket: string | null;
  afterSurface: string | null;
  limit: number;
}): Promise<ActivityReconciliationMinute[]> {
  return serviceReadActivityReconciliationMinutes(input);
}

export function persistRuntimeActivityContribution(input: {
  metricCode: string;
  doctorId: string;
  periodDay: string;
  featureCode: string;
  value: number;
  sourceStream: string;
  sourceVersion: number;
}): Promise<void> {
  return serviceIngestActivityContribution(input);
}

export function acknowledgeRuntimeActivityReconciliation(input: {
  doctorId: string;
  periodDay: string;
  generation: number;
}): Promise<void> {
  return serviceAcknowledgeActivityReconciliation(input);
}

export function acknowledgeRuntimeActivityReconciliationDay(input: {
  periodDay: string;
  observedGeneration: number;
  observedDoctorCount: number;
}): Promise<void> {
  return serviceAcknowledgeActivityReconciliationDay(input);
}

export function finalizeRuntimeActivityMeasurementDay(input: {
  periodDay: string;
  sourceVersion: number;
}): Promise<void> {
  return serviceFinalizeActivityMeasurementDay(input);
}
