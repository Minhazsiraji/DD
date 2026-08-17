"use client";

import * as React from "react";
import { saveConsultationAction } from "./actions";
import { refreshListsAction } from "./list-actions";
import { validateVitals } from "./draft-patch";
import {
  applySaveResult,
  beginSave,
  keepLocalEdits,
  ownedKeys,
  takeServerVersion,
  type SaveState,
} from "./draft-state";
import {
  detectFindingConflict,
  detectRemovalConflict,
  editorAsNewFinding,
  editorKeepingMine,
  editorTakingTheirs,
  notesConflicted,
  type FindingConflict,
} from "./finding-conflict";
import { versionMoved, type ListResult } from "./list-schema";
import {
  CONFLICT_UNLOADABLE_MESSAGE,
  WRITE_UNCONFIRMED_MESSAGE,
  type DesyncKind,
} from "./version-contract";
import {
  draftFromRow,
  editorIsDirty,
  emptyFinding,
  type FindingDraft,
  type FindingEditor,
  type FindingRow,
  type ListKind,
} from "./finding-types";
import { MutationGate } from "./mutation-gate";
import type { Consultation, ServerState } from "./queries";
import type { DraftKey, DraftValues } from "./schema";

/**
 * ONE encounter, ONE version, ONE queue, ONE gate.
 *
 * Every mutation shares `encounters.version` (ADR 0010 §6c), so the version
 * lives here and nothing mutates except through `run`. Two things `run`
 * refuses, and both are invariants rather than button states:
 *
 *   - a second mutation while one is in flight
 *   - ANY mutation while a conflict is unresolved, or while the on-screen list
 *     is known to be out of step with the record
 *
 * Disabling a button is usability. This is the rule.
 */

export type MutationKind = "notes" | "list";

/**
 * A conflict is encounter-wide at the version boundary, but the DECISION is
 * not. A refused diagnosis edit is not answered by choosing between two
 * versions of the examination note, so every subject is tracked separately and
 * ALL of them must be settled before mutations resume.
 */
export interface ConflictState {
  message: string;
  server: ServerState;
  /** Present only when the notes genuinely differ — never an empty table. */
  notes: { theirs: DraftValues } | null;
  findings: FindingConflict[];
}

export interface ConsultationSession {
  values: DraftValues;
  dirtyKeys: DraftKey[];
  isDirty: boolean;
  vitalErrors: ReturnType<typeof validateVitals>;
  hasVitalErrors: boolean;
  setField: (key: DraftKey, value: string) => void;
  save: () => Promise<void>;

  diagnoses: FindingRow[];
  investigations: FindingRow[];
  editors: Record<ListKind, FindingEditor | null>;
  confirmingRemoval: { list: ListKind; row: FindingRow } | null;
  openAdd: (list: ListKind) => void;
  openEdit: (list: ListKind, row: FindingRow) => void;
  closeEditor: (list: ListKind) => void;
  setDraft: (list: ListKind, draft: FindingDraft) => void;
  askRemove: (list: ListKind, row: FindingRow) => void;
  cancelRemove: () => void;
  runList: (
    list: ListKind,
    fn: (expectedVersion: number) => Promise<ListResult>,
    options?: { closeEditorOnSuccess?: boolean },
  ) => Promise<ListResult | null>;

  version: number;
  state: SaveState;
  busy: MutationKind | null;
  blocked: boolean;
  listError: string | null;
  notice: string | null;
  dismissNotice: () => void;
  desynced: { kind: DesyncKind; message: string } | null;
  retrySync: () => Promise<void>;
  clearListError: () => void;
  conflict: ConflictState | null;
  keepMine: () => void;
  takeTheirs: () => void;
  resolveFinding: (
    conflict: FindingConflict,
    choice: "mine" | "theirs" | "discard" | "as-new" | "acknowledge",
  ) => void;
  anythingUnsaved: boolean;
}

