"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth/session";

const paymentSchema = z.object({
  amount: z.coerce.number().positive().max(10_000_000),
  reference: z.string().trim().min(3).max(120),
  note: z.string().trim().max(500).optional(),
});

export async function submitManualPayment(formData: FormData) {
  await requireUser();
  const parsed = paymentSchema.safeParse({
    amount: formData.get("amount"),
    reference: formData.get("reference"),
    note: formData.get("note") || undefined,
  });
  if (!parsed.success) redirect("/settings/billing?error=check-payment");

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("submit_manual_subscription_payment", {
    p_amount: parsed.data.amount,
    p_reference: parsed.data.reference,
    p_note: parsed.data.note ?? null,
  });
  if (error) {
    const code = error.message.includes("DUPLICATE_REFERENCE") ? "duplicate-reference" : "payment-failed";
    redirect(`/settings/billing?error=${code}`);
  }

  revalidatePath("/settings/billing");
  redirect("/settings/billing?submitted=1");
}

export async function cancelSubscription() {
  await requireUser();
  const supabase = await createSupabaseServerClient();
  await supabase.rpc("cancel_own_subscription");
  revalidatePath("/settings/billing");
}

export async function reactivateSubscription() {
  await requireUser();
  const supabase = await createSupabaseServerClient();
  await supabase.rpc("reactivate_own_subscription");
  revalidatePath("/settings/billing");
}
