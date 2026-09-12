import * as React from "react";
import { CircleSlash, CloudOff, EyeOff, Hash } from "lucide-react";
import { INSUFFICIENT_COHORT, NOT_MEASURED, UNAVAILABLE } from "../measurement";

/**
 * The four readings, stated once, in the shell.
 *
 * An owner console is read for decisions, and three of these four look like
 * "nothing" at a glance while meaning entirely different things. Spelling them
 * out in the chrome — rather than in a tooltip nobody opens — is what makes the
 * rest of the dashboard safe to read quickly.
 */
const STATES = [
  { icon: Hash, term: "0", meaning: "Measured, and the answer was none." },
  { icon: CircleSlash, term: NOT_MEASURED, meaning: "Coverage is absent or incomplete for this window." },
  { icon: CloudOff, term: UNAVAILABLE, meaning: "The approved source or authority did not answer." },
  { icon: EyeOff, term: INSUFFICIENT_COHORT, meaning: "Withheld: too few doctors to report without identifying one." },
];

export function TruthLegend() {
  return (
    <details className="dd-material-panel min-w-0 rounded-glass" data-truth-legend>
      <summary className="flex min-h-11 cursor-pointer list-none items-center px-3 text-xs font-semibold text-ink-secondary focus-visible:focus-ring">
        How to read a value that is not a number
      </summary>
      <dl className="grid min-w-0 gap-2 px-3 pb-3 sm:grid-cols-2">
        {STATES.map(({ icon: Icon, term, meaning }) => (
          <div key={term} className="dd-material-record dd-record-pearl flex min-w-0 items-start gap-2 rounded-glass p-2.5">
            <Icon className="mt-0.5 size-3.5 shrink-0 text-ink-muted" aria-hidden="true" />
            <div className="min-w-0">
              <dt className="text-xs font-semibold text-ink">{term}</dt>
              <dd className="text-xs text-ink-secondary">{meaning}</dd>
            </div>
          </div>
        ))}
      </dl>
    </details>
  );
}
