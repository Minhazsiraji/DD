import * as React from "react";
import Link from "next/link";
import { Suspense } from "react";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { requirePlatformOwner } from "@/features/owner/authority";
import { DashboardTabs } from "@/features/owner/dashboard/components/dashboard-tabs";
import { PeriodFilter } from "@/features/owner/dashboard/components/period-filter";

/**
 * The Owner Dashboard shell — header, sections, period, and the standing
 * statement of what this surface can never show.
 *
 * AUTHORITY. `src/app/owner/layout.tsx` already guards every `/owner` route
 * (platform owner + AAL2). This layout asserts it again, first, and so does
 * every page beneath it: Next renders layouts and pages concurrently, so a
 * page cannot rely on a parent layout's guard having run before its own work
 * starts. Same pattern as the existing claims and payments pages — this adds
 * no authority of its own, it only refuses to begin without the existing one.
 *
 * Sits outside `(app)` with the rest of `/owner`: platform administration is
 * not clinical work, and the clinical shell's location context has no meaning
 * for someone with no clinical role at any location.
 */
export default async function OwnerDashboardLayout({ children }: { children: React.ReactNode }) {
  await requirePlatformOwner();

  return (
    <main className="mx-auto w-full min-w-0 max-w-[1400px] overflow-x-clip px-4 py-6 sm:px-6 sm:py-8">
      <Link
        href="/owner"
        className="inline-flex h-11 items-center gap-1.5 rounded-lg text-[13px] font-medium text-ink-secondary hover:text-ink focus-visible:focus-ring"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Owner console
      </Link>

      <header className="mt-1 flex min-w-0 flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-semibold tracking-[0.14em] text-brand uppercase">Platform · Pilot</p>
          <h1 className="mt-1 text-2xl font-semibold text-ink sm:text-[28px]">Owner dashboard</h1>
          <p className="mt-1 max-w-2xl text-sm text-ink-secondary">
            Doctors, adoption, usage and cost across the pilot — counts and
            totals only.
          </p>
        </div>
        <div className="w-full min-w-0 lg:w-auto">
          <Suspense fallback={null}>
            <PeriodFilter />
          </Suspense>
        </div>
      </header>

      <div className="mt-5">
        <Suspense fallback={null}>
          <DashboardTabs />
        </Suspense>
      </div>

      <div className="mt-5 min-w-0 space-y-4 sm:space-y-5">{children}</div>

      {/* The standing boundary statement. Present on every section, because a
          reader arriving on any tab must be able to see it. */}
      <p
        className="mt-8 flex items-start justify-center gap-2 text-center text-xs text-ink-muted"
        data-owner-privacy-statement
      >
        <ShieldCheck className="mt-px size-3.5 shrink-0" aria-hidden="true" />
        <span>
          This dashboard shows doctor-level usage and totals only. It never shows a
          patient name, diagnosis, prescription text, transcript, prompt or any
          clinical content — and platform ownership grants no clinical access.
        </span>
      </p>
    </main>
  );
}
