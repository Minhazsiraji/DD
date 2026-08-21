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

/**
 * The prescription composer's state.
 *
 * The PRESCRIPTION's own version, never `encounters.version` (ADR 0011 §1).
 * The safety philosophy is Stage 6C's, deliberately reused rather than
 * relearned, and it turns on ONE question about every write: did it commit?
 *
 *   definitely NOT      preserve every character, block, recover
 *   we cannot TELL      close the form so it cannot be entered twice, block
 *   definitely YES      close the form for the same reason — it is already there
 *
 * A screen that gets the middle answer wrong in either direction either makes a
 * doctor retype work they can see, or puts a medicine on a prescription twice.
 */

export type ComposerState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved"; at: number }
  | { kind: "error"; message: string }
  /** Refused: nothing was written, and the form below still holds their text. */
  | { kind: "conflict"; message: string }
  /** Refused, and we could not load what the record now holds. Same rule. */
  | { kind: "conflict-unloadable"; message: string }
  /** Committed, then somebody else moved the record. NOT a refusal. */
  | { kind: "advanced"; message: string }
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
  /** What changed under the doctor while they were recovering. Dismissible. */
  const [notice, setNotice] = React.useState<string | null>(null);

  const [editor, setEditor] = React.useState<EditorTarget | null>(null);
  const [draft, setDraft] = React.useState<MedicineDraft>(emptyMedicine());
  const [confirmingRemoval, setConfirmingRemoval] = React.useState<MedicineRow | null>(null);

  // Live copies, readable from inside an awaited mutation — the closure
  // captured when a request left is stale by the time it returns.
  const liveVersion = React.useRef(initialVersion);
  const liveEditor = React.useRef<EditorTarget | null>(null);
  const liveDraft = React.useRef<MedicineDraft>(draft);
  const liveRemoval = React.useRef<MedicineRow | null>(null);
  const gate = React.useRef(new MutationGate()).current;
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    liveEditor.current = editor;
  }, [editor]);
  React.useEffect(() => {
    liveDraft.current = draft;
  }, [draft]);
  React.useEffect(() => {
    liveRemoval.current = confirmingRemoval;
  }, [confirmingRemoval]);

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

  /** What the doctor is holding, as `applyOutcome` understands it. */
  const held = React.useCallback(
    (): HeldState => ({
      editor: liveEditor.current,
      draft: liveDraft.current,
      confirmingRemoval: liveRemoval.current,
    }),
    [],
  );

  const adopt = React.useCallback((next: HeldState) => {
    setEditor(next.editor);
    setDraft(next.draft);
    setConfirmingRemoval(next.confirmingRemoval);
  }, []);

  /**
   * Every mutation passes through here, or does not happen.
   *
   * The editor is closed on exactly the outcomes where the write is on the
   * record or may be — success, `write-confirmed-advanced`, `unconfirmed` —
   * and kept on both refusals, because a refusal means the text was not saved
   * and is the doctor's only copy.
   */
  const run = React.useCallback(
    async (
      fn: (expectedVersion: number) => Promise<RxResult>,
      options?: { closeOnSuccess?: boolean },
    ) => {
      if (gate.isBusy || gate.isClosed) return null;
      setBusy(true);
      setState({ kind: "saving" });

      /**
       * Bounded. A clinical write that never answers is not allowed to leave
       * the screen on "Saving…" — see `deadline.ts`. The deadline gives up on
       * WAITING, never on the write, and never retries.
       */
      const result = await gate.run(() => withWriteDeadline(fn(liveVersion.current)));
      setBusy(false);
      if (!result) return null;

      if (result.ok) {
        commitVersion(result.version);
        setItems(result.items);
        setState({ kind: "saved", at: Date.now() });
        // A move has no editor to close; everything else submitted a form.
        if (options?.closeOnSuccess !== false) {
          adopt(applyOutcome({ kind: "ok", held: held(), fresh: result.items }).held);
        } else {
          setConfirmingRemoval(null);
        }
        return result;
      }

      /**
       * Everything below follows from ONE pure decision (`applyOutcome`), not
       * from branches written twice. Blocker 1 and Blocker 2 both happened
       * because the rule lived as conditionals in two files and two of the
       * outcomes quietly merged; a table cannot merge without a test noticing.
       */
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
        case "conflict":
          setState({ kind: "conflict", message: result.message });
          break;
        case "conflict-unloadable":
          setState({ kind: "conflict-unloadable", message: result.message });
          break;
        case "write-confirmed-advanced":
          setState({ kind: "advanced", message: result.message });
          break;
        case "unconfirmed":
          setState({ kind: "unknown", message: result.message });
          break;
        default:
          setState({ kind: "error", message: result.message });
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

  /**
   * Recover: re-read, settle what the doctor is holding against it, unblock.
   *
   * Never discards a typed field. It only rebases them onto the medicine as it
   * now stands (see `reconcileHeld`), so an intentional save afterwards is
   * still possible — that is the whole point of preserving a refused write.
   */
  const resync = React.useCallback(async () => {
    if (gate.isBusy) return;
    setBusy(true);
    const result = await refreshPrescriptionAction(prescriptionId);
    setBusy(false);

    if (!result.ok) {
      /**
       * Still cannot load it. A KNOWN refusal must not decay into "may have
       * been saved" just because a second read also failed — nothing has
       * happened since to make its fate any less certain.
       */
      setState((s) =>
        s.kind === "conflict-unloadable" || s.kind === "conflict"
          ? s
          : { kind: "unknown", message: RX_UNCONFIRMED_MESSAGE },
      );
      return;
    }

    commitVersion(result.version);
    setItems(result.items);

    /**
     * The reviewer's requirement: compare what was preserved against what the
     * record actually holds BEFORE letting the doctor write again. A rejected
     * edit whose medicine has since been removed must not be re-saved into a
     * row that is gone.
     */
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
    dirty, openAdd, openEdit, closeEditor, applySuggestion,
    submit, remove, move, resync,
  };
}
