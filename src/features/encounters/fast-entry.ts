import { RX_MODULE_LABEL, type RxModule } from "@/features/doctor/rx-modules";
import { MODULE_SOURCE, type VisibilityMap } from "./module-visibility";

/**
 * FAST ENTRY — the keyboard core.
 *
 * An ACCELERATOR OVER THE EXISTING SCREEN, and nothing else. Every decision in
 * this file is about moving FOCUS. Nothing here writes, submits, finalises or
 * changes clinical state, and the palette that uses it cannot either — the
 * whole surface exists to save a doctor seventeen tab presses, not to make a
 * commitment faster to make.
 *
 * WHY EVERY SHORTCUT NEEDS A MODIFIER
 *
 * A doctor in a consultation is inside a textarea almost all of the time. A
 * bare-key accelerator would therefore have to either hijack their typing or be
 * unreachable, and both are wrong. So the rule is simple and absolute:
 *
 *     NO BARE KEY EVER RESOLVES TO AN ACTION. ANYWHERE.
 *
 * A modifier chord produces no character and interrupts no sentence, so it is
 * safe inside a field — which is the only place it would ever be pressed.
 *
 * WHY `ctrlKey` DISQUALIFIES A CHORD
 *
 * On Windows, AltGr reports as Ctrl+Alt. On a Bangla, German, Polish or Nordic
 * layout AltGr+letter is how ordinary characters are typed — so treating
 * Ctrl+Alt as our modifier would eat real keystrokes for a large share of the
 * world. This app is one global codebase, so the chord requires Alt WITHOUT
 * Ctrl and WITHOUT Meta.
 */

/** The whole shortcut vocabulary. Two chords and Escape, deliberately. */
export const SHORTCUTS = [
  { action: "open-jump", chord: "Alt + G", key: "g", description: "Go to a section" },
  { action: "open-help", chord: "Alt + H", key: "h", description: "Keyboard shortcuts" },
] as const;

export type FastEntryAction = "open-jump" | "open-help" | "dismiss";

/** Only what a decision needs — so the rules are testable without a DOM. */
export interface ShortcutEvent {
  key: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  target: { tagName: string; isContentEditable: boolean; role: string | null };
}

export interface ShortcutContext {
  /**
   * The coordinator owns the encounter right now — a mutation is in flight, or
   * a conflict is unanswered. Accelerators go inert; see below.
   */
  blocked: boolean;
  /** A Fast Entry surface is on screen, so Escape has something to close. */
  open: boolean;
}

const TYPING_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);
const TYPING_ROLES = new Set(["combobox", "searchbox", "textbox"]);

/**
 * Is the keystroke landing somewhere the doctor is composing text?
 *
 * Not used to refuse chords — a chord is safe in a field, which is the point.
 * It exists so that if a bare-key accelerator is ever added, it is refused here
 * rather than discovered on a half-typed instruction.
 */
export function isTypingTarget(target: ShortcutEvent["target"]): boolean {
  return (
    TYPING_TAGS.has(target.tagName.toUpperCase()) ||
    target.isContentEditable ||
    (target.role !== null && TYPING_ROLES.has(target.role))
  );
}

/**
 * What this keystroke means, if anything.
 *
 * BLOCKED IS THE STRICTEST STATE. When the coordinator is blocked the only
 * things that still work are dismiss and help — both non-mutating, and neither
 * puts the doctor's cursor into an editor whose next Enter could try to write
 * into a conflict nobody has answered yet. Everything else is inert rather
 * than refused-with-a-message: a shortcut that explains why it did nothing is
 * still a shortcut that did nothing.
 */
export function resolveShortcut(
  event: ShortcutEvent,
  context: ShortcutContext,
): FastEntryAction | null {
  // Escape is the one bare key with a meaning, and only to close what is open.
  // It never opens anything, so it cannot start an interaction by accident.
  if (event.key === "Escape") return context.open ? "dismiss" : null;

  // Alt, and only Alt. See the AltGr note above for why Ctrl disqualifies.
  if (!event.altKey || event.ctrlKey || event.metaKey) return null;

  const key = event.key.toLowerCase();
  const shortcut = SHORTCUTS.find((s) => s.key === key);
  if (!shortcut) return null;

  // Help stays reachable while blocked — reading it changes nothing, and a
  // doctor whose shortcuts have gone quiet is exactly who needs to read it.
  if (context.blocked && shortcut.action !== "open-help") return null;

  return shortcut.action;
}

/**
 * WHERE FOCUS LANDS for each module.
 *
 * This is a map of DOM ids, not a list of enabled modules. Which modules exist
 * is `MODULE_SOURCE`; which are ON SCREEN is `resolveVisibility`, and this file
 * never second-guesses either. `fast-entry.test.ts` asserts these keys are
 * exactly `MODULE_SOURCE`'s, so a module can never be added without a decision
 * about where its shortcut goes.
 *
 * `null` means the module has no consultation surface to focus — the two
 * patient-record modules, which `resolveVisibility` already reports as never
 * visible. They are excluded twice over, deliberately.
 */
const FOCUS_TARGET: Record<RxModule, string | null> = {
  CHIEF_COMPLAINT: "chiefComplaints",
  SYMPTOMS: "symptoms",
  // The two history fields are one printed section; focus lands on the first.
  HISTORY: "presentIllness",
  VITALS: "vitalHeightCm",
  EXAMINATION: "examination",
  ASSESSMENT: "assessment",
  // The lists have no field — focus goes to the control that opens their
  // editor. Landing there writes nothing; it only offers the form.
  DIAGNOSIS: "add-diagnosis",
  INVESTIGATIONS: "add-investigation",
  ADVICE: "advice",
  // The date, not the note: it is the half a doctor reaches for first.
  NEXT_VISIT: "nextVisitOn",
  ALLERGY: null,
  LONG_TERM_MEDICINES: null,
};

export interface JumpTarget {
  module: RxModule;
  /** The doctor's own vocabulary — the same heading the settings screen uses. */
  label: string;
  elementId: string;
}

/**
 * The destinations, derived from the SAME resolved visibility the workspace
 * renders from.
 *
 * There is no second list of enabled modules and no per-module key binding, so
 * there is nothing that can go stale: a module the doctor turned off is absent
 * from the palette because it is absent from the screen, and the only way to
 * reach any section is to pick it from what this returns.
 */
export function jumpTargets(visibility: VisibilityMap): JumpTarget[] {
  const out: JumpTarget[] = [];

  for (const rxModule of Object.keys(MODULE_SOURCE) as RxModule[]) {
    if (!visibility[rxModule]?.visible) continue;
    const elementId = FOCUS_TARGET[rxModule];
    if (elementId === null) continue;
    out.push({ module: rxModule, label: RX_MODULE_LABEL[rxModule], elementId });
  }

  return out;
}

/** Ordinary substring match, folded. Nothing clinical is being searched here. */
export function filterTargets(targets: JumpTarget[], query: string): JumpTarget[] {
  const q = query.trim().toLowerCase();
  if (q === "") return targets;
  return targets.filter((t) => t.label.toLowerCase().includes(q));
}

/** Exported for the test that keeps the map and the module list in step. */
export const FOCUS_TARGET_KEYS = Object.keys(FOCUS_TARGET) as RxModule[];
export function focusTargetFor(rxModule: RxModule): string | null {
  return FOCUS_TARGET[rxModule];
}
