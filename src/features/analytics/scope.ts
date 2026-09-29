import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export interface AnalyticsChamber { locationId: string; locationName: string; timezone: string }
export type AnalyticsScope = "all" | string;

export async function getAnalyticsChambers(): Promise<AnalyticsChamber[]> {
  const supabase = await createSupabaseServerClient();
  const result = await supabase.rpc("doctor_expense_chambers");
  if (result.error || !Array.isArray(result.data)) return [];
  return result.data as unknown as AnalyticsChamber[];
}

export function resolveAnalyticsScope(requested: string | undefined, chambers: readonly AnalyticsChamber[], activeLocationId: string) {
  if (!requested || requested === "all") return { scope: "all" as const, locationIds: chambers.map(c => c.locationId) };
  const allowed = chambers.find(c => c.locationId === requested);
  if (allowed) return { scope: allowed.locationId, locationIds: [allowed.locationId] };
  const fallback = chambers.find(c => c.locationId === activeLocationId);
  return { scope: fallback?.locationId ?? "all", locationIds: fallback ? [fallback.locationId] : chambers.map(c => c.locationId) };
}
