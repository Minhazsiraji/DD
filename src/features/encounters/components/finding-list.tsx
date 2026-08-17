"use client";

import * as React from "react";
import { CircleAlert, Pencil, Plus, Trash2 } from "lucide-react";
import { SectionCard, SectionHeader } from "@/components/common/section-card";
import { certaintyLabel, type Certainty, type ListResult } from "../list-schema";
import { FindingForm, emptyFinding, type FindingDraft } from "./finding-form";

export interface FindingRow {
  id: string;
  title: string;
  note: string | null;
  position: number;
  certainty?: string;
}

/**
 * Diagnoses or investigations for this consultation.
 *
 * Rows render in the DATABASE's `position` order, never re-sorted here: the
 * order a doctor put their findings in is part of the record, and the RPCs
 * close the gap when one is removed.
 *
 * Neither list is required. An empty one says so plainly rather than nagging.
 */
export function FindingList({
  kind,
  title,
  icon,
  rows,
  readOnly,
  busy,
  blocked,
  error,
  onAdd,
  onUpdate,
  onRemove,
  onDirtyChange,
  onDismissError,
}: {
  kind: "diagnosis" | "investigation";
  title: string;
  icon: React.ReactNode;
  rows: FindingRow[];
  readOnly: boolean;
  /** A mutation from THIS list is in flight. */
  busy: boolean;
  /** Something else on the screen is mutating, or a conflict is unresolved. */
  blocked: boolean;
  error: string | null;
  onAdd: (draft: FindingDraft) => Promise<ListResult | null>;
  onUpdate: (row: FindingRow, draft: FindingDraft) => Promise<ListResult | null>;
  onRemove: (row: FindingRow) => Promise<ListResult | null>;
  /** True while an add or edit form holds text that is not in the record. */
  onDirtyChange: (dirty: boolean) => void;
  onDismissError: () => void;
}) {
  const [mode, setMode] = React.useState<"idle" | "add" | { editing: string }>("idle");
  const [draft, setDraft] = React.useState<FindingDraft>(emptyFinding());
  const [confirming, setConfirming] = React.useState<string | null>(null);

  const formOpen = mode !== "idle";
  const dirty = formOpen && (draft.title.trim() !== "" || draft.note.trim() !== "");

  // Reported upward so the navigation guard covers a half-written finding, not
  // only the notes draft.
  React.useEffect(() => {
    onDirtyChange(dirty);
    return () => onDirtyChange(false);
  }, [dirty, onDirtyChange]);

  function startAdd() {
    onDismissError();
    setDraft(emptyFinding());
    setMode("add");
  }

  function startEdit(row: FindingRow) {
    onDismissError();
    setDraft({
      title: row.title,
      note: row.note ?? "",
      certainty: (row.certainty as Certainty) ?? "PROVISIONAL",
    });
    setMode({ editing: row.id });
  }

  function close() {
    setMode("idle");
    setDraft(emptyFinding());
  }

  async function submit() {
    // The form stays open and populated unless the database actually accepted
    // it — closing on send would claim success we have not been given.
    const result =
      mode === "add"
        ? await onAdd(draft)
        : typeof mode === "object"
          ? await onUpdate(rows.find((r) => r.id === mode.editing)!, draft)
          : null;

    if (result?.ok) close();
  }

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
              onClick={startAdd}
              disabled={disabled}
              className="inline-flex h-11 items-center gap-1.5 rounded-xl border border-hairline bg-white px-3 text-[13px] font-semibold text-ink transition-colors hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-55 focus-visible:focus-ring"
            >
              <Plus className="size-4" aria-hidden="true" />
              Add
            </button>
          )
        }
      />

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
              const editingThis = typeof mode === "object" && mode.editing === row.id;
              return (
                <li key={row.id} className="py-2.5 first:pt-0 last:pb-0">
                  {editingThis ? (
                    <FindingForm
                      kind={kind}
                      value={draft}
                      busy={busy}
                      blocked={blocked}
                      submitLabel="Save changes"
                      onChange={setDraft}
                      onSubmit={submit}
                      onCancel={close}
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
                            onClick={() => startEdit(row)}
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
                              setConfirming(row.id);
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
                    confirmed by name — not by an icon that happened to be
                    under a thumb.
                  */}
                  {confirming === row.id ? (
                    <div className="mt-2 flex flex-wrap items-center gap-2 rounded-xl bg-danger-soft px-3 py-2.5">
                      <span className="text-[13px] text-ink">
                        Remove <strong className="font-semibold">{row.title}</strong>?
                      </span>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={async () => {
                          const result = await onRemove(row);
                          if (result?.ok) setConfirming(null);
                        }}
                        className="inline-flex h-11 items-center justify-center rounded-xl bg-danger px-3.5 text-[13px] font-semibold text-white disabled:opacity-55 focus-visible:focus-ring"
                      >
                        {busy ? "Removing…" : "Remove"}
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => setConfirming(null)}
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
        ) : null}

        {mode === "add" ? (
          <FindingForm
            kind={kind}
            value={draft}
            busy={busy}
            blocked={blocked}
            submitLabel={kind === "diagnosis" ? "Add diagnosis" : "Add investigation"}
            onChange={setDraft}
            onSubmit={submit}
            onCancel={close}
          />
        ) : null}
      </div>
    </SectionCard>
  );
}
