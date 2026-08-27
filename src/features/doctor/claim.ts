import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * The doctor's own PROFESSIONAL VERIFICATION request.
 *
 * Every read here is scoped inside the database by `auth.uid()`. Nothing on
 * this path accepts a claim id for READING and nothing accepts a claimant id at
 * all — one doctor must not be able to reach another's claim by guessing a
 * uuid, and nobody should be able to file in someone else's name.
 */
export type ClaimStatus =
  | "PENDING"
  | "NEEDS_INFORMATION"
  | "APPROVED"
  | "REJECTED"
  | "CANCELLED";

export interface MyClaim {
  id: string;
  status: ClaimStatus;
  countryCode: string;
  regulatorName: string;
  registrationNumber: string;
  claimedFullName: string;
  evidenceNote: string | null;
  submittedAt: string;
  decidedAt: string | null;
  decisionNote: string | null;
}

export async function getMyClaims(): Promise<MyClaim[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("my_doctor_profile_claims");
  if (error || !Array.isArray(data)) return [];
  return data as unknown as MyClaim[];
}

/** The one that still needs the doctor's attention, if any. */
export function openClaim(claims: MyClaim[]): MyClaim | null {
  return (
    claims.find((c) => c.status === "PENDING" || c.status === "NEEDS_INFORMATION") ?? null
  );
}

export function approvedClaim(claims: MyClaim[]): MyClaim | null {
  return claims.find((c) => c.status === "APPROVED") ?? null;
}

export const CLAIM_STATUS_COPY: Record<ClaimStatus, string> = {
  PENDING: "Submitted — waiting for review",
  NEEDS_INFORMATION: "More information needed",
  APPROVED: "Verified professional identity",
  REJECTED: "Not verified",
  CANCELLED: "Withdrawn",
};
