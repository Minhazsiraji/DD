import type { SaveState } from "./draft-state";

/** Fast enough to disappear from the doctor's workflow, long enough not to save every keystroke. */
export const AUTOSAVE_DEBOUNCE_MS = 650;

export interface AutosavePolicyInput {
  dirty: boolean;
  blocked: boolean;
  hasVitalErrors: boolean;
  state: SaveState["kind"];
}

/**
 * Autosave is scheduling only. The actual write is still `useConsultation().save()`
 * and therefore still passes through the single encounter MutationGate/version.
 *
 * Errors and conflicts never loop. They need an explicit retry/resolution; a new
 * doctor edit changes the coordinator state back to dirty and may schedule again.
 */
export function shouldScheduleAutosave(input: AutosavePolicyInput): boolean {
  return (
    input.dirty &&
    !input.blocked &&
    !input.hasVitalErrors &&
    input.state === "dirty"
  );
}
