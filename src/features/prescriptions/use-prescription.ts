"use client";

import * as React from "react";
import { MutationGate } from "@/features/encounters/mutation-gate";
import {
  addMedicineAction,
  moveMedicineAction,
  refreshPrescriptionAction,
  removeMedicineAction,
  updateMedicineAction,
  type RxResult,
} from "./actions";
import { RX_UNCONFIRMED_MESSAGE } from "./errors";
import {
  changedPatch,
  draftFromRow,
  emptyMedicine,
  medicineIsDirty,
  patchFromDraft,
  type MedicineDraft,
  type MedicineRow,
} from "./schema";

/**
 * The prescription composer's state.
 *
 * The PRESCRIPTION's own version, never `encounters.version` (ADR 0011 §1).
 * The safety philosophy is Stage 6C's, deliberately reused rather than
 * relearned:
 *
 *   - a definitely-REJECTED write preserves every character the doctor typed
 *   - an UNCERTAIN write closes the form so the medicine cannot be entered
 *     twice, and blocks until the record is re-read
 *   - the gate is an invariant in the coordinator, not a disabled button
 *   - nothing is reported saved that is not saved
 */

export type ComposerState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved"; at: number }
  | { kind: "error"; message: string }
  /** Refused: nothing was written, and the form below still holds their text. */
  | { kind: "conflict"; message: string }
  /** Unknown: the write may have landed. Blocks until a successful re-read. */
  | { kind: "unknown"; message: string };

export type EditorTarget = { mode: "add" } | { mode: "edit"; row: MedicineRow };

export function usePrescription(
  prescriptionId: string,
  initialVersion: number,
  initialItems: MedicineRow[],
  readOnly: boolean,
) {
  const [items, setItems] = React.useState(initialItems);
  const [version, setVersion] = React.useState(initialVersion);
  const [state, setState] = React.useState<ComposerState>({ kind: "idle" });

  const [editor, setEditor] = React.useState<EditorTarget | null>(null);
  const [draft, setDraft] = React.useState<MedicineDraft>(emptyMedicine());
  const [confirmingRemoval, setConfirmingRemoval] = React.useState<MedicineRow | null>(null);

  // Live copies, readable from inside an awaited mutation — the closure
  // captured when a request left is stale by the time it returns.
  const liveVersion = React.useRef(initialVersion);
  const gate = React.useRef(new MutationGate()).current;
  const [busy, setBusy] = React.useState(false);

  const baseDraft = editor?.mode === "edit" ? draftFromRow(editor.row) : null;
  const dirty = editor !== null && medicineIsDirty(draft, baseDraft);
  const blocked = busy || state.kind === "conflict" || state.kind === "unknown" || readOnly;

  const commitVersion = React.useCallback((next: number) => {
    liveVersion.current = next;
    setVersion(next);
  }, []);

  /**
   * Every mutation passes through here, or does not happen.
   *
   * `apply` decides what to do with the answer; the editor is closed ONLY on a
   * genuine success or on an unconfirmed write — never on a refusal, because a
   * refusal means the text was not saved and is the doctor's only copy.
   */
  const run = React.useCallback(
    async (fn: (expectedVersion: number) => Promise<RxResult>, options?: { closeOnSuccess?: boolean }) => {
      if (gate.isBusy || gate.isClosed) return null;
      setBusy(true);
      setState({ kind: "saving" });

      const result = await gate.run(() => fn(liveVersion.current));
      setBusy(false);
      if (!result) return null;

      if (result.ok) {
        commitVersion(result.version);
        setItems(result.items);
        setState({ kind: "saved", at: Date.now() });
        if (options?.closeOnSuccess !== false) {
          setEditor(null);
          setDraft(emptyMedicine());
        }
        setConfirmingRemoval(null);
        return result;
      }

      if (result.kind === "conflict") {
        // Refused. Adopt the record's rows and version, keep the form intact.
        commitVersion(result.version);
        setItems(result.items);
        gate.close();
        setState({ kind: "conflict", message: result.message });
        return result;
      }

      if (result.kind === "unconfirmed") {
        // May have landed. Close the form so it cannot be submitted twice.
        setEditor(null);
        setDraft(emptyMedicine());
        setConfirmingRemoval(null);
        gate.close();
        setState({ kind: "unknown", message: result.message });
        return result;
      }

      setState({ kind: "error", message: result.message });
      return result;
    },
    [gate, commitVersion],
  );

  const openAdd = React.useCallback(() => {
    if (readOnly) return;
    setEditor({ mode: "add" });
    setDraft(emptyMedicine());
    setState((s) => (s.kind === "error" ? { kind: "idle" } : s));
  }, [readOnly]);

  const openEdit = React.useCallback(
    (row: MedicineRow) => {
      if (readOnly) return;
      setEditor({ mode: "edit", row });
      setDraft(draftFromRow(row));
      setState((s) => (s.kind === "error" ? { kind: "idle" } : s));
    },
    [readOnly],
  );

  const closeEditor = React.useCallback(() => {
    setEditor(null);
    setDraft(emptyMedicine());
  }, []);

  /** A suggestion POPULATES the form. It is not stored and not referenced. */
  const applySuggestion = React.useCallback((s: MedicineDraft) => {
    setDraft((prev) => ({ ...s, instructions: prev.instructions || s.instructions }));
  }, []);

  const submit = React.useCallback(async () => {
    if (!editor || draft.displayName.trim() === "") return;

    if (editor.mode === "add") {
      await run((expectedVersion) =>
        addMedicineAction({
          prescriptionId,
          expectedVersion,
          patch: patchFromDraft(draft),
        }),
      );
      return;
    }

    const patch = changedPatch(draft, draftFromRow(editor.row));
    if (Object.keys(patch).length === 0) {
      closeEditor();
      return;
    }
    await run((expectedVersion) =>
      updateMedicineAction({
        prescriptionId,
        expectedVersion,
        itemId: editor.row.id,
        patch,
      }),
    );
  }, [editor, draft, prescriptionId, run, closeEditor]);

  const remove = React.useCallback(
    async (row: MedicineRow) => {
      await run((expectedVersion) =>
        removeMedicineAction({ prescriptionId, expectedVersion, itemId: row.id }),
      );
    },
    [prescriptionId, run],
  );

  const move = React.useCallback(
    async (row: MedicineRow, toPosition: number) => {
      if (toPosition < 1 || toPosition > items.length || toPosition === row.position) return;
      await run(
        (expectedVersion) =>
          moveMedicineAction({ prescriptionId, expectedVersion, itemId: row.id, toPosition }),
        { closeOnSuccess: false },
      );
    },
    [prescriptionId, items.length, run],
  );

  /** Re-read after a refusal or an unknown outcome, without touching the form. */
  const resync = React.useCallback(async () => {
    if (gate.isBusy) return;
    setBusy(true);
    const result = await refreshPrescriptionAction(prescriptionId);
    setBusy(false);
    if (!result.ok) {
      setState({ kind: "unknown", message: RX_UNCONFIRMED_MESSAGE });
      return;
    }
    commitVersion(result.version);
    setItems(result.items);
    gate.open();
    setState({ kind: "idle" });
  }, [gate, prescriptionId, commitVersion]);

  return {
    items, version, state, busy, blocked,
    editor, draft, setDraft, confirmingRemoval, setConfirmingRemoval,
    dirty, openAdd, openEdit, closeEditor, applySuggestion,
    submit, remove, move, resync,
  };
}
