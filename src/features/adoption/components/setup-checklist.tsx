import Link from "next/link";
import { CircleCheck, CircleDashed, CircleHelp, Loader, ChevronRight } from "lucide-react";
import { SectionCard, SectionHeader } from "@/components/common/section-card";
import { cn } from "@/lib/utils";
import type { SetupProgress, StepState } from "../progress";

/**
 * "Your Doctor's Diary setup".
 *
 * TONE IS A REQUIREMENT HERE, NOT A PREFERENCE. This is the screen that
 * decides whether the product feels like a colleague helping you get set up or
 * a SaaS funnel counting your sins. So: no red, no percentage shouted in a
 * ring, no "incomplete!" banner, no modal, and nothing that blocks a single
 * clinical action. A doctor who never opens this card must be able to run a
 * full clinic, and the card says so at the bottom.
 *
 * STATUS IS NEVER COLOUR ALONE (design system rule). Every row carries an icon
 * and a word.
 */

const STATE_ICON: Record<StepState, React.ReactNode> = {
  DONE: <CircleCheck className="size-4" />,
  PARTIAL: <Loader className="size-4" />,
  TODO: <CircleDashed className="size-4" />,
  UNKNOWN: <CircleHelp className="size-4" />,
};

const STATE_TONE: Record<StepState, string> = {
  DONE: "text-[#07684a]",
  PARTIAL: "text-[#8a3f07]",
  TODO: "text-ink-muted",
  UNKNOWN: "text-ink-muted",
};

const STATE_WORD: Record<StepState, string> = {
  DONE: "Done",
  PARTIAL: "Started",
  TODO: "Not yet",
  UNKNOWN: "Couldn't check",
};

export function SetupChecklist({ progress }: { progress: SetupProgress }) {
  const { steps, doneCount, total, nextStep, incomplete } = progress;

  return (
    <SectionCard className="overflow-hidden">
      <SectionHeader
        title="Your Doctor's Diary setup"
        icon={<CircleCheck className="size-4" />}
        action={
          <span className="text-xs font-semibold tabular-nums text-ink-secondary">
            {doneCount} of {total}
          </span>
        }
      />

      <ul className="divide-y divide-hairline">
        {steps.map((step) => (
          <li key={step.key}>
            <Link
              href={step.href}
              className="flex min-h-11 items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-muted focus-visible:focus-ring sm:px-5"
            >
              <span className={cn("shrink-0", STATE_TONE[step.state])} aria-hidden="true">
                {STATE_ICON[step.state]}
              </span>

              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-sm font-semibold text-ink">{step.title}</span>
                  <span className={cn("text-[11px] font-semibold", STATE_TONE[step.state])}>
                    {STATE_WORD[step.state]}
                  </span>
                </span>
                {/*
                  Evidence, not exhortation. "1 of 2 chambers" tells a doctor
                  what is actually missing; "Complete your setup!" tells them
                  they are behind on something they cannot see.
                */}
                <span className="mt-0.5 block truncate text-xs text-ink-secondary">
                  {step.evidence ?? step.help}
                </span>
              </span>

              <ChevronRight className="size-4 shrink-0 text-ink-muted" aria-hidden="true" />
            </Link>
          </li>
        ))}
      </ul>

      <div className="space-y-2 border-t border-hairline px-4 py-4 sm:px-5">
        {nextStep ? (
          <Link
            href={nextStep.href}
            className="inline-flex h-11 items-center gap-2 rounded-xl bg-brand px-4 text-sm font-semibold text-white transition-colors hover:bg-brand-hover focus-visible:focus-ring"
          >
            Continue setup
            <ChevronRight className="size-4" aria-hidden="true" />
          </Link>
        ) : (
          <p className="text-sm font-semibold text-[#07684a]">
            Everything is set up. Nothing here needs you.
          </p>
        )}

        {incomplete ? (
          <p className="text-xs text-ink-muted">
            One or more items could not be checked just now, so they are marked
            &ldquo;couldn&rsquo;t check&rdquo; rather than guessed at. Reload to try again.
          </p>
        ) : null}

        <p className="text-xs text-ink-muted">
          None of this is required to see patients. Registration, consultations
          and prescriptions work whether this list is finished or empty.
        </p>
      </div>
    </SectionCard>
  );
}
