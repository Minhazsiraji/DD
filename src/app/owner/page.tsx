import type { Metadata } from "next";
import Link from "next/link";
import { requirePlatformOwner } from "@/features/owner/authority";

export const metadata: Metadata = { title: "Platform" };

/**
 * The owner boundary, and only the boundary.
 *
 * This page exists to prove the authority layer works end to end. It shows what
 * the primitive unblocks and what it deliberately cannot reach — no metrics, no
 * doctor list, no clinical data, because none of that is built and none of it
 * should appear by accident.
 *
 * `/owner` sits OUTSIDE the `(app)` group on purpose. That group's layout is
 * the clinical shell — location switcher, patient search, clinical navigation —
 * and platform administration is not clinical work. Rendering owner tools
 * inside it would put a location context around someone who has no clinical
 * role at any location.
 */
export default async function OwnerPage() {
  // Must be the first await: it throws notFound() for everyone else.
  await requirePlatformOwner();

  return (
    <main className="mx-auto max-w-3xl px-5 py-12 sm:px-6">
      <p className="text-sm font-semibold uppercase tracking-[0.14em] text-brand">
        Platform
      </p>
      <h1 className="mt-1 text-2xl font-semibold text-ink">Owner console</h1>
      <p className="mt-2 text-sm text-ink-secondary">
        Administrative authority for Doctor&apos;s Diary. You are signed in as a
        platform owner.
      </p>

      <section className="clinical-surface mt-6 rounded-glass-lg p-5">
        <h2 className="text-sm font-semibold text-ink">Decisions waiting for you</h2>
        <ul className="mt-3 grid gap-2 text-sm">
          <li>
            <Link href="/owner/claims" className="font-medium text-brand">
              Doctor professional verification
            </Link>
          </li>
          <li>
            <Link href="/owner/payments" className="font-medium text-brand">
              Manual subscription payments
            </Link>
          </li>
        </ul>
        <p className="mt-4 text-xs text-ink-muted">
          Both decide platform state only. Neither reaches a patient, a
          consultation or a prescription.
        </p>
      </section>

      <section className="clinical-surface mt-4 rounded-glass-lg p-5">
        <h2 className="text-sm font-semibold text-ink">
          What owning the platform does not include
        </h2>
        <p className="mt-3 text-sm text-ink-secondary">
          Platform ownership grants no access to any doctor&apos;s patients,
          consultations or prescriptions. That separation is enforced in the
          database, not here — no clinical policy references owner status, and a
          verification script fails if an owner can read a single clinical row.
        </p>
      </section>
    </main>
  );
}
