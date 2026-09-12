"use client";

import * as React from "react";
import { CloudOff } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { COHORT_PARAM, resolveCohort } from "../catalog";

/**
 * Which pilot cohort the cohort-scoped tabs are reporting on.
 *
 * THIS IS NOT A DOCTOR SELECTOR. The only identifier the dashboard's URL may
 * carry is a cohort code, and the options are exactly the cohort codes O1-F
 * returned for this owner — there is no free-text field, no id parameter and
 * no way to ask the database about a subject it did not first offer.
 *
 * When F cannot answer at all the control says so rather than disappearing:
 * an empty selector would read as "there are no cohorts".
 */
export function CohortFilter({ cohorts }: { cohorts: readonly string[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = React.useTransition();

  /**
   * The same pure resolver the pages use, so the highlighted chip is always
   * the cohort the server actually reported on — including the fall back to
   * the first cohort when the URL names one F did not publish.
   */
  const selected = resolveCohort(Object.fromEntries(params.entries()), cohorts);

  if (cohorts.length === 0) {
    return (
      <p className="inline-flex min-h-11 items-center gap-1.5 text-xs text-ink-muted" data-cohort-filter="unavailable">
        <CloudOff className="size-3.5 shrink-0" aria-hidden="true" />
        Cohort list unavailable — this is not “no cohorts”.
      </p>
    );
  }

  function choose(code: string) {
    const next = new URLSearchParams(params.toString());
    next.set(COHORT_PARAM, code);
    startTransition(() => router.replace(`${pathname}?${next.toString()}`));
  }

  return (
    <div
      role="group"
      aria-label="Pilot cohort"
      aria-busy={pending}
      data-cohort-filter="available"
      className="flex w-full min-w-0 flex-wrap gap-1.5"
    >
      {cohorts.map((code) => {
        const active = code === selected;
        return (
          <button
            key={code}
            type="button"
            onClick={() => choose(code)}
            aria-pressed={active}
            className={cn(
              "inline-flex h-11 min-w-0 items-center justify-center rounded-xl px-3 text-sm font-semibold transition-colors focus-visible:focus-ring",
              active ? "dd-material-record dd-record-pearl text-ink" : "text-ink-secondary hover:bg-white/30 hover:text-ink",
            )}
          >
            <span className="truncate">{code}</span>
          </button>
        );
      })}
    </div>
  );
}
