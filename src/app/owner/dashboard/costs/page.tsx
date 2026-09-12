import type { Metadata } from "next";
import { requirePlatformOwner } from "@/features/owner/authority";
import { resolveCohort } from "@/features/owner/dashboard/catalog";
import { CostTable } from "@/features/owner/dashboard/components/cost-table";
import { MetricSection } from "@/features/owner/dashboard/components/metric-section";
import { describeWindow, parsePeriod, periodWindow, todayIsoUtc } from "@/features/owner/dashboard/periods";
import { readPilotStatus, readServiceUsage } from "@/features/owner/dashboard/sources";

export const metadata: Metadata = { title: "Costs · Owner dashboard" };

/**
 * What the pilot cost.
 *
 * Cost arrives from O1-F as an exact fixed-point decimal in minor units with
 * the currency it was incurred in. Nothing here applies a provider rate, a
 * conversion or an assumed currency: a rate table in the UI would be a second
 * source of truth for money, and the first one to drift.
 */
export default async function OwnerDashboardCostsPage(props: PageProps<"/owner/dashboard/costs">) {
  await requirePlatformOwner();

  const params = await props.searchParams;
  const period = parsePeriod(params);
  const window = periodWindow(period, todayIsoUtc());

  const status = await readPilotStatus(window);
  const cohorts = status.state === "measured" ? status.cohorts.map((c) => c.cohortCode) : [];
  const cohort = resolveCohort(params, cohorts);
  const usage = cohort ? await readServiceUsage(cohort, window) : ({ state: "unavailable" } as const);

  return (
    <MetricSection
      title="Costs"
      description="Spend by provider and model, in the currency the source reported. A total is published only when every contributing bucket is known — one unknown and the total reads “Not measured”."
      window={describeWindow(window)}
      specs={[]}
      measurements={{}}
    >
      <CostTable result={usage} cohort={cohort} />
    </MetricSection>
  );
}
