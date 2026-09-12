import type { Metadata } from "next";
import { requirePlatformOwner } from "@/features/owner/authority";
import { resolveCohort } from "@/features/owner/dashboard/catalog";
import { MetricSection } from "@/features/owner/dashboard/components/metric-section";
import { ParticipationTable } from "@/features/owner/dashboard/components/participation-table";
import { describeWindow, parsePeriod, periodWindow, todayIsoUtc } from "@/features/owner/dashboard/periods";
import { readCohortDetail, readPilotStatus } from "@/features/owner/dashboard/sources";

export const metadata: Metadata = { title: "Doctors · Owner dashboard" };

/**
 * Doctors, seen only as pilot participations.
 *
 * THERE IS NO DOCTOR SELECTOR HERE, and there is not meant to be one. The page
 * reads a whole cohort through `owner_pilot_cohort_detail` — the consent-gated
 * surface O1-F publishes for exactly this purpose — so no doctor-shaped
 * identifier is ever accepted from the URL and no arbitrary subject can be
 * probed. The cohort itself is validated against the list F returned.
 *
 * WITHDRAWAL TAKES EFFECT AT THE SOURCE. When a participation is withdrawn or
 * its consent lapses, F returns `UNAVAILABLE` for that row and the metrics
 * disappear. Nothing is cached here to outlive that: the page is
 * request-scoped, reads the owner's own session, and stores nothing.
 */
export default async function OwnerDashboardDoctorsPage(props: PageProps<"/owner/dashboard/doctors">) {
  await requirePlatformOwner();

  const params = await props.searchParams;
  const period = parsePeriod(params);
  const window = periodWindow(period, todayIsoUtc());

  const status = await readPilotStatus(window);
  const cohorts = status.state === "measured" ? status.cohorts.map((c) => c.cohortCode) : [];
  const cohort = resolveCohort(params, cohorts);

  const detail = cohort ? await readCohortDetail(cohort, window) : ({ state: "unavailable" } as const);

  return (
    <MetricSection
      title="Doctors"
      description="One row per pilot participation. Identity, usage and measurement state only — no clinical record of any kind is reachable from this page."
      window={describeWindow(window)}
      specs={[]}
      measurements={{}}
    >
      <ParticipationTable result={detail} cohort={cohort} />
    </MetricSection>
  );
}
