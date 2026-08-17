import type { Certainty } from "./list-schema";

/** Diagnoses and investigations share a shape; only the labels differ. */
export type ListKind = "diagnosis" | "investigation";

export interface FindingRow {
  id: string;
  title: string;
  note: string | null;
  position: number;
  /** Diagnoses only. */
  certainty?: string;
}

export interface FindingDraft {
  /** Diagnosis label or investigation name — the row's meaning, never blank. */
  title: string;
  note: string;
  certainty: Certainty;
}

export const emptyFinding = (): FindingDraft => ({
  title: "",
  note: "",
  certainty: "PROVISIONAL",
});

export function draftFromRow(row: FindingRow): FindingDraft {
  return {
    title: row.title,
    note: row.note ?? "",
    certainty: (row.certainty as Certainty) ?? "PROVISIONAL",
  };
}

/** What is open on screen and holding text that is not in the record. */
export interface FindingEditor {
  list: ListKind;
  mode: "add" | "edit";
  /** The row being corrected; null while adding. */
  rowId: string | null;
  /** The row as it was when editing STARTED — the baseline for "did it move?". */
  base: FindingRow | null;
  draft: FindingDraft;
}

export function editorIsDirty(editor: FindingEditor | null): boolean {
  if (!editor) return false;
  if (editor.mode === "add") {
    return editor.draft.title.trim() !== "" || editor.draft.note.trim() !== "";
  }
  if (!editor.base) return true;
  const base = draftFromRow(editor.base);
  return (
    base.title.trim() !== editor.draft.title.trim() ||
    base.note.trim() !== editor.draft.note.trim() ||
    base.certainty !== editor.draft.certainty
  );
}
