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
  const requested = Number(typeof params.period === "string" ? params.period : "7");
  const period: AnalyticsPeriod = ANALYTICS_PERIODS.includes(requested as AnalyticsPeriod)
    ? (requested as AnalyticsPeriod)
    : 7;
  const outcome = await getDoctorAnalytics(period);

  return (
    <div className="min-w-0 space-y-5 sm:space-y-6">
      <PageHeader
        eyebrow="Practice activity"
        title={outcome.ok ? outcome.analytics.locationName : "Doctor Analytics"}
        subtitle="Privacy-safe clinical and workflow aggregates for your active chamber."
      />
      <AnalyticsDashboard outcome={outcome} selected={period} />
    </div>
  );
}
