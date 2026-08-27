import type { Metadata } from "next";
import Link from "next/link";
import { requirePlatformOwner } from "@/features/owner/authority";
import { getPaymentsForReview } from "@/features/owner/payments";
import { decidePayment } from "@/features/owner/payment-actions";
import { formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "Payments" };

const errors: Record<string, string> = {
  "check-decision": "Check the decision and try again.",
  "not-found": "That payment no longer exists.",
  "already-decided": "That payment was already decided. Decisions are not overwritten.",
  "note-too-long": "The note is too long.",
  "not-owner": "You are not a platform owner.",
  "decision-failed": "The decision could not be recorded. Nothing was changed.",
};

const decided: Record<string, string> = {
  confirm: "Payment confirmed and the subscription activated.",
  reject: "Payment rejected. The subscription was not changed.",
};

/**
 * The payment review queue.
 *
 * Confirming here is the one action that moves a doctor to ACTIVE, so the
 * screen states the consequence rather than leaving it implicit — and states
 * equally that it reaches nothing clinical.
 */
export default async function OwnerPaymentsPage(props: PageProps<"/owner/payments">) {
  await requirePlatformOwner();

  const search = await props.searchParams;
  const payments = await getPaymentsForReview();
  const error = typeof search.error === "string" ? errors[search.error] : null;
  const ok = typeof search.decided === "string" ? decided[search.decided] : null;

  return (
    <main className="mx-auto max-w-3xl px-5 py-12 sm:px-6">
      <p className="text-sm font-semibold uppercase tracking-[0.14em] text-brand">Platform</p>
      <h1 className="mt-1 text-2xl font-semibold text-ink">Manual payments</h1>
      <p className="mt-2 text-sm text-ink-secondary">
        Match each transfer against the bank before confirming. Confirming
        activates the doctor&apos;s subscription and runs the period for a
        month; rejecting changes nothing but the payment.
      </p>
      <p className="mt-2 text-sm text-ink-secondary">
        A decision here reaches no patient, consultation or prescription.
      </p>
      <Link href="/owner" className="mt-3 inline-block text-sm font-medium text-brand">
        ← Owner console
      </Link>

      {error && <p className="mt-5 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800">{error}</p>}
      {ok && <p className="mt-5 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{ok}</p>}

      {payments.length === 0 ? (
        <p className="clinical-surface mt-6 rounded-glass-lg p-6 text-sm text-ink-secondary">
          No payments are waiting for a decision.
        </p>
      ) : (
        <ul className="mt-6 grid gap-4">
          {payments.map((p) => (
            <li key={p.id} className="clinical-surface rounded-glass-lg p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-lg font-semibold tabular-nums text-ink">
                    {p.currency} {p.amount}
                  </h2>
                  <p className="mt-0.5 text-sm text-ink-secondary">
                    {p.doctorName ?? "—"} · {p.planCode}
                  </p>
                </div>
                <span className="shrink-0 rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
                  {p.subscriptionStatus.replaceAll("_", " ")}
                </span>
              </div>

              <dl className="mt-4 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-ink-muted">Reference</dt>
                  <dd className="text-ink tabular-nums">{p.payerReference ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-ink-muted">Method</dt>
                  <dd className="text-ink">{p.method.replaceAll("_", " ")}</dd>
                </div>
                <div>
                  <dt className="text-ink-muted">Submitted</dt>
                  <dd className="text-ink tabular-nums">{formatDate(p.submittedAt)}</dd>
                </div>
                <div>
                  <dt className="text-ink-muted">Current period ends</dt>
                  <dd className="text-ink tabular-nums">
                    {p.currentPeriodEnd ? formatDate(p.currentPeriodEnd) : "— not started"}
                  </dd>
                </div>
              </dl>

              {p.note && (
                <p className="mt-3 rounded-xl bg-slate-50 px-4 py-3 text-sm text-ink-secondary">
                  {p.note}
                </p>
              )}

              <form action={decidePayment} className="mt-5 grid gap-3">
                <input type="hidden" name="paymentId" value={p.id} />
                <label className="text-xs font-medium uppercase tracking-wide text-ink-muted">
                  Reason / note
                  <input
                    type="text"
                    name="note"
                    maxLength={500}
                    placeholder="Recorded with the decision"
                    className="mt-1 w-full rounded-xl border border-hairline bg-white px-3 py-2 text-sm text-ink focus:border-brand focus:outline-none"
                  />
                </label>

                <div className="flex flex-wrap gap-2">
                  <button
                    type="submit"
                    name="decision"
                    value="CONFIRM"
                    className="inline-flex h-10 items-center rounded-xl bg-brand px-4 text-sm font-semibold text-white"
                  >
                    Confirm &amp; activate
                  </button>
                  <button
                    type="submit"
                    name="decision"
                    value="REJECT"
                    className="inline-flex h-10 items-center rounded-xl border border-hairline bg-white px-4 text-sm font-semibold text-danger"
                  >
                    Reject
                  </button>
                </div>
              </form>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
