import * as React from "react";
import { MetricGrid } from "./metric-grid";
import { AwaitingPanel } from "./awaiting-panel";
import type { MetricSpec } from "../catalog";
import type { MeasurementMap } from "../sources";
import { describePeriod, type Period } from "../periods";

/**
 * One dashboard section: a heading, the metric grid, and — only while anything
 * is unmeasured — the panel saying what each missing number is waiting on.
 *
 * Every metric tab renders through this so the five sections cannot drift in
 * how they present absence.
 */
export function MetricSection({
  title,
  description,
  period,
  specs,
  measurements,
  columns = 3,
  children,
}: {
  title: string;
  description: string;
  period: Period;
  specs: readonly MetricSpec[];
  measurements: MeasurementMap;
  columns?: 3 | 5;
  children?: React.ReactNode;
}) {
  return (
    <section aria-labelledby="dashboard-section-title" className="min-w-0 space-y-4 sm:space-y-5">
      <div className="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
        <h2 id="dashboard-section-title" className="text-lg font-semibold text-ink">
          {title}
        </h2>
        <p className="text-xs text-ink-muted">Period: {describePeriod(period)}</p>
      </div>
      <p className="-mt-2 max-w-3xl text-sm text-ink-secondary">{description}</p>

      <MetricGrid specs={specs} measurements={measurements} columns={columns} label={title} />
      {children}
      <AwaitingPanel specs={specs} measurements={measurements} />
    </section>
  );
}
