import type { Metadata } from "next";
import { requirePlatformOwner } from "@/features/owner/authority";
import { resolveCohort } from "@/features/owner/dashboard/catalog";
import { MetricSection } from "@/features/owner/dashboard/components/metric-section";
import { UsageTable } from "@/features/owner/dashboard/components/usage-table";
import { describeWindow, parsePeriod, periodWindow, todayIsoUtc } from "@/features/owner/dashboard/periods";
import { readPilotStatus, readServiceUsage } from "@/features/owner/dashboard/sources";

export const metadata: Metadata = { title: "AI Usage · Owner dashboard" };

/**
 * AI and Voice usage, at O1-F's published grain: provider, model, service kind
 * and unit.
 *
 * The Owner projection carries exactly ten columns, and this page shows the
 * ones that describe consumption. There is no operation, proposal or grant
 * identifier here, no prompt, completion, transcript or audio, no clinical task
 * text, no latency and no failure payload — none of those cross the boundary
 * into the Owner plane at all.
 */
export default async function OwnerDashboardAiUsagePage(props: PageProps<"/owner/dashboard/ai-usage">) {
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
      title="AI Usage"
      description="Consumption by provider, model, service and unit. Quantities are counted; a bucket with any unknown quantity is reported as not measured rather than summed."
      window={describeWindow(window)}
      specs={[]}
      measurements={{}}
    >
      <UsageTable result={usage} cohort={cohort} />
    </MetricSection>
  );
}
