import { changedKeys } from "./draft-patch";
import { draftFromRow, type FindingDraft, type FindingEditor, type FindingRow, type ListKind } from "./finding-types";
import type { DraftValues } from "./schema";

/**
 * WHAT the conflict is about, not merely THAT there is one.
 *
 * The version boundary is encounter-wide, so any mutation can be refused
 * because of any other. But the DECISION a doctor has to make is specific: a
 * refused diagnosis edit is not answered by choosing between two versions of
 * the examination note.
 *
 * Resolving a finding conflict through the notes panel is last-write-wins
 * wearing an unrelated dialog: press either notes button, and the stale
 * diagnosis can then be submitted over the newer one without the two ever
 * being compared.
 */

export type FindingConflict =
  /** The row being edited changed underneath. Both versions must be shown. */
  | { kind: "changed"; list: ListKind; rowId: string; mine: FindingDraft; base: FindingRow; theirs: FindingRow }
  /** The row being edited is gone. The typed text must not vanish with it. */
  | { kind: "removed"; list: ListKind; rowId: string; mine: FindingDraft; base: FindingRow }
  /** An add form held text when something unrelated moved the encounter. */
  | { kind: "interrupted"; list: ListKind; mine: FindingDraft }
  /**
   * A PENDING REMOVAL was refused. These three exist because a removal has no
   * open editor, so it had no subject at all — and a conflict with no subject
   * renders no panel while still blocking the screen. That is a consultation a
   * doctor cannot get out of.
   */
  | { kind: "removal-stale"; list: ListKind; rowId: string; base: FindingRow }
  | { kind: "removal-changed"; list: ListKind; rowId: string; base: FindingRow; theirs: FindingRow }
  | { kind: "removal-gone"; list: ListKind; rowId: string; base: FindingRow };

function sameFinding(a: FindingRow, b: FindingRow): boolean {
  return (
    a.title.trim() === b.title.trim() &&
    (a.note ?? "").trim() === (b.note ?? "").trim() &&
    (a.certainty ?? "") === (b.certainty ?? "")
  );
}

/**
 * Did the row this editor is working on move, vanish, or stay put?
 *
 * `position` is deliberately NOT compared: a finding that only shifted up the
 * list because something above it was removed has not changed clinically, and
 * asking a doctor to adjudicate that would train them to dismiss the dialog.
 */
export function detectFindingConflict(
  editor: FindingEditor | null,
  serverRows: readonly FindingRow[],
): FindingConflict | null {
  if (!editor) return null;

  if (editor.mode === "add") {
    const hasText = editor.draft.title.trim() !== "" || editor.draft.note.trim() !== "";
    return hasText ? { kind: "interrupted", list: editor.list, mine: editor.draft } : null;
  }

  if (!editor.rowId || !editor.base) return null;

  const theirs = serverRows.find((r) => r.id === editor.rowId);
  if (!theirs) {
    return { kind: "removed", list: editor.list, rowId: editor.rowId, mine: editor.draft, base: editor.base };
  }
  if (sameFinding(theirs, editor.base)) return null;

  return { kind: "changed", list: editor.list, rowId: editor.rowId, mine: editor.draft, base: editor.base, theirs };
}

/**
 * A removal that the database refused.
 *
 * The doctor confirmed "remove this", the encounter had already moved, and the
 * delete did not happen. They are owed one of three different sentences — and
 * in every case a FRESH confirmation, because the thing they agreed to remove
 * may no longer be the thing that is there.
 */
export function detectRemovalConflict(
  pending: { list: ListKind; row: FindingRow } | null,
  serverRows: readonly FindingRow[],
): FindingConflict | null {
  if (!pending) return null;

  const theirs = serverRows.find((r) => r.id === pending.row.id);
  if (!theirs) {
    return { kind: "removal-gone", list: pending.list, rowId: pending.row.id, base: pending.row };
  }
  if (!sameFinding(theirs, pending.row)) {
    return {
      kind: "removal-changed",
      list: pending.list,
      rowId: pending.row.id,
      base: pending.row,
      theirs,
    };
  }
  return { kind: "removal-stale", list: pending.list, rowId: pending.row.id, base: pending.row };
}

/**
 * Is there a NOTES decision to make?
 *
 * Only if the doctor would actually be choosing between two different texts.
 * Opening an empty comparison table because a diagnosis was refused teaches
 * people to click past conflict dialogs, which is worse than not showing one.
 */
export function notesConflicted(mine: DraftValues, theirs: DraftValues): boolean {
  return changedKeys(mine, theirs).length > 0;
}

/** Resolving a "changed" finding by taking the server's version. */
export function editorTakingTheirs(
  editor: FindingEditor,
  theirs: FindingRow,
): FindingEditor {
  return { ...editor, base: theirs, draft: draftFromRow(theirs) };
}

/**
 * Resolving a "changed" finding by keeping the local text.
 *
 * The base moves to the server's row so the editor is no longer stale — the
 * doctor may then submit, and the submission carries their words rather than
 * silently re-sending fields they never looked at.
 */
export function editorKeepingMine(
  editor: FindingEditor,
  theirs: FindingRow,
): FindingEditor {
  return { ...editor, base: theirs };
}

/**
 * The row was removed elsewhere and the doctor wants to keep what they wrote.
 *
 * It becomes an ADD: there is no longer a row to correct, and re-creating one
 * under the old id would be a fiction. Nothing is submitted automatically.
 */
export function editorAsNewFinding(editor: FindingEditor): FindingEditor {
  return { ...editor, mode: "add", rowId: null, base: null };
}
