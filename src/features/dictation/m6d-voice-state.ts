import {
  isM6DDiagnosisIntent,
  isM6DInvestigationIntent,
  isM6DNavigationIntent,
  nextM6DTarget,
  removeM6DLastSentence,
  resolveM6DNavigationTarget,
  type M6DLocalIntent,
  type M6DTarget,
} from "./m6d-intent-router";

export type M6DVoiceDestination =
  | { kind: "note"; target: M6DTarget }
  | { kind: "diagnosis"; target: "title" | "certainty" | "note" }
  | { kind: "investigation"; target: "field" };

export type M6DVoiceSession = "idle" | "listening" | "paused";
export type M6DVoiceSection = M6DTarget | "diagnoses" | "investigations";

export interface M6DPendingNavigation {
  key: string;
  target: M6DTarget;
  previousDestination: M6DVoiceDestination;
  consumed: boolean;
}

export interface M6DVoiceState {
  destination: M6DVoiceDestination;
  session: M6DVoiceSession;
  pendingNavigation: M6DPendingNavigation | null;
}

export const INITIAL_M6D_VOICE_STATE: M6DVoiceState = {
  destination: { kind: "note", target: "chiefComplaints" },
  session: "idle",
  pendingNavigation: null,
};

export const M6D_VOICE_SECTION_OPTIONS: readonly M6DVoiceSection[] = [
  "chiefComplaints",
  "presentIllness",
  "pastHistory",
  "examination",
  "assessment",
  "advice",
  "nextVisitNote",
  "diagnoses",
  "investigations",
];

export function m6dVoiceSection(destination: M6DVoiceDestination): M6DVoiceSection {
  if (destination.kind === "diagnosis") return "diagnoses";
  if (destination.kind === "investigation") return "investigations";
  return destination.target;
}

export function m6dVoiceDestinationForSection(section: M6DVoiceSection): M6DVoiceDestination {
  if (section === "diagnoses") return { kind: "diagnosis", target: "title" };
  if (section === "investigations") return { kind: "investigation", target: "field" };
  return { kind: "note", target: section };
}

export function m6dVoiceDestinationForIntent(
  current: M6DVoiceDestination,
  intent: M6DLocalIntent,
): M6DVoiceDestination | null {
  if (intent.type === "NAVIGATE") return { kind: "note", target: intent.target };
  if (intent.type === "NEXT" || intent.type === "PREVIOUS") {
    const direction = intent.type === "NEXT" ? 1 : -1;
    if (current.kind === "diagnosis" && direction === 1) {
      return { kind: "investigation", target: "field" };
    }
    if (current.kind === "investigation" && direction === -1) {
      return { kind: "diagnosis", target: "title" };
    }
    if (current.kind !== "note") return null;
    return { kind: "note", target: nextM6DTarget(current.target, direction) };
  }
  if (intent.type === "DIAGNOSIS_NAVIGATE") return { kind: "diagnosis", target: "title" };
  if (intent.type === "DIAGNOSIS_TARGET") return { kind: "diagnosis", target: intent.target };
  if (intent.type === "DIAGNOSIS_CERTAINTY") return { kind: "diagnosis", target: "certainty" };
  if (intent.type === "INVESTIGATION_NAVIGATE" || intent.type === "INVESTIGATION_TARGET") {
    return { kind: "investigation", target: "field" };
  }
  return null;
}

export function m6dVoiceFocusSelector(destination: M6DVoiceDestination): string {
  if (destination.kind === "note") return `#${destination.target}`;
  if (destination.kind === "investigation") return "#investigation-search";
  if (destination.target === "title") return "[data-m6d-diagnosis-title]";
  if (destination.target === "certainty") return "[data-m6d-diagnosis-certainty]";
  return "[data-m6d-diagnosis-note]";
}

export type M6DCommandPriority = "session" | "edit" | "navigation" | "certainty" | "clinical-action" | "none";

export function m6dCommandPriority(intent: M6DLocalIntent): M6DCommandPriority {
  if (["PAUSE", "RESUME", "END", "UNDO"].includes(intent.type)) return "session";
  if (intent.type === "REMOVE_LAST_SENTENCE" || intent.type === "NOTE_EDIT") return "edit";
  if (isM6DNavigationIntent(intent) ||
    (isM6DDiagnosisIntent(intent) && intent.type !== "DIAGNOSIS_CERTAINTY" && intent.type !== "DIAGNOSIS_REVIEW") ||
    isM6DInvestigationIntent(intent)) return "navigation";
  if (intent.type === "DIAGNOSIS_CERTAINTY") return "certainty";
  if (intent.type === "DIAGNOSIS_REVIEW") return "clinical-action";
  return "none";
}

export function resolvePendingNoteNavigation(
  current: M6DVoiceDestination,
  intent: Extract<M6DLocalIntent, { type: "NAVIGATE" | "NEXT" | "PREVIOUS" }>,
): M6DTarget | null {
  if (intent.type === "NAVIGATE") return intent.target;
  if (current.kind !== "note") return null;
  return resolveM6DNavigationTarget(intent, current.target);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function removeFirstInsensitive(current: string, value: string): string {
  return current.replace(new RegExp(escapeRegExp(value), "i"), "").replace(/\s{2,}/g, " ").trim();
}

function replaceFirstInsensitive(current: string, value: string, replacement: string): string {
  return current.replace(new RegExp(escapeRegExp(value), "i"), replacement);
}

export function applyM6DTextEdit(current: string, intent: M6DLocalIntent): string | null {
  if (intent.type === "REMOVE_LAST_SENTENCE") return removeM6DLastSentence(current);
  if (intent.type !== "NOTE_EDIT") return null;
  if (intent.operation === "CLEAR") return "";
  if (intent.operation === "ADD" && intent.value) {
    return [current.trimEnd(), intent.value.trim()].filter(Boolean).join(" ");
  }
  if (intent.operation === "REPLACE_LAST" && intent.replacement) {
    const withoutLast = removeM6DLastSentence(current);
    return [withoutLast.trimEnd(), intent.replacement.trim()].filter(Boolean).join(" ");
  }
  if (intent.operation === "REMOVE" && intent.value) {
    return removeFirstInsensitive(current, intent.value);
  }
  if (intent.operation === "REPLACE" && intent.value && intent.replacement) {
    return replaceFirstInsensitive(current, intent.value, intent.replacement);
  }
  return null;
}
