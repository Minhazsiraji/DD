"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { SectionCard, SectionHeader } from "@/components/common/section-card";
import { SECTIONS, VITALS, type DraftKey, type DraftValues, type VitalKey } from "../schema";

/**
 * The clinical form.
 *
 * Nothing is required. A consultation that will not save until every box is
 * filled produces either empty fields or invented ones, and a doctor who is
 * mid-examination should be able to write two words and come back (ADR 0010).
 * Order is a suggestion; the boxes are plain textareas because doctors write in
 * very different amounts and shapes.
 */

export function SectionFields({
  values,
  dirtyKeys,
  disabled,
  onChange,
}: {
  values: DraftValues;
  dirtyKeys: DraftKey[];
  disabled: boolean;
  onChange: (key: DraftKey, value: string) => void;
}) {
  return (
    <div className="space-y-4">
      {SECTIONS.map((section) => {
        const unsaved = dirtyKeys.includes(section.key);
        return (
          <SectionCard key={section.key}>
            <SectionHeader
              title={section.label}
              action={
                unsaved ? (
                  <span className="rounded-full bg-warning-soft px-2 py-0.5 text-[11px] font-semibold text-warning">
                    Unsaved
                  </span>
                ) : null
              }
            />
            <div className="p-4 sm:p-5">
              <label htmlFor={section.key} className="sr-only">
                {section.label}
              </label>
              <textarea
                id={section.key}
                name={section.key}
                rows={section.rows}
                disabled={disabled}
                value={values[section.key]}
                onChange={(e) => onChange(section.key, e.target.value)}
                placeholder={section.placeholder}
                spellCheck={false}
                className="w-full resize-y rounded-xl border border-hairline bg-white px-3 py-2.5 text-[15px] leading-relaxed text-ink placeholder:text-ink-muted focus-visible:focus-ring disabled:bg-surface-muted disabled:text-ink-secondary"
              />
            </div>
          </SectionCard>
        );
      })}
    </div>
  );
}

/**
 * Vitals.
 *
 * Numeric, tabular, and bounded by the same limits the database enforces — the
 * message names a plausibility limit rather than judging the patient, because a
 * pulse of 190 is a real emergency and must be recordable.
 *
 * Emptying a box CLEARS the value. That is the whole reason the patch contract
 * distinguishes absent from null: a mistyped blood pressure has to be
 * removable.
 */
export function VitalFields({
  values,
  dirtyKeys,
  errors,
  disabled,
  onChange,
}: {
  values: DraftValues;
  dirtyKeys: DraftKey[];
  errors: Partial<Record<VitalKey, string>>;
  disabled: boolean;
  onChange: (key: DraftKey, value: string) => void;
}) {
  return (
    <SectionCard>
      <SectionHeader
        title="Vitals"
        action={
          <span className="text-[11px] text-ink-muted">Leave blank to skip · clear to remove</span>
        }
      />
      <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-4 sm:p-5">
        {VITALS.map((vital) => {
          const error = errors[vital.key];
          const unsaved = dirtyKeys.includes(vital.key);
          const describedBy = error ? `${vital.key}-error` : undefined;

          return (
            <div key={vital.key} className="min-w-0">
              <label
                htmlFor={vital.key}
                className="flex items-baseline justify-between gap-1 text-[13px] font-medium text-ink-secondary"
              >
                <span className="truncate">{vital.label}</span>
                <span className="shrink-0 text-[11px] text-ink-muted">{vital.unit}</span>
              </label>
              <input
                id={vital.key}
                name={vital.key}
                type="number"
                inputMode="decimal"
                step={vital.step}
                disabled={disabled}
                value={values[vital.key]}
                onChange={(e) => onChange(vital.key, e.target.value)}
                aria-invalid={error ? true : undefined}
                aria-describedby={describedBy}
                className={cn(
                  "mt-1 h-11 w-full rounded-xl border bg-white px-3 text-[15px] text-ink tabular-nums focus-visible:focus-ring disabled:bg-surface-muted",
                  error
                    ? "border-danger"
                    : unsaved
                      ? "border-warning"
                      : "border-hairline",
                )}
              />
              {error ? (
                <p id={describedBy} role="status" className="mt-1 text-[11px] font-medium text-danger">
                  {error}
                </p>
              ) : null}
            </div>
          );
        })}
      </div>
    </SectionCard>
  );
}