/**
 * The truthful notes state when there is no notes DECISION to make.
 *
 * Never fabricates "dirty" — a save bar that says "0 unsaved changes" is
 * reporting a state that cannot exist, and it appeared because a finding-only
 * conflict was setting the notes to dirty on the way past.
 */
function deriveNotesState(values: DraftValues, baseline: DraftValues): SaveState {
  return ownedKeys(values, baseline).length > 0 ? { kind: "dirty" } : { kind: "clean" };
}

export function useConsultation(consultation: Consultation): ConsultationSession {
  const encounterId = consultation.id;

  const [values, setValues] = React.useState<DraftValues>(consultation.values);
  const [baseline, setBaseline] = React.useState<DraftValues>(consultation.values);
  const [version, setVersion] = React.useState(consultation.version);
  const [state, setState] = React.useState<SaveState>({ kind: "clean" });
  const [busy, setBusy] = React.useState<MutationKind | null>(null);
  const [listError, setListError] = React.useState<string | null>(null);
  const [desynced, setDesynced] = React.useState<{ kind: DesyncKind; message: string } | null>(null);
  /** Read synchronously when deciding whether the gate may reopen. */
  const desyncedRef = React.useRef<{ kind: DesyncKind; message: string } | null>(null);
  const [conflict, setConflict] = React.useState<ConflictState | null>(null);

  const [diagnoses, setDiagnoses] = React.useState<FindingRow[]>(
    consultation.diagnoses.map((d) => ({
      id: d.id, title: d.label, note: d.note, position: d.position, certainty: d.certainty,
    })),
  );
  const [investigations, setInvestigations] = React.useState<FindingRow[]>(
    consultation.investigations.map((i) => ({
      id: i.id, title: i.name, note: i.note, position: i.position,
    })),
  );

  const [editors, setEditors] = React.useState<Record<ListKind, FindingEditor | null>>({
    diagnosis: null,
    investigation: null,
  });
  const [confirmingRemoval, setConfirmingRemoval] =
    React.useState<{ list: ListKind; row: FindingRow } | null>(null);
  /** Informational only — the encounter moved but nothing here disagreed. */
  const [notice, setNotice] = React.useState<string | null>(null);

  // Live copies, readable from inside an awaited mutation — the closure
  // captured when a request left is stale by the time it returns.
  const liveValues = React.useRef(consultation.values);
  const liveVersion = React.useRef(consultation.version);
  const liveEditors = React.useRef(editors);
  const livePending = React.useRef<{ list: ListKind; row: FindingRow } | null>(null);
  /** One gate for the whole screen; see mutation-gate.ts. */
  const gate = React.useRef(new MutationGate()).current;

  const commitValues = React.useCallback((next: DraftValues) => {
    liveValues.current = next;
    setValues(next);
  }, []);

  const commitVersion = React.useCallback((next: number) => {
    liveVersion.current = next;
    setVersion(next);
  }, []);

  const commitEditors = React.useCallback(
    (next: Record<ListKind, FindingEditor | null>) => {
      liveEditors.current = next;
      setEditors(next);
    },
    [],
  );

  /**
   * The pending removal is mirrored into a ref because conflict detection runs
   * inside an awaited mutation, where React state is a stale closure. It is a
   * conflict SUBJECT, not a piece of view state.
   */
  const commitPending = React.useCallback(
    (next: { list: ListKind; row: FindingRow } | null) => {
      livePending.current = next;
      setConfirmingRemoval(next);
    },
    [],
  );

  const rowsFor = React.useCallback(
    (list: ListKind, server: ServerState): FindingRow[] =>
      list === "diagnosis"
        ? server.diagnoses.map((d) => ({
            id: d.id, title: d.label, note: d.note, position: d.position, certainty: d.certainty,
          }))
        : server.investigations.map((i) => ({
            id: i.id, title: i.name, note: i.note, position: i.position,
          })),
    [],
  );

  const applyRows = React.useCallback(
    (server: ServerState) => {
      setDiagnoses(rowsFor("diagnosis", server));
      setInvestigations(rowsFor("investigation", server));
    },
    [rowsFor],
  );

  const dirtyKeys = ownedKeys(values, baseline);
  const isDirty = dirtyKeys.length > 0;
  const vitalErrors = validateVitals(values);
  const hasVitalErrors = Object.keys(vitalErrors).length > 0;
  const blocked = conflict !== null || desynced !== null || busy !== null;

  /**
   * The gate closes SYNCHRONOUSLY, never from an effect.
   *
   * A conflict schedules React state, but the mutation that produced it
   * releases `inFlight` in its own `finally` — which runs before any effect. In
   * that window `gated.current` was still false, so a direct coordinator call
   * could start another mutation against a version we already knew was stale.
   * Button state hid it; the coordinator is supposed to BE the invariant.
   */
  const closeGate = React.useCallback(() => gate.close(), [gate]);
  const openGate = React.useCallback(() => gate.open(), [gate]);

  const enterDesync = React.useCallback(
    (message: string, kind: DesyncKind) => {
      closeGate();
      const next = { kind, message };
      desyncedRef.current = next;
      setDesynced(next);
    },
    [closeGate],
  );

  const setField = React.useCallback(
    (key: DraftKey, value: string) => {
      if (liveValues.current[key] === value) return;
      commitValues({ ...liveValues.current, [key]: value });
      setState((prev) =>
        prev.kind === "conflict" || prev.kind === "saving" ? prev : { kind: "dirty" },
      );
    },
    [commitValues],
  );

  /**
   * Enter conflict, naming every subject the doctor must settle.
   *
   * The lists are refreshed because rows are server state. The editors are NOT
   * touched: their text is the doctor's, and a comparison they have not seen
   * cannot be resolved on their behalf.
   */
  const enterConflict = React.useCallback(
    (server: ServerState, message: string) => {
      applyRows(server);
      commitVersion(server.version);

      const findings: FindingConflict[] = [];
      for (const list of ["diagnosis", "investigation"] as ListKind[]) {
        const rows = rowsFor(list, server);
        const fromEditor = detectFindingConflict(liveEditors.current[list], rows);
        if (fromEditor) findings.push(fromEditor);

        /**
         * A PENDING REMOVAL is a subject too. It has no open editor, so it used
         * to produce nothing at all — and a conflict with no subjects renders
         * no panel while still blocking every mutation. The doctor was left
         * looking at "settle the change above" with nothing above to settle.
         */
        const pending = livePending.current;
        if (pending && pending.list === list) {
          const fromRemoval = detectRemovalConflict(pending, rows);
          if (fromRemoval) findings.push(fromRemoval);
        }
      }

      const notesDiffer = notesConflicted(liveValues.current, server.values);

      /**
       * NO SUBJECTS, NO CONFLICT.
       *
       * The encounter moved, but nothing on this screen disagrees with it: the
       * notes match, no editor is stale, no pending removal is affected. There
       * is no clinical decision to ask for, so the refreshed state is simply
       * adopted and the doctor is told what happened. Storing a conflict here
       * is what produced a screen that could not be unblocked.
       */
      if (!notesDiffer && findings.length === 0) {
        setBaseline(server.values);
        setConflict(null);
        openGate();
        setNotice(
          "This consultation was updated somewhere else. Nothing you typed was affected, and the latest version is shown.",
        );
        setState(deriveNotesState(liveValues.current, server.values));
        return;
      }

      closeGate();
      setNotice(null);
      setConflict({
        message,
        server,
        notes: notesDiffer ? { theirs: server.values } : null,
        findings,
      });

      /**
       * The notes banner is a NOTES decision. When only a finding moved it must
       * not appear — and it must not invent a dirty state either, or the save
       * bar ends up announcing "0 unsaved changes".
       */
      setState((prev) =>
        notesDiffer
          ? { kind: "conflict", message, theirs: server.values, version: server.version }
          : prev.kind === "saving"
            ? deriveNotesState(liveValues.current, baseline)
            : prev,
      );
    },
    [applyRows, baseline, closeGate, commitVersion, openGate, rowsFor],
  );

  /** Every mutation on this screen passes through here, or does not happen. */
  const run = React.useCallback(
    async <T,>(kind: MutationKind, fn: () => Promise<T>): Promise<T | null> => {
      if (gate.isBusy || gate.isClosed) return null;
      setBusy(kind);
      try {
        return await gate.run(fn);
      } finally {
        setBusy(null);
      }
    },
    [gate],
  );

  const save = React.useCallback(async () => {
    const attempt = beginSave(liveValues.current, baseline);
    if (!attempt) {
      setState({ kind: "clean" });
      return;
    }
    if (Object.keys(validateVitals(liveValues.current)).length > 0) {
      setState({ kind: "error", message: "Check the highlighted vitals before saving." });
      return;
    }

    await run("notes", async () => {
      setState({ kind: "saving" });

      const result = await saveConsultationAction({
        encounterId,
        expectedVersion: liveVersion.current,
        patch: attempt.patch,
      });

      /**
       * The refusal is certain but the current state is unreachable. Blocking
       * is the only honest answer: retrying against a version we already know
       * is stale can only be refused again, and there is nothing to show.
       *
       * The notes text is untouched either way — the draft is not an editor
       * that can be "closed", so both outcomes preserve it. What differs is
       * what the doctor is TOLD about whether it landed.
       */
      if (!result.ok && result.kind === "conflict-unloadable") {
        setState(deriveNotesState(liveValues.current, baseline));
        enterDesync(result.message, "conflict-unloadable");
        return;
      }

      if (!result.ok && result.kind === "write-unconfirmed") {
        setState(deriveNotesState(liveValues.current, baseline));
        enterDesync(result.message, "write-unconfirmed");
        return;
      }

      if (!result.ok && result.kind === "conflict") {
        const refreshed = await refreshListsAction(encounterId);
        if (refreshed.ok) {
          enterConflict(refreshed.server, result.message);
        } else {
          setState(deriveNotesState(liveValues.current, baseline));
          enterDesync(CONFLICT_UNLOADABLE_MESSAGE, "conflict-unloadable");
        }
        return;
      }

      const applied = applySaveResult({
        sent: attempt.sent,
        current: liveValues.current,
        baseline,
        result,
      });
      if (applied.values) commitValues(applied.values);
      setBaseline(applied.baseline);
      if (applied.version !== undefined) commitVersion(applied.version);
      setState(applied.state);
    });
  }, [encounterId, baseline, commitValues, commitVersion, enterConflict, enterDesync, run]);

  const runList = React.useCallback(
    async (
      list: ListKind,
      fn: (expectedVersion: number) => Promise<ListResult>,
      options?: { closeEditorOnSuccess?: boolean },
    ): Promise<ListResult | null> =>
      run("list", async () => {
        setListError(null);
        const result = await fn(liveVersion.current);

        if (result.ok) {
          commitVersion(result.version);

          const refreshed = await refreshListsAction(encounterId);
          if (!refreshed.ok) {
            /**
             * The write landed; reading the result did not. Reporting failure
             * would invite the doctor to add the same finding twice, so the
             * form is closed and the screen says plainly that it is showing
             * stale rows until a retry succeeds.
             */
            if (options?.closeEditorOnSuccess !== false) {
              commitEditors({ ...liveEditors.current, [list]: null });
            }
            commitPending(null);
            enterDesync(WRITE_UNCONFIRMED_MESSAGE, "write-unconfirmed");
            return result;
          }

          applyRows(refreshed.server);

          if (versionMoved(result.version, refreshed.server.version)) {
            enterConflict(
              refreshed.server,
              "This consultation changed somewhere else while your change was saving.",
            );
            return result;
          }

          if (options?.closeEditorOnSuccess !== false) {
            commitEditors({ ...liveEditors.current, [list]: null });
          }
          commitPending(null);
          return result;
        }

        if (result.kind === "conflict") {
          enterConflict(result.server, result.message);
        } else if (result.kind === "write-unconfirmed") {
          /**
           * The write MAY be in the record. Closing the form is the whole
           * point: leaving it open invites the doctor to enter the same
           * finding a second time.
           */
          commitEditors({ ...liveEditors.current, [list]: null });
          commitPending(null);
          enterDesync(result.message, "write-unconfirmed");
        } else if (result.kind === "conflict-unloadable") {
          /**
           * The database definitely REFUSED this. Nothing was saved, so the
           * editor, its baseline and every character in it stay exactly where
           * they are — and so does the pending removal. Closing them would
           * throw away work the record never took, and would destroy the very
           * subjects recovery needs in order to compare anything.
           */
          enterDesync(result.message, "conflict-unloadable");
        } else {
          setListError(result.message);
        }
        return result;
      }),
    [encounterId, applyRows, commitEditors, commitPending, commitVersion, enterConflict, enterDesync, run],
  );

  /**
   * Recover from "we do not know what the record looks like".
   *
   * Refreshes without touching a single character the doctor has typed — the
   * notes draft and any open finding form are untouched. The earned-version
   * rule still applies: a version we did not earn raises a real conflict rather
   * than being adopted quietly.
   */
  const retrySync = React.useCallback(async () => {
    if (gate.isBusy) return;
    setBusy("list");
    try {
      const refreshed = await refreshListsAction(encounterId);
      if (!refreshed.ok) return;

      applyRows(refreshed.server);
      desyncedRef.current = null;
      setDesynced(null);

      /**
       * Recovery runs FULL subject detection, pending removal included — the
       * state we could not read may have moved for a reason the doctor still
       * has to decide about. `enterConflict` reopens the gate itself when it
       * finds nothing to settle.
       */
      if (versionMoved(liveVersion.current, refreshed.server.version)) {
        enterConflict(
          refreshed.server,
          "This consultation changed somewhere else. Your text is still here — choose which version to keep.",
        );
      } else {
        // Back in step and nothing to settle: the doctor has the encounter.
        commitVersion(refreshed.server.version);
        openGate();
      }
    } finally {
      setBusy(null);
    }
  }, [encounterId, applyRows, commitVersion, enterConflict, gate, openGate]);

  // ---- editors ------------------------------------------------------------
  const openAdd = React.useCallback(
    (list: ListKind) => {
      setListError(null);
      commitEditors({
        ...liveEditors.current,
        [list]: { list, mode: "add", rowId: null, base: null, draft: emptyFinding() },
      });
    },
    [commitEditors],
  );

  const openEdit = React.useCallback(
    (list: ListKind, row: FindingRow) => {
      setListError(null);
      commitEditors({
        ...liveEditors.current,
        [list]: { list, mode: "edit", rowId: row.id, base: row, draft: draftFromRow(row) },
      });
    },
    [commitEditors],
  );

  const closeEditor = React.useCallback(
    (list: ListKind) => commitEditors({ ...liveEditors.current, [list]: null }),
    [commitEditors],
  );

  const setDraft = React.useCallback(
    (list: ListKind, draft: FindingDraft) => {
      const current = liveEditors.current[list];
      if (!current) return;
      commitEditors({ ...liveEditors.current, [list]: { ...current, draft } });
    },
    [commitEditors],
  );

  const askRemove = React.useCallback(
    (list: ListKind, row: FindingRow) => {
      setListError(null);
      commitPending({ list, row });
    },
    [commitPending],
  );

  const cancelRemove = React.useCallback(() => commitPending(null), [commitPending]);

  // ---- conflict resolution ------------------------------------------------
  /**
   * Settling a subject, and reopening the gate the moment the last one goes.
   *
   * The gate is released HERE rather than in an effect, so it can never be open
   * while an unresolved subject is still on screen, or closed after the last
   * one is answered.
   */
  const settle = React.useCallback(
    (next: { notes?: null; drop?: FindingConflict }) => {
      setConflict((prev) => {
        if (!prev) return prev;
        const notes = next.notes === null ? null : prev.notes;
        const findings = next.drop ? prev.findings.filter((f) => f !== next.drop) : prev.findings;

        if (notes === null && findings.length === 0) {
          if (desyncedRef.current === null) openGate();
          return null;
        }
        return { ...prev, notes, findings };
      });
    },
    [openGate],
  );

  const keepMine = React.useCallback(() => {
    if (!conflict?.notes) return;
    const applied = keepLocalEdits({
      current: liveValues.current,
      baseline,
      theirs: conflict.notes.theirs,
    });
    if (applied.values) commitValues(applied.values);
    setBaseline(applied.baseline);
    setState(applied.state);
    settle({ notes: null });
  }, [conflict, baseline, commitValues, settle]);

  const takeTheirs = React.useCallback(() => {
    if (!conflict?.notes) return;
    const applied = takeServerVersion(conflict.notes.theirs);
    if (applied.values) commitValues(applied.values);
    setBaseline(applied.baseline);
    setState(applied.state);
    settle({ notes: null });
  }, [conflict, commitValues, settle]);

  const resolveFinding = React.useCallback(
    (
      target: FindingConflict,
      choice: "mine" | "theirs" | "discard" | "as-new" | "acknowledge",
    ) => {
      const editor = liveEditors.current[target.list];

      if (editor) {
        if (target.kind === "changed" && choice === "theirs") {
          commitEditors({ ...liveEditors.current, [target.list]: editorTakingTheirs(editor, target.theirs) });
        } else if (target.kind === "changed" && choice === "mine") {
          commitEditors({ ...liveEditors.current, [target.list]: editorKeepingMine(editor, target.theirs) });
        } else if (target.kind === "removed" && choice === "as-new") {
          commitEditors({ ...liveEditors.current, [target.list]: editorAsNewFinding(editor) });
        } else if (choice === "discard" && target.kind !== "removal-gone") {
          commitEditors({ ...liveEditors.current, [target.list]: null });
        }
      }

      /**
       * A refused removal always demands a FRESH confirmation. The doctor
       * agreed to delete a particular finding; the record has moved since, so
       * that agreement no longer covers what is there now.
       */
      if (target.kind === "removal-gone") {
        // Already deleted elsewhere. Acknowledging must not issue a second
        // delete — there is nothing left to remove.
        commitPending(null);
      } else if (target.kind === "removal-changed") {
        // Re-anchored to what is actually stored, so the confirmation now names
        // the current finding rather than the one they first saw.
        commitPending(choice === "discard" ? null : { list: target.list, row: target.theirs });
      } else if (target.kind === "removal-stale") {
        commitPending(choice === "discard" ? null : { list: target.list, row: target.base });
      }

      settle({ drop: target });
    },
    [commitEditors, commitPending, settle],
  );

  const clearListError = React.useCallback(() => setListError(null), []);
  const dismissNotice = React.useCallback(() => setNotice(null), []);

  const anythingUnsaved =
    isDirty || editorIsDirty(editors.diagnosis) || editorIsDirty(editors.investigation);

  return {
    values, dirtyKeys, isDirty, vitalErrors, hasVitalErrors, setField, save,
    diagnoses, investigations, editors, confirmingRemoval,
    openAdd, openEdit, closeEditor, setDraft, askRemove, cancelRemove, runList,
    version, state, busy, blocked, listError, notice, dismissNotice, desynced, retrySync, clearListError,
    conflict, keepMine, takeTheirs, resolveFinding, anythingUnsaved,
  };
}
