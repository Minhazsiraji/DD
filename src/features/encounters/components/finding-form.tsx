"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { CERTAINTIES, CERTAINTY_HINT, CERTAINTY_LABEL } from "../list-schema";
import type { FindingDraft, ListKind } from "../finding-types";

/**
 * The one form used to add a finding and to correct one.
 *
 * Suggestions are optional accelerators only: choosing one fills the existing
 * title field. It does NOT submit the form, save a row, or create a favourite.
 */
export function FindingForm({
  kind,
  value,
  busy,
  blocked = false,
  submitLabel,
  suggestions = [],
  onChange,
  onSubmit,
  onCancel,
}: {
  kind: ListKind;
  value: FindingDraft;
  /** This form's own mutation is in flight. */
  busy: boolean;
  /** Something else owns the encounter right now. */
  blocked?: boolean;
  submitLabel: string;
  /** Doctor-owned previous-visit labels only; never persisted as favourites. */
  suggestions?: string[];
  onChange: (next: FindingDraft) => void;
  onSubmit: () => void;
  onCancel?: () => void;
}) {
  const id = React.useId();
  const isDiagnosis = kind === "diagnosis";
  const titleLabel = isDiagnosis ? "Diagnosis" : "Investigation order";
  const canSubmit = value.title.trim().length > 0 && !busy && !blocked;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (canSubmit) onSubmit();
      }}
      className="space-y-3 rounded-xl border border-white/60 bg-white/22 p-3 sm:p-4"
    >
      <div>
        <label htmlFor={`${id}-title`} className="text-[13px] font-medium text-ink-secondary">
          {titleLabel}
        </label>
        <input
          id={`${id}-title`}
          value={value.title}
          disabled={busy}
          autoComplete="off"
          onChange={(e) => onChange({ ...value, title: e.target.value })}
          placeholder={isDiagnosis ? "Dengue fever" : "CBC with platelet count"}
          className="mt-1 h-11 w-full rounded-xl border border-hairline bg-white/90 px-3 text-[15px] text-ink placeholder:text-ink-muted focus-visible:focus-ring disabled:bg-surface-muted"
        />

        {suggestions.length > 0 && value.title.trim() === "" ? (
          <div className="mt-2">
            <p className="text-[11px] text-ink-muted">
              From this patient&rsquo;s previous visit · selecting only fills the field
            </p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {suggestions.slice(0, 5).map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  disabled={busy || blocked}
                  onClick={() => onChange({ ...value, title: suggestion })}
                  className="dd-secondary inline-flex min-h-11 items-center px-3 text-[12px] font-semibold disabled:opacity-45 focus-visible:focus-ring"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      {isDiagnosis ? (
        <fieldset disabled={busy}>
          <legend className="text-[13px] font-medium text-ink-secondary">How certain</legend>
          <div className="mt-1.5 grid gap-1.5 sm:grid-cols-2">
            {CERTAINTIES.map((c) => (
              <label
                key={c}
                className={cn(
                  "flex min-h-11 cursor-pointer items-start gap-2 rounded-xl border px-3 py-2 text-[13px] transition-colors",
                  value.certainty === c
                    ? "border-brand bg-brand-soft"
                    : "border-hairline bg-white/88 hover:bg-white",
                )}
              >
                <input
                  type="radio"
                  name={`${id}-certainty`}
                  value={c}
                  checked={value.certainty === c}
                  onChange={() => onChange({ ...value, certainty: c })}
                  className="mt-0.5 size-4 shrink-0 accent-[var(--color-brand)]"
                />
                <span className="min-w-0">
                  <span className="block font-semibold text-ink">{CERTAINTY_LABEL[c]}</span>
                  <span className="block text-[11px] text-ink-muted">{CERTAINTY_HINT[c]}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}

      <div>
        <label htmlFor={`${id}-note`} className="text-[13px] font-medium text-ink-secondary">
          Note <span className="font-normal text-ink-muted">— optional</span>
        </label>
        <textarea
          id={`${id}-note`}
          rows={2}
          value={value.note}
          disabled={busy}
          onChange={(e) => onChange({ ...value, note: e.target.value })}
          placeholder={isDiagnosis ? "Platelets falling, review tomorrow" : "Fasting sample"
          }
          className="mt-1 w-full resize-y rounded-xl border border-hairline bg-white/90 px-3 py-2 text-[15px] text-ink placeholder:text-ink-muted focus-visible:focus-ring disabled:bg-surface-muted"
        />
        <p className="mt-1 text-[11px] text-ink-muted">Emptying this removes the note.</p>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={!canSubmit}
          className="dd-primary inline-flex h-11 items-center justify-center px-4 text-[13px] font-semibold disabled:cursor-not-allowed disabled:opacity-55 focus-visible:focus-ring"
        >
          {busy ? "Saving…" : submitLabel}
        </button>
        {onCancel ? (
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="dd-secondary inline-flex h-11 items-center justify-center px-4 text-[13px] font-semibold disabled:opacity-55 focus-visible:focus-ring"
          >
            Cancel
          </button>
        ) : null}
      </div>
    </form>
  );
}
