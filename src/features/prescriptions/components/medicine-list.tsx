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
            <li key={row.id} className="liquid-medicine-row p-3.5 sm:p-4">
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
          <li key={row.id} className="liquid-medicine-row p-3.5 sm:p-4">
            <div className="flex items-start gap-3">
              <span className="liquid-rx-index mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold text-brand tabular-nums">
                {row.position}
              </span>

              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <p className="truncate text-[15px] font-semibold tracking-[-0.01em] text-[#302b58] sm:text-[16px]">
                    {row.display_name}
                  </p>
                  {row.is_prn ? (
                    <span className="liquid-secondary inline-flex min-h-6 items-center rounded-full px-2 text-[10px] font-semibold text-ink-secondary">
                      PRN
                    </span>
                  ) : null}
                </div>

                <div className="mt-1.5 flex flex-wrap gap-1.5 text-[12px] text-ink-secondary">
                  {dosingParts(row).length > 0 ? (
                    dosingParts(row).map((part) => (
                      <span key={part} className="liquid-rx-chip inline-flex min-h-7 items-center rounded-full px-2.5">
                        {part}
                      </span>
                    ))
                  ) : (
                    <span className="text-ink-muted">No dosing details</span>
                  )}
                </div>

                {row.instructions ? (
                  <p className="mt-2 text-[12px] leading-relaxed whitespace-pre-wrap text-ink-secondary">
                    {row.instructions}
                  </p>
                ) : null}
              </div>

              {readOnly ? null : (
                <div className="flex shrink-0 flex-wrap items-center justify-end gap-1 sm:flex-nowrap">
                  <ActionButton
                    label={`Move ${row.display_name} up`}
                    disabled={rx.blocked || index === 0 || rx.editor !== null}
                    onClick={() => void rx.move(row, row.position - 1)}
                  >
                    <ArrowUp className="size-3.5" aria-hidden="true" />
                  </ActionButton>
                  <ActionButton
                    label={`Move ${row.display_name} down`}
                    disabled={rx.blocked || index === rx.items.length - 1 || rx.editor !== null}
                    onClick={() => void rx.move(row, row.position + 1)}
                  >
                    <ArrowDown className="size-3.5" aria-hidden="true" />
                  </ActionButton>
                  <ActionButton
                    label={`Edit ${row.display_name}`}
                    disabled={rx.blocked || rx.editor !== null}
                    onClick={() => rx.openEdit(row)}
                  >
                    <Pencil className="size-3.5" aria-hidden="true" />
                  </ActionButton>
                  <ActionButton
                    label={`Remove ${row.display_name}`}
                    disabled={rx.blocked || rx.editor !== null}
                    onClick={() => rx.setConfirmingRemoval(row)}
                    danger
                  >
                    <Trash2 className="size-3.5" aria-hidden="true" />
                  </ActionButton>
                </div>
              )}
            </div>

            {rx.confirmingRemoval?.id === row.id ? (
              <div className="mt-3 flex flex-wrap items-center gap-2 rounded-[15px] border border-danger/12 bg-danger-soft/78 px-3 py-2.5">
                <span className="text-[12px] text-ink">
                  Remove <strong className="font-semibold">{row.display_name}</strong>?
                </span>
                <button
                  type="button"
                  disabled={rx.blocked}
                  onClick={() => void rx.remove(row)}
                  className="inline-flex h-10 items-center justify-center rounded-full bg-danger px-3.5 text-[12px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-55 focus-visible:focus-ring"
                >
                  {rx.busy ? "Removing…" : "Remove"}
                </button>
                <button
                  type="button"
                  disabled={rx.busy}
                  onClick={() => rx.setConfirmingRemoval(null)}
                  className="liquid-secondary inline-flex h-10 items-center justify-center rounded-full px-3.5 text-[12px] font-semibold text-ink disabled:opacity-55 focus-visible:focus-ring"
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

function ActionButton({
  label,
  disabled,
  onClick,
  danger = false,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={
        danger
          ? "liquid-icon-button inline-flex size-9 items-center justify-center rounded-full text-danger disabled:opacity-30 focus-visible:focus-ring"
          : "liquid-icon-button inline-flex size-9 items-center justify-center rounded-full text-ink-secondary disabled:opacity-30 focus-visible:focus-ring"
      }
    >
      {children}
    </button>
  );
}

function dosingParts(row: MedicineRow): string[] {
  return [row.strength_text, row.dose_text, row.schedule_text, row.duration_text, row.food_relation].filter(
    (value): value is string => Boolean(value),
  );
}
