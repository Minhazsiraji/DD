/**
 * The encounter version contract, in one place.
 *
 * Every mutating RPC advances `encounters.version` by exactly one (ADR 0010
 * §6c, asserted by db:verify:encounters). That is the whole rule, and it is
 * neutral between notes and findings because the version is shared — a
 * validation that lived only on the list side let the note save keep the
 * defect after the list actions had been fixed.
 */

/**
 * The version an RPC reported, or null if it cannot be believed.
 *
 * `Number(data)` alone turns null into 0, accepts fractions and negatives, and
 * waves through a jump of +3. A version we invented — or one we did not earn —
 * is then sent as the expected version of the NEXT mutation, so one unnoticed
 * anomaly becomes a wrong clinical write.
 */
export function acceptVersion(data: unknown, expectedVersion: number): number | null {
  if (typeof data !== "number" && typeof data !== "string") return null;
  if (typeof data === "string" && data.trim() === "") return null;

  const n = Number(data);
  if (!Number.isInteger(n) || n <= 0) return null;
  if (n !== expectedVersion + 1) return null;
  return n;
}

/**
 * TWO different unknowns, and confusing them costs a doctor something.
 *
 * WRITE_UNCONFIRMED — the write may already be in the record. The form must
 * close, or they will type it again and the patient ends up with it twice.
 *
 * CONFLICT_UNLOADABLE — the database definitely REFUSED the write, and only
 * the newer state is missing. Nothing was saved, so every character they typed
 * must stay exactly where it is and the pending decision must survive to be
 * re-examined once the state loads.
 */
export type DesyncKind = "write-unconfirmed" | "conflict-unloadable";

export const WRITE_UNCONFIRMED_MESSAGE =
  "Your change may already have been saved, but the result could not be loaded. Do not enter it again — retry loading to see what the record actually holds.";

export const CONFLICT_UNLOADABLE_MESSAGE =
  "This consultation changed somewhere else, so your change was NOT saved — and the newer version could not be loaded. Nothing was overwritten and nothing you typed has been lost. Retry loading to see what changed.";

/** Titles the panel by what is actually unknown, never by what changed. */
export const DESYNC_TITLE = "This consultation may be out of date";
