import type { ServerState } from "./queries";

/**
 * Diagnosis certainty, said the way a doctor says it.
 *
 * The database stores RULED_OUT. A clinical list that prints "RULED_OUT" is
 * showing an enum where a clinical judgement belongs — the same mistake as
 * rendering B_POS for a blood group, and on a more consequential field.
 */
export const CERTAINTIES = [
  "PROVISIONAL",
  "WORKING",
  "CONFIRMED",
  "RULED_OUT",
] as const;

export type Certainty = (typeof CERTAINTIES)[number];

export const CERTAINTY_LABEL: Record<Certainty, string> = {
  PROVISIONAL: "Provisional",
  WORKING: "Working",
  CONFIRMED: "Confirmed",
  RULED_OUT: "Ruled out",
};

/**
 * What each one means, for the doctor choosing between them — and because
 * "provisional" and "working" are used differently in different chambers.
 */
export const CERTAINTY_HINT: Record<Certainty, string> = {
  PROVISIONAL: "First impression, still to be confirmed",
  WORKING: "Being treated as this while investigations run",
  CONFIRMED: "Established, with evidence",
  RULED_OUT: "Considered and excluded",
};

/**
 * Never returns an enum name.
 *
 * An unrecognised value falls back to a readable form rather than vanishing —
 * a diagnosis whose certainty we cannot categorise must still be legible.
 */
export function certaintyLabel(value: string): string {
  const known = CERTAINTY_LABEL[value as Certainty];
  if (known) return known;
  return value
    .toLowerCase()
    .split("_")
    .map((part, i) => (i === 0 ? part.charAt(0).toUpperCase() + part.slice(1) : part))
    .join(" ");
}

/**
 * What an edited note box instructs.
 *
 * Emptied means CLEAR (null), which is a different instruction from leaving the
 * field out — the same distinction the notes patch contract turns on, and the
 * reason a mistyped note can be removed at all.
 */
export function noteInstruction(text: string): string | null {
  return text.trim() === "" ? null : text;
}

/**
 * Did the version we EARNED survive until we could re-read it?
 *
 * After a successful list mutation the caller knows the version it is entitled
 * to. If the database now reports a different one, somebody else moved the
 * record in between — and adopting their number while keeping our stale notes
 * baseline would let a real conflict pass unnoticed (ADR 0010 §6c).
 */
export function versionMoved(earned: number, observed: number): boolean {
  return observed !== earned;
}

// The version rule is shared with the note save; it lives in version-contract.ts.
export { acceptVersion } from "./version-contract";

/**
 * Every list mutation answers one of four ways.
 *
 * A conflict carries the encounter's CURRENT state, because a conflict is about
 * the encounter rather than about one widget: whatever moved it, the notes and
 * both lists on this screen are now potentially behind.
 *
 * The last two are BOTH "we do not know what the record looks like", and they
 * must stay apart, because the right response to each is the opposite of the
 * other:
 *
 *   write-unconfirmed   — the write may already be in the record, so the form
 *                         CLOSES; leaving it open invites a duplicate.
 *   conflict-unloadable — the write was definitely REFUSED, so the form and
 *                         every character in it STAYS; closing it throws away
 *                         work the database never took, and destroys the
 *                         subject that recovery needs in order to compare.
 *
 * Collapsing them into one "desync" is what made a rejected diagnosis edit
 * vanish from the screen.
 */
export type ListResult =
  | { ok: true; version: number }
  | { ok: false; kind: "conflict"; message: string; server: ServerState }
  | { ok: false; kind: "write-unconfirmed"; message: string }
  | { ok: false; kind: "conflict-unloadable"; message: string }
  | { ok: false; kind: "error"; message: string };
