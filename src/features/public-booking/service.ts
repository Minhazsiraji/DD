import "server-only";
import { createHmac } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { publicEnv, serviceRoleKey } from "@/lib/env";

let cached: ReturnType<typeof createClient> | null = null;

function publicBookingServiceClient() {
  if (typeof window !== "undefined") {
    throw new Error("Public booking service client requested from client code");
  }

  cached ??= createClient(publicEnv().NEXT_PUBLIC_SUPABASE_URL, serviceRoleKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}

function sourceKey(sourceIp: string): string {
  const hmacKey = serviceRoleKey();
  const digest = createHmac("sha256", hmacKey)
    .update(`dd-public-booking:${sourceIp}`)
    .digest("hex");
  return digest;
}

export async function consumePublicBookingRateLimit(sourceIp: string): Promise<boolean> {
  if (!sourceIp) return false;

  const { data, error } = await publicBookingServiceClient().rpc(
    "consume_public_booking_rate_limit",
    { p_source_key: sourceKey(sourceIp) },
  );

  if (error || typeof data !== "boolean") {
    // Fail closed: an unavailable limiter must never degrade to an unthrottled
    // anonymous booking write.
    return false;
  }

  return data;
}

export interface PublicBookingWriteInput {
  slug: string;
  locationId: string;
  date: string;
  localTime: string;
  patientName: string;
  phone: string;
  sex: "MALE" | "FEMALE" | "OTHER" | "UNKNOWN";
  reason: string | null;
}

export async function createPublicBookingPrivileged(input: PublicBookingWriteInput): Promise<unknown> {
  const { data, error } = await publicBookingServiceClient().rpc("create_public_booking", {
    p_slug: input.slug,
    p_location_id: input.locationId,
    p_date: input.date,
    p_local_time: input.localTime,
    p_patient_name: input.patientName,
    p_phone: input.phone,
    p_sex: input.sex,
    p_reason: input.reason,
  });

  if (error) return null;
  return data;
}
