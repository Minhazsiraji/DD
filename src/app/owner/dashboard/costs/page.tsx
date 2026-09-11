import type { Metadata } from "next";
import { requirePlatformOwner } from "@/features/owner/authority";
import { COST_METRICS } from "@/features/owner/dashboard/catalog";
import { MetricSection } from "@/features/owner/dashboard/components/metric-section";
import { parsePeriod } from "@/features/owner/dashboard/periods";
import { readCosts } from "@/features/owner/dashboard/sources";

export const metadata: Metadata = { title: "Costs · Owner dashboard" };

export default async function OwnerDashboardCostsPage(props: PageProps<"/owner/dashboard/costs">) {
  // First await, before any read: the owner + AAL2 boundary.
  await requirePlatformOwner();

  const period = parsePeriod(await props.searchParams);
  const measurements = await readCosts(period);

  return (
    <MetricSection
      title="Costs"
      description="Variable AI and voice cost, fixed platform cost, and the operating total. Each figure will state whether it is actual, estimated or a manual adjustment."
      period={period}
      specs={COST_METRICS}
      measurements={measurements}
    />
  );
}
