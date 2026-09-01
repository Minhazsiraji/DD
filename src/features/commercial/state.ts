/**
 * Commercial account state — the doctor-facing reading of a subscription row.
 *
 * TWO VOCABULARIES, ONE SOURCE OF TRUTH. The database records seven statuses
 * (`doctor_subscriptions_status`), which exist because billing needs to tell
 * PILOT from EXPIRED and GRACE_PERIOD from PAST_DUE. The commercial layer
 * speaks six, because a doctor does not need to know which of two overdue
 * shades they are in.
 *
 * The database stays the source of truth and is never rewritten to match the
 * shorter vocabulary. This file is a projection, and it is pure: no reads, no
 * clock beyond what is passed in, nothing to mock.
 */

import type { Money } from "./catalog";

/** Exactly the values `doctor_subscriptions_status` permits. */
export const DB_STATUSES = [
  "PILOT",
  "TRIAL",
  "ACTIVE",
  "GRACE_PERIOD",
  "PAST_DUE",
  "CANCELLED",
  "EXPIRED",
] as const;
export type DbSubscriptionStatus = (typeof DB_STATUSES)[number];

export const COMMERCIAL_STATES = [
  "FREE",
  "TRIAL",
  "ACTIVE",
  "PAST_DUE",
  "SUSPENDED",
  "CANCELLED",
] as const;
export type CommercialState = (typeof COMMERCIAL_STATES)[number];

/**
 * The projection, written out rather than computed, so that adding a database
 * status is a compile error here instead of a silent default somewhere else.
 *
 * GRACE_PERIOD and PAST_DUE both land on PAST_DUE: the difference between
 * "the payment is late" and "the payment is late and we are still serving you
 * anyway" is a billing detail, and the doctor's action is the same either way.
 *
 * EXPIRED lands on SUSPENDED and NOT on CANCELLED. Cancelled is a decision the
 * doctor made; expired is one that happened to them, and telling someone they
 * cancelled when they did not is the kind of small lie that loses trust.
 */
export const STATE_OF: Record<DbSubscriptionStatus, CommercialState> = {
  PILOT: "FREE",
  TRIAL: "TRIAL",
  ACTIVE: "ACTIVE",
  GRACE_PERIOD: "PAST_DUE",
  PAST_DUE: "PAST_DUE",
  CANCELLED: "CANCELLED",
  EXPIRED: "SUSPENDED",
};

/**
 * Project a raw status. Returns null for anything unrecognised.
 *
 * Null rather than a guess. A status this build has never heard of means the
 * database moved ahead of the app, and inventing a commercial meaning for it
 * would either grant something unpaid for or withdraw something paid for. The
 * caller renders the raw status instead, and entitlement resolution treats
 * null as the most restrictive case.
 */
export function commercialState(status: string | null | undefined): CommercialState | null {
  const key = (status ?? "").trim().toUpperCase();
  return (STATE_OF as Record<string, CommercialState | undefined>)[key] ?? null;
}

/** Plain-language state, for a doctor rather than for billing. */
export const STATE_LABEL: Record<CommercialState, string> = {
  FREE: "Free",
  TRIAL: "Trial",
  ACTIVE: "Active",
  PAST_DUE: "Payment due",
  SUSPENDED: "Expired",
  CANCELLED: "Cancelled",
};

/**
 * What the state means, said once, so no page invents its own wording.
 *
 * Every line ends the same way for a reason. A doctor reading "expired" will
 * wonder about their patients before they wonder about their plan, and the
 * answer must be on the same screen, not in a help article.
 */
export const STATE_MEANING: Record<CommercialState, string> = {
  FREE: "You are on the free pilot. Your records are yours to keep.",
  TRIAL: "You are trying the full product. Your records are yours to keep.",
  ACTIVE: "Your subscription is running. Your records are yours to keep.",
  PAST_DUE:
    "A payment is outstanding. Your patient records are unaffected and stay open to you.",
  SUSPENDED:
    "The subscription period has ended. Your patient records are unaffected and stay open to you.",
  CANCELLED:
    "The subscription is cancelled. Your patient records are unaffected and stay open to you.",
};

/** Which states should read as a problem rather than a status. */
export function needsAttention(state: CommercialState | null): boolean {
  return state === "PAST_DUE" || state === "SUSPENDED";
}

/**
 * A subscription as the commercial screens read it.
 *
 * Every date is nullable and stays nullable. The database does not always have
 * a period — a PILOT subscription has never had one — and rendering "—" is
 * correct where rendering today's date would be a fabrication.
 */
export interface CommercialSummary {
  subscriptionId: string;
  /** The projection. Null when the database status is unknown to this build. */
  state: CommercialState | null;
  /** Always carried through, so nothing is hidden behind the projection. */
  rawStatus: string;
  planCode: string;
  planName: string;
  /** Null when no price is configured. Never zero-filled. */
  monthlyPrice: Money | null;
  periodStart: string | null;
  periodEnd: string | null;
  /**
   * The trial's end, and ONLY when the status actually says TRIAL.
   *
   * There is no `trial_ends_at` column; a trial's end is its period end. That
   * makes this a derived field, and deriving it for a non-trial subscription
   * would put a "trial ends" date on an active paid account.
   */
  trialEndsAt: string | null;
  graceUntil: string | null;
  cancelAtPeriodEnd: boolean;
  founderDiscountPercent: number | null;
}

/** The subset of `current_subscription()` this projection needs. */
export interface SubscriptionRow {
  subscriptionId: string;
  status: string;
  planCode: string;
  planName: string;
  monthlyPriceBdt: number | string | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  graceUntil: string | null;
  cancelAtPeriodEnd: boolean;
  founderDiscountPercent: number | string | null;
}

export function summarize(
  row: SubscriptionRow,
  planPrice: (v: number | string | null | undefined) => Money | null,
): CommercialSummary {
  const state = commercialState(row.status);
  const discount = Number(row.founderDiscountPercent);

  return {
    subscriptionId: row.subscriptionId,
    state,
    rawStatus: (row.status ?? "").trim().toUpperCase(),
    planCode: row.planCode,
    planName: row.planName,
    monthlyPrice: planPrice(row.monthlyPriceBdt),
    periodStart: row.currentPeriodStart,
    periodEnd: row.currentPeriodEnd,
    trialEndsAt: state === "TRIAL" ? row.currentPeriodEnd : null,
    graceUntil: row.graceUntil,
    cancelAtPeriodEnd: row.cancelAtPeriodEnd === true,
    founderDiscountPercent: Number.isFinite(discount) && discount > 0 ? discount : null,
  };
}
