import "server-only";

import {
  serviceIngestAiVoiceTelemetryEvent,
  serviceRecordEngagementMinute,
  serviceResolveDoctorProfileIdForActor,
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
