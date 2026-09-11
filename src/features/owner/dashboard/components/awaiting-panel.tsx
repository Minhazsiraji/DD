import * as React from "react";
import { Info } from "lucide-react";
import { SectionCard, SectionHeader } from "@/components/common/section-card";
import { LANE_LABEL, type SourceLane } from "../measurement";
import type { MetricSpec } from "../catalog";
import type { MeasurementMap } from "../sources";

/**
 * "Why is this empty?" — answered, per lane, instead of left to guesswork.
 *
 * Groups every not-measured metric on the page by the lane that owes its
 * source and says what it owes. When a lane delivers, its metrics become
 * measured and drop out of this panel on their own; when nothing is waiting,
 * the panel renders nothing at all.
 */
export function AwaitingPanel({
  specs,
  measurements,
}: {
  specs: readonly MetricSpec[];
  measurements: MeasurementMap;
}) {
  const byLane = new Map<SourceLane, { label: string; what: string }[]>();
  for (const spec of specs) {
    if (measurements[spec.key]?.state !== "not-measured") continue;
    const list = byLane.get(spec.awaiting.lane) ?? [];
    list.push({ label: spec.label, what: spec.awaiting.what });
    byLane.set(spec.awaiting.lane, list);
  }
  if (byLane.size === 0) return null;

  const lanes = (["F", "A", "E"] as const).filter((l) => byLane.has(l));

  return (
    <SectionCard className="overflow-hidden" data-awaiting-panel>
      <SectionHeader title="Not measured yet — and why" icon={<Info className="size-4" />} />
      <div className="space-y-4 px-4 py-4 sm:px-5">
        <p className="text-[13px] text-ink-secondary">
          These numbers have no approved source yet, so they are shown as{" "}
          <strong className="font-semibold text-ink">Not measured</strong> rather
          than as zero. A zero would be a claim; this is the absence of one.
        </p>
        <dl className="grid min-w-0 gap-4 md:grid-cols-3">
          {lanes.map((lane) => (
            <div key={lane} className="dd-material-record dd-record-pearl min-w-0 rounded-glass p-3.5">
              <dt className="text-[13px] font-semibold text-ink">{LANE_LABEL[lane]}</dt>
              <dd className="mt-2">
                <ul className="space-y-1.5">
                  {byLane.get(lane)!.map((m) => (
                    <li key={m.label} className="min-w-0 text-xs text-ink-secondary">
                      <span className="font-medium text-ink">{m.label}</span>
                      <span className="text-ink-muted"> — {m.what}</span>
                    </li>
                  ))}
                </ul>
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </SectionCard>
  );
}
