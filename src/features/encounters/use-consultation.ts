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
import { versionMoved, type ListResult } from "./list-schema";
import type { Consultation, DiagnosisRow, InvestigationRow } from "./queries";
import type { DraftKey, DraftValues } from "./schema";

/**
 * ONE encounter, ONE version, ONE queue.
 *
 * Notes, vitals, diagnoses and investigations all mutate the same
 * `encounters.version` (ADR 0010 §6c). Giving the lists their own version
 * counter would let this screen conflict with itself: add a diagnosis, then
 * save a note, and the note's expected version is already one behind — a
 * "somebody else changed this" banner caused entirely by the doctor's own
 * previous click.
 *
 * So the version lives here, every mutation goes through `run`, and `run`
 * refuses to start a second one while the first is in flight. Two mutations
 * carrying the same expected version means one of them was stale before it
 * left.
 */

export type MutationKind = "notes" | "list";

export interface ConsultationSession {
  /** Notes editor */
  values: DraftValues;
  dirtyKeys: DraftKey[];
  isDirty: boolean;
  vitalErrors: ReturnType<typeof validateVitals>;
  hasVitalErrors: boolean;
  setField: (key: DraftKey, value: string) => void;
  save: () => Promise<void>;

  /** Lists */
  diagnoses: DiagnosisRow[];
  investigations: InvestigationRow[];
  runList: (fn: (expectedVersion: number) => Promise<ListResult>) => Promise<ListResult | null>;

  /** Shared */
  version: number;
  state: SaveState;
  busy: MutationKind | null;
  listError: string | null;
  clearListError: () => void;
  keepMine: () => void;
  takeTheirs: () => void;
}

export function useConsultation(consultation: Consultation): ConsultationSession {
  const encounterId = consultation.id;

  const [values, setValues] = React.useState<DraftValues>(consultation.values);
  const [baseline, setBaseline] = React.useState<DraftValues>(consultation.values);
  const [version, setVersion] = React.useState(consultation.version);
  const [state, setState] = React.useState<SaveState>({ kind: "clean" });
  const [busy, setBusy] = React.useState<MutationKind | null>(null);
  const [listError, setListError] = React.useState<string | null>(null);

  const [diagnoses, setDiagnoses] = React.useState(consultation.diagnoses);
  const [investigations, setInvestigations] = React.useState(consultation.investigations);

  /**
   * Live copies, readable from inside an awaited mutation. The closure captured
   * when a request left is stale by the time it returns, and the difference is
   * exactly the typing that must not be reported as saved.
   */
  const liveValues = React.useRef(consultation.values);
  const liveVersion = React.useRef(consultation.version);
  const inFlight = React.useRef(false);

  const commitValues = React.useCallback((next: DraftValues) => {
    liveValues.current = next;
    setValues(next);
  }, []);

  const commitVersion = React.useCallback((next: number) => {
    liveVersion.current = next;
    setVersion(next);
  }, []);

  const dirtyKeys = ownedKeys(values, baseline);
  const isDirty = dirtyKeys.length > 0;
  const vitalErrors = validateVitals(values);
  const hasVitalErrors = Object.keys(vitalErrors).length > 0;

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
   * Adopt the server's state after a conflict.
   *
   * The lists are REPLACED, because rows are server state and there is no merge
   * question about them. The notes are NOT: `theirs` is handed to the conflict
   * panel and the doctor decides. The half-typed add form lives in its own
   * component and is never touched by any of this.
   */
  const adoptServer = React.useCallback(
    (server: {
      version: number;
      values: DraftValues;
      diagnoses: DiagnosisRow[];
      investigations: InvestigationRow[];
    }, message: string) => {
      setDiagnoses(server.diagnoses);
      setInvestigations(server.investigations);
      commitVersion(server.version);
      setState({
        kind: "conflict",
        message,
        theirs: server.values,
        version: server.version,
      });
    },
    [commitVersion],
  );

  const save = React.useCallback(async () => {
    if (inFlight.current) return;

    const attempt = beginSave(liveValues.current, baseline);
    if (!attempt) {
      setState({ kind: "clean" });
      return;
    }
    if (Object.keys(validateVitals(liveValues.current)).length > 0) {
      setState({ kind: "error", message: "Check the highlighted vitals before saving." });
      return;
    }

    inFlight.current = true;
    setBusy("notes");
    setState({ kind: "saving" });

    try {
      const result = await saveConsultationAction({
        encounterId,
        expectedVersion: liveVersion.current,
        patch: attempt.patch,
      });

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

      // A rejected note save means the encounter moved; the lists on screen are
      // behind too, so they are re-read rather than left quietly wrong.
      if (!result.ok && result.kind === "conflict") {
        const refreshed = await refreshListsAction(encounterId);
        if (refreshed.ok) {
          setDiagnoses(refreshed.server.diagnoses);
          setInvestigations(refreshed.server.investigations);
        }
      }
    } finally {
      inFlight.current = false;
      setBusy(null);
    }
  }, [encounterId, baseline, commitValues, commitVersion]);

  /**
   * Every list mutation, serialised against the notes save and against each
   * other, and always carrying the version this screen has actually earned.
   *
   * On success the rows are RE-READ rather than patched locally: positions
   * shift when something is removed, and a screen that guesses at the new order
   * disagrees with the record about what the doctor wrote down.
   */
  const runList = React.useCallback(
    async (fn: (expectedVersion: number) => Promise<ListResult>): Promise<ListResult | null> => {
      if (inFlight.current) return null;

      inFlight.current = true;
      setBusy("list");
      setListError(null);

      try {
        const result = await fn(liveVersion.current);

        if (result.ok) {
          commitVersion(result.version);
          const refreshed = await refreshListsAction(encounterId);
          if (refreshed.ok) {
            setDiagnoses(refreshed.server.diagnoses);
            setInvestigations(refreshed.server.investigations);
            /**
             * The version from the re-read is only adopted when it MATCHES what
             * we earned. A higher number means somebody else moved the record
             * between our mutation and this read — taking it would leave the
             * notes baseline stale while claiming to be current, which is how a
             * real conflict gets silently skipped.
             */
            if (versionMoved(result.version, refreshed.server.version)) {
              adoptServer(
                refreshed.server,
                "This consultation changed somewhere else while your change was saving. Your text is still here — choose which version to keep.",
              );
            }
          }
          return result;
        }

        if (result.kind === "conflict") {
          adoptServer(result.server, result.message);
        } else {
          setListError(result.message);
        }
        return result;
      } finally {
        inFlight.current = false;
        setBusy(null);
      }
    },
    [encounterId, commitVersion, adoptServer],
  );

  const keepMine = React.useCallback(() => {
    if (state.kind !== "conflict") return;
    const applied = keepLocalEdits({
      current: liveValues.current,
      baseline,
      theirs: state.theirs,
    });
    if (applied.values) commitValues(applied.values);
    setBaseline(applied.baseline);
    setState(applied.state);
  }, [state, baseline, commitValues]);

  const takeTheirs = React.useCallback(() => {
    if (state.kind !== "conflict") return;
    const applied = takeServerVersion(state.theirs);
    if (applied.values) commitValues(applied.values);
    setBaseline(applied.baseline);
    setState(applied.state);
  }, [state, commitValues]);

  const clearListError = React.useCallback(() => setListError(null), []);

  return {
    values,
    dirtyKeys,
    isDirty,
    vitalErrors,
    hasVitalErrors,
    setField,
    save,
    diagnoses,
    investigations,
    runList,
    version,
    state,
    busy,
    listError,
    clearListError,
    keepMine,
    takeTheirs,
  };
}
