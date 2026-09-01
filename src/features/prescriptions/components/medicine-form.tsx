"use client";

import * as React from "react";
import { Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { DictateButton } from "@/features/dictation/components/dictate-button";
import {
  MEDICINE_FIELDS,
  type MedicineDraft,
  type MedicineField,
  type Suggestion,
} from "../schema";
import { medicineFieldSupportsDictation } from "../prescription-dictation";

/**
 * One medicine line, being written.
 *
 * Only the name is required. Dictation may assist selected FREE-TEXT fields,
 * but it only changes this local draft. The doctor must still explicitly press
 * Add/Save, then later Review and Finalize through the existing trusted path.
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
  const [carets, setCarets] = React.useState<Partial<Record<MedicineField, number>>>({});
  const query = value.displayName;

  React.useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return;

    const controller = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/medicine-suggestions?q=${encodeURIComponent(q)}`, {
          signal: controller.signal,
        });
        if (!res.ok) return;
        const body = (await res.json()) as { suggestions?: Suggestion[] };
        setSuggestions(body.suggestions ?? []);
      } catch {
        // Suggestions are optional and never gate prescribing.
      }
    }, 200);

    return () => {
      controller.abort();
      clearTimeout(t);
    };
  }, [query]);

  const visibleSuggestions = query.trim().length < 2 ? [] : suggestions;

  const set = (key: keyof MedicineDraft, v: string | boolean) =>
    onChange({ ...value, [key]: v } as MedicineDraft);

  const rememberCaret = (key: MedicineField, caret: number | null) => {
    if (caret === null) return;
    setCarets((current) => ({ ...current, [key]: caret }));
  };

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
          const dictatable = medicineFieldSupportsDictation(field.key);
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
                  onSelect={(e) => dictatable && rememberCaret(field.key, e.currentTarget.selectionStart)}
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
                  onSelect={(e) => dictatable && rememberCaret(field.key, e.currentTarget.selectionStart)}
                  onFocus={() => isName && setShowSuggestions(true)}
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

              {!busy && dictatable ? (
                <DictateButton
                  className="mt-2"
                  fieldLabel={`prescription ${field.label.toLowerCase()}`}
                  disabled={blocked}
                  value={value[field.key]}
                  caretAt={carets[field.key]}
                  onInsert={(next, caret) => {
                    setCarets((current) => ({ ...current, [field.key]: caret }));
                    set(field.key, next);
                  }}
                />
              ) : null}

              {field.hint ? (
                <p className="mt-1 text-[11px] text-ink-muted">{field.hint}</p>
              ) : null}

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
          Dictation only edits this draft. Nothing is added until you press {submitLabel}.
        </p>
      </div>
    </form>
  );
}
