"use client";

import * as React from "react";
import { saveConsultationAction } from "./actions";
import { type DraftKey, type DraftValues } from "./schema";
import { buildPatch, changedKeys, validateVitals } from "./draft-patch";

/**
 * The consultation draft.
 *
 * ONE RULE ABOVE ALL OTHERS: what the doctor typed is never discarded, never
 * silently replaced, and never overwritten by anything arriving from the
 * server. Every branch below is written so that `values` only ever changes
 * because the doctor changed it, or because they explicitly asked for the
 * saved version.
 */

export type SaveState =
  | { kind: "clean" }
  | { kind: "dirty" }
  | { kind: "saving" }
  | { kind: "saved"; at: string }
  | { kind: "error"; message: string }
  /** Their text is intact; `theirs` is what is on the server. */
  | { kind: "conflict"; message: string; theirs: DraftValues; version: number };

export function useDraft(encounterId: string, initial: DraftValues, initialVersion: number) {
  const [values, setValues] = React.useState<DraftValues>(initial);
  const [baseline, setBaseline] = React.useState<DraftValues>(initial);
  const [version, setVersion] = React.useState(initialVersion);
  const [state, setState] = React.useState<SaveState>({ kind: "clean" });

  /**
   * Fields the doctor has actually TYPED INTO on this screen — which is not the
   * same as fields that differ from the server. When another device changes a
   * section this doctor never touched, "keep what I typed" must not revert it:
   * they did not type there, so they are not asserting anything about it.
   */
  const [touched, setTouched] = React.useState<ReadonlySet<DraftKey>>(new Set());

  // Derived during render, never mirrored into state — a second copy of "is
  // this dirty" is a second thing that can be wrong.
  const dirtyKeys = changedKeys(values, baseline);
  const isDirty = dirtyKeys.length > 0;
  const vitalErrors = validateVitals(values);
  const hasVitalErrors = Object.keys(vitalErrors).length > 0;

  const setField = React.useCallback((key: DraftKey, value: string) => {
    setValues((prev) => (prev[key] === value ? prev : { ...prev, [key]: value }));
    setTouched((prev) => (prev.has(key) ? prev : new Set(prev).add(key)));
    /**
     * Typing clears a finished save message but NEVER a conflict. A conflict is
     * an unresolved decision about the record; carrying on typing does not
     * answer it, and hiding the banner would leave them saving into a stale
     * version with no idea why it keeps failing.
     */
    setState((prev) =>
      prev.kind === "conflict" ? prev : isDirtyState(prev) ? prev : { kind: "dirty" },
    );
  }, []);

  const save = React.useCallback(async () => {
    const patch = buildPatch(values, baseline);
    if (Object.keys(patch).length === 0) {
      setState({ kind: "clean" });
      return;
    }
    if (Object.keys(validateVitals(values)).length > 0) {
      setState({ kind: "error", message: "Check the highlighted vitals before saving." });
      return;
    }

    setState({ kind: "saving" });
    // Snapshot what we are saving: the doctor may keep typing while it is in
    // flight, and only the fields actually sent may be marked saved.
    const sent = { ...values };

    const result = await saveConsultationAction({
      encounterId,
      expectedVersion: version,
      patch,
    });

    if (result.ok) {
      setVersion(result.version);
      setBaseline(sent);
      setState({ kind: "saved", at: result.savedAt });
      return;
    }
    if (result.kind === "conflict") {
      setVersion(result.version);
      setState({
        kind: "conflict",
        message: result.message,
        theirs: result.values,
        version: result.version,
      });
      return;
    }
    setState({ kind: "error", message: result.message });
  }, [encounterId, values, baseline, version]);

  /**
   * Resolving a conflict, both ways — and both are the doctor's explicit
   * choice, made after seeing the other version.
   */
  const keepMine = React.useCallback(() => {
    if (state.kind !== "conflict") return;
    /**
     * Rebase onto their text, keeping this doctor's words ONLY where they
     * actually typed. Everything else takes the newer version — including
     * sections this screen merely had open and stale.
     *
     * Re-saving every differing field would silently undo the other device's
     * work on sections nobody here touched, which is last-write-wins wearing a
     * confirmation dialog.
     */
    const merged = { ...state.theirs };
    for (const key of touched) merged[key] = values[key];

    setValues(merged);
    setBaseline(state.theirs);
    setState({ kind: "dirty" });
  }, [state, touched, values]);

  const takeTheirs = React.useCallback(() => {
    if (state.kind !== "conflict") return;
    setValues(state.theirs);
    setBaseline(state.theirs);
    setTouched(new Set());
    setState({ kind: "clean" });
  }, [state]);

  return {
    values,
    baseline,
    version,
    state,
    dirtyKeys,
    touched,
    isDirty,
    vitalErrors,
    hasVitalErrors,
    setField,
    save,
    keepMine,
    takeTheirs,
  };
}

function isDirtyState(s: SaveState) {
  return s.kind === "dirty" || s.kind === "saving";
}
