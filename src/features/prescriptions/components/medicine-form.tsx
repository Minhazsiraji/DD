"use client";

import * as React from "react";
import { Check, ChevronDown, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  MEDICINE_FIELDS,
  type FieldSpec,
  type MedicineDraft,
  type MedicineField,
} from "../schema";
import type { SignedMedicineSuggestion } from "../m3-history";

const FAST_KEYS = new Set<MedicineField>([
  "displayName",
  "strengthText",
  "doseText",
  "scheduleText",
  "durationText",
]);
const FAST_FIELDS = MEDICINE_FIELDS.filter((field) => FAST_KEYS.has(field.key));
const MORE_FIELDS = MEDICINE_FIELDS.filter((field) => !FAST_KEYS.has(field.key));

function spanClass(field: FieldSpec): string {
  if (field.key === "displayName") return "col-span-12 sm:col-span-6";
  if (field.key === "strengthText") return "col-span-6 sm:col-span-3";
  if (field.key === "doseText") return "col-span-6 sm:col-span-3";
  if (field.key === "scheduleText" || field.key === "durationText") {
    return "col-span-6 sm:col-span-3";
  }
  if (field.span === 12) return "col-span-12";
  if (field.span === 6) return "col-span-12 sm:col-span-6";
  if (field.span === 4) return "col-span-6 sm:col-span-4";
  return "col-span-6 sm:col-span-3";
}

