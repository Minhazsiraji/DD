/**
 * Turning a database refusal into something a receptionist can act on.
 *
 * Pure and exported separately so it can be tested directly — and so the
 * fallback below cannot quietly regress into echoing raw error text.
 */

/** What a user sees when we do not recognise the failure. */
export const GENERIC_QUEUE_ERROR =
  "The queue could not be updated. Refresh and try again.";

export interface TranslatedError {
  /** Safe to render. Never contains database detail. */
  message: string;
  /**
   * True when we did not recognise the error, so the caller should log the
   * original for us rather than show it to anyone.
   */
  unexpected: boolean;
}

/**
 * Recognised operational cases get a specific sentence; everything else gets
 * one stable message.
 *
 * The fallback used to be `Could not do that: ${message}`, which put Postgres
 * function names, constraint names and SQLSTATEs in front of doctors. Those
 * leak schema shape to anyone who can trigger an error, and they tell the
 * reader nothing they can act on.
 *
 * The IN_CONSULTATION case matters most: it is what a STALE SCREEN produces.
 * Someone else started the consultation while this tab still showed a Call
 * button, so it has to read as "the queue moved on", not as a fault.
 */
export function translateQueueError(message: string): TranslatedError {
  const m = message.toLowerCase();

  if (m.includes("already with the doctor")) {
    return {
      message:
        "That patient is already in with the doctor — the queue has moved on since this screen loaded.",
      unexpected: false,
    };
  }
  if (m.includes("not in the queue")) {
    return {
      message:
        "That patient has left the queue — they may have been seen, cancelled or marked as not arrived.",
      unexpected: false,
    };
  }
  /**
   * Deliberately the same sentence whether the appointment is missing, belongs
   * to someone else, or sits at another location. Distinguishing them would
   * tell a caller which appointment ids exist and where.
   */
  if (m.includes("appointment not found")) {
    return { message: "That patient is no longer available to you.", unexpected: false };
  }
  if (m.includes("needs a reason")) {
    return { message: "Choose why they are going ahead of the others.", unexpected: false };
  }

  return { message: GENERIC_QUEUE_ERROR, unexpected: true };
}
