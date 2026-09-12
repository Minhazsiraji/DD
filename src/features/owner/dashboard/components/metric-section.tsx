import * as React from "react";
import { MetricGrid } from "./metric-grid";
import type { MetricSpec } from "../catalog";
import type { MeasurementMap } from "../measurement";

/**
 * A titled block of tiles with the window it was measured over.
 *
 * The window is printed, not implied. "Sessions: 412" means nothing without
 * the dates it covers, and an owner comparing two tabs needs to see that both
 * are answering the same question.
 */
export function MetricSection({
  title,
  description,
  window: windowLabel,
  specs,
  measurements,
  columns,
  children,
}: {
  title: string;
  description?: string;
  window: string;
  specs: readonly MetricSpec[];
  measurements: MeasurementMap;
  columns?: 3 | 6;
  children?: React.ReactNode;
}) {
  return (
    <section className="min-w-0 space-y-4" aria-label={title}>
      <header className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-lg font-semibold text-ink sm:text-xl">{title}</h1>
          <p className="text-xs text-ink-muted tabular-nums">{windowLabel}</p>
        </div>
        {description ? <p className="mt-1 max-w-2xl text-sm text-ink-secondary">{description}</p> : null}
      </header>

      {specs.length > 0 ? (
        <MetricGrid specs={specs} measurements={measurements} columns={columns} label={title} />
      ) : null}

      {children}
    </section>
  );
}
