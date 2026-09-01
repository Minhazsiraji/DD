import type { Metadata } from "next";
import Link from "next/link";
import { Banknote, Receipt } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { SectionCard, SectionHeader } from "@/components/common/section-card";
import { formatDate } from "@/lib/format";
import { requireUser } from "@/lib/auth/session";
import {
  cancelSubscription,
  reactivateSubscription,
  submitManualPayment,
} from "@/features/billing/actions";
import { getCommercialOverview } from "@/features/commercial/overview";
import { DEFAULT_CURRENCY_CODE, currency, formatMoney } from "@/features/commercial/catalog";
import { PlanCard } from "@/features/commercial/components/plan-card";

export const metadata: Metadata = { title: "Plan & billing" };

const errors: Record<string, string> = {
  "check-payment": "Check the payment amount and reference.",
  "duplicate-reference": "That payment reference was already submitted.",
  "payment-failed": "The payment could not be submitted.",
};

const PAYMENT_STATE: Record<string, string> = {
  PENDING: "Waiting for review",
  CONFIRMED: "Confirmed",
  REJECTED: "Not accepted",
  REFUNDED: "Refunded",
};

function day(iso: string | null): string {
  if (!iso) return "—";
  const date = iso.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? formatDate(date) : "—";
}

/**
 * Plan, payments and what the plan includes.
 *
 * NO LIVE PAYMENT PROVIDER IS WIRED HERE, deliberately. The only way money
 * moves is a doctor telling us they made a bank transfer and a platform owner
 * confirming it against a statement — the manual path, unchanged. "Change
 * plan" is a link to a conversation, not a checkout, because a checkout with
 * no provider behind it is a button that lies.
 */
