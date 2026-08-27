"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requirePlatformOwner } from "./authority";

/**
 * Owner decisions on a manual payment.
 *
 * No decider id is sent — `auth.uid()` inside the RPC is the only identity, and
 * `is_platform_owner()` is re-checked there. The guard below keeps a non-owner
 * from reaching the RPC at all; it is not what makes the decision safe.
 */
const schema = z.object({
  paymentId: z.string().uuid(),
  decision: z.enum(["CONFIRM", "REJECT"]),
  note: z.string().trim().max(500).optional(),
});

const MESSAGES: Record<string, string> = {
  NOT_PLATFORM_OWNER: "not-owner",
  PAYMENT_NOT_FOUND: "not-found",
  PAYMENT_ALREADY_DECIDED: "already-decided",
  INVALID_DECISION: "check-decision",
  NOTE_TOO_LONG: "note-too-long",
};

function codeFor(message: string): string {
  const hit = Object.keys(MESSAGES).find((key) => message.includes(key));
  return hit ? MESSAGES[hit]! : "decision-failed";
}

export async function decidePayment(formData: FormData) {
  await requirePlatformOwner();

  const parsed = schema.safeParse({
    paymentId: formData.get("paymentId"),
    decision: formData.get("decision"),
    note: formData.get("note") || undefined,
  });
  if (!parsed.success) redirect("/owner/payments?error=check-decision");

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("owner_decide_subscription_payment", {
    p_payment_id: parsed.data.paymentId,
    p_decision: parsed.data.decision,
    p_note: parsed.data.note ?? null,
  });

  if (error) redirect(`/owner/payments?error=${codeFor(error.message)}`);

  revalidatePath("/owner/payments");
  redirect(`/owner/payments?decided=${parsed.data.decision.toLowerCase()}`);
}
