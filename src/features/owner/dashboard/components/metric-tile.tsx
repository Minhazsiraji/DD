import * as React from "react";
import { CircleSlash, CloudOff, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { GlassCard } from "@/components/glass/glass-card";
import { IconOrb, type OrbAccent } from "@/components/common/icon-orb";
import { formatMeasurement, LANE_LABEL, type Measurement } from "../measurement";
import type { MetricSpec } from "../catalog";

/**
 * One dashboard number — or an honest statement of which kind of nothing it is.
 *
 * Visually the same object as `StatCard` (same `GlassCard`, same
 * `dd-dashboard-card` material, same `IconOrb`), so a measured tile and the
 * doctor dashboard's tiles read as one system. `StatCard` itself is not reused
 * because it prints `value` at 28–32px bold: right for a numeral, wrong for the
 * words "Insufficient cohort", which must read as a state and not as a headline.
 *
 * FOUR STATES, FOUR SETS OF WORDS. Absence never renders as a digit, the three
 * absent states never render as each other, and none of them is distinguished
 * by colour alone — each carries its own icon and its own sentence.
 */

const ABSENT_ICON = {
  "not-measured": CircleSlash,
  unavailable: CloudOff,
  "insufficient-cohort": EyeOff,
} as const;

function footnote(m: Measurement): string {
  switch (m.state) {
    case "measured":
      return "Measured for this window";
    case "not-measured":
      return `Coverage incomplete — ${LANE_LABEL[m.lane]}`;
    case "unavailable":
      return "Source did not answer — not a zero";
    case "insufficient-cohort":
      return "Withheld: too few doctors to report (k=5)";
  }
}

export function MetricTile({
  spec,
  measurement,
  icon,
  accent = "brand",
}: {
  spec: MetricSpec;
  measurement: Measurement;
  icon: React.ReactNode;
  accent?: OrbAccent;
}) {
  const f = formatMeasurement(measurement, spec.unit);
  const absent = f.kind === "absent";
  const AbsentIcon = measurement.state === "measured" ? null : ABSENT_ICON[measurement.state];

  return (
    <GlassCard
      data-metric={spec.key}
      data-state={measurement.state}
      className="dd-dashboard-card w-full min-w-0 p-4 sm:p-5"
    >
      <div className="flex min-w-0 items-start justify-between gap-3">
        <IconOrb accent={absent ? "info" : accent} size="lg">
          {icon}
        </IconOrb>

        {absent && AbsentIcon ? (
          <span
            className="inline-flex min-w-0 items-center gap-1.5 rounded-full bg-surface-muted px-2.5 py-1 text-xs font-semibold text-ink-secondary ring-1 ring-hairline ring-inset"
            aria-hidden="true"
          >
            <AbsentIcon className="size-3.5 shrink-0" />
            <span className="truncate">{f.display}</span>
          </span>
        ) : (
          <span
            className="min-w-0 truncate text-[28px] leading-none font-bold text-ink tabular-nums sm:text-[32px]"
            aria-hidden="true"
          >
            {f.display}
          </span>
        )}
      </div>

      <div className="mt-4 min-w-0">
        <p className="text-sm font-semibold text-ink">{spec.label}</p>
        {/* The full sentence for assistive tech — never just "Not measured". */}
        <p className="sr-only">{`${spec.label}: ${f.spoken}`}</p>
        <p className={cn("mt-0.5 text-xs", absent ? "text-ink-muted" : "text-ink-secondary")}>{footnote(measurement)}</p>
        {spec.awaiting && measurement.state !== "measured" ? (
          <p className="mt-1 text-xs text-ink-muted">Needs: {spec.awaiting.what}</p>
        ) : null}
      </div>
    </GlassCard>
  );
}
