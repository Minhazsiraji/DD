import { cancelSubscription, reactivateSubscription, submitManualPayment } from "@/features/billing/actions";
import { getCurrentSubscription } from "@/features/billing/queries";

const errors: Record<string, string> = {
  "check-payment": "Check the payment amount and reference.",
  "duplicate-reference": "That payment reference was already submitted.",
  "payment-failed": "The payment could not be submitted.",
};

export default async function BillingPage(props: PageProps<"/settings/billing">) {
  const search = await props.searchParams;
  const subscription = await getCurrentSubscription();
  if (!subscription) {
    return <div className="rounded-2xl border border-hairline bg-white p-6">Billing is not available for this account.</div>;
  }

  const error = typeof search.error === "string" ? errors[search.error] : null;
  const submitted = search.submitted === "1";

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div>
        <p className="text-sm font-semibold uppercase tracking-[0.14em] text-brand">Subscription</p>
        <h1 className="mt-1 text-2xl font-semibold text-ink">Plan & billing</h1>
        <p className="mt-2 text-sm text-ink-secondary">
          Billing controls product access. It does not delete or rewrite historical clinical records.
        </p>
      </div>

      {error && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800">{error}</p>}
      {submitted && <p className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">Payment reference submitted for review.</p>}

      <section className="clinical-surface rounded-glass-lg p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm text-ink-secondary">Current plan</p>
            <h2 className="mt-1 text-xl font-semibold text-ink">{subscription.planName}</h2>
            <p className="mt-1 text-sm text-ink-secondary">Status: {subscription.status.replaceAll("_", " ")}</p>
          </div>
          <div className="text-right">
            <p className="text-sm text-ink-secondary">Configured monthly price</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">৳{String(subscription.monthlyPriceBdt)}</p>
          </div>
        </div>

        {subscription.founderDiscountPercent != null && (
          <p className="mt-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Founding-doctor discount: {String(subscription.founderDiscountPercent)}%
          </p>
        )}

        <div className="mt-5">
          {subscription.cancelAtPeriodEnd ? (
            <form action={reactivateSubscription}>
              <button className="rounded-lg border border-hairline px-4 py-2 text-sm font-semibold">Keep subscription active</button>
            </form>
          ) : (
            <form action={cancelSubscription}>
              <button className="rounded-lg border border-hairline px-4 py-2 text-sm font-semibold">Cancel at period end</button>
            </form>
          )}
        </div>
      </section>

      <section className="clinical-surface rounded-glass-lg p-5">
        <h2 className="text-lg font-semibold text-ink">Submit manual payment</h2>
        <p className="mt-2 text-sm text-ink-secondary">
          For the first founding doctors, bank/manual payment can be reviewed before automated billing is enabled.
        </p>
        <form action={submitManualPayment} className="mt-5 grid gap-4 sm:grid-cols-2">
          <div>
            <label className="text-sm font-semibold">Amount (BDT)</label>
            <input name="amount" type="number" min="1" step="0.01" required className="mt-2 w-full rounded-lg border border-hairline px-3 py-2.5" />
          </div>
          <div>
            <label className="text-sm font-semibold">Bank / payment reference</label>
            <input name="reference" maxLength={120} required className="mt-2 w-full rounded-lg border border-hairline px-3 py-2.5" />
          </div>
          <div className="sm:col-span-2">
            <label className="text-sm font-semibold">Note (optional)</label>
            <textarea name="note" maxLength={500} rows={2} className="mt-2 w-full rounded-lg border border-hairline px-3 py-2.5" />
          </div>
          <button className="rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white sm:col-span-2">
            Submit for review
          </button>
        </form>
      </section>

      <section className="clinical-surface rounded-glass-lg p-5">
        <h2 className="text-lg font-semibold text-ink">Payment history</h2>
        <div className="mt-4 grid gap-3">
          {subscription.payments.length === 0 ? (
            <p className="text-sm text-ink-secondary">No payments submitted yet.</p>
          ) : subscription.payments.map((p) => (
            <div key={p.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-hairline px-4 py-3 text-sm">
              <div>
                <p className="font-semibold">{p.currency} {String(p.amount)}</p>
                <p className="text-ink-secondary">{p.method.replaceAll("_", " ")} · {p.payerReference ?? "No reference"}</p>
              </div>
              <span className="rounded-full bg-surface-muted px-3 py-1 text-xs font-semibold">{p.status}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
