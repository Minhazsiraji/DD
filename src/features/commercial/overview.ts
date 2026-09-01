import "server-only";
import { getCurrentSubscription } from "@/features/billing/queries";
import { planPrice } from "./catalog";
import { summarize, type CommercialSummary } from "./state";
import { entitlementsFor, type PlanEntitlements } from "./entitlements";

/**
 * The commercial account, assembled once.
 *
 * REUSES THE EXISTING SUBSCRIPTION READ. `current_subscription()` already
 * resolves the doctor in the database, creates the pilot subscription if it is
 * the first look, and returns the plan joined to it. Adding a second reader
 * would be the start of a parallel billing system, which is exactly what this
 * stage was told not to build.
 *
 * Everything added on top is projection: a commercial state, a currency-aware
 * price, and the entitlement set implied by the plan. None of it writes.
 */
export interface CommercialOverview {
  summary: CommercialSummary;
  entitlements: PlanEntitlements;
  payments: {
    id: string;
    amount: number | string;
    currency: string;
    method: string;
    status: string;
    payerReference: string | null;
    submittedAt: string;
    confirmedAt: string | null;
  }[];
  /** True while a submitted payment has not been decided. */
  awaitingReview: boolean;
}

export async function getCommercialOverview(): Promise<CommercialOverview | null> {
  const subscription = await getCurrentSubscription();
  if (!subscription) return null;

  const summary = summarize(
    {
      subscriptionId: subscription.subscriptionId,
      status: subscription.status,
      planCode: subscription.planCode,
      planName: subscription.planName,
      monthlyPriceBdt: subscription.monthlyPriceBdt,
      currentPeriodStart: subscription.currentPeriodStart,
      currentPeriodEnd: subscription.currentPeriodEnd,
      graceUntil: subscription.graceUntil,
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
      founderDiscountPercent: subscription.founderDiscountPercent,
    },
    planPrice,
  );

  return {
    summary,
    entitlements: entitlementsFor(summary.planCode, summary.state),
    payments: subscription.payments,
    awaitingReview: subscription.payments.some((p) => p.status === "PENDING"),
  };
}
