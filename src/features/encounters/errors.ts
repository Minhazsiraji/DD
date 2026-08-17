/**
 * Turning a database refusal into something a doctor mid-consultation can act
 * on — without ever telling them a Postgres function name.
 *
 * Pure and separately tested, like the queue's translator, so the fallback
 * cannot quietly regress into echoing raw error text.
 */

export const GENERIC_SAVE_ERROR =
  "Your notes could not be saved. Nothing has been lost — try again in a moment.";

export type SaveFailureKind = "conflict" | "error";

export interface TranslatedSaveError {
  kind: SaveFailureKind;
  /** Safe to render. Never contains database detail. */
  message: string;
  /** True when we did not recognise the failure, so the caller should log it. */
  unexpected: boolean;
}

/**
 * Every sentence here has to be true even in the worst case, because the worst
 * case is what a doctor will act on. The one rule the copy must never break:
 * do not say anything that implies the typed text is gone. It is not — the
 * editor still holds it, and saying otherwise would make someone retype notes
 * they can see on the screen in front of them.
 */
export function translateSaveError(message: string): TranslatedSaveError {
  const m = message.toUpperCase();

  /**
   * The stale-tab case. Not an error in any meaningful sense — two tabs, or a
   * phone and a desktop, on one consultation. It has to read as "this needs a
   * decision", never as a fault or a loss.
   */
  if (m.includes("ENCOUNTER_VERSION_CONFLICT")) {
    return {
      kind: "conflict",
      message:
        "These notes were saved somewhere else after this screen loaded. Your text is still here — choose which version to keep.",
      unexpected: false,
    };
  }

  if (m.includes("ENCOUNTER_NOT_DRAFT")) {
    return {
      kind: "error",
      message:
        "This consultation has already been closed, so it can no longer be edited.",
      unexpected: false,
    };
  }

  if (m.includes("VITAL_OUT_OF_RANGE")) {
    return {
      kind: "error",
      message:
        "One of the vitals is outside what can be measured — check for a typing or unit slip.",
      unexpected: false,
    };
  }

  if (m.includes("PATCH_EMPTY")) {
    return { kind: "error", message: "Nothing has changed since the last save.", unexpected: false };
  }

  if (m.includes("PATCH_INVALID") || m.includes("PATCH_UNKNOWN_FIELD")) {
    return {
      kind: "error",
      message: "Something in the form was not understood. Reload the consultation and try again.",
      unexpected: true,
    };
  }

  /**
   * Deliberately one sentence for missing, not-yours and wrong-location alike —
   * the database gives the same answer for all three on purpose, and splitting
   * them here would undo that.
   */
  if (m.includes("ENCOUNTER NOT FOUND")) {
    return {
      kind: "error",
      message: "This consultation is no longer available at your current location.",
      unexpected: false,
    };
  }

  if (m.includes("APPOINTMENT_NOT_IN_CONSULTATION")) {
    return {
      kind: "error",
      message: "Start the consultation from the queue before writing notes.",
      unexpected: false,
    };
  }

  if (m.includes("APPOINTMENT NOT FOUND") || m.includes("PATIENT NOT FOUND")) {
    return { kind: "error", message: "That patient is no longer available to you.", unexpected: false };
  }

  return { kind: "error", message: GENERIC_SAVE_ERROR, unexpected: true };
}
