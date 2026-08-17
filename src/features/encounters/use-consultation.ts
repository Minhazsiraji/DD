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
  editorAsNewFinding,
  editorKeepingMine,
  editorTakingTheirs,
  notesConflicted,
  type FindingConflict,
} from "./finding-conflict";
import {
  UNCONFIRMED_MESSAGE,
  versionMoved,
  type ListResult,
} from "./list-schema";
import {
  draftFromRow,
  editorIsDirty,
  emptyFinding,
  type FindingDraft,
  type FindingEditor,
  type FindingRow,
  type ListKind,
} from "./finding-types";
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
  desynced: string | null;
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

export function useConsultation(consultation: Consultation): ConsultationSession {
  const encounterId = consultation.id;

  const [values, setValues] = React.useState<DraftValues>(consultation.values);
  const [baseline, setBaseline] = React.useState<DraftValues>(consultation.values);
  const [version, setVersion] = React.useState(consultation.version);
  const [state, setState] = React.useState<SaveState>({ kind: "clean" });
  const [busy, setBusy] = React.useState<MutationKind | null>(null);
  const [listError, setListError] = React.useState<string | null>(null);
  const [desynced, setDesynced] = React.useState<string | null>(null);
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

  // Live copies, readable from inside an awaited mutation — the closure
  // captured when a request left is stale by the time it returns.
  const liveValues = React.useRef(consultation.values);
  const liveVersion = React.useRef(consultation.version);
  const liveEditors = React.useRef(editors);
  const inFlight = React.useRef(false);
  /** Mirrors "a conflict or desync owns the encounter", for the gate in `run`. */
  const gated = React.useRef(false);

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

  React.useEffect(() => {
    gated.current = conflict !== null || desynced !== null;
  }, [conflict, desynced]);

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
        const found = detectFindingConflict(liveEditors.current[list], rowsFor(list, server));
        if (found) findings.push(found);
      }

      const notesDiffer = notesConflicted(liveValues.current, server.values);

      setConflict({
        message,
        server,
        notes: notesDiffer ? { theirs: server.values } : null,
        findings,
      });

      // The notes banner is a notes decision; it must not appear when the
      // notes agree and only a finding moved.
      setState(
        notesDiffer
          ? { kind: "conflict", message, theirs: server.values, version: server.version }
          : { kind: "dirty" },
      );
    },
    [applyRows, commitVersion, rowsFor],
  );

  /** Every mutation on this screen passes through here, or does not happen. */
  const run = React.useCallback(
    async <T,>(kind: MutationKind, fn: () => Promise<T>): Promise<T | null> => {
      if (inFlight.current || gated.current) return null;
      inFlight.current = true;
      setBusy(kind);
      try {
        return await fn();
      } finally {
        inFlight.current = false;
        setBusy(null);
      }
    },
    [],
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

      if (!result.ok && result.kind === "conflict") {
        const refreshed = await refreshListsAction(encounterId);
        if (refreshed.ok) {
          enterConflict(refreshed.server, result.message);
        } else {
          setState({ kind: "error", message: result.message });
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
  }, [encounterId, baseline, commitValues, commitVersion, enterConflict, run]);

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
            setConfirmingRemoval(null);
            setDesynced(UNCONFIRMED_MESSAGE);
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
          setConfirmingRemoval(null);
          return result;
        }

        if (result.kind === "conflict") {
          enterConflict(result.server, result.message);
        } else if (result.kind === "unconfirmed") {
          // Same reasoning as a failed readback: the write may be committed.
          commitEditors({ ...liveEditors.current, [list]: null });
          setConfirmingRemoval(null);
          setDesynced(result.message);
        } else {
          setListError(result.message);
        }
        return result;
      }),
    [encounterId, applyRows, commitEditors, commitVersion, enterConflict, run],
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
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy("list");
    try {
      const refreshed = await refreshListsAction(encounterId);
      if (!refreshed.ok) return;

      applyRows(refreshed.server);
      setDesynced(null);

      if (versionMoved(liveVersion.current, refreshed.server.version)) {
        gated.current = false;
        enterConflict(
          refreshed.server,
          "This consultation changed somewhere else. Your text is still here — choose which version to keep.",
        );
      }
    } finally {
      inFlight.current = false;
      setBusy(null);
    }
  }, [encounterId, applyRows, enterConflict]);

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

  const askRemove = React.useCallback((list: ListKind, row: FindingRow) => {
    setListError(null);
    setConfirmingRemoval({ list, row });
  }, []);

  const cancelRemove = React.useCallback(() => setConfirmingRemoval(null), []);

  // ---- conflict resolution ------------------------------------------------
  const settle = React.useCallback(
    (next: Partial<Pick<ConflictState, "notes" | "findings">>) => {
      setConflict((prev) => {
        if (!prev) return prev;
        const merged = { ...prev, ...next };
        // Every subject settled: the encounter is the doctor's again.
        if (merged.notes === null && merged.findings.length === 0) return null;
        return merged;
      });
    },
    [],
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
        } else if (choice === "discard") {
          commitEditors({ ...liveEditors.current, [target.list]: null });
        }
      }

      setConflict((prev) => {
        if (!prev) return prev;
        const findings = prev.findings.filter((f) => f !== target);
        if (prev.notes === null && findings.length === 0) return null;
        return { ...prev, findings };
      });
    },
    [commitEditors],
  );

  const clearListError = React.useCallback(() => setListError(null), []);

  const anythingUnsaved =
    isDirty || editorIsDirty(editors.diagnosis) || editorIsDirty(editors.investigation);

  return {
    values, dirtyKeys, isDirty, vitalErrors, hasVitalErrors, setField, save,
    diagnoses, investigations, editors, confirmingRemoval,
    openAdd, openEdit, closeEditor, setDraft, askRemove, cancelRemove, runList,
    version, state, busy, blocked, listError, desynced, retrySync, clearListError,
    conflict, keepMine, takeTheirs, resolveFinding, anythingUnsaved,
  };
}
