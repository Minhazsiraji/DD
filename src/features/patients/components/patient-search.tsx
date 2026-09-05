"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Search, X, Loader } from "lucide-react";

/**
 * Patient search input.
 *
 * Pushes the query into the URL rather than holding it in component state, so a
 * search is shareable, survives a refresh, and the results are rendered on the
 * server. Debounced, because a doctor types an identifier faster than a round trip.
 */
export function PatientSearch({ initialQuery }: { initialQuery: string }) {
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
      startTransition(() => router.replace(`/patients?${q.toString()}`));
    },
    [params, router],
  );

  React.useEffect(() => {
    // Skip the debounce when the box is cleared — that should feel instant.
    const delay = value.trim() === "" ? 0 : 250;
    const t = setTimeout(() => commit(value), delay);
    return () => clearTimeout(t);
    // `commit` is stable per params/router; value is the real trigger.
  }, [value, commit]);

  return (
    <div className="relative">
      <label htmlFor="patient-search" className="sr-only">
        Search patients by phone or patient number
      </label>

      <Search
        className="pointer-events-none absolute top-1/2 left-3.5 size-[18px] -translate-y-1/2 text-ink-muted"
        aria-hidden="true"
      />

      <input
        id="patient-search"
        ref={inputRef}
        type="search"
        inputMode="search"
        autoComplete="off"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Phone number or patient number…"
        /* h-12 and text-base: a 16px font stops iOS zooming on focus, and this
           is the control a doctor uses one-handed more than any other. */
        className="h-12 w-full rounded-glass border border-hairline bg-white pr-11 pl-11 text-base text-ink shadow-soft placeholder:text-ink-muted focus-visible:focus-ring"
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
          className="absolute top-1/2 right-2 flex size-8 -translate-y-1/2 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink focus-visible:focus-ring"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}
