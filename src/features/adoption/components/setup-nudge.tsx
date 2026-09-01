import Link from "next/link";
import { ChevronRight, Sparkles } from "lucide-react";
import type { SetupProgress } from "../progress";

/**
 * ONE line, ONE next step, on the dashboard.
 *
 * The brief for this component was mostly a list of things not to be: not a
 * modal, not a banner that reappears, not a progress ring, not a countdown.
 * What is left is a sentence naming the single most useful next thing and a
 * link to it — the shape a colleague would use, not a funnel.
 *
 * It renders nothing at all once there is no next step, and nothing when the
 * doctor is close to finished, because the last item on a checklist is almost
 * always the one they were going to do anyway.
 */
export function SetupNudge({ progress }: { progress: SetupProgress }) {
  const { nextStep, doneCount, total } = progress;
  if (!nextStep) return null;

  /*
   * Silence near the end. A doctor at 9 of 10 does not need chasing, and a
   * prompt that survives to the last item reads as nagging rather than help.
   */
  if (total - doneCount <= 1) return null;

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 rounded-glass-lg border border-hairline bg-brand-soft/50 px-4 py-3">
      <Sparkles className="size-4 shrink-0 text-brand" aria-hidden="true" />
      <p className="min-w-0 flex-1 text-sm text-ink">
        <span className="font-semibold">{nextStep.title}</span>
        <span className="text-ink-secondary"> — {nextStep.help}</span>
      </p>
      <Link
        href={nextStep.href}
        className="inline-flex h-9 shrink-0 items-center gap-1 rounded-lg bg-white px-3 text-xs font-semibold text-brand ring-1 ring-hairline ring-inset transition-colors hover:bg-surface-muted focus-visible:focus-ring"
      >
        Set up
        <ChevronRight className="size-3.5" aria-hidden="true" />
      </Link>
      <Link
        href="/settings/setup"
        className="shrink-0 text-xs font-medium text-ink-secondary underline underline-offset-2"
      >
        All {total} steps
      </Link>
    </div>
  );
}
