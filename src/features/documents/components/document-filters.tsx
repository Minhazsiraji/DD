"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Search, X, Loader } from "lucide-react";
import { DOCUMENT_TYPES, DOCUMENT_TYPE_LABEL } from "../types";

/**
 * Filters for the Documents workspace.
 *
 * Everything goes into the URL rather than component state, so a filtered view
 * is shareable, survives a refresh and back, and is rendered on the server —
 * the same reasoning as the patient search. The text box is debounced because a
 * doctor types faster than a round trip; the selects commit immediately.
 */

interface FiltersProps {
  q: string;
  type: string;
  patientId: string;
  patientName: string | null;
  from: string;
  to: string;
  archived: boolean;
}

export function DocumentFilters(props: FiltersProps) {
  const router = useRouter();
  const params = useSearchParams();
  const [value, setValue] = React.useState(props.q);
  const [pending, startTransition] = React.useTransition();
  const inputRef = React.useRef<HTMLInputElement>(null);

  const push = React.useCallback(
    (mutate: (next: URLSearchParams) => void) => {
      const next = new URLSearchParams(params.toString());
      mutate(next);
      startTransition(() => router.replace(`/documents?${next.toString()}`));
    },
    [params, router],
  );

  const setParam = React.useCallback(
    (key: string, raw: string) => {
      push((next) => {
        const v = raw.trim();
        if (v) next.set(key, v);
        else next.delete(key);
      });
    },
    [push],
  );

  React.useEffect(() => {
    // Clearing the box should feel instant; typing should not round-trip per key.
    const delay = value.trim() === "" ? 0 : 250;
    const t = setTimeout(() => {
      if (value.trim() !== props.q) setParam("q", value);
    }, delay);
    return () => clearTimeout(t);
  }, [value, props.q, setParam]);

  const selectClass =
    "h-11 w-full min-w-0 rounded-xl border border-hairline bg-white px-3 text-base text-ink focus-visible:focus-ring sm:h-10 sm:text-sm";

  return (
    <div className="space-y-3">
      <div className="relative">
        <label htmlFor="document-search" className="sr-only">
          Search documents by title or file name
        </label>
        <Search
          className="pointer-events-none absolute top-1/2 left-3.5 size-[18px] -translate-y-1/2 text-ink-muted"
          aria-hidden="true"
        />
        <input
          id="document-search"
          ref={inputRef}
          type="search"
          inputMode="search"
          autoComplete="off"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Title or file name…"
          /* h-12 / text-base — 16px stops iOS zooming the page on focus. */
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

      {/*
        One column on a phone, four from `sm`. Stacking rather than scrolling
        sideways: a filter a doctor cannot see is a filter that stays wrong.
      */}
      <div
        data-mobile-document-filters
        className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4"
      >
        <div className="min-w-0">
          <label htmlFor="document-type" className="sr-only">
            Document type
          </label>
          <select
            id="document-type"
            className={selectClass}
            value={props.type}
            onChange={(e) => setParam("type", e.target.value === "all" ? "" : e.target.value)}
          >
            <option value="all">All types</option>
            {DOCUMENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {DOCUMENT_TYPE_LABEL[t]}
              </option>
            ))}
          </select>
        </div>

        <div className="min-w-0">
          <label htmlFor="document-from" className="mb-1 block text-xs text-ink-muted">
            Dated from
          </label>
          <input
            id="document-from"
            type="date"
            className={selectClass}
            value={props.from}
            onChange={(e) => setParam("from", e.target.value)}
          />
        </div>

        <div className="min-w-0">
          <label htmlFor="document-to" className="mb-1 block text-xs text-ink-muted">
            Dated to
          </label>
          <input
            id="document-to"
            type="date"
            className={selectClass}
            value={props.to}
            onChange={(e) => setParam("to", e.target.value)}
          />
        </div>

        <div className="flex min-w-0 items-end">
          <label className="flex h-11 w-full min-w-0 cursor-pointer items-center gap-2.5 rounded-xl border border-hairline bg-white px-3 text-sm text-ink focus-within:focus-ring sm:h-10">
            <input
              type="checkbox"
              className="size-4 shrink-0 accent-[var(--dd-brand)]"
              checked={props.archived}
              onChange={(e) => setParam("archived", e.target.checked ? "1" : "")}
            />
            <span className="min-w-0 truncate">Show removed</span>
          </label>
        </div>
      </div>

      {/*
        A patient filter arrives from the patient record ("see all documents"),
        so it is shown as a removable chip rather than a select — a doctor's own
        patient list is far too long to put in a dropdown.
      */}
      {props.patientId ? (
        <p className="flex flex-wrap items-center gap-2 text-[13px] text-ink-secondary">
          <span>Showing documents for</span>
          <span className="inline-flex min-w-0 items-center gap-2 rounded-full bg-brand-soft px-3 py-1 font-semibold text-brand">
            <span className="min-w-0 truncate">{props.patientName ?? "one patient"}</span>
            <button
              type="button"
              onClick={() => setParam("patient", "")}
              aria-label="Show documents for every patient"
              className="rounded-full focus-visible:focus-ring"
            >
              <X className="size-3.5" aria-hidden="true" />
            </button>
          </span>
        </p>
      ) : null}
    </div>
  );
}
