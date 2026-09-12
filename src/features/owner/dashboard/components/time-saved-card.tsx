import * as React from "react";
import { CircleSlash, Timer, TrendingDown, TrendingUp } from "lucide-react";
import { SectionCard, SectionHeader } from "@/components/common/section-card";
import { CONFIDENCE_LABEL, formatSignedMinutes, type TimeSavedConfidence } from "../contract";

/**
 * Estimated time saved — signed, and never dressed up.
 *
 * TWO RULES INHERITED FROM O1-A, both visible here:
 *
 *   THE SIGN SURVIVES. A negative estimate means DD was SLOWER than the
 *   doctor's manual workflow. That is the single most useful thing a pilot can
 *   learn, and it is stated plainly rather than clamped to zero or hidden.
 *
 *   THE LADDER IS HIGH / MEDIUM / LOW / NOT_MEASURED. There is no STANDARD
 *   tier. Confidence comes from the baseline O1-A holds, not from how much DD
 *   usage was measured, so a large sample never promotes a thin baseline.
 *
 * D does not compute any of this. When no approved estimate exists, the card
 * says what is missing instead of showing a plausible-looking number.
 */
export type TimeSavedView =
  | { state: "estimated"; minutes: number; confidence: Exclude<TimeSavedConfidence, "NOT_MEASURED"> }
  | { state: "not-measured"; needs: string };

export function TimeSavedCard({ view }: { view: TimeSavedView }) {
  const slower = view.state === "estimated" && view.minutes < 0;
  const Icon = view.state !== "estimated" ? CircleSlash : slower ? TrendingDown : TrendingUp;

  return (
    <SectionCard className="overflow-hidden" data-time-saved data-state={view.state}>
      <SectionHeader title="Estimated time saved" icon={<Timer className="size-4" />} />
      <div className="flex min-w-0 items-start gap-3 px-4 py-5 sm:px-5">
        <Icon className="mt-0.5 size-5 shrink-0 text-ink-muted" aria-hidden="true" />
        <div className="min-w-0">
          {view.state === "estimated" ? (
            <>
              <p className="text-2xl font-bold text-ink tabular-nums" data-time-saved-value>
                {formatSignedMinutes(view.minutes)}
              </p>
              <p className="mt-1 text-[13px] text-ink-secondary">
                {CONFIDENCE_LABEL[view.confidence]}.{" "}
                {slower
                  ? "Negative: the measured DD workflow took longer than the manual baseline."
                  : "Positive: the measured DD workflow was faster than the manual baseline."}
              </p>
            </>
          ) : (
            <>
              <p className="text-sm font-semibold text-ink">{CONFIDENCE_LABEL.NOT_MEASURED}</p>
              <p className="mt-1 text-[13px] text-ink-secondary">
                No approved estimate exists for this window. Needs: {view.needs}. This is not
                “no time saved”.
              </p>
            </>
          )}
        </div>
      </div>
    </SectionCard>
  );
}
