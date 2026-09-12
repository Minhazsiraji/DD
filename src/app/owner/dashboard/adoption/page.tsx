import type { Metadata } from "next";
import { requirePlatformOwner } from "@/features/owner/authority";
import { ACTIVITY_TILES, ADOPTION_AWAITED, resolveCohort } from "@/features/owner/dashboard/catalog";
import { MetricSection } from "@/features/owner/dashboard/components/metric-section";
import { ParticipationTable } from "@/features/owner/dashboard/components/participation-table";
import { TimeSavedCard } from "@/features/owner/dashboard/components/time-saved-card";
import { describeWindow, parsePeriod, periodWindow, todayIsoUtc } from "@/features/owner/dashboard/periods";
import { readActivitySummary, readCohortDetail, readPilotStatus } from "@/features/owner/dashboard/sources";

export const metadata: Metadata = { title: "Adoption · Owner dashboard" };

/**
 * Adoption — active doctors, engaged minutes, sessions, active days and
 * feature touches, for the window the owner chose.
 *
 * NO EXTRAPOLATION. Every figure covers exactly the window shown in the header;
 * a partial period is never scaled up to a full one. DAU/WAU/MAU as a single
 * comparable series is not presented at all, because the approved surface
 * answers one window at a time and stitching three windows together here would
 * be D inventing a metric.
 */
export default async function OwnerDashboardAdoptionPage(props: PageProps<"/owner/dashboard/adoption">) {
  await requirePlatformOwner();

  const params = await props.searchParams;
  const period = parsePeriod(params);
  const window = periodWindow(period, todayIsoUtc());

  const [activity, status] = await Promise.all([readActivitySummary(window), readPilotStatus(window)]);
  const cohorts = status.state === "measured" ? status.cohorts.map((c) => c.cohortCode) : [];
  const cohort = resolveCohort(params, cohorts);
  const detail = cohort ? await readCohortDetail(cohort, window) : ({ state: "unavailable" } as const);

  return (
    <MetricSection
      title="Adoption"
      description="Engagement across the pilot for this window, then the same measures per participation."
      window={describeWindow(window)}
      specs={[...ACTIVITY_TILES, ...ADOPTION_AWAITED]}
      measurements={activity.state === "measured" ? activity.metrics : {}}
    >
      <TimeSavedCard
        view={{
          state: "not-measured",
          needs: "an approved manual baseline and the eligible-cohort median (O1D-4)",
        }}
      />
      <ParticipationTable result={detail} cohort={cohort} />
    </MetricSection>
  );
}
