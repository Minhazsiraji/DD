"use client";

import * as React from "react";
import { saveConsultationAction } from "./actions";
import { validateVitals } from "./draft-patch";
import {
  applySaveResult,
  beginSave,
  keepLocalEdits,
  ownedKeys,
  takeServerVersion,
  type Applied,
  type SaveState,
} from "./draft-state";
import type { DraftKey, DraftValues } from "./schema";

export type { SaveState } from "./draft-state";

/**
 * The consultation draft — a thin React binding over the rules in
 * draft-state.ts.
 *
 * ONE RULE ABOVE ALL OTHERS: what the doctor typed is never discarded, never
 * silently replaced, and never overwritten by anything arriving from the
 * server. `values` changes only because the doctor changed it, or because they
 * explicitly asked for the saved version.
 *
 * There is deliberately no "fields I have ever touched" set. Ownership is
 * always measured against the last ACKNOWLEDGED baseline, which a successful
 * save moves — otherwise a section saved an hour ago stays claimed forever and
 * gets re-asserted over a colleague's newer text at the next conflict.
 */
export function useDraft(encounterId: string, initial: DraftValues, initialVersion: number) {
  const [values, setValues] = React.useState<DraftValues>(initial);
  const [baseline, setBaseline] = React.useState<DraftValues>(initial);
  const [version, setVersion] = React.useState(initialVersion);
  const [state, setState] = React.useState<SaveState>({ kind: "clean" });

  /**
   * The live editor contents, readable from inside an awaited save.
   *
   * The closure captured when the request left is stale by the time it returns
   * — and the difference between those two is exactly the typing that must not
   * be reported as saved.
   */
  const liveValues = React.useRef(initial);

  const commit = React.useCallback((next: DraftValues) => {
    liveValues.current = next;
    setValues(next);
  }, []);

  const apply = React.useCallback(
    (applied: Applied) => {
      if (applied.values) commit(applied.values);
      setBaseline(applied.baseline);
      if (applied.version !== undefined) setVersion(applied.version);
      setState(applied.state);
    },
    [commit],
  );

  // Derived during render, never mirrored into state — a second copy of "is
  // this dirty" is a second thing that can be wrong.
  const dirtyKeys = ownedKeys(values, baseline);
  const isDirty = dirtyKeys.length > 0;
  const vitalErrors = validateVitals(values);
  const hasVitalErrors = Object.keys(vitalErrors).length > 0;

  const setField = React.useCallback(
    (key: DraftKey, value: string) => {
      if (liveValues.current[key] === value) return;
      commit({ ...liveValues.current, [key]: value });

      /**
       * Typing clears a finished save message but NEVER a conflict. A conflict
       * is an unresolved decision about the record; carrying on typing does not
       * answer it, and hiding the banner would leave them saving into a stale
       * version with no idea why it keeps failing.
       */
      setState((prev) =>
        prev.kind === "conflict" || prev.kind === "saving" ? prev : { kind: "dirty" },
      );
    },
    [commit],
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

    setState({ kind: "saving" });

    const result = await saveConsultationAction({
      encounterId,
      expectedVersion: version,
      patch: attempt.patch,
    });

    // `liveValues.current`, not `values`: the doctor may have kept typing.
    apply(
      applySaveResult({
        sent: attempt.sent,
        current: liveValues.current,
        baseline,
        result,
      }),
    );
  }, [encounterId, baseline, version, apply]);

  const keepMine = React.useCallback(() => {
    if (state.kind !== "conflict") return;
    apply(keepLocalEdits({ current: liveValues.current, baseline, theirs: state.theirs }));
  }, [state, baseline, apply]);

  const takeTheirs = React.useCallback(() => {
    if (state.kind !== "conflict") return;
    apply(takeServerVersion(state.theirs));
  }, [state, apply]);

  return {
    values,
    baseline,
    version,
    state,
    dirtyKeys,
    isDirty,
    vitalErrors,
    hasVitalErrors,
    setField,
    save,
    keepMine,
    takeTheirs,
  };
}
