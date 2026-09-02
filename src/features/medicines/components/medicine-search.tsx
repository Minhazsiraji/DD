"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Search, X, Loader } from "lucide-react";
import { MIN_SEARCH_LENGTH } from "../medicine";

/**
 * Catalogue search box.
 *
 * The query goes into the URL, not component state, so results render on the
 * server, survive a refresh, and can be linked. Debounced — a doctor types
 * faster than a round trip.
 *
 * NO CLIENT-SIDE MATCHING HAPPENS HERE, and that is deliberate. This component
 * transports what was typed and nothing else: it does not correct spelling,
 * expand abbreviations, or pick a "best" row. Matching is literal and happens
 * in one place, `search_medicines`, where it can be audited.
 */
export function MedicineSearch({
  initialQuery,
  tab,
}: {
  initialQuery: string;
  tab: "all" | "mine";
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [value, setValue] = React.useState(initialQuery);
  const [pending, startTransition] = React.useTransition();
  const inputRef = React.useRef<HTMLInputElement>(null);

  const commit = React.useCallback(
    (next: string) => {
      const q = new URLSearchParams(params.toString());
      if (next.trim()) q.set("q", next.trim());
      else q.delete("q");
      startTransition(() => router.replace(`/medicines?${q.toString()}`));
    },
    [params, router],
  );

  React.useEffect(() => {
    // Clearing should feel instant; typing gets a debounce.
    const delay = value.trim() === "" ? 0 : 250;
    const t = setTimeout(() => commit(value), delay);
    return () => clearTimeout(t);
  }, [value, commit]);

  const tooShort = value.trim().length > 0 && value.trim().length < MIN_SEARCH_LENGTH;

  return (
    <div>
      <div className="relative">
        <label htmlFor="medicine-search" className="sr-only">
          Search medicines by generic name, brand or strength
        </label>

        <Search
          className="pointer-events-none absolute top-1/2 left-3.5 size-[18px] -translate-y-1/2 text-ink-muted"
          aria-hidden="true"
        />

        <input
          id="medicine-search"
          ref={inputRef}
          type="search"
          inputMode="search"
          autoComplete="off"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={
            tab === "mine" ? "Search my medicines…" : "Generic, brand or strength…"
          }
          aria-describedby="medicine-search-hint"
          /* h-12 + text-base: 16px stops iOS zooming the page on focus. */
          className="h-12 w-full min-w-0 rounded-glass border border-hairline bg-white pr-11 pl-11 text-base text-ink shadow-soft placeholder:text-ink-muted focus-visible:focus-ring"
        />

        {pending ? (
          <Loader
            className="absolute top-1/2 right-3.5 size-4 -translate-y-1/2 animate-spin text-ink-muted"
            aria-hidden="true"
          />
        ) : value ? (
          <button
            type="button"
            onClick={() => {
              setValue("");
              inputRef.current?.focus();
            }}
            aria-label="Clear search"
            /* size-11 = 44px. Measured at 360/375/390: this was the only
               control in the feature under the touch-target floor. */
            className="absolute top-1/2 right-1 flex size-11 -translate-y-1/2 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink focus-visible:focus-ring"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        ) : null}
      </div>

      <p id="medicine-search-hint" className="mt-2 text-xs text-ink-muted" role="status">
        {tooShort
          ? `Type at least ${MIN_SEARCH_LENGTH} characters.`
          : "Matches are literal — nothing is auto-corrected or substituted."}
      </p>
    </div>
  );
}
