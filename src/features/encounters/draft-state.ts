import { buildPatch, changedKeys } from "./draft-patch";
import type { DraftKey, DraftPatch, DraftValues, SaveResult } from "./schema";

/**
 * The rules that decide what a save sends, what a successful save
 * acknowledges, and who owns a field when two devices disagree.
 *
 * Deliberately free of React. These are the rules that determine whether one
 * doctor's clinical note can silently overwrite another's, and they must be
 * testable at the exact sequences that break them — not only through a
 * component.
 *
 * THE CENTRAL DEFINITION, and the one that was wrong before:
 *
 *   A field is MINE if it currently differs from the last ACKNOWLEDGED
 *   baseline — not if I typed into it at some point since this screen loaded.
 *
 * A successful save moves the baseline. After that, a field I edited an hour
 * ago is no longer mine to assert: the server has my text, and anything newer
 * there came from somewhere else and is newer than anything I have.
 */

export type SaveState =
  | { kind: "clean" }
  | { kind: "dirty" }
  | { kind: "saving" }
  | { kind: "saved"; at: string }
  | { kind: "error"; message: string }
  /** Their text is intact; `theirs` is what is on the server. */
  | { kind: "conflict"; message: string; theirs: DraftValues; version: number };

/**
 * The fields this screen currently owns — everything unsaved relative to the
 * last acknowledgement. This is both the patch's contents and, at a conflict,
 * the set the doctor may assert over the server's newer text.
 */
export function ownedKeys(values: DraftValues, baseline: DraftValues): DraftKey[] {
  return changedKeys(values, baseline);
}

export interface SaveAttempt {
  patch: DraftPatch;
  /** The exact values this request represents; the acknowledgement compares to it. */
  sent: DraftValues;
}

export function beginSave(values: DraftValues, baseline: DraftValues): SaveAttempt | null {
  const patch = buildPatch(values, baseline);
  if (Object.keys(patch).length === 0) return null;
  return { patch, sent: { ...values } };
}

export interface Applied {
  /** Only set when the caller must replace the editor contents. */
  values?: DraftValues;
  baseline: DraftValues;
  version?: number;
  state: SaveState;
}

/**
 * Fold a save response back in, using the values as they are AT THE MOMENT THE
 * RESPONSE ARRIVES — not as they were when the request left.
 *
 * A doctor keeps typing while the request is in flight. Those keystrokes were
 * never sent, so they are not saved, and the screen must not say they are.
 * Reporting "Saved" over unsaved clinical text is the worst thing this state
 * machine can do, so the acknowledged snapshot is compared against the live
 * one before any success is announced.
 */
export function applySaveResult(args: {
  sent: DraftValues;
  current: DraftValues;
  baseline: DraftValues;
  result: SaveResult;
}): Applied {
  const { sent, current, baseline, result } = args;

  if (result.ok) {
    // The server now holds `sent`; that becomes the new acknowledged baseline
    // even if the doctor has moved on, so the next patch carries only what is
    // genuinely newer.
    const newer = changedKeys(current, sent);
    return {
      baseline: sent,
      version: result.version,
      state: newer.length > 0 ? { kind: "dirty" } : { kind: "saved", at: result.savedAt },
    };
  }

  if (result.kind === "conflict") {
    // Baseline does NOT move: nothing was acknowledged. The doctor still owns
    // everything they had unsaved, including whatever they typed just now.
    return {
      baseline,
      version: result.version,
      state: {
        kind: "conflict",
        message: result.message,
        theirs: result.values,
        version: result.version,
      },
    };
  }

  return { baseline, state: { kind: "error", message: result.message } };
}

/**
 * "Keep what is unsaved here" — the doctor's side of a conflict.
 *
 * Ownership is computed against the baseline BEFORE rebasing. A field they
 * never changed since the last acknowledgement is not theirs to assert, so it
 * takes the server's newer text; re-sending it would silently undo the other
 * device's work, which is last-write-wins wearing a confirmation dialog.
 */
export function keepLocalEdits(args: {
  current: DraftValues;
  baseline: DraftValues;
  theirs: DraftValues;
}): Applied {
  const { current, baseline, theirs } = args;
  const mine = ownedKeys(current, baseline);

  const merged = { ...theirs };
  for (const key of mine) merged[key] = current[key];

  return { values: merged, baseline: theirs, state: { kind: "dirty" } };
}

/** "Use the saved version" — discard this screen's unsaved text, deliberately. */
export function takeServerVersion(theirs: DraftValues): Applied {
  return { values: { ...theirs }, baseline: { ...theirs }, state: { kind: "clean" } };
}
