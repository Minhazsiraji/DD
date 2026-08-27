import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * CLAIM REVIEW — professional identity evidence, and nothing else.
 *
 * The shape below is the whole surface a reviewer gets. Answering "is this
 * person this doctor?" needs a name, a regulator and a registration number; it
 * never needs a patient. A reviewer who could see clinical rows would be a
 * clinical superuser under another name, which is exactly what the owner
 * authority layer exists to prevent.
 *
 * Authority is re-checked inside every RPC — `owner_pending_claims()` and
 * `owner_decide_doctor_profile_claim()` both raise `NOT_PLATFORM_OWNER` on
 * their own. The route guard is convenience; the database is the control.
 */
export interface ClaimForReview {
  id: string;
  status: "PENDING" | "NEEDS_INFORMATION";
  claimedFullName: string;
  countryCode: string;
  regulatorName: string;
  registrationNumber: string;
  evidenceNote: string | null;
  submittedAt: string;
  accountName: string | null;
  profileQualification: string | null;
  profileSpecialization: string | null;
  profileDesignation: string | null;
  /** What the profile already carries, to compare against the claim. */
  profileRegistrationOnRecord: string | null;
}

export async function getClaimsForReview(): Promise<ClaimForReview[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("owner_pending_claims");
  if (error || !Array.isArray(data)) return [];
  return data as unknown as ClaimForReview[];
}
