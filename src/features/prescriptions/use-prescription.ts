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
import { reusePrescriptionItemsAction } from "./m3-actions";
import { withWriteDeadline } from "./deadline";
import { RX_UNCONFIRMED_MESSAGE } from "./errors";
import { applyOutcome, reconcileHeld, type HeldState } from "./recovery";
import {
  changedPatch,
  draftFromRow,
  emptyMedicine,
  medicineIsDirty,
  patchFromDraft,
  type MedicineDraft,
  type MedicineRow,
} from "./schema";

export type ComposerState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved"; at: number }
  | { kind: "error"; message: string }
  | { kind: "conflict"; message: string }
  | { kind: "conflict-unloadable"; message: string }
  | { kind: "advanced"; message: string }
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
  const [notice, setNotice] = React.useState<string | null>(null);
  const [editor, setEditor] = React.useState<EditorTarget | null>(null);
  const [draft, setDraft] = React.useState<MedicineDraft>(emptyMedicine());
  const [confirmingRemoval, setConfirmingRemoval] = React.useState<MedicineRow | null>(null);

  const liveVersion = React.useRef(initialVersion);
  const liveEditor = React.useRef<EditorTarget | null>(null);
  const liveDraft = React.useRef<MedicineDraft>(draft);
  const liveRemoval = React.useRef<MedicineRow | null>(null);
  const gate = React.useRef(new MutationGate()).current;
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => { liveEditor.current = editor; }, [editor]);
  React.useEffect(() => { liveDraft.current = draft; }, [draft]);
  React.useEffect(() => { liveRemoval.current = confirmingRemoval; }, [confirmingRemoval]);

  const baseDraft = editor?.mode === "edit" ? draftFromRow(editor.row) : null;
  const dirty = editor !== null && medicineIsDirty(draft, baseDraft);
  const blocked =
    busy ||
    state.kind === "conflict" ||
    state.kind === "conflict-unloadable" ||
    state.kind === "advanced" ||
    state.kind === "unknown" ||
    readOnly;

  const commitVersion = React.useCallback((next: number) => {
    liveVersion.current = next;
    setVersion(next);
  }, []);

  const held = React.useCallback(
    (): HeldState => ({ editor: liveEditor.current, draft: liveDraft.current, confirmingRemoval: liveRemoval.current }),
    [],
  );
  const adopt = React.useCallback((next: HeldState) => {
    setEditor(next.editor);
    setDraft(next.draft);
    setConfirmingRemoval(next.confirmingRemoval);
  }, []);

  /** Every prescription mutation, including M3 reuse, passes through this one gate/version. */
  const run = React.useCallback(
    async (fn: (expectedVersion: number) => Promise<RxResult>, options?: { closeOnSuccess?: boolean }) => {
      if (gate.isBusy || gate.isClosed) return null;
      setBusy(true);
      setState({ kind: "saving" });
      const result = await gate.run(() => withWriteDeadline(fn(liveVersion.current)));
      setBusy(false);
      if (!result) return null;

      if (result.ok) {
        commitVersion(result.version);
        setItems(result.items);
        setState({ kind: "saved", at: Date.now() });
        if (options?.closeOnSuccess !== false) {
          adopt(applyOutcome({ kind: "ok", held: held(), fresh: result.items }).held);
        } else {
          setConfirmingRemoval(null);
        }
        return result;
      }

      const fresh = "items" in result ? result.items : null;
      if ("version" in result) {
        commitVersion(result.version);
        setItems(result.items);
      }
      const settled = applyOutcome({ kind: result.kind, held: held(), fresh });
      adopt(settled.held);
      setNotice(settled.notice);
      if (settled.blocks) gate.close();

      switch (result.kind) {
        case "conflict": setState({ kind: "conflict", message: result.message }); break;
        case "conflict-unloadable": setState({ kind: "conflict-unloadable", message: result.message }); break;
        case "write-confirmed-advanced": setState({ kind: "advanced", message: result.message }); break;
        case "unconfirmed": setState({ kind: "unknown", message: result.message }); break;
        default: setState({ kind: "error", message: result.message });
      }
      return result;
    },
    [gate, commitVersion, held, adopt],
  );

  const openAdd = React.useCallback(() => {
    if (readOnly) return;
    setEditor({ mode: "add" });
    setDraft(emptyMedicine());
    setState((s) => (s.kind === "error" ? { kind: "idle" } : s));
  }, [readOnly]);

  const openEdit = React.useCallback((row: MedicineRow) => {
    if (readOnly) return;
    setEditor({ mode: "edit", row });
    setDraft(draftFromRow(row));
    setState((s) => (s.kind === "error" ? { kind: "idle" } : s));
  }, [readOnly]);

  const closeEditor = React.useCallback(() => {
    setEditor(null);
    setDraft(emptyMedicine());
  }, []);

  /** Signed-history selection populates the proposed form; it never commits. */
  const applySuggestion = React.useCallback((suggestion: MedicineDraft) => {
    setDraft((prev) => ({ ...suggestion, instructions: prev.instructions || suggestion.instructions }));
  }, []);

  const proposeMedicine = React.useCallback((suggestion: MedicineDraft) => {
    if (readOnly || blocked) return;
    setEditor({ mode: "add" });
    setDraft(suggestion);
    setState((s) => (s.kind === "error" ? { kind: "idle" } : s));
  }, [readOnly, blocked]);

  const submit = React.useCallback(async () => {
    if (!editor || draft.displayName.trim() === "") return;
    if (editor.mode === "add") {
      await run((expectedVersion) => addMedicineAction({ prescriptionId, expectedVersion, patch: patchFromDraft(draft) }));
      return;
    }
    const patch = changedPatch(draft, draftFromRow(editor.row));
    if (Object.keys(patch).length === 0) { closeEditor(); return; }
    await run((expectedVersion) => updateMedicineAction({ prescriptionId, expectedVersion, itemId: editor.row.id, patch }));
  }, [editor, draft, prescriptionId, run, closeEditor]);

  const remove = React.useCallback(async (row: MedicineRow) => {
    await run((expectedVersion) => removeMedicineAction({ prescriptionId, expectedVersion, itemId: row.id }));
  }, [prescriptionId, run]);

  const move = React.useCallback(async (row: MedicineRow, toPosition: number) => {
    if (toPosition < 1 || toPosition > items.length || toPosition === row.position) return;
    await run(
      (expectedVersion) => moveMedicineAction({ prescriptionId, expectedVersion, itemId: row.id, toPosition }),
      { closeOnSuccess: false },
    );
  }, [prescriptionId, items.length, run]);

  const reuseHistory = React.useCallback(async (input: {
    sourcePrescriptionId: string;
    mode: "ALL" | "SELECTED";
    selectedItemIds?: string[];
    appendConfirmed: boolean;
    idempotencyKey: string;
  }) => {
    // Reuse and an open medicine editor cannot coexist: selection/review must be explicit.
    if (liveEditor.current) return null;
    return run(
      (expectedVersion) => reusePrescriptionItemsAction({ prescriptionId, expectedVersion, ...input }),
      { closeOnSuccess: false },
    );
  }, [prescriptionId, run]);

  const resync = React.useCallback(async () => {
    if (gate.isBusy) return;
    setBusy(true);
    const result = await refreshPrescriptionAction(prescriptionId);
    setBusy(false);
    if (!result.ok) {
      setState((s) =>
        s.kind === "conflict-unloadable" || s.kind === "conflict"
          ? s
          : { kind: "unknown", message: RX_UNCONFIRMED_MESSAGE },
      );
      return;
    }
    commitVersion(result.version);
    setItems(result.items);
    const settled = reconcileHeld(held(), result.items);
    adopt(settled.held);
    setNotice(settled.notice);
    gate.open();
    setState({ kind: "idle" });
  }, [gate, prescriptionId, commitVersion, held, adopt]);

  const dismissNotice = React.useCallback(() => setNotice(null), []);

  return {
    items, version, state, busy, blocked, notice, dismissNotice,
    editor, draft, setDraft, confirmingRemoval, setConfirmingRemoval,
    dirty, openAdd, openEdit, closeEditor, applySuggestion, proposeMedicine,
    submit, remove, move, reuseHistory, resync,
  };
}
