"use client";

import * as React from "react";
import { Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { medicineSuggestionsAction } from "../actions";
import { MEDICINE_FIELDS, type MedicineDraft, type Suggestion } from "../schema";

/**
 * One medicine line, being written.
 *
 * Only the name is required. A doctor mid-consultation types "Tab. Napa 500 mg"
 * and presses add; everything else is optional and can be filled where it
 * matters. Enter submits from any single-line field, so the whole loop —
 * type, add, repeat — is reachable without touching the mouse.
 *
 * The option chips are ACCELERATORS. Every one of these fields stays free
 * text: the lists are what this practice writes most often, not what it is
 * allowed to write.
 */
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

  const [suggestions, setSuggestions] = React.useState<Suggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = React.useState(false);
  const query = value.displayName;

  /**
   * Suggestions trail the typing and never gate it. A failed or slow lookup
   * leaves the doctor typing exactly as before — the list is a shortcut, not a
   * step.
   */
  React.useEffect(() => {
    const q = query.trim();
    let cancelled = false;
    const t = setTimeout(async () => {
      const found = q.length < 2 ? [] : await medicineSuggestionsAction(q);
      if (!cancelled) setSuggestions(found);
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query]);

  /**
   * Gated at render, not only in the effect: a list fetched for "Nap" must stop
   * being offered the instant the field is cleared, without waiting on a timer.
   */
  const visibleSuggestions = query.trim().length < 2 ? [] : suggestions;

  const set = (key: keyof MedicineDraft, v: string | boolean) =>
    onChange({ ...value, [key]: v } as MedicineDraft);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (canSubmit) onSubmit();
      }}
      className="space-y-3 rounded-xl border border-hairline bg-surface-muted/60 p-3 sm:p-4"
    >
      <div className="grid grid-cols-12 gap-3">
        {MEDICINE_FIELDS.map((field) => {
          const isName = field.key === "displayName";
          const span =
            field.span === 12 ? "col-span-12"
            : field.span === 6 ? "col-span-12 sm:col-span-6"
            : field.span === 4 ? "col-span-6 sm:col-span-4"
            : "col-span-6 sm:col-span-3";

          return (
            <div key={field.key} className={cn(span, "relative min-w-0")}>
              <label
                htmlFor={`${id}-${field.key}`}
                className="text-[13px] font-medium text-ink-secondary"
              >
                {field.label}
              </label>

              {field.multiline ? (
                <textarea
                  id={`${id}-${field.key}`}
                  rows={2}
                  value={value[field.key]}
                  disabled={busy}
                  onChange={(e) => set(field.key, e.target.value)}
                  placeholder={field.placeholder}
                  className="mt-1 w-full resize-y rounded-xl border border-hairline bg-white px-3 py-2 text-[15px] text-ink placeholder:text-ink-muted focus-visible:focus-ring disabled:bg-surface-muted"
                />
              ) : (
                <input
                  id={`${id}-${field.key}`}
                  type="text"
                  autoComplete="off"
                  value={value[field.key]}
                  disabled={busy}
                  onChange={(e) => set(field.key, e.target.value)}
                  onFocus={() => isName && setShowSuggestions(true)}
                  // A short delay so a click on a suggestion lands first.
                  onBlur={() => isName && setTimeout(() => setShowSuggestions(false), 150)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      if (canSubmit) onSubmit();
                    }
                    if (e.key === "Escape" && isName) setShowSuggestions(false);
                  }}
                  placeholder={field.placeholder}
                  className="mt-1 h-11 w-full rounded-xl border border-hairline bg-white px-3 text-[15px] text-ink placeholder:text-ink-muted focus-visible:focus-ring disabled:bg-surface-muted"
                />
              )}

              {field.hint ? (
                <p className="mt-1 text-[11px] text-ink-muted">{field.hint}</p>
              ) : null}

              {/*
                What this doctor has written before. Choosing one COPIES the
                text into these fields — it stores no reference, so nothing
                already finalised can change because a later line was worded
                differently.
              */}
              {isName && showSuggestions && visibleSuggestions.length > 0 ? (
                <ul className="clinical-surface absolute inset-x-0 top-full z-20 mt-1 max-h-64 overflow-y-auto rounded-xl border border-hairline shadow-soft">
                  {visibleSuggestions.map((s, i) => (
                    <li key={`${s.displayName}-${i}`}>
                      <button
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          onApplySuggestion(s);
                          setShowSuggestions(false);
                        }}
                        className="flex w-full flex-col items-start gap-0.5 px-3 py-2.5 text-left hover:bg-surface-muted focus-visible:focus-ring"
                      >
                        <span className="text-[14px] font-medium text-ink">{s.displayName}</span>
                        <span className="text-[12px] text-ink-muted">
                          {[s.strengthText, s.doseText, s.scheduleText, s.durationText]
                            .filter(Boolean)
                            .join(" · ") || "no other details"}
                          {s.timesUsed > 1 ? ` · used ${s.timesUsed}×` : ""}
                        </span>
                      </button>
                    </li>
                  ))}
                  <li className="border-t border-hairline px-3 py-2 text-[11px] text-ink-muted">
                    From prescriptions you have signed. Keep typing to ignore these.
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
                        "rounded-lg border px-2 py-1 text-[12px] transition-colors disabled:opacity-55 focus-visible:focus-ring",
                        value[field.key] === option
                          ? "border-brand bg-brand-soft font-semibold text-brand"
                          : "border-hairline bg-white text-ink-secondary hover:bg-surface-muted",
                      )}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <label className="flex min-h-11 cursor-pointer items-center gap-2 text-[13px] text-ink">
          <input
            type="checkbox"
            checked={value.isPrn}
            disabled={busy}
            onChange={(e) => set("isPrn", e.target.checked)}
            className="size-4 accent-[var(--color-brand)]"
          />
          As needed (PRN)
        </label>
        <label className="flex min-h-11 cursor-pointer items-center gap-2 text-[13px] text-ink">
          <input
            type="checkbox"
            checked={value.substitutionAllowed}
            disabled={busy}
            onChange={(e) => set("substitutionAllowed", e.target.checked)}
            className="size-4 accent-[var(--color-brand)]"
          />
          Substitution allowed
        </label>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={!canSubmit}
          className="inline-flex h-11 items-center justify-center gap-1.5 rounded-xl bg-brand px-4 text-[13px] font-semibold text-white shadow-soft transition-colors hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-55 focus-visible:focus-ring"
        >
          {busy ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              Saving…
            </>
          ) : (
            <>
              <Check className="size-4" aria-hidden="true" />
              {submitLabel}
            </>
          )}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="inline-flex h-11 items-center justify-center rounded-xl border border-hairline bg-white px-4 text-[13px] font-semibold text-ink hover:bg-surface-muted disabled:opacity-55 focus-visible:focus-ring"
        >
          Cancel
        </button>
        <p className="basis-full text-[11px] text-ink-muted">
          Only the medicine name is required. Press Enter to add and keep going.
        </p>
      </div>
    </form>
  );
}
