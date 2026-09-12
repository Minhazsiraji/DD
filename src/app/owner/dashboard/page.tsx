import type { Metadata } from "next";
import { requirePlatformOwner } from "@/features/owner/authority";
import { ACTIVITY_TILES, dashboardQuery, resolveCohort, tabHref } from "@/features/owner/dashboard/catalog";
import { CohortStatusTable } from "@/features/owner/dashboard/components/cohort-status-table";
import { MetricSection } from "@/features/owner/dashboard/components/metric-section";
import { SectionSummary } from "@/features/owner/dashboard/components/section-summary";
import type { MeasurementState } from "@/features/owner/dashboard/measurement";
import { describeWindow, parsePeriod, periodWindow, todayIsoUtc } from "@/features/owner/dashboard/periods";
import { readActivitySummary, readPilotStatus, readServiceUsage } from "@/features/owner/dashboard/sources";

export const metadata: Metadata = { title: "Overview · Owner dashboard" };

/**
 * The calm executive view: what the pilot did in this window, cohort by cohort,
 * plus a one-line reading of every other section.
 *
 * No number on this page is computed here. Platform activity comes from
 * `owner_activity_summary`; lifecycle counters come from `owner_pilot_status`,
 * one row per cohort and never summed across cohorts — a doctor in two cohorts
 * would be counted twice, and a wrong total that looks official is worse than
 * no total.
 */
export default async function OwnerDashboardPage(props: PageProps<"/owner/dashboard">) {
  await requirePlatformOwner();

  const params = await props.searchParams;
  const period = parsePeriod(params);
  const window = periodWindow(period, todayIsoUtc());

  const [activity, status] = await Promise.all([readActivitySummary(window), readPilotStatus(window)]);

  const cohorts = status.state === "measured" ? status.cohorts.map((c) => c.cohortCode) : [];
  const cohort = resolveCohort(params, cohorts);
  const usage = cohort ? await readServiceUsage(cohort, window) : null;
  const query = dashboardQuery(period, cohort);

  const usageState: MeasurementState =
    usage === null || usage.state !== "measured"
      ? "unavailable"
      : usage.usage.status === "OK"
        ? "measured"
        : usage.usage.status === "NOT_MEASURED"
          ? "not-measured"
          : usage.usage.status === "INSUFFICIENT_COHORT"
            ? "insufficient-cohort"
            : "unavailable";

  return (
    <MetricSection
      title="Overview"
      description="Platform-wide engagement for the selected window, then each cohort's enrolment state."
      window={describeWindow(window)}
      specs={ACTIVITY_TILES}
      measurements={activity.state === "measured" ? activity.metrics : {}}
    >
      <CohortStatusTable result={status} />

      <ul className="grid min-w-0 grid-cols-1 gap-3 [&>*]:min-w-0 min-[480px]:grid-cols-2 sm:gap-4 lg:grid-cols-4">
        <li className="min-w-0">
          <SectionSummary
            title="AI & Voice usage"
            state={usageState}
            detail={cohort ? `Cohort ${cohort}` : "No cohort available"}
            href={`${tabHref("ai-usage")}?${query}`}
          />
        </li>
        <li className="min-w-0">
          <SectionSummary
            title="Cost"
            state={usageState}
            detail="Provider and model totals, exact currency"
            href={`${tabHref("costs")}?${query}`}
          />
        </li>
        <li className="min-w-0">
          <SectionSummary
            title="Pilot health"
            state={status.state === "measured" ? "measured" : "unavailable"}
            detail="Lifecycle and consent coverage"
            href={`${tabHref("pilot-health")}?${query}`}
          />
        </li>
        <li className="min-w-0">
          <SectionSummary
            title="Security"
            state="not-measured"
            detail="Posture is enforced; counters are not yet published"
            href={`${tabHref("security")}?${query}`}
          />
        </li>
      </ul>
    </MetricSection>
  );
}
