/**
 * Turning a refusal into something a doctor mid-consultation can act on.
 *
 * Pure and separately tested, so the fallback cannot quietly regress into
 * echoing raw error text — the same rule the queue and the notes editor follow.
 */

export const GENERIC_RX_ERROR =
  "That could not be saved. Nothing has been lost — try again in a moment.";

export type RxFailureKind = "conflict" | "desync-unconfirmed" | "error";

export interface TranslatedRxError {
  kind: RxFailureKind;
  message: string;
  /** True when we did not recognise it, so the caller should log the original. */
  unexpected: boolean;
}

/**
 * The one rule this copy must never break: never imply the typed medicine is
 * gone. It is still in the form, and telling a doctor otherwise makes them
 * retype a line they can see on the screen in front of them.
 */
export function translateRxError(message: string): TranslatedRxError {
  const m = message.toUpperCase();

  if (m.includes("PRESCRIPTION_VERSION_CONFLICT")) {
    return {
      kind: "conflict",
      message:
        "This prescription changed somewhere else, so your change was NOT saved. Nothing was overwritten and what you typed is still here.",
      unexpected: false,
    };
  }

  if (m.includes("PRESCRIPTION_NOT_DRAFT")) {
    return {
      kind: "error",
      message:
        "This prescription has been approved and can no longer be edited. A correction is a new prescription.",
      unexpected: false,
    };
  }

  /**
   * The encounter already has an approved prescription, so anything new is a
   * REPLACEMENT and must carry a reason (ADR 0011 §3). Nothing on this screen
   * can collect one yet, so the copy says what is true rather than asking for
   * something the doctor has no way to give — a dead end that reads like an
   * instruction is worse than a plain refusal.
   */
  if (m.includes("PRESCRIPTION_REPLACEMENT_NEEDS_REASON")) {
    return {
      kind: "error",
      message:
        "This consultation's prescription has already been approved, and it cannot be replaced from this screen.",
      unexpected: false,
    };
  }

  if (m.includes("A MEDICINE NEEDS A NAME")) {
    return { kind: "error", message: "Give the medicine a name.", unexpected: false };
  }

  if (m.includes("MEDICINE NOT FOUND")) {
    return {
      kind: "error",
      message: "That medicine is no longer on this prescription — it may have been removed.",
      unexpected: false,
    };
  }

  if (m.includes("POSITION_OUT_OF_RANGE")) {
    return { kind: "error", message: "That is not a position on this list.", unexpected: false };
  }

  if (m.includes("PATCH_INVALID") || m.includes("PATCH_UNKNOWN_FIELD")) {
    return {
      kind: "error",
      message: "Something in the form was not understood. Reload the prescription and try again.",
      unexpected: true,
    };
  }

  if (m.includes("PATCH_EMPTY")) {
    return { kind: "error", message: "Nothing has changed.", unexpected: false };
  }

  /**
   * Deliberately one sentence for missing, not-yours and wrong-location alike —
   * the database answers all three identically on purpose, and splitting them
   * here would undo that.
   */
  if (m.includes("PRESCRIPTION NOT FOUND")) {
    return {
      kind: "error",
      message: "This prescription is no longer available at your current location.",
      unexpected: false,
    };
  }

  if (m.includes("ENCOUNTER NOT FOUND")) {
    return {
      kind: "error",
      message: "This consultation is no longer available at your current location.",
      unexpected: false,
    };
  }

  if (m.includes("ONLY A DOCTOR CAN WRITE A PRESCRIPTION")) {
    return {
      kind: "error",
      message: "Only the treating doctor can write a prescription.",
      unexpected: false,
    };
  }

  return { kind: "error", message: GENERIC_RX_ERROR, unexpected: true };
}

/**
 * The write may or may not have landed, and we could not find out.
 *
 * Kept apart from a refusal for the reason Stage 6C established: telling a
 * doctor "failed" when it may have succeeded is what produces a duplicate
 * medicine on a prescription.
 */
export const RX_UNCONFIRMED_MESSAGE =
  "Your change may already have been saved, but the result could not be loaded. Do not enter it again — reload to see what the prescription actually holds.";

export const RX_TITLE_UNKNOWN = "This prescription may be out of date";
