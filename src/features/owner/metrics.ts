import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Platform adoption metrics.
 *
 * Reads through `owner_adoption_metrics()`, which is gated on
 * `is_platform_owner()` in the database. The guard on the page is a courtesy
 * to the user; this is the one that decides.
 *
 * FAILS SOFT ON PURPOSE. The function is a policy file, and policy files are
 * applied by a deliberate `db:policies` run rather than by a deploy. Until
 * that run happens the RPC does not exist, and the console must say so plainly
 * rather than crash or — far worse — render zeros that read as "nobody has
 * signed up".
 */
export interface AdoptionMetrics {
  doctors: number;
  publicProfiles: number;
  profilesWithSlug: number;
  withChambers: number;
  withBookingEnabled: number;
  withFirstConsultation: number;
  subscriptions: Record<string, number>;
  pendingManualPayments: number;
  generatedAt: string;
}

export type MetricsResult =
  | { ok: true; metrics: AdoptionMetrics }
  | { ok: false; reason: "unavailable" };

export async function getAdoptionMetrics(): Promise<MetricsResult> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("owner_adoption_metrics");
  if (error || !data) return { ok: false, reason: "unavailable" };
  return { ok: true, metrics: data as unknown as AdoptionMetrics };
}

/**
 * A share, as a whole percent, or null when there is nothing to divide by.
 *
 * Null rather than 0. "0% of doctors have enabled booking" is a claim about
 * doctors; with no doctors registered there is no such claim to make, and a
 * zero on that tile would be read as a failure of adoption rather than an
 * absence of anyone to adopt.
 */
export function share(part: number, whole: number): number | null {
  if (!Number.isFinite(part) || !Number.isFinite(whole) || whole <= 0) return null;
  return Math.round((part / whole) * 100);
}
