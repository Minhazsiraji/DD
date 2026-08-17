"use client";

import * as React from "react";
import { ArrowDown, ArrowUp, Pencil, Trash2 } from "lucide-react";
import type { usePrescription } from "../use-prescription";
import type { MedicineRow } from "../schema";
import { MedicineForm } from "./medicine-form";

/**
 * The medicines on this prescription, in the order they will print.
 *
 * The order is the record's, not the screen's: a move is a write, and the list
 * re-reads rather than reordering locally, so what a doctor sees is what the
 * pharmacist will read.
 *
 * Read-only renders no controls at all rather than disabled ones — an approved
 * prescription has no edit that could be attempted.
 */
export function MedicineList({
  rx,
  readOnly,
}: {
  rx: ReturnType<typeof usePrescription>;
  readOnly: boolean;
}) {
  return (
    <ol className="divide-y divide-hairline">
      {rx.items.map((row, index) => {
        const editingThis = rx.editor?.mode === "edit" && rx.editor.row.id === row.id;

        if (editingThis) {
          return (
            <li key={row.id} className="py-3 first:pt-0 last:pb-0">
              <MedicineForm
                value={rx.draft}
                busy={rx.busy}
                blocked={rx.blocked && !rx.busy}
                submitLabel="Save changes"
                onChange={rx.setDraft}
                onSubmit={() => void rx.submit()}
                onCancel={rx.closeEditor}
                onApplySuggestion={rx.applySuggestion}
              />
            </li>
          );
        }

        return (
          <li key={row.id} className="py-3 first:pt-0 last:pb-0">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 w-5 shrink-0 text-right text-[13px] font-semibold text-ink-muted tabular-nums">
                {row.position}
              </span>

              <div className="min-w-0 flex-1">
                <p className="text-[15px] font-medium text-ink">
                  {row.display_name}
                  {row.is_prn ? (
                    <span className="ml-2 rounded bg-surface-muted px-1.5 py-0.5 text-[11px] font-semibold text-ink-secondary">
                      PRN
                    </span>
                  ) : null}
                </p>
                {/*
                  Strength and dose are printed as separate facts. "500 mg" is
                  the product; "1 tablet" is the instruction.
                */}
                <p className="mt-0.5 text-[13px] text-ink-secondary">
                  {dosing(row) || "no dosing details"}
                </p>
                {row.instructions ? (
                  <p className="mt-0.5 text-[13px] whitespace-pre-wrap text-ink-secondary">
                    {row.instructions}
                  </p>
                ) : null}
              </div>

              {readOnly ? null : (
                <div className="flex shrink-0 items-center gap-0.5">
                  <button
                    type="button"
                    aria-label={`Move ${row.display_name} up`}
                    disabled={rx.blocked || index === 0 || rx.editor !== null}
                    onClick={() => void rx.move(row, row.position - 1)}
                    className="inline-flex size-11 items-center justify-center rounded-xl text-ink-secondary hover:bg-surface-muted disabled:opacity-30 focus-visible:focus-ring"
                  >
                    <ArrowUp className="size-4" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    aria-label={`Move ${row.display_name} down`}
                    disabled={rx.blocked || index === rx.items.length - 1 || rx.editor !== null}
                    onClick={() => void rx.move(row, row.position + 1)}
                    className="inline-flex size-11 items-center justify-center rounded-xl text-ink-secondary hover:bg-surface-muted disabled:opacity-30 focus-visible:focus-ring"
                  >
                    <ArrowDown className="size-4" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    aria-label={`Edit ${row.display_name}`}
                    disabled={rx.blocked || rx.editor !== null}
                    onClick={() => rx.openEdit(row)}
                    className="inline-flex size-11 items-center justify-center rounded-xl text-ink-secondary hover:bg-surface-muted disabled:opacity-40 focus-visible:focus-ring"
                  >
                    <Pencil className="size-4" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    aria-label={`Remove ${row.display_name}`}
                    disabled={rx.blocked || rx.editor !== null}
                    onClick={() => rx.setConfirmingRemoval(row)}
                    className="inline-flex size-11 items-center justify-center rounded-xl text-danger hover:bg-danger-soft disabled:opacity-40 focus-visible:focus-ring"
                  >
                    <Trash2 className="size-4" aria-hidden="true" />
                  </button>
                </div>
              )}
            </div>

            {/* Removing a medicine is a clinical act, so it is named. */}
            {rx.confirmingRemoval?.id === row.id ? (
              <div className="mt-2 flex flex-wrap items-center gap-2 rounded-xl bg-danger-soft px-3 py-2.5">
                <span className="text-[13px] text-ink">
                  Remove <strong className="font-semibold">{row.display_name}</strong>?
                </span>
                <button
                  type="button"
                  disabled={rx.blocked}
                  onClick={() => void rx.remove(row)}
                  className="inline-flex h-11 items-center justify-center rounded-xl bg-danger px-3.5 text-[13px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-55 focus-visible:focus-ring"
                >
                  {rx.busy ? "Removing…" : "Remove"}
                </button>
                <button
                  type="button"
                  disabled={rx.busy}
                  onClick={() => rx.setConfirmingRemoval(null)}
                  className="inline-flex h-11 items-center justify-center rounded-xl border border-hairline bg-white px-3.5 text-[13px] font-semibold text-ink disabled:opacity-55 focus-visible:focus-ring"
                >
                  Keep it
                </button>
              </div>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

/** Whatever the doctor filled in, in the order a prescription is read. */
function dosing(row: MedicineRow): string {
  return [row.strength_text, row.dose_text, row.schedule_text, row.duration_text, row.food_relation]
    .filter(Boolean)
    .join(" · ");
}
