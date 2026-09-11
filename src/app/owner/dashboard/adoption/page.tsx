import type { Metadata } from "next";
import { requirePlatformOwner } from "@/features/owner/authority";
import { ADOPTION_METRICS } from "@/features/owner/dashboard/catalog";
import { MetricSection } from "@/features/owner/dashboard/components/metric-section";
import { parsePeriod } from "@/features/owner/dashboard/periods";
import { readAdoption } from "@/features/owner/dashboard/sources";

export const metadata: Metadata = { title: "Adoption · Owner dashboard" };

export default async function OwnerDashboardAdoptionPage(props: PageProps<"/owner/dashboard/adoption">) {
  // First await, before any read: the owner + AAL2 boundary.
  await requirePlatformOwner();

  const period = parsePeriod(await props.searchParams);
  const measurements = await readAdoption(period);

  return (
    <MetricSection
      title="Adoption"
      description="How far doctors have taken the product up — from registering, to verification, to their first consultation."
      period={period}
      specs={ADOPTION_METRICS}
      measurements={measurements}
    />
  );
}
