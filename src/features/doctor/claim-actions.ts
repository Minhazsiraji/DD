"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth/session";

/**
 * The doctor's side of the claim.
 *
 * No claimant id is sent — the RPC reads `auth.uid()`. The bounds below mirror
 * the RPC's own validation and the CHECK constraints beneath it: this layer
 * exists to give a person a usable message, not to be the control.
 *
 * There is deliberately no action here that can reach APPROVED. A claimant may
 * submit, resubmit and withdraw; only a platform owner decides.
 */
const submitSchema = z.object({
  countryCode: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/),
  regulatorName: z.string().trim().min(2).max(120),
  registrationNumber: z.string().trim().min(2).max(64),
  claimedFullName: z.string().trim().min(2).max(120),
  evidenceNote: z.string().trim().max(1000).optional(),
});

const MESSAGES: Record<string, string> = {
  DOCTOR_PROFILE_REQUIRED: "no-doctor-profile",
  CLAIM_ALREADY_OPEN: "already-open",
  ALREADY_APPROVED: "already-approved",
  INVALID_COUNTRY: "check-details",
  INVALID_REGULATOR: "check-details",
  INVALID_REGISTRATION: "check-details",
  INVALID_NAME: "check-details",
  EVIDENCE_TOO_LONG: "check-details",
  CLAIM_NOT_FOUND: "claim-not-found",
  CLAIM_ALREADY_DECIDED: "already-decided",
  NOTHING_TO_RESUBMIT: "nothing-to-resubmit",
};

function codeFor(message: string): string {
  const hit = Object.keys(MESSAGES).find((key) => message.includes(key));
  return hit ? MESSAGES[hit]! : "claim-failed";
}

export async function submitClaim(formData: FormData) {
  await requireUser();

  const parsed = submitSchema.safeParse({
    countryCode: formData.get("countryCode"),
    regulatorName: formData.get("regulatorName"),
    registrationNumber: formData.get("registrationNumber"),
    claimedFullName: formData.get("claimedFullName"),
    evidenceNote: formData.get("evidenceNote") || undefined,
  });
  if (!parsed.success) redirect("/settings/claim?error=check-details");

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("submit_doctor_profile_claim", {
    p_country_code: parsed.data.countryCode,
    p_regulator_name: parsed.data.regulatorName,
    p_registration_number: parsed.data.registrationNumber,
    p_claimed_full_name: parsed.data.claimedFullName,
    p_evidence_note: parsed.data.evidenceNote ?? null,
  });

  if (error) redirect(`/settings/claim?error=${codeFor(error.message)}`);

  revalidatePath("/settings/claim");
  redirect("/settings/claim?submitted=1");
}

const respondSchema = z.object({
  claimId: z.string().uuid(),
  action: z.enum(["RESUBMIT", "CANCEL"]),
  note: z.string().trim().max(1000).optional(),
});

export async function respondToClaim(formData: FormData) {
  await requireUser();

  const parsed = respondSchema.safeParse({
    claimId: formData.get("claimId"),
    action: formData.get("action"),
    note: formData.get("note") || undefined,
  });
  if (!parsed.success) redirect("/settings/claim?error=check-details");

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("respond_to_doctor_profile_claim", {
    p_claim_id: parsed.data.claimId,
    p_action: parsed.data.action,
    p_note: parsed.data.note ?? null,
  });

  if (error) redirect(`/settings/claim?error=${codeFor(error.message)}`);

  revalidatePath("/settings/claim");
  redirect(`/settings/claim?${parsed.data.action === "CANCEL" ? "withdrawn" : "resubmitted"}=1`);
}
