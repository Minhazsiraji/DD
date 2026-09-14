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
 * WHAT IT MUST NEVER TOUCH DIRECTLY
 *
 * `storage.objects` rows are metadata. Supabase treats that schema as
 * read-only and file operations go through the Storage API — inserting rows
 * directly produces a metadata entry with no object behind it, which is worse
 * than a failure because it looks like success.
 *
 * O1 runtime persistence is RPC-only. The database functions own tenancy,
 * consent, allowlists, reconciliation generations and idempotency; this module
 * does not recreate any of those decisions in application code.
 *
 * CONTAINMENT
 *
 *   • `import "server-only"` — importing this from a client component is a
 *     build error, not a runtime surprise.
 *   • the key is read through `serviceRoleKey()`, which throws if `window`
 *     exists and is never prefixed `NEXT_PUBLIC_`.
 *   • an allowlist test restricts imports of this module to reviewed server
 *     boundaries.
 *   • neither the privileged client nor a generic RPC helper is exported.
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

/** True when the deployment is configured for privileged server operations. */
export function canFreezeSignatures(): boolean {
  return typeof window === "undefined" && Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
}