export default async function BillingPage(props: PageProps<"/settings/billing">) {
  await requireUser();
  const search = await props.searchParams;
  const overview = await getCommercialOverview();

  if (!overview) {
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <h1 className="text-lg font-semibold text-ink">No plan on this account</h1>
        <p className="mt-2 text-[13px] text-ink-secondary">
          Reception and administrator accounts have no subscription of their own.
        </p>
        <Link
          href="/settings"
          className="mt-5 inline-flex h-11 items-center rounded-xl border border-hairline bg-white px-4 text-[13px] font-semibold text-ink hover:bg-surface-muted focus-visible:focus-ring"
        >
          Back to settings
        </Link>
      </div>
    );
  }

  const { summary, entitlements, payments, awaitingReview } = overview;
  const error = typeof search.error === "string" ? errors[search.error] : null;
  const submitted = search.submitted === "1";
  const cur = currency(DEFAULT_CURRENCY_CODE);

  return (
    <div className="space-y-5 sm:space-y-6">
      <PageHeader
        eyebrow="Subscription"
        title="Plan & billing"
        subtitle="What you are on, what you have paid, and what a plan can and cannot affect."
      />

      {error ? (
        <p className="rounded-xl bg-danger-soft px-4 py-3 text-sm text-[#a81c1c]">{error}</p>
      ) : null}
      {submitted ? (
        <p className="rounded-xl bg-success-soft px-4 py-3 text-sm text-[#07684a]">
          Payment reference submitted. A platform owner will match it against the
          bank before it is confirmed.
        </p>
      ) : null}

      <PlanCard summary={summary} entitlements={entitlements} />

      <SectionCard className="overflow-hidden">
        <SectionHeader title="Manage your plan" icon={<Banknote className="size-4" />} />
        <div className="space-y-4 p-4 sm:p-5">
          {summary.cancelAtPeriodEnd ? (
            <form action={reactivateSubscription}>
              <button
                type="submit"
                className="inline-flex h-11 items-center rounded-xl bg-brand px-4 text-sm font-semibold text-white transition-colors hover:bg-brand-hover focus-visible:focus-ring"
              >
                Keep my subscription
              </button>
              <p className="mt-2 text-xs text-ink-muted">
                Your subscription is set to end on {day(summary.periodEnd)}. This
                cancels that.
              </p>
            </form>
          ) : (
            <form action={cancelSubscription}>
              <button
                type="submit"
                className="inline-flex h-11 items-center rounded-xl border border-hairline bg-white px-4 text-sm font-semibold text-ink transition-colors hover:bg-surface-muted focus-visible:focus-ring"
              >
                Cancel at period end
              </button>
              <p className="mt-2 text-xs text-ink-muted">
                Stops the renewal. Your patient records, consultations and
                prescriptions stay exactly as they are.
              </p>
            </form>
          )}

          {/*
            A PLACEHOLDER THAT SAYS WHAT IT IS. Changing plan needs a plan to
            change to, and today there is one commercial plan and a pilot. A
            disabled "Upgrade" button would imply a product decision nobody has
            made; a line of text and a contact route is the honest version.
          */}
          <div className="rounded-xl border border-hairline bg-surface-muted px-4 py-3">
            <p className="text-sm font-semibold text-ink">Changing plan</p>
            <p className="mt-1 text-xs text-ink-secondary">
              Plans beyond the founding-doctor pricing are not open yet. When
              they are, they will appear here.{" "}
              <Link href="/contact" className="font-medium text-brand underline underline-offset-2">
                Talk to us
              </Link>{" "}
              in the meantime.
            </p>
          </div>
        </div>
      </SectionCard>

      <SectionCard className="overflow-hidden">
        <SectionHeader
          title="Record a bank payment"
          icon={<Banknote className="size-4" />}
          action={
            awaitingReview ? (
              <span className="rounded-full bg-warning-soft px-2.5 py-1 text-xs font-semibold text-[#8a3f07] ring-1 ring-[#f2d5b0] ring-inset">
                One waiting for review
              </span>
            ) : null
          }
        />
        <div className="p-4 sm:p-5">
          <p className="text-sm text-ink-secondary">
            Make the transfer, then tell us its reference. A platform owner
            matches it against the bank before anything is confirmed — nothing
            here charges you.
          </p>
          <form action={submitManualPayment} className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="amount" className="text-sm font-semibold text-ink">
                Amount ({cur.code})
              </label>
              <input
                id="amount"
                name="amount"
                type="number"
                min="1"
                step="0.01"
                required
                inputMode="decimal"
                className="mt-2 h-11 w-full rounded-xl border border-hairline bg-white px-3 text-sm tabular-nums text-ink focus:border-brand focus:outline-none"
              />
            </div>
            <div>
              <label htmlFor="reference" className="text-sm font-semibold text-ink">
                Bank / payment reference
              </label>
              <input
                id="reference"
                name="reference"
                maxLength={120}
                required
                className="mt-2 h-11 w-full rounded-xl border border-hairline bg-white px-3 text-sm text-ink focus:border-brand focus:outline-none"
              />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="note" className="text-sm font-semibold text-ink">
                Note (optional)
              </label>
              <textarea
                id="note"
                name="note"
                maxLength={500}
                rows={2}
                className="mt-2 w-full rounded-xl border border-hairline bg-white px-3 py-2 text-sm text-ink focus:border-brand focus:outline-none"
              />
            </div>
            <button
              type="submit"
              className="inline-flex h-11 items-center justify-center rounded-xl bg-brand px-4 text-sm font-semibold text-white transition-colors hover:bg-brand-hover focus-visible:focus-ring sm:col-span-2 sm:justify-self-start"
            >
              Submit for review
            </button>
          </form>
        </div>
      </SectionCard>

      <SectionCard className="overflow-hidden">
        <SectionHeader
          title="Payment history"
          count={payments.length}
          icon={<Receipt className="size-4" />}
        />
        {payments.length === 0 ? (
          <p className="p-4 text-sm text-ink-secondary sm:p-5">
            No payments submitted yet.
          </p>
        ) : (
          <ul className="divide-y divide-hairline">
            {payments.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-5">
                <div className="min-w-0">
                  <p className="text-sm font-semibold tabular-nums text-ink">
                    {formatMoney(p.amount, p.currency) ?? `${p.currency} ${String(p.amount)}`}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-ink-secondary">
                    {p.method.replaceAll("_", " ")} · {p.payerReference ?? "No reference"} ·{" "}
                    {day(p.submittedAt)}
                  </p>
                </div>
                <span className="shrink-0 rounded-full bg-surface-muted px-3 py-1 text-xs font-semibold text-ink-secondary">
                  {PAYMENT_STATE[p.status] ?? p.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}
