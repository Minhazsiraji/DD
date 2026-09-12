import * as React from "react";
import { CircleSlash, CloudOff, EyeOff, Flag } from "lucide-react";
import { SectionCard, SectionHeader } from "@/components/common/section-card";
import { PILOT_STATUS_TILES } from "../catalog";
import { formatMeasurement, type Measurement } from "../measurement";
import type { PilotStatusResult } from "../sources";

/**
 * Pilot lifecycle by cohort — invited, enrolled, completed, withdrawn,
 * consented, and how many were active in the window.
 *
 * ONE ROW PER COHORT, NEVER A GRAND TOTAL. A doctor can belong to more than
 * one cohort, so adding the columns up would count them twice and present the
 * result as a platform figure. Where a platform-wide number is genuinely
 * available, O1-F publishes it separately (`owner_activity_summary`) and the
 * dashboard uses that instead of doing arithmetic of its own.
 *
 * LIFECYCLE IS NOT ENGAGEMENT. These five counters describe enrolment state.
 * An enrolled doctor who did nothing this week is still enrolled — the active
 * count is a separate column, and neither is derived from the other here.
 */
function Cell({ m }: { m: Measurement }) {
  const f = formatMeasurement(m, "COUNT");
  if (f.kind === "value") return <span className="tabular-nums">{f.display}</span>;
  const Icon = m.state === "insufficient-cohort" ? EyeOff : m.state === "not-measured" ? CircleSlash : CloudOff;
  return (
    <span className="inline-flex items-center gap-1 text-xs text-ink-muted">
      <Icon className="size-3 shrink-0" aria-hidden="true" />
      <span className="sr-only">{f.spoken}</span>
      <span aria-hidden="true">{f.display}</span>
    </span>
  );
}

export function CohortStatusTable({ result }: { result: PilotStatusResult }) {
  if (result.state !== "measured") {
    return (
      <SectionCard className="overflow-hidden" data-cohort-status-table data-cohort-status-state="unavailable">
        <SectionHeader title="Pilot cohorts" icon={<Flag className="size-4" />} />
        <div className="flex min-w-0 items-start gap-3 px-4 py-5 sm:px-5">
          <CloudOff className="mt-0.5 size-5 shrink-0 text-ink-muted" aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-ink">Cohort status unavailable</p>
            <p className="mt-1 text-[13px] text-ink-secondary">
              The approved owner pilot-status surface did not answer. This is not the same as “no
              cohorts” and not the same as “nobody enrolled”.
            </p>
          </div>
        </div>
      </SectionCard>
    );
  }

  if (result.cohorts.length === 0) {
    return (
      <SectionCard className="overflow-hidden" data-cohort-status-table data-cohort-status-state="empty">
        <SectionHeader title="Pilot cohorts" icon={<Flag className="size-4" />} />
        <p className="px-4 py-6 text-sm text-ink-secondary sm:px-5">
          The approved source answered and reported no cohorts.
        </p>
      </SectionCard>
    );
  }

  return (
    <SectionCard className="overflow-hidden" data-cohort-status-table data-cohort-status-state="measured">
      <SectionHeader title="Pilot cohorts" icon={<Flag className="size-4" />} count={result.cohorts.length} />

      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-left text-[13px]">
          <thead className="bg-white/85">
            <tr className="border-b border-hairline">
              <th scope="col" className="px-3 py-2.5 pl-5 font-semibold whitespace-nowrap text-ink-secondary">
                Cohort
              </th>
              {PILOT_STATUS_TILES.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  className="px-3 py-2.5 font-semibold whitespace-nowrap text-ink-secondary last:pr-5"
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline">
            {result.cohorts.map((cohort) => (
              <tr key={cohort.cohortCode}>
                <th scope="row" className="px-3 py-2.5 pl-5 font-semibold whitespace-nowrap text-ink">
                  {cohort.cohortCode}
                </th>
                {PILOT_STATUS_TILES.map((c) => (
                  <td key={c.key} className="px-3 py-2.5 whitespace-nowrap text-ink last:pr-5">
                    <Cell m={cohort.counts[c.key as keyof typeof cohort.counts]} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </SectionCard>
  );
}
