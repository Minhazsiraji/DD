"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { SectionCard, SectionHeader } from "@/components/common/section-card";
import { SECTIONS, VITALS, type DraftKey, type DraftValues, type VitalKey } from "../schema";
import { MODULE_BY_DRAFT_KEY, type VisibilityMap } from "../module-visibility";

/**
 * WHY A SECTION THE DOCTOR TURNED OFF IS ON THE SCREEN.
 *
 * Without this line, a doctor who switched Examination off and still sees it
 * concludes the setting did not save — and turns it off again, and again.
 * Saying it plainly costs one line and makes the rule visible: configuration
 * simplifies future input, it never hides information already recorded.
 */
function ShownBecauseFilled() {
  return (
    <p className="border-b border-hairline bg-surface-muted px-4 py-2 text-[12px] text-ink-secondary sm:px-5">
      Shown because this visit already contains information.
    </p>
  );
}

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
  carryForward,
  visibility,
}: {
  values: DraftValues;
  dirtyKeys: DraftKey[];
  disabled: boolean;
  onChange: (key: DraftKey, value: string) => void;
  carryForward?: CarryForward;
  /**
   * Which sections the doctor has asked to write on. Omitted means all of them
   * — the read failed, and a failed read must never hide a clinical field.
   */
  visibility?: VisibilityMap;
}) {
  /**
   * Filtered by MODULE, not by field: History is one printed section built from
   * two fields, so both stand or fall together — hiding half of it would put a
   * doctor's past history out of reach while its neighbour stayed on screen.
   */
  const shown = SECTIONS.filter((section) => {
    if (!visibility) return true;
    const owner = MODULE_BY_DRAFT_KEY.get(section.key);
    return owner ? visibility[owner].visible : true;
  });

  return (
    <div className="space-y-4">
      {shown.map((section) => {
        const unsaved = dirtyKeys.includes(section.key);
        const owner = MODULE_BY_DRAFT_KEY.get(section.key);
        const becauseFilled = owner ? (visibility?.[owner].shownBecauseFilled ?? false) : false;
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
            {becauseFilled ? <ShownBecauseFilled /> : null}
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

              {/*
                PAST HISTORY ONLY, and only into an empty field.

                It is the one section that is stable history rather than a fresh
                finding — "hypertension for 3 years" is as true today as it was
                last month. Chief complaint, present illness, examination,
                assessment and advice are all observations OF A VISIT and are
                never offered: today's are today's, and last time's belong to the
                read-only card above.
              */}
              {section.key === "pastHistory" &&
              carryForward?.pastHistory &&
              values[section.key] === "" ? (
                <CarriedValue
                  label="From the previous visit:"
                  value={truncate(carryForward.pastHistory)}
                  disabled={disabled}
                  onUse={() => onChange(section.key, carryForward.pastHistory!)}
                />
              ) : null}
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
/**
 * A measurement from the LAST visit, offered but never taken.
 *
 * NOTHING HERE PREFILLS. The doctor presses "Use previous" or the field stays
 * empty, and that is the whole safety argument: a value that appears by itself
 * is indistinguishable, once saved, from one somebody measured today. Weight
 * changes between visits and height changes for a child, so a silent copy is a
 * fabricated observation attributed to this consultation.
 *
 * Height for an adult is stable enough that the batch permitted prefilling it.
 * It is offered the same way as weight instead, because deciding "adult"
 * requires an age this screen may not have — an approximate age, or none at
 * all, is common — and the batch's own fallback for exactly that case is to
 * show the value rather than fill it in. One press is a small price for a
 * measurement nobody has to audit later.
 */
function CarriedValue({
  label,
  value,
  unit,
  disabled,
  onUse,
}: {
  label: string;
  value: string;
  unit?: string;
  disabled: boolean;
  onUse: () => void;
}) {
  return (
    <p className="mt-1 flex flex-wrap items-baseline gap-x-1.5 text-[11px] text-ink-muted">
      <span>
        {label}{" "}
        <span className="font-semibold tabular-nums text-ink-secondary">
          {value}
          {unit ? ` ${unit}` : ""}
        </span>
      </span>
      <button
        type="button"
        onClick={onUse}
        disabled={disabled}
        className="font-semibold text-brand hover:underline disabled:opacity-50 focus-visible:focus-ring"
      >
        Use previous
      </button>
    </p>
  );
}

/** Last visit's values, offered for carry-forward. Never written by this file. */
export interface CarryForward {
  heightCm: string | null;
  weightKg: string | null;
  pastHistory: string | null;
}

/**
 * ONLY height and weight are ever offered.
 *
 * Temperature, pulse, blood pressure, respiratory rate and SpO2 are readings of
 * a moment. Carrying one forward — even by an explicit press — would record a
 * measurement from another day against today's consultation, and a fever that
 * had resolved would go on being documented. They are not in this map, and a
 * new vital added later is not offered unless somebody deliberately adds it.
 */
/** Enough to recognise it; the field itself receives the whole text. */
function truncate(value: string): string {
  const oneLine = value.replace(/\s+/g, " ").trim();
  return oneLine.length > 60 ? `${oneLine.slice(0, 60)}…` : oneLine;
}

function previousFor(key: VitalKey, carry?: CarryForward): string | null {
  if (!carry) return null;
  if (key === "vitalHeightCm") return carry.heightCm;
  if (key === "vitalWeightKg") return carry.weightKg;
  return null;
}

export function VitalFields({
  values,
  dirtyKeys,
  errors,
  disabled,
  onChange,
  carryForward,
  shownBecauseFilled = false,
}: {
  values: DraftValues;
  dirtyKeys: DraftKey[];
  errors: Partial<Record<VitalKey, string>>;
  disabled: boolean;
  onChange: (key: DraftKey, value: string) => void;
  carryForward?: CarryForward;
  shownBecauseFilled?: boolean;
}) {
  return (
    <SectionCard>
      <SectionHeader
        title="Vitals"
        action={
          <span className="text-[11px] text-ink-muted">Leave blank to skip · clear to remove</span>
        }
      />
      {shownBecauseFilled ? <ShownBecauseFilled /> : null}
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

              {/*
                Offered only while TODAY's field is still empty. Once the doctor
                has measured, last visit's number is noise beside it — and worse,
                a one-press way to overwrite what they just wrote.
              */}
              {previousFor(vital.key, carryForward) && values[vital.key] === "" ? (
                <CarriedValue
                  label="Previous:"
                  value={previousFor(vital.key, carryForward)!}
                  unit={vital.unit}
                  disabled={disabled}
                  onUse={() => onChange(vital.key, previousFor(vital.key, carryForward)!)}
                />
              ) : null}
            </div>
          );
        })}
      </div>
    </SectionCard>
  );
}
