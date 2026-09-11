"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { PERIOD_LABEL, PERIODS, parsePeriod, periodQuery, type PeriodKind } from "../periods";

/**
 * Today / 7 days / 30 days / Custom.
 *
 * The choice goes into the URL and the server re-renders; this component holds
 * no data. `parsePeriod` — the same pure function the server uses — decides
 * what the current selection is, so the control can never show a range the
 * page is not actually reporting.
 *
 * A custom range is only committed once both dates are valid and ordered; an
 * incomplete range stays local rather than navigating to a URL the server would
 * have to discard.
 */
export function PeriodFilter() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const current = parsePeriod(Object.fromEntries(params.entries()));
  const [pending, startTransition] = React.useTransition();

  const [from, setFrom] = React.useState(current.kind === "custom" ? current.from : "");
  const [to, setTo] = React.useState(current.kind === "custom" ? current.to : "");
  const [customOpen, setCustomOpen] = React.useState(current.kind === "custom");

  function go(query: string) {
    startTransition(() => router.replace(`${pathname}?${query}`));
  }

  function choose(kind: PeriodKind) {
    if (kind === "custom") {
      setCustomOpen(true);
      return;
    }
    setCustomOpen(false);
    go(periodQuery({ kind }));
  }

  function applyCustom() {
    const next = parsePeriod({ period: "custom", from, to });
    if (next.kind === "custom") go(periodQuery(next));
  }

  const customValid = parsePeriod({ period: "custom", from, to }).kind === "custom";
  const field =
    "h-11 w-full min-w-0 rounded-xl border border-hairline bg-white px-3 text-base text-ink focus-visible:focus-ring sm:text-sm";

  return (
    <div className="min-w-0 space-y-2" data-mobile-period-filter aria-busy={pending}>
      <div role="group" aria-label="Reporting period" className="flex w-full min-w-0 flex-wrap gap-1.5">
        {PERIODS.map((kind) => {
          const active = customOpen ? kind === "custom" : current.kind === kind;
          return (
            <button
              key={kind}
              type="button"
              onClick={() => choose(kind)}
              aria-pressed={active}
              className={cn(
                "inline-flex h-11 min-w-[4.5rem] flex-1 items-center justify-center rounded-xl px-3 text-sm font-semibold transition-colors focus-visible:focus-ring sm:flex-none",
                active ? "dd-material-record dd-record-pearl text-ink" : "text-ink-secondary hover:bg-white/30 hover:text-ink",
              )}
            >
              {PERIOD_LABEL[kind]}
            </button>
          );
        })}
      </div>

      {customOpen ? (
        <div className="grid w-full min-w-0 grid-cols-1 gap-2 min-[480px]:grid-cols-[1fr_1fr_auto]">
          <label className="min-w-0">
            <span className="mb-1 block text-xs text-ink-muted">From</span>
            <input type="date" className={field} value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="min-w-0">
            <span className="mb-1 block text-xs text-ink-muted">To</span>
            <input type="date" className={field} value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
          <button
            type="button"
            onClick={applyCustom}
            disabled={!customValid || pending}
            className="inline-flex h-11 items-center justify-center self-end rounded-xl bg-brand px-4 text-sm font-semibold text-white shadow-soft transition-colors hover:bg-brand-hover focus-visible:focus-ring disabled:opacity-50"
          >
            Apply
          </button>
        </div>
      ) : null}
    </div>
  );
}
