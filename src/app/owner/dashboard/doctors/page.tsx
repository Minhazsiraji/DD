import type { Metadata } from "next";
import { requirePlatformOwner } from "@/features/owner/authority";
import { DoctorTable } from "@/features/owner/dashboard/components/doctor-table";
import { describePeriod, parsePeriod } from "@/features/owner/dashboard/periods";
import { readDoctorRows } from "@/features/owner/dashboard/sources";

export const metadata: Metadata = { title: "Doctors · Owner dashboard" };

/**
 * Doctors — per-doctor usage.
 *
 * Doctor identity and usage counts only. A row links to nothing clinical; the
 * owner's drill-down is usage and cost, never a doctor's patients.
 */
export default async function OwnerDashboardDoctorsPage(props: PageProps<"/owner/dashboard/doctors">) {
  await requirePlatformOwner();

  const period = parsePeriod(await props.searchParams);
  const result = await readDoctorRows(period);

  return (
    <section aria-labelledby="dashboard-section-title" className="min-w-0 space-y-4 sm:space-y-5">
      <div className="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
        <h2 id="dashboard-section-title" className="text-lg font-semibold text-ink">
          Doctors
        </h2>
        <p className="text-xs text-ink-muted">Period: {describePeriod(period)}</p>
      </div>
      <p className="-mt-2 max-w-3xl text-sm text-ink-secondary">
        Activity, usage and cost for each doctor in the pilot. Usage and cost
        drill-down only — this view never reaches a doctor&apos;s patients or
        records.
      </p>
      <DoctorTable result={result} />
    </section>
  );
}
