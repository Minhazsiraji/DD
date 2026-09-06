"use client";

import * as React from "react";
import type { DraftValues } from "../schema";
import type { SaveState } from "../draft-state";
import { AUTOSAVE_DEBOUNCE_MS, shouldScheduleAutosave } from "../autosave-policy";

/**
 * A scheduler, not a second mutation path.
 *
 * The only function this component can call is the consultation coordinator's
 * existing `save()`. That save shares the encounter MutationGate/version with
 * diagnosis and investigation writes. If a list mutation is running, `blocked`
 * cancels this timer; once the gate is free the dirty draft is scheduled again.
 *
 * `values` is deliberately a dependency. Dirty can remain true while a doctor
 * types ten more characters in the same field; depending on dirty alone would
 * save 650 ms after the FIRST character instead of debouncing the latest edit.
 */
export function ConsultationAutosave({
  values,
  dirty,
  blocked,
  hasVitalErrors,
  state,
  save,
}: {
  values: DraftValues;
  dirty: boolean;
  blocked: boolean;
  hasVitalErrors: boolean;
  state: SaveState;
  save: () => Promise<void>;
}) {
  React.useEffect(() => {
    if (
      !shouldScheduleAutosave({
        dirty,
        blocked,
        hasVitalErrors,
        state: state.kind,
      })
    ) {
      return;
    }

    const timer = window.setTimeout(() => {
      void save();
    }, AUTOSAVE_DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
  }, [values, dirty, blocked, hasVitalErrors, state.kind, save]);

  return null;
}
