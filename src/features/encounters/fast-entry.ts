import { RX_MODULE_LABEL, type RxModule } from "@/features/doctor/rx-modules";
import { MODULE_SOURCE, type VisibilityMap } from "./module-visibility";

/**
 * FAST ENTRY — focus-only keyboard acceleration.
 * No shortcut in this module writes, submits, approves, finalises or changes
 * clinical state. AltGr (Ctrl+Alt) remains explicitly disqualified.
 */
export const SHORTCUTS = [
  { action: "open-jump", chord: "Ctrl / Cmd + K", description: "Find a consultation section" },
  { action: "direct-1", chord: "Alt + 1", description: "Chief complaints" },
  { action: "direct-2", chord: "Alt + 2", description: "Vitals" },
  { action: "direct-3", chord: "Alt + 3", description: "Examination" },
  { action: "direct-4", chord: "Alt + 4", description: "Diagnoses" },
  { action: "direct-5", chord: "Alt + 5", description: "Investigation orders" },
  { action: "direct-6", chord: "Alt + 6", description: "Advice" },
  { action: "direct-7", chord: "Alt + 7", description: "Follow-up" },
  { action: "open-jump-alt", chord: "Alt + G", description: "Open section list" },
  { action: "open-help", chord: "Alt + H", description: "Keyboard shortcuts" },
] as const;

export type DirectAction =
  | "direct-1"
  | "direct-2"
  | "direct-3"
  | "direct-4"
  | "direct-5"
  | "direct-6"
  | "direct-7";
export type FastEntryAction =
  | "open-jump"
  | "open-jump-alt"
  | "open-help"
  | "dismiss"
  | DirectAction;

export interface ShortcutEvent {
  key: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  target: { tagName: string; isContentEditable: boolean; role: string | null };
}

export interface ShortcutContext {
  blocked: boolean;
  open: boolean;
}

const TYPING_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);
const TYPING_ROLES = new Set(["combobox", "searchbox", "textbox"]);

export function isTypingTarget(target: ShortcutEvent["target"]): boolean {
  return (
    TYPING_TAGS.has(target.tagName.toUpperCase()) ||
    target.isContentEditable ||
    (target.role !== null && TYPING_ROLES.has(target.role))
  );
}

/** Pure keyboard resolution so the safety rules are testable without a DOM. */
export function resolveShortcut(
  event: ShortcutEvent,
  context: ShortcutContext,
): FastEntryAction | null {
  if (event.key === "Escape") return context.open ? "dismiss" : null;

  const key = event.key.toLowerCase();
  const commandK =
    key === "k" &&
    !event.altKey &&
    ((event.ctrlKey && !event.metaKey) || (event.metaKey && !event.ctrlKey));
  if (commandK) return context.blocked ? null : "open-jump";

  // Alt only. Ctrl+Alt may be AltGr and must remain normal text input.
  if (!event.altKey || event.ctrlKey || event.metaKey) return null;

  if (key === "h") return "open-help";
  if (context.blocked) return null;
  if (key === "g") return "open-jump-alt";
  if (/^[1-7]$/.test(key)) return `direct-${key}` as DirectAction;
  return null;
}

const FOCUS_TARGET: Record<RxModule, string | null> = {
  CHIEF_COMPLAINT: "chiefComplaints",
  SYMPTOMS: "symptoms",
  HISTORY: "presentIllness",
  VITALS: "vitalTemperatureC",
  EXAMINATION: "examination",
  ASSESSMENT: "assessment",
  DIAGNOSIS: "add-diagnosis",
  INVESTIGATIONS: "add-investigation",
  ADVICE: "advice",
  NEXT_VISIT: "nextVisitOn",
  ALLERGY: null,
  LONG_TERM_MEDICINES: null,
};

const DIRECT_MODULE: Record<DirectAction, RxModule> = {
  "direct-1": "CHIEF_COMPLAINT",
  "direct-2": "VITALS",
  "direct-3": "EXAMINATION",
  "direct-4": "DIAGNOSIS",
  "direct-5": "INVESTIGATIONS",
  "direct-6": "ADVICE",
  "direct-7": "NEXT_VISIT",
};

export interface JumpTarget {
  module: RxModule;
  label: string;
  elementId: string;
}

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

/** Fixed Alt+1…7 semantics; a hidden section is inert rather than redirected. */
export function directJumpTarget(
  action: DirectAction,
  visibility: VisibilityMap,
): JumpTarget | null {
  const rxModule = DIRECT_MODULE[action];
  if (!visibility[rxModule]?.visible) return null;
  const elementId = FOCUS_TARGET[rxModule];
  if (!elementId) return null;
  return { module: rxModule, label: RX_MODULE_LABEL[rxModule], elementId };
}

export function filterTargets(targets: JumpTarget[], query: string): JumpTarget[] {
  const q = query.trim().toLowerCase();
  if (q === "") return targets;
  return targets.filter((target) => target.label.toLowerCase().includes(q));
}

export const FOCUS_TARGET_KEYS = Object.keys(FOCUS_TARGET) as RxModule[];
export function focusTargetFor(rxModule: RxModule): string | null {
  return FOCUS_TARGET[rxModule];
}
