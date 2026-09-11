import type { Metadata } from "next";
import { requirePlatformOwner } from "@/features/owner/authority";
import { PILOT_HEALTH_METRICS } from "@/features/owner/dashboard/catalog";
import { MetricSection } from "@/features/owner/dashboard/components/metric-section";
import { parsePeriod } from "@/features/owner/dashboard/periods";
import { readPilotHealth } from "@/features/owner/dashboard/sources";

export const metadata: Metadata = { title: "Pilot Health · Owner dashboard" };

export default async function OwnerDashboardPilotHealthPage(props: PageProps<"/owner/dashboard/pilot-health">) {
  // First await, before any read: the owner + AAL2 boundary.
  await requirePlatformOwner();

  const period = parsePeriod(await props.searchParams);
  const measurements = await readPilotHealth(period);

  return (
    <MetricSection
      title="Pilot Health"
      description="Where the pilot is straining — abandoned consultations, corrections, no-shows and AI provider failures."
      period={period}
      specs={PILOT_HEALTH_METRICS}
      measurements={measurements}
    />
  );
}
