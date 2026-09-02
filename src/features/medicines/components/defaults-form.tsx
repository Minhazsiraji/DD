"use client";

import * as React from "react";
import { ResponsiveSheet } from "@/components/common/responsive-sheet";
import { updateDoctorMedicine } from "../actions";
import {
  SAVED_DEFAULTS_DISCLAIMER,
  SAVED_DEFAULTS_LABEL,
  type DoctorMedicine,
} from "../medicine";

/**
 * Edit one saved medicine's defaults.
 *
 * EVERY FIELD STARTS EMPTY UNLESS THE DOCTOR FILLED IT. Nothing is pre-filled
 * from a catalogue, a heuristic, or another doctor's habit. A dose that appears
 * in this form without the doctor typing it would be Doctor's Diary making a
 * clinical suggestion, which it has no source for and no business doing.
 *
 * The placeholders are FORMAT examples ("1+0+1"), not value suggestions — they
 * say what shape the box wants, not what to put in it.
 */
export function DefaultsForm({
  medicine,
  onClose,
  onSaved,
}: {
  medicine: DoctorMedicine;
  /** Dismiss without saving. */
  onClose: () => void;
  /** Saved: the parent closes this AND re-renders the list. */
  onSaved: () => void;
}) {
  const [pending, start] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);

  function submit(form: FormData) {
    setError(null);
    const text = (k: string) => {
      const v = form.get(k);
      return typeof v === "string" ? v : "";
    };

    start(async () => {
      const result = await updateDoctorMedicine(medicine.id, {
        displayName: text("displayName"),
        genericName: text("genericName"),
        brandName: medicine.brandName ?? "",
        strengthText: text("strengthText"),
        dosageForm: text("dosageForm"),
        route: text("route"),
        defaultDoseText: text("defaultDoseText"),
        defaultScheduleText: text("defaultScheduleText"),
        defaultDurationText: text("defaultDurationText"),
        defaultQuantityText: text("defaultQuantityText"),
        defaultFoodRelation: text("defaultFoodRelation"),
        defaultInstructions: text("defaultInstructions"),
        // A disabled input posts nothing, so PRN is read from the hidden
        // mirror rather than the checkbox's presence in the payload.
        defaultIsPrn: form.get("defaultIsPrn") === "on",
        medicineReferenceId: medicine.medicineReferenceId,
      });

      if (result.ok) {
        /**
         * The PARENT re-renders, not this component.
         *
         * `router.refresh()` called from here did nothing: closing the sheet
         * unmounts this component in the same tick, and the refresh it
         * scheduled inside `useTransition` went with it. The list then still
         * showed the old defaults — the write had committed and the screen
         * said it had not. Measured twice in a browser before the cause was
         * obvious; the first fix looked right and changed nothing.
         *
         * So success is reported upward and `LibraryList`, which stays mounted,
         * does the refreshing.
         */
        onSaved();
      } else {
        setError(result.message ?? "That did not save.");
      }
    });
  }

  const field =
    "mt-1.5 h-11 w-full min-w-0 rounded-xl border border-hairline bg-white px-3 text-base text-ink focus-visible:focus-ring";
  const label = "text-sm font-semibold text-ink";

  return (
    <ResponsiveSheet
      trigger={null}
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={`Edit defaults · ${medicine.displayName}`}
      description="Your own saved dose, schedule and duration for this medicine. Not medical advice."
    >
      <form action={submit} className="grid min-w-0 gap-4 px-4 pb-6 sm:px-5">
        <p className="rounded-xl bg-surface-muted px-3 py-2 text-xs text-ink-secondary">
          {SAVED_DEFAULTS_DISCLAIMER}
        </p>

        <div className="min-w-0">
          <label htmlFor="displayName" className={label}>
            Name as it prints
          </label>
          <input
            id="displayName"
            name="displayName"
            required
            maxLength={200}
            defaultValue={medicine.displayName}
            className={field}
          />
        </div>

        <div className="grid min-w-0 gap-4 sm:grid-cols-2">
          <div className="min-w-0">
            <label htmlFor="genericName" className={label}>
              Generic
            </label>
            <input
              id="genericName"
              name="genericName"
              maxLength={200}
              defaultValue={medicine.genericName ?? ""}
              className={field}
            />
          </div>
          <div className="min-w-0">
            <label htmlFor="strengthText" className={label}>
              Strength
            </label>
            <input
              id="strengthText"
              name="strengthText"
              maxLength={100}
              defaultValue={medicine.strengthText ?? ""}
              placeholder="500 mg"
              className={field}
            />
          </div>
          <div className="min-w-0">
            <label htmlFor="dosageForm" className={label}>
              Form
            </label>
            <input
              id="dosageForm"
              name="dosageForm"
              maxLength={100}
              defaultValue={medicine.dosageForm ?? ""}
              placeholder="Tablet"
              className={field}
            />
          </div>
          <div className="min-w-0">
            <label htmlFor="route" className={label}>
              Route
            </label>
            <input
              id="route"
              name="route"
              maxLength={100}
              defaultValue={medicine.route ?? ""}
              placeholder="Oral"
              className={field}
            />
          </div>
        </div>

        <fieldset className="min-w-0 rounded-xl border border-hairline p-3">
          <legend className="px-1 text-[11px] font-semibold tracking-wide text-ink-muted uppercase">
            {SAVED_DEFAULTS_LABEL}
          </legend>

          <div className="grid min-w-0 gap-4 sm:grid-cols-2">
            <div className="min-w-0">
              <label htmlFor="defaultDoseText" className={label}>
                Dose
              </label>
              <input
                id="defaultDoseText"
                name="defaultDoseText"
                maxLength={100}
                defaultValue={medicine.defaultDoseText ?? ""}
                placeholder="1 tablet"
                className={field}
              />
            </div>
            <div className="min-w-0">
              <label htmlFor="defaultScheduleText" className={label}>
                Schedule
              </label>
              <input
                id="defaultScheduleText"
                name="defaultScheduleText"
                maxLength={100}
                defaultValue={medicine.defaultScheduleText ?? ""}
                placeholder="1+0+1"
                className={field}
              />
            </div>
            <div className="min-w-0">
              <label htmlFor="defaultDurationText" className={label}>
                Duration
              </label>
              <input
                id="defaultDurationText"
                name="defaultDurationText"
                maxLength={100}
                defaultValue={medicine.defaultDurationText ?? ""}
                placeholder="3 days"
                className={field}
              />
            </div>
            <div className="min-w-0">
              <label htmlFor="defaultQuantityText" className={label}>
                Quantity
              </label>
              <input
                id="defaultQuantityText"
                name="defaultQuantityText"
                maxLength={100}
                defaultValue={medicine.defaultQuantityText ?? ""}
                className={field}
              />
            </div>
            <div className="min-w-0">
              <label htmlFor="defaultFoodRelation" className={label}>
                Food relation
              </label>
              <input
                id="defaultFoodRelation"
                name="defaultFoodRelation"
                maxLength={100}
                defaultValue={medicine.defaultFoodRelation ?? ""}
                placeholder="After food"
                className={field}
              />
            </div>
            <label className="flex min-h-11 min-w-0 items-center gap-3 self-end">
              <input
                type="checkbox"
                name="defaultIsPrn"
                defaultChecked={medicine.defaultIsPrn}
                className="size-5 shrink-0"
              />
              <span className={label}>PRN (as needed)</span>
            </label>
          </div>

          <div className="mt-4 min-w-0">
            <label htmlFor="defaultInstructions" className={label}>
              Instructions
            </label>
            <textarea
              id="defaultInstructions"
              name="defaultInstructions"
              maxLength={1000}
              rows={3}
              defaultValue={medicine.defaultInstructions ?? ""}
              className="mt-1.5 w-full min-w-0 rounded-xl border border-hairline bg-white px-3 py-2 text-base text-ink focus-visible:focus-ring"
            />
          </div>
        </fieldset>

        {error ? (
          <p role="alert" className="rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">
            {error}
          </p>
        ) : null}

        <div className="flex min-w-0 flex-col gap-2 sm:flex-row-reverse">
          <button
            type="submit"
            disabled={pending}
            className="inline-flex min-h-11 items-center justify-center rounded-xl bg-brand px-5 text-sm font-semibold text-white shadow-soft transition-colors hover:bg-brand-hover focus-visible:focus-ring disabled:opacity-60"
          >
            {pending ? "Saving…" : "Save defaults"}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex min-h-11 items-center justify-center rounded-xl border border-hairline px-5 text-sm font-semibold text-ink"
          >
            Cancel
          </button>
        </div>
      </form>
    </ResponsiveSheet>
  );
}
