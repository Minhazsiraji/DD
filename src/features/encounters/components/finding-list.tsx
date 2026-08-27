"use client";

import * as React from "react";
import { CircleAlert, Pencil, Plus, Trash2 } from "lucide-react";
import { SectionCard, SectionHeader } from "@/components/common/section-card";
import { certaintyLabel } from "../list-schema";
import type { FindingDraft, FindingEditor, FindingRow, ListKind } from "../finding-types";
import { FindingForm } from "./finding-form";

/**
 * Diagnoses or investigations for this consultation.
 *
 * CONTROLLED: the open editor and the pending removal live in the coordinator,
 * not here. That is not tidiness — it is what lets a conflict inspect the row a
 * doctor is editing, and what stops an editor becoming stranded when its row is
 * deleted elsewhere (this list would otherwise keep `{editing: goneId}`
 * forever: no form rendered, Add hidden, and typed text nobody could reach).
 *
 * Rows render in the DATABASE's `position` order, never re-sorted here.
 * Neither list is required; an empty one says so plainly rather than nagging.
 */
export function FindingList({
  kind,
  title,
  icon,
  rows,
  editor,
  confirmingRow,
  readOnly,
  busy,
  blocked,
  error,
  onOpenAdd,
  onOpenEdit,
  onCloseEditor,
  onDraftChange,
  onSubmit,
  onAskRemove,
  onCancelRemove,
  onConfirmRemove,
  onDismissError,
  shownBecauseFilled = false,
}: {
  kind: ListKind;
  title: string;
  icon: React.ReactNode;
  rows: FindingRow[];
  editor: FindingEditor | null;
  confirmingRow: FindingRow | null;
  readOnly: boolean;
  /** A mutation from THIS list is in flight. */
  busy: boolean;
  /** Something else owns the encounter: another mutation, a conflict, a desync. */
  blocked: boolean;
  error: string | null;
  onOpenAdd: () => void;
  onOpenEdit: (row: FindingRow) => void;
  onCloseEditor: () => void;
  onDraftChange: (draft: FindingDraft) => void;
  onSubmit: () => void;
  onAskRemove: (row: FindingRow) => void;
  onCancelRemove: () => void;
  onConfirmRemove: (row: FindingRow) => void;
  onDismissError: () => void;
  /**
   * On screen only because this visit already holds rows, despite the doctor
   * having turned the section off. Said out loud, or they would conclude the
   * setting had not saved.
   */
  shownBecauseFilled?: boolean;
}) {
  const formOpen = editor !== null;
  const disabled = readOnly || blocked;

  return (
    <SectionCard>
      <SectionHeader
        title={title}
        icon={icon}
        count={rows.length}
        action={
          readOnly || formOpen ? null : (
            <button
              type="button"
              /*
                Fast Entry's focus target for this list. Landing here writes
                nothing — it only offers the form — which is why a shortcut is
                allowed to reach it at all.
              */
              id={`add-${kind}`}
              onClick={onOpenAdd}
              disabled={disabled}
              className="inline-flex h-11 items-center gap-1.5 rounded-xl border border-hairline bg-white px-3 text-[13px] font-semibold text-ink transition-colors hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-55 focus-visible:focus-ring"
            >
              <Plus className="size-4" aria-hidden="true" />
              Add
            </button>
          )
        }
      />

      {shownBecauseFilled ? (
        <p className="border-b border-hairline bg-surface-muted px-4 py-2 text-[12px] text-ink-secondary sm:px-5">
          Shown because this visit already contains information.
        </p>
      ) : null}

      <div className="space-y-3 p-4 sm:p-5">
        {error ? (
          <p
            role="status"
            className="flex items-start gap-2 rounded-xl bg-danger-soft px-3 py-2 text-[13px] font-medium text-[#a81c1c]"
          >
            <CircleAlert className="mt-px size-4 shrink-0" aria-hidden="true" />
            {error}
          </p>
        ) : null}

        {rows.length === 0 && !formOpen ? (
          <p className="text-[13px] text-ink-muted">
            None recorded{readOnly ? "" : " — add one if it helps, or leave it empty"}.
          </p>
        ) : null}

        {rows.length > 0 ? (
          <ol className="divide-y divide-hairline">
            {rows.map((row) => {
              const editingThis = editor?.mode === "edit" && editor.rowId === row.id;
              const confirmingThis = confirmingRow?.id === row.id;

              return (
                <li key={row.id} className="py-2.5 first:pt-0 last:pb-0">
                  {editingThis ? (
                    <FindingForm
                      kind={kind}
                      value={editor.draft}
                      busy={busy}
                      blocked={blocked}
                      submitLabel="Save changes"
                      onChange={onDraftChange}
                      onSubmit={onSubmit}
                      onCancel={onCloseEditor}
                    />
                  ) : (
                    <div className="flex items-start gap-3">
                      <span className="mt-0.5 w-5 shrink-0 text-right text-[13px] font-semibold text-ink-muted tabular-nums">
                        {row.position}
                      </span>

                      <div className="min-w-0 flex-1">
                        <p className="text-[15px] font-medium text-ink">{row.title}</p>
                        {row.certainty ? (
                          <p className="mt-0.5 text-[12px] font-semibold text-brand">
                            {certaintyLabel(row.certainty)}
                          </p>
                        ) : null}
                        {row.note ? (
                          <p className="mt-0.5 text-[13px] whitespace-pre-wrap text-ink-secondary">
                            {row.note}
                          </p>
                        ) : null}
                      </div>

                      {readOnly ? null : (
                        <div className="flex shrink-0 gap-1">
                          <button
                            type="button"
                            onClick={() => onOpenEdit(row)}
                            disabled={disabled || formOpen}
                            aria-label={`Edit ${row.title}`}
                            className="inline-flex size-11 items-center justify-center rounded-xl text-ink-secondary transition-colors hover:bg-surface-muted disabled:opacity-40 focus-visible:focus-ring"
                          >
                            <Pencil className="size-4" aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              onDismissError();
                              onAskRemove(row);
                            }}
                            disabled={disabled || formOpen}
                            aria-label={`Remove ${row.title}`}
                            className="inline-flex size-11 items-center justify-center rounded-xl text-danger transition-colors hover:bg-danger-soft disabled:opacity-40 focus-visible:focus-ring"
                          >
                            <Trash2 className="size-4" aria-hidden="true" />
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {/*
                    Removing a finding is a clinical statement, so it is
                    confirmed by name. The Remove button obeys `blocked`: a
                    confirmation opened BEFORE a conflict arrived must not be
                    able to delete a finding while that conflict is unanswered.
                    The coordinator refuses it too; this is the visible half.
                  */}
                  {confirmingThis ? (
                    <div className="mt-2 flex flex-wrap items-center gap-2 rounded-xl bg-danger-soft px-3 py-2.5">
                      <span className="text-[13px] text-ink">
                        Remove <strong className="font-semibold">{row.title}</strong>?
                      </span>
                      <button
                        type="button"
                        disabled={disabled}
                        onClick={() => onConfirmRemove(row)}
                        className="inline-flex h-11 items-center justify-center rounded-xl bg-danger px-3.5 text-[13px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-55 focus-visible:focus-ring"
                      >
                        {busy ? "Removing…" : "Remove"}
                      </button>
                      {/* Cancelling is always safe, so it is never blocked. */}
                      <button
                        type="button"
                        disabled={busy}
                        onClick={onCancelRemove}
                        className="inline-flex h-11 items-center justify-center rounded-xl border border-hairline bg-white px-3.5 text-[13px] font-semibold text-ink disabled:opacity-55 focus-visible:focus-ring"
                      >
                        Keep it
                      </button>
                      {blocked && !busy ? (
                        <span className="basis-full text-[12px] font-medium text-ink-secondary">
                          Settle the change above before removing anything.
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ol>
        ) : null}

        {editor?.mode === "add" ? (
          <FindingForm
            kind={kind}
            value={editor.draft}
            busy={busy}
            blocked={blocked}
            submitLabel={kind === "diagnosis" ? "Add diagnosis" : "Add investigation"}
            onChange={onDraftChange}
            onSubmit={onSubmit}
            onCancel={onCloseEditor}
          />
        ) : null}
      </div>
    </SectionCard>
  );
}
