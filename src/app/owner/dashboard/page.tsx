import type { Metadata } from "next";
import { requirePlatformOwner } from "@/features/owner/authority";
import { OVERVIEW_CARDS } from "@/features/owner/dashboard/catalog";
import { MetricSection } from "@/features/owner/dashboard/components/metric-section";
import { parsePeriod } from "@/features/owner/dashboard/periods";
import { readOverview } from "@/features/owner/dashboard/sources";

export const metadata: Metadata = { title: "Owner dashboard" };

/** Overview — the ten top-level cards. */
export default async function OwnerDashboardOverviewPage(props: PageProps<"/owner/dashboard">) {
  // First await, before any read: the owner + AAL2 boundary.
  await requirePlatformOwner();

  const period = parsePeriod(await props.searchParams);
  const measurements = await readOverview(period);

  return (
    <MetricSection
      title="Overview"
      description="The pilot at a glance. Each number comes from an approved aggregate source — until one exists, the tile says so instead of showing zero."
      period={period}
      specs={OVERVIEW_CARDS}
      measurements={measurements}
      columns={5}
    />
  );
}
