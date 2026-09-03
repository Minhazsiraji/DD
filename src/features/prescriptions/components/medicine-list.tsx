"use client";

import * as React from "react";
import { ArrowDown, ArrowUp, Pencil, Trash2 } from "lucide-react";
import type { usePrescription } from "../use-prescription";
import type { MedicineRow } from "../schema";
import { MedicineForm } from "./medicine-form";

export function MedicineList({
  rx,
  readOnly,
}: {
  rx: ReturnType<typeof usePrescription>;
  readOnly: boolean;
}) {
  return (
    <ol className="space-y-2.5">
      {rx.items.map((row, index) => {
        const editingThis = rx.editor?.mode === "edit" && rx.editor.row.id === row.id;

        if (editingThis) {
          return (
            <li key={row.id}>
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
          <li key={row.id} className="dd-rx-row overflow-hidden rounded-[17px]">
            <div className="flex items-start gap-2.5 px-3 py-3 sm:px-3.5">
              <span className="dd-rx-position mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full text-[10.5px] font-semibold text-brand tabular-nums">
                {row.position}
              </span>

              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-semibold text-ink sm:text-[14.5px]">
                  {row.display_name}
                  {row.is_prn ? (
                    <span className="ml-2 rounded-full bg-surface-muted px-2 py-0.5 text-[9.5px] font-semibold text-ink-secondary">PRN</span>
                  ) : null}
                </p>
                <p className="mt-1 text-[11.5px] leading-5 text-ink-secondary">
                  {dosing(row) || "No dosing details"}
                </p>
                {row.instructions ? (
                  <p className="mt-1 text-[11.5px] whitespace-pre-wrap text-ink-secondary">{row.instructions}</p>
                ) : null}
              </div>

              {readOnly ? null : (
                <div className="flex shrink-0 items-center gap-0.5">
                  <ActionButton label={`Move ${row.display_name} up`} disabled={rx.blocked || index === 0 || rx.editor !== null} onClick={() => void rx.move(row, row.position - 1)}>
                    <ArrowUp className="size-3.5" aria-hidden="true" />
                  </ActionButton>
                  <ActionButton label={`Move ${row.display_name} down`} disabled={rx.blocked || index === rx.items.length - 1 || rx.editor !== null} onClick={() => void rx.move(row, row.position + 1)}>
                    <ArrowDown className="size-3.5" aria-hidden="true" />
                  </ActionButton>
                  <ActionButton label={`Edit ${row.display_name}`} disabled={rx.blocked || rx.editor !== null} onClick={() => rx.openEdit(row)}>
                    <Pencil className="size-3.5" aria-hidden="true" />
                  </ActionButton>
                  <button
                    type="button"
                    aria-label={`Remove ${row.display_name}`}
                    disabled={rx.blocked || rx.editor !== null}
                    onClick={() => rx.setConfirmingRemoval(row)}
                    className="dd-icon-btn inline-flex size-9 items-center justify-center rounded-full text-danger hover:bg-danger-soft disabled:opacity-40 focus-visible:focus-ring"
                  >
                    <Trash2 className="size-3.5" aria-hidden="true" />
                  </button>
                </div>
              )}
            </div>

            {rx.confirmingRemoval?.id === row.id ? (
              <div className="border-t border-danger/15 bg-danger-soft/70 px-3 py-2.5 sm:px-3.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[12px] text-ink">
                    Remove <strong className="font-semibold">{row.display_name}</strong>?
                  </span>
                  <button
                    type="button"
                    disabled={rx.blocked}
                    onClick={() => void rx.remove(row)}
                    className="inline-flex h-9 items-center justify-center rounded-full bg-danger px-3 text-[11.5px] font-semibold text-white disabled:opacity-55 focus-visible:focus-ring"
                  >
                    {rx.busy ? "Removing…" : "Remove"}
                  </button>
                  <button
                    type="button"
                    disabled={rx.busy}
                    onClick={() => rx.setConfirmingRemoval(null)}
                    className="dd-secondary inline-flex h-9 items-center justify-center rounded-full px-3 text-[11.5px] font-semibold text-ink disabled:opacity-55 focus-visible:focus-ring"
                  >
                    Keep it
                  </button>
                </div>
              </div>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

function ActionButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="dd-icon-btn inline-flex size-9 items-center justify-center rounded-full text-ink-secondary disabled:opacity-30 focus-visible:focus-ring"
    >
      {children}
    </button>
  );
}

function dosing(row: MedicineRow): string {
  return [row.strength_text, row.dose_text, row.schedule_text, row.duration_text, row.food_relation]
    .filter(Boolean)
    .join(" · ");
}
