import type { Metadata } from "next";
import { HeartPulse } from "lucide-react";
import { requirePlatformOwner } from "@/features/owner/authority";
import { SectionCard, SectionHeader } from "@/components/common/section-card";
import { resolveCohort } from "@/features/owner/dashboard/catalog";
import { CohortStatusTable } from "@/features/owner/dashboard/components/cohort-status-table";
import { MetricSection } from "@/features/owner/dashboard/components/metric-section";
import { ParticipationTable } from "@/features/owner/dashboard/components/participation-table";
import { LIFECYCLE_LABEL, PARTICIPATION_LIFECYCLE } from "@/features/owner/dashboard/contract";
import { describeWindow, parsePeriod, periodWindow, todayIsoUtc } from "@/features/owner/dashboard/periods";
import { readCohortDetail, readPilotStatus } from "@/features/owner/dashboard/sources";

export const metadata: Metadata = { title: "Pilot Health · Owner dashboard" };

/**
 * Where each cohort stands, and where each participation stands inside it.
 *
 * LIFECYCLE AND ENGAGEMENT ARE DIFFERENT AXES, and conflating them is the
 * classic pilot-dashboard error. A doctor who enrolled in March and did nothing
 * this week is ENROLLED with no activity — not "inactive", not "paused" and
 * certainly not withdrawn. The four states below are the whole vocabulary.
 */
const LIFECYCLE_MEANING: Record<string, string> = {
  INVITED: "Invited to the pilot; not yet enrolled. No measurement is expected.",
  ENROLLED: "Participating. Measurement applies from the enrolment date onward.",
  COMPLETED: "Finished the pilot. Historic measurement remains readable.",
  WITHDRAWN: "Left the pilot. Measurement stops and existing figures become unavailable.",
};

export default async function OwnerDashboardPilotHealthPage(props: PageProps<"/owner/dashboard/pilot-health">) {
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
      title="Pilot Health"
      description="Enrolment lifecycle and consent coverage. Engagement is reported separately — being enrolled is not a claim about being active."
      window={describeWindow(window)}
      specs={[]}
      measurements={{}}
    >
      <CohortStatusTable result={status} />

      <SectionCard className="overflow-hidden" data-lifecycle-vocabulary>
        <SectionHeader title="Participation lifecycle" icon={<HeartPulse className="size-4" />} />
        <ul className="grid min-w-0 gap-3 p-4 sm:p-5 md:grid-cols-2">
          {PARTICIPATION_LIFECYCLE.map((state) => (
            <li key={state} className="dd-material-record dd-record-pearl min-w-0 rounded-glass p-3.5">
              <p className="text-[13px] font-semibold text-ink">{LIFECYCLE_LABEL[state]}</p>
              <p className="mt-1 text-xs text-ink-secondary">{LIFECYCLE_MEANING[state]}</p>
            </li>
          ))}
        </ul>
      </SectionCard>

      <ParticipationTable result={detail} cohort={cohort} />
    </MetricSection>
  );
}
