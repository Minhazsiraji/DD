import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * PAYMENT REVIEW — money, not medicine.
 *
 * A reviewer matching a bank transfer to an account needs the amount, the
 * reference and whose subscription it belongs to. They do not need a patient,
 * and the RPC does not offer one. Authority is re-checked inside
 * `owner_pending_payments()` and `owner_decide_subscription_payment()`; the
 * route guard is convenience, the database is the control.
 */
export interface PaymentForReview {
  id: string;
  amount: number | string;
  currency: string;
  method: string;
  payerReference: string | null;
  note: string | null;
  submittedAt: string;
  subscriptionId: string;
  subscriptionStatus: string;
  planCode: string;
  doctorName: string | null;
  currentPeriodEnd: string | null;
}

export async function getPaymentsForReview(): Promise<PaymentForReview[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("owner_pending_payments");
  if (error || !Array.isArray(data)) return [];
  return data as unknown as PaymentForReview[];
}
