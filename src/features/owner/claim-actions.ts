"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requirePlatformOwner } from "./authority";

/**
 * Owner decisions on a doctor's claim.
 *
 * The deciding owner is never passed from here — `auth.uid()` inside the RPC is
 * the only identity, and `is_platform_owner()` is re-checked there. The guard
 * below is a courtesy that keeps a non-owner from reaching the RPC at all; it
 * is not what makes the decision safe.
 */
const decisionSchema = z.object({
  claimId: z.string().uuid(),
  decision: z.enum(["APPROVE", "REJECT", "NEEDS_INFORMATION"]),
  note: z.string().trim().max(1000).optional(),
});

/** The owner's screen, so a refusal names the real reason. */
const MESSAGES: Record<string, string> = {
  NOT_PLATFORM_OWNER: "not-owner",
  CLAIM_NOT_FOUND: "claim-not-found",
  CLAIM_ALREADY_DECIDED: "already-decided",
  OWNERSHIP_CONFLICT: "ownership-conflict",
  INVALID_DECISION: "check-decision",
  NOTE_TOO_LONG: "note-too-long",
};

function codeFor(message: string): string {
  const hit = Object.keys(MESSAGES).find((key) => message.includes(key));
  return hit ? MESSAGES[hit]! : "decision-failed";
}

export async function decideClaim(formData: FormData) {
  await requirePlatformOwner();

  const parsed = decisionSchema.safeParse({
    claimId: formData.get("claimId"),
    decision: formData.get("decision"),
    note: formData.get("note") || undefined,
  });
  if (!parsed.success) redirect("/owner/claims?error=check-decision");

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("owner_decide_doctor_profile_claim", {
    p_claim_id: parsed.data.claimId,
    p_decision: parsed.data.decision,
    p_note: parsed.data.note ?? null,
  });

  if (error) redirect(`/owner/claims?error=${codeFor(error.message)}`);

  revalidatePath("/owner/claims");
  redirect(`/owner/claims?decided=${parsed.data.decision.toLowerCase()}`);
}
