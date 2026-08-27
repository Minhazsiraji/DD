import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export interface BillingPayment {
  id: string;
  amount: number | string;
  currency: string;
  method: string;
  status: string;
  payerReference: string | null;
  submittedAt: string;
  confirmedAt: string | null;
}

export interface CurrentSubscription {
  subscriptionId: string;
  status: string;
  planCode: string;
  planName: string;
  monthlyPriceBdt: number | string;
  annualPriceBdt: number | string | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  graceUntil: string | null;
  cancelAtPeriodEnd: boolean;
  founderDiscountPercent: number | string | null;
  founderPriceLockedUntil: string | null;
  payments: BillingPayment[];
}

export async function getCurrentSubscription(): Promise<CurrentSubscription | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("current_subscription");
  if (error || !data) return null;
  return data as unknown as CurrentSubscription;
}
