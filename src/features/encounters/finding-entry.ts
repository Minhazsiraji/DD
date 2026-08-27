/**
 * FAST ENTRY FOR FINDINGS — the keyboard rules, as pure decisions.
 *
 * A doctor adds three or four diagnoses in a row, and today each one costs a
 * trip to the mouse: press Add, type, submit, watch the form close, press Add
 * again. This makes it type → Enter → type → Enter, and nothing else about the
 * finding lifecycle changes.
 *
 * WHAT THIS FILE DOES NOT DO. It does not save, validate clinically, or decide
 * what happens after a write. The five write outcomes stay exactly where they
 * are, in `use-consultation` and `recovery.ts`: the form clears ONLY on a clean
 * confirmed success, and on every other outcome the doctor's text is the only
 * copy that exists and is left alone.
 */

/** Only what a decision needs, so the rules are testable without a DOM. */
export interface EnterKeyEvent {
  key: string;
  /**
   * Mid-composition. A Bangla, Chinese, Japanese or Korean input method uses
   * Enter to CHOOSE A CANDIDATE, and that Enter belongs to the IME, not to us.
   */
  isComposing: boolean;
  /**
   * The legacy signal for the same thing. Some input methods still report 229
   * with `isComposing` unset, and a doctor whose first word gets submitted
   * instead of composed will not use the shortcut twice.
   */
  keyCode?: number;
  shiftKey: boolean;
}

export type EnterOutcome =
  /** Not our key at all — let the browser have it. */
  | "ignore"
  /**
   * Ours, but it must not act: the IME owns it, or there is nothing to submit.
   * Still swallowed, because a form with a single text input submits
   * IMPLICITLY on Enter and that submission has to be stopped either way.
   */
  | "swallow"
  | "submit";

const IME_KEY_CODE = 229;

export function isComposing(event: EnterKeyEvent): boolean {
  return event.isComposing || event.keyCode === IME_KEY_CODE;
}

/**
 * What Enter means in the finding TITLE field.
 *
 * The title is single-line, so there is no newline to protect here — that is
 * the note textarea's business, and nothing in this file touches it. Shift is
 * still reported so a future multi-line title cannot silently lose it.
 */
export function enterOutcome(
  event: EnterKeyEvent,
  context: { canSubmit: boolean },
): EnterOutcome {
  if (event.key !== "Enter") return "ignore";

  // The IME's Enter, not ours. Swallowed rather than passed through, because
  // implicit form submission would otherwise fire mid-word.
  if (isComposing(event)) return "swallow";

  // Shift+Enter never submits. On a single-line input it does nothing; if the
  // field ever becomes multi-line it must insert a newline, and this is the
  // rule that will already be true when it does.
  if (event.shiftKey) return "swallow";

  return context.canSubmit ? "submit" : "swallow";
}

/**
 * Does a confirmed add leave the form open for the next one?
 *
 * ADDS ONLY. Correcting an existing finding is a single deliberate act — the
 * doctor opened one row, changed it, and is done; leaving an empty form behind
 * would look like a second correction had begun.
 */
export function staysOpenAfterSuccess(mode: "add" | "edit"): boolean {
  return mode === "add";
}
