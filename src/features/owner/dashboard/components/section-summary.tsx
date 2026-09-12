import * as React from "react";
import Link from "next/link";
import { ArrowRight, CircleSlash, CloudOff, EyeOff, Hash } from "lucide-react";
import { GlassCard } from "@/components/glass/glass-card";
import { INSUFFICIENT_COHORT, NOT_MEASURED, UNAVAILABLE, type MeasurementState } from "../measurement";

/**
 * A one-line reading of a whole section, for the overview.
 *
 * The executive view of a pilot is mostly "is this being measured at all?" —
 * so each card answers that in the same four words the tiles use, and links to
 * the tab where the detail lives. It never summarises an absent section as a
 * number, and never as "0".
 */
const WORD: Record<MeasurementState, string> = {
  measured: "Measured",
  "not-measured": NOT_MEASURED,
  unavailable: UNAVAILABLE,
  "insufficient-cohort": INSUFFICIENT_COHORT,
};

const ICON = {
  measured: Hash,
  "not-measured": CircleSlash,
  unavailable: CloudOff,
  "insufficient-cohort": EyeOff,
} as const;

export function SectionSummary({
  title,
  state,
  detail,
  href,
}: {
  title: string;
  state: MeasurementState;
  detail: string;
  href: string;
}) {
  const Icon = ICON[state];
  return (
    <GlassCard className="dd-dashboard-card min-w-0 p-0" data-section-summary={title} data-state={state}>
      <Link
        href={href}
        className="flex min-h-11 min-w-0 items-start gap-3 rounded-glass p-4 focus-visible:focus-ring sm:p-5"
      >
        <Icon className="mt-0.5 size-4 shrink-0 text-ink-muted" aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-ink">{title}</span>
          <span className="mt-0.5 block text-xs font-semibold text-ink-secondary">{WORD[state]}</span>
          <span className="mt-1 block text-xs text-ink-muted">{detail}</span>
        </span>
        <ArrowRight className="mt-0.5 size-4 shrink-0 text-ink-muted" aria-hidden="true" />
      </Link>
    </GlassCard>
  );
}
