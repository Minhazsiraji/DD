import type { Metadata } from "next";
import { PageHeader } from "@/components/common/page-header";
import { AnalyticsDashboard } from "@/features/analytics/components/analytics-dashboard";
import {
  ANALYTICS_PERIODS,
  getDoctorAnalytics,
  type AnalyticsPeriod,
} from "@/features/analytics/doctor-analytics";

export const metadata: Metadata = { title: "Analytics" };

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const requested = typeof params.period === "string" ? params.period : "7";
  const candidate: AnalyticsPeriod = requested === "all" ? "all" : Number(requested) as AnalyticsPeriod;
  const period: AnalyticsPeriod = ANALYTICS_PERIODS.includes(candidate)
    ? candidate
    : 7;
  const requestedScope = typeof params.scope === "string" ? params.scope : "all";
  const outcome = await getDoctorAnalytics(period, requestedScope);

  return (
    <div className="min-w-0 space-y-5 sm:space-y-6">
      <PageHeader
        eyebrow="Practice activity"
        title={outcome.ok ? outcome.analytics.locationName : "Doctor Analytics"}
        subtitle="Privacy-safe clinical, workflow and practice-cost aggregates across your authorized chambers."
      />
      <AnalyticsDashboard outcome={outcome} selected={period} selectedScope={requestedScope} />
    </div>
  );
}