export function MedicineForm({
  value,
  busy,
  blocked,
  submitLabel,
  onChange,
  onSubmit,
  onCancel,
  onApplySuggestion,
}: {
  value: MedicineDraft;
  busy: boolean;
  blocked: boolean;
  submitLabel: string;
  onChange: (next: MedicineDraft) => void;
  onSubmit: () => void;
  onCancel: () => void;
  onApplySuggestion: (s: MedicineDraft) => void;
}) {
  const id = React.useId();
  const canSubmit = value.displayName.trim() !== "" && !busy && !blocked;
  const [suggestions, setSuggestions] = React.useState<SignedMedicineSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = React.useState(false);
  const query = value.displayName;

  const moreHasValue =
    MORE_FIELDS.some((field) => value[field.key].trim() !== "") ||
    value.isPrn ||
    !value.substitutionAllowed;
  const [moreOpen, setMoreOpen] = React.useState(moreHasValue);

  React.useEffect(() => {
    if (moreHasValue) setMoreOpen(true);
  }, [moreHasValue]);

  React.useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void fetch(`/api/m3-signed-medicine-history?mode=RECENT&q=${encodeURIComponent(q)}`, {
        signal: controller.signal,
        cache: "no-store",
      })
        .then(async (response) => {
          if (!response.ok) return;
          const body = (await response.json()) as { items?: SignedMedicineSuggestion[] };
          setSuggestions(body.items ?? []);
        })
        .catch(() => undefined);
    }, 200);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [query]);

  const visibleSuggestions = query.trim().length < 2 ? [] : suggestions;
  const set = (key: keyof MedicineDraft, next: string | boolean) =>
    onChange({ ...value, [key]: next } as MedicineDraft);

  const renderField = (field: FieldSpec) => {
    const isName = field.key === "displayName";
    return (
      <div key={field.key} className={cn(spanClass(field), "relative min-w-0")}>
        <label
          htmlFor={`${id}-${field.key}`}
          className="text-[12px] font-semibold text-ink-secondary"
        >
          {field.label}
        </label>
        {field.multiline ? (
          <textarea
            id={`${id}-${field.key}`}
            rows={2}
            value={value[field.key]}
            disabled={busy}
            onChange={(event) => set(field.key, event.target.value)}
            placeholder={field.placeholder}
            className="mt-1 w-full resize-y rounded-xl border border-hairline bg-white/90 px-3 py-2 text-[15px] text-ink placeholder:text-ink-muted focus-visible:focus-ring disabled:bg-surface-muted"
          />
        ) : (
          <input
            id={`${id}-${field.key}`}
            type="text"
            autoComplete="off"
            value={value[field.key]}
            disabled={busy}
            onChange={(event) => set(field.key, event.target.value)}
            onFocus={() => isName && setShowSuggestions(true)}
            onBlur={() => isName && window.setTimeout(() => setShowSuggestions(false), 150)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                if (canSubmit) onSubmit();
              }
              if (event.key === "Escape" && isName) setShowSuggestions(false);
            }}
            placeholder={field.placeholder}
            className="mt-1 h-11 w-full rounded-xl border border-hairline bg-white/90 px-3 text-[15px] text-ink placeholder:text-ink-muted focus-visible:focus-ring disabled:bg-surface-muted"
          />
        )}
        {field.hint ? <p className="mt-1 text-[10px] text-ink-muted">{field.hint}</p> : null}

        {isName && showSuggestions && visibleSuggestions.length > 0 ? (
          <ul className="dd-material-panel dd-panel-pearl absolute inset-x-0 top-full z-30 mt-1 max-h-64 overflow-y-auto rounded-xl border border-white/70 shadow-soft">
            {visibleSuggestions.map((suggestion, index) => (
              <li key={`${suggestion.displayName}-${suggestion.strengthText}-${index}`}>
                <button
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    const { lastUsed: _lastUsed, timesUsed: _timesUsed, ...draft } = suggestion;
                    onApplySuggestion(draft);
                    setShowSuggestions(false);
                  }}
                  className="flex min-h-11 w-full flex-col items-start justify-center px-3 py-2 text-left hover:bg-white/35 focus-visible:focus-ring"
                >
                  <span className="text-[13px] font-semibold text-ink">
                    {suggestion.displayName}
                    {suggestion.strengthText ? ` ${suggestion.strengthText}` : ""}
                  </span>
                  <span className="text-[11px] text-ink-muted">
                    {[suggestion.doseText, suggestion.scheduleText, suggestion.durationText]
                      .filter(Boolean)
                      .join(" · ") || "Signed wording"}
                  </span>
                </button>
              </li>
            ))}
            <li className="border-t border-white/60 px-3 py-2 text-[10px] text-ink-muted">
              Signed prescription history. Selection fills this form; it does not add a medicine.
            </li>
          </ul>
        ) : null}

        {field.options ? (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {field.options.map((option) => (
              <button
                key={option}
                type="button"
                disabled={busy}
                onClick={() => set(field.key, value[field.key] === option ? "" : option)}
                className={cn(
                  "min-h-11 rounded-xl border px-2.5 text-[11px] disabled:opacity-55 focus-visible:focus-ring",
                  value[field.key] === option
                    ? "border-brand bg-brand-soft font-semibold text-brand"
                    : "border-hairline bg-white/70 text-ink-secondary hover:bg-white",
                )}
              >
                {option}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (canSubmit) onSubmit();
      }}
      className="dd-material-panel dd-panel-pearl dd-panel-rim space-y-4 rounded-glass p-3 sm:p-4"
    >
      <div>
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-brand">
          Fast entry
        </p>
        <div className="grid grid-cols-12 gap-3">{FAST_FIELDS.map(renderField)}</div>
      </div>

      <details
        className="dd-material-record dd-record-pearl rounded-2xl"
        open={moreOpen}
        onToggle={(event) => setMoreOpen(event.currentTarget.open)}
      >
        <summary className="flex min-h-11 cursor-pointer items-center gap-2 px-3 text-[12px] font-semibold text-ink focus-visible:focus-ring">
          <ChevronDown
            className={cn("size-4 text-ink-muted transition-transform", moreOpen && "rotate-180")}
            aria-hidden="true"
          />
          More medicine details
          <span className="ml-auto hidden text-[10px] font-normal text-ink-muted sm:inline">
            brand · generic · form · route · quantity · food · instructions
          </span>
        </summary>
        <div className="border-t border-white/55 p-3">
          <div className="grid grid-cols-12 gap-3">{MORE_FIELDS.map(renderField)}</div>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
            <label className="flex min-h-11 cursor-pointer items-center gap-2 text-[12px] text-ink">
              <input
                type="checkbox"
                checked={value.isPrn}
                disabled={busy}
                onChange={(event) => set("isPrn", event.target.checked)}
                className="size-4 accent-[var(--color-brand)]"
              />
              As needed (PRN)
            </label>
            <label className="flex min-h-11 cursor-pointer items-center gap-2 text-[12px] text-ink">
              <input
                type="checkbox"
                checked={value.substitutionAllowed}
                disabled={busy}
                onChange={(event) => set("substitutionAllowed", event.target.checked)}
                className="size-4 accent-[var(--color-brand)]"
              />
              Substitution allowed
            </label>
          </div>
        </div>
      </details>

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <button
          type="submit"
          disabled={!canSubmit}
          className="dd-primary inline-flex min-h-11 items-center justify-center gap-1.5 px-4 text-[13px] font-semibold disabled:cursor-not-allowed disabled:opacity-55 focus-visible:focus-ring"
        >
          {busy ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Check className="size-4" aria-hidden="true" />
          )}
          {busy ? "Saving…" : submitLabel}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="dd-secondary inline-flex min-h-11 items-center justify-center px-4 text-[13px] font-semibold disabled:opacity-55 focus-visible:focus-ring"
        >
          Cancel
        </button>
        <p className="basis-full text-[10px] text-ink-muted">
          Medicine name is the only required field. Press Enter from a single-line field to add quickly.
        </p>
      </div>
    </form>
  );
}
