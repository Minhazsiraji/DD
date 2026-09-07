"use client";

import * as React from "react";
import { Clock3, Loader2, Search, Sparkles } from "lucide-react";
import type { MedicineDraft } from "../schema";
import type { SignedHistoryMode, SignedMedicineSuggestion } from "../m3-history";

function when(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(date);
}

export function SignedMedicineHistory({
  disabled,
  onSelect,
}: {
  disabled: boolean;
  onSelect: (medicine: MedicineDraft) => void;
}) {
  const [mode, setMode] = React.useState<SignedHistoryMode>("RECENT");
  const [query, setQuery] = React.useState("");
  const [items, setItems] = React.useState<SignedMedicineSuggestion[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const normalizedQuery = query.trim();
  const queryTooShort = normalizedQuery.length === 1;

  React.useEffect(() => {
    if (query.trim().length === 1) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError(null);
      const params = new URLSearchParams({ mode });
      if (query.trim()) params.set("q", query.trim());
      void fetch(`/api/m3-signed-medicine-history?${params}`, {
        signal: controller.signal,
        cache: "no-store",
      })
        .then(async (response) => {
          const body = (await response.json()) as { items?: SignedMedicineSuggestion[]; error?: string };
          if (!response.ok) throw new Error(body.error || "History unavailable");
          setItems(body.items ?? []);
        })
        .catch((reason: unknown) => {
          if (controller.signal.aborted) return;
          setItems([]);
          setError(reason instanceof Error ? reason.message : "Signed medicine history is unavailable.");
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, query.trim() ? 200 : 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [mode, query]);

  const visibleItems = queryTooShort ? [] : items;
  const visibleLoading = queryTooShort ? false : loading;
  const visibleError = queryTooShort ? null : error;

  return (
    <section className="dd-material-panel dd-panel-pearl dd-panel-rim rounded-glass p-3 sm:p-4" aria-label="Signed medicine history">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="flex items-center gap-1.5 text-[13px] font-semibold text-ink">
            <Sparkles className="size-4 text-brand" aria-hidden="true" />
            Signed medicine history
          </p>
          <p className="mt-0.5 text-[11px] text-ink-muted">Choose a line to propose it. Nothing is added until you press Add medicine.</p>
        </div>
        <div className="flex gap-1.5" role="group" aria-label="History order">
          {(["RECENT", "FREQUENT"] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setMode(value)}
              disabled={disabled}
              aria-pressed={mode === value}
              className={mode === value
                ? "dd-primary inline-flex min-h-11 items-center px-3 text-[12px] font-semibold focus-visible:focus-ring"
                : "dd-secondary inline-flex min-h-11 items-center px-3 text-[12px] font-semibold focus-visible:focus-ring"}
            >
              {value === "RECENT" ? "Recent" : "Frequent"}
            </button>
          ))}
        </div>
      </div>

      <label className="relative mt-3 block">
        <Search className="pointer-events-none absolute left-3 top-3.5 size-4 text-ink-muted" aria-hidden="true" />
        <span className="sr-only">Search signed medicine history</span>
        <input
          type="search"
          value={query}
          disabled={disabled}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search your signed medicines"
          className="h-11 w-full rounded-xl border border-hairline bg-white/88 pl-9 pr-3 text-[14px] text-ink placeholder:text-ink-muted focus-visible:focus-ring"
        />
      </label>

      {visibleError ? <p role="status" className="mt-2 text-[12px] font-medium text-danger">{visibleError}</p> : null}

      <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {visibleLoading ? (
          <p className="col-span-full flex min-h-11 items-center gap-2 text-[12px] text-ink-muted"><Loader2 className="size-4 animate-spin" />Loading signed history…</p>
        ) : visibleItems.length === 0 ? (
          <p className="col-span-full py-2 text-[12px] text-ink-muted">{normalizedQuery ? "No signed medicine matches that search." : "No signed medicine history yet."}</p>
        ) : (
          visibleItems.map((item, index) => (
            <button
              key={`${item.displayName}-${item.strengthText}-${index}`}
              type="button"
              disabled={disabled}
              onClick={() => {
                const { lastUsed, timesUsed, ...draft } = item;
                void lastUsed;
                void timesUsed;
                onSelect(draft);
              }}
              className="dd-material-record dd-record-pearl dd-record-interactive min-h-11 rounded-2xl p-3 text-left focus-visible:focus-ring disabled:opacity-50"
            >
              <span className="block truncate text-[13px] font-semibold text-ink">{item.displayName}{item.strengthText ? ` ${item.strengthText}` : ""}</span>
              <span className="mt-0.5 block truncate text-[11px] text-ink-secondary">{[item.doseText, item.scheduleText, item.durationText].filter(Boolean).join(" · ") || "Signed wording"}</span>
              <span className="mt-1 flex items-center gap-1.5 text-[10px] text-ink-muted">
                <Clock3 className="size-3" aria-hidden="true" />
                {mode === "FREQUENT" ? `${item.timesUsed} signed Rx${item.timesUsed === 1 ? "" : "s"}` : when(item.lastUsed) || "Signed history"}
              </span>
            </button>
          ))
        )}
      </div>
    </section>
  );
}
