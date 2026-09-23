import { normalizeClinicalNumbers } from "./normalize";

export const BP_INCOMPLETE_FINALIZATION_MS = 1500;
export const BP_SPLIT_COMPLETION_GRACE_MS = 700;

export type BloodPressureCaptureState = { pending: string | null };
export type BloodPressureCaptureResult = {
  state: BloodPressureCaptureState;
  commits: string[];
  held: boolean;
};

const BP_PREFIX = /^\s*(?:bp|b\s+p|blood pressure)\b/i;
const STANDALONE_COMPLETION = /^\s*(\d{2,3})[.!?]?\s*$/;
const CANONICAL_BP = /^\s*(?:BP|blood pressure)\s+(\d{2,3})\/(\d{1,3})[.!?]?\s*$/i;

export function bloodPressureCaptureState(raw: string): "not-bp" | "incomplete" | "complete" {
  if (!BP_PREFIX.test(raw)) return "not-bp";
  const match = normalizeClinicalNumbers(raw).match(CANONICAL_BP);
  if (!match) return "incomplete";
  const systolic = Number(match[1]);
  const diastolic = Number(match[2]);
  return systolic >= 60 && systolic <= 300 &&
    diastolic >= 30 && diastolic <= 200 &&
    systolic - diastolic >= 10
    ? "complete"
    : "incomplete";
}

export function guidedVoiceFinalizationDelay(raw: string, ordinaryDelayMs: number): number {
  return bloodPressureCaptureState(raw) === "incomplete"
    ? BP_INCOMPLETE_FINALIZATION_MS
    : ordinaryDelayMs;
}

export function mergeSplitBloodPressure(pending: string, next: string): string | null {
  if (bloodPressureCaptureState(pending) !== "incomplete") return null;
  const completion = next.match(STANDALONE_COMPLETION)?.[1];
  if (!completion) return null;
  const completionValue = Number(completion);
  if (completionValue < 30 || completionValue > 200) return null;

  const candidates = [
    `${pending.replace(/[.!?]\s*$/, "")} ${completion}`,
    pending.replace(/\/\s*\d{1,2}[.!?]?\s*$/, `/${completion}`),
  ];
  const completed = [...new Set(candidates.map(normalizeClinicalNumbers))]
    .filter((candidate) => bloodPressureCaptureState(candidate) === "complete");
  return completed.length === 1 ? completed[0] : null;
}

export function reduceBloodPressureCapture(
  state: BloodPressureCaptureState,
  event: { type: "provider-utterance"; transcript: string } | { type: "grace-expired" },
): BloodPressureCaptureResult {
  if (event.type === "grace-expired") {
    return state.pending
      ? { state: { pending: null }, commits: [state.pending], held: false }
      : { state, commits: [], held: false };
  }

  if (state.pending) {
    const merged = mergeSplitBloodPressure(state.pending, event.transcript);
    if (merged) return { state: { pending: null }, commits: [merged], held: false };
    const commits = [state.pending];
    if (bloodPressureCaptureState(event.transcript) === "incomplete") {
      return { state: { pending: event.transcript }, commits, held: true };
    }
    return { state: { pending: null }, commits: [...commits, event.transcript], held: false };
  }

  if (bloodPressureCaptureState(event.transcript) === "incomplete") {
    return { state: { pending: event.transcript }, commits: [], held: true };
  }
  return { state, commits: [event.transcript], held: false };
}
