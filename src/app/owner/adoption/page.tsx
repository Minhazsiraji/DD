import type { Metadata } from "next";
import Link from "next/link";
import { requirePlatformOwner } from "@/features/owner/authority";
import { getAdoptionMetrics, share } from "@/features/owner/metrics";
import { STATE_OF, STATE_LABEL, DB_STATUSES } from "@/features/commercial/state";

export const metadata: Metadata = { title: "Adoption" };

/**
 * How far doctors have got, in aggregate.
 *
 * EVERY NUMBER HERE IS A COUNT OF DOCTORS. There is no patient count, no
 * consultation count and no per-doctor row — see the header of
 * `0042_owner_adoption_metrics.sql` for why the shape itself is the control.
 *
 * A funnel reads top to bottom: registered → described → findable → bookable →
 * actually seeing patients. Each row names the count and the share, because a
 * share with no denominator is the easiest number in a dashboard to misread.
 */
export default async function OwnerAdoptionPage() {
  await requirePlatformOwner();
  const result = await getAdoptionMetrics();

  if (!result.ok) {
    return (
      <main className="mx-auto max-w-3xl px-5 py-12 sm:px-6">
        <h1 className="text-2xl font-semibold text-ink">Adoption</h1>
        <p className="mt-3 rounded-xl bg-warning-soft px-4 py-3 text-sm text-[#8a3f07]">
          Adoption metrics are not available on this database yet.
          <code className="mx-1 rounded bg-white/60 px-1 py-0.5 text-xs">
            owner_adoption_metrics()
          </code>
          ships in <code className="text-xs">0042_owner_adoption_metrics.sql</code> and
          needs <code className="text-xs">db:policies</code> to have been run. No
          figures are shown rather than zeros, because zeros here would read as
          &ldquo;nobody has signed up&rdquo;.
        </p>
        <Link href="/owner" className="mt-5 inline-block text-sm font-medium text-brand">
          ← Owner console
        </Link>
      </main>
    );
  }

  const m = result.metrics;
  const funnel: { label: string; value: number; note: string }[] = [
    { label: "Registered doctors", value: m.doctors, note: "Accounts with a doctor profile" },
    { label: "Chambers described", value: m.withChambers, note: "At least one chamber on the profile" },
    { label: "Public profiles", value: m.publicProfiles, note: "Visible to patients" },
    { label: "…with a profile link", value: m.profilesWithSlug, note: "Public and actually reachable" },
    { label: "Online booking on", value: m.withBookingEnabled, note: "At least one bookable chamber" },
    {
      label: "First consultation done",
      value: m.withFirstConsultation,
      note: "Doctors who completed at least one — no patient detail is read",
    },
  ];

  return (
    <main className="mx-auto max-w-3xl px-5 py-12 sm:px-6">
      <p className="text-sm font-semibold uppercase tracking-[0.14em] text-brand">Platform</p>
      <h1 className="mt-1 text-2xl font-semibold text-ink">Adoption</h1>
      <p className="mt-2 text-sm text-ink-secondary">
        This page returns platform-level aggregate counts only. It does not expose
        patient, doctor, encounter, diagnosis, prescription or clinical-note details.
      </p>
      <Link href="/owner" className="mt-3 inline-block text-sm font-medium text-brand">
        ← Owner console
      </Link>

      <section className="clinical-surface mt-6 rounded-glass-lg p-5">
        <h2 className="text-sm font-semibold text-ink">Setup funnel</h2>
        <ul className="mt-3 divide-y divide-hairline">
          {funnel.map((row) => {
            const pct = share(row.value, m.doctors);
            return (
              <li key={row.label} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2.5">
                <span className="min-w-0">
                  <span className="text-sm font-medium text-ink">{row.label}</span>
                  <span className="mt-0.5 block text-xs text-ink-muted">{row.note}</span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="text-base font-semibold tabular-nums text-ink">{row.value}</span>
                  {pct !== null ? (
                    <span className="ml-2 text-xs tabular-nums text-ink-secondary">{pct}%</span>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="clinical-surface mt-4 rounded-glass-lg p-5">
        <h2 className="text-sm font-semibold text-ink">Subscriptions</h2>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {DB_STATUSES.map((status) => (
            <li key={status} className="flex items-baseline justify-between gap-3 text-sm">
              <span className="text-ink-secondary">
                {status.replaceAll("_", " ")}
                <span className="ml-1.5 text-xs text-ink-muted">
                  ({STATE_LABEL[STATE_OF[status]]})
                </span>
              </span>
              <span className="font-semibold tabular-nums text-ink">
                {m.subscriptions[status] ?? 0}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-sm text-ink-secondary">
          Manual payments waiting for a decision:{" "}
          <Link href="/owner/payments" className="font-semibold text-brand">
            {m.pendingManualPayments}
          </Link>
        </p>
      </section>

      <p className="mt-4 text-xs text-ink-muted">
        Measured {m.generatedAt.slice(0, 19).replace("T", " ")} UTC. There is no
        per-doctor breakdown here, and adding one would be a different product
        decision with a different consent conversation.
      </p>
    </main>
  );
}
