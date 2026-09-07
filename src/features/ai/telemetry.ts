import type { AiTaskType, SafeProviderMetadata } from "./contracts";

export type AiOperationOutcome =
  | "SUCCEEDED"
  | "VALIDATION_REJECTED"
  | "PROVIDER_TIMEOUT"
  | "PROVIDER_FAILED";

export type AiProposalDecision = "PENDING" | "ACCEPTED" | "EDITED" | "REJECTED";

export interface AiOperationTelemetry {
  operationId: string;
  actorUserId: string;
  doctorProfileId: string;
  taskType: AiTaskType;
  source: "TEXT" | "VOICE_TRANSCRIPT";
  startedAt: string;
  completedAt: string;
  provider: SafeProviderMetadata;
  outcome: AiOperationOutcome;
  latencyMs: number;
  decision: AiProposalDecision;
  usage: {
    audioSeconds: number | null;
    inputTokens: number | null;
    outputTokens: number | null;
    estimatedCostUsdMicros: number | null;
  };
}

/**
 * Platform-owner-safe aggregate row.
 * Deliberately absent: patient id, record id, transcript, prompt, proposal,
 * medicine/test name, provider raw response and raw audio.
 */
export interface AiOwnerCostAggregate {
  doctorProfileId: string;
  taskType: AiTaskType;
  requestCount: number;
  successCount: number;
  acceptedCount: number;
  editedCount: number;
  rejectedCount: number;
  audioSeconds: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsdMicros: number;
}

const FORBIDDEN_TELEMETRY_KEYS = new Set([
  "patientid",
  "patient_id",
  "transcript",
  "prompt",
  "rawaudio",
  "audiobytes",
  "medicine",
  "investigation",
  "clinicaltext",
  "clinicalpayload",
  "proposal",
]);

export function assertPrivacySafeTelemetry(value: unknown): void {
  const visit = (node: unknown, path: string): void => {
    if (node === null || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach((item, index) => visit(item, `${path}[${index}]`));
      return;
    }
    for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
      const lower = key.toLowerCase();
      if (FORBIDDEN_TELEMETRY_KEYS.has(lower)) {
        throw new Error(`privacy-unsafe AI telemetry key at ${path}.${key}`);
      }
      visit(child, `${path}.${key}`);
    }
  };
  visit(value, "telemetry");
}

export function emptyOwnerAggregate(
  doctorProfileId: string,
  taskType: AiTaskType,
): AiOwnerCostAggregate {
  return {
    doctorProfileId,
    taskType,
    requestCount: 0,
    successCount: 0,
    acceptedCount: 0,
    editedCount: 0,
    rejectedCount: 0,
    audioSeconds: 0,
    inputTokens: 0,
    outputTokens: 0,
    estimatedCostUsdMicros: 0,
  };
}

export function addTelemetry(
  aggregate: AiOwnerCostAggregate,
  event: AiOperationTelemetry,
): AiOwnerCostAggregate {
  if (aggregate.doctorProfileId !== event.doctorProfileId || aggregate.taskType !== event.taskType) {
    throw new Error("AI telemetry aggregate key mismatch");
  }
  return {
    ...aggregate,
    requestCount: aggregate.requestCount + 1,
    successCount: aggregate.successCount + (event.outcome === "SUCCEEDED" ? 1 : 0),
    acceptedCount: aggregate.acceptedCount + (event.decision === "ACCEPTED" ? 1 : 0),
    editedCount: aggregate.editedCount + (event.decision === "EDITED" ? 1 : 0),
    rejectedCount: aggregate.rejectedCount + (event.decision === "REJECTED" ? 1 : 0),
    audioSeconds: aggregate.audioSeconds + (event.usage.audioSeconds ?? 0),
    inputTokens: aggregate.inputTokens + (event.usage.inputTokens ?? 0),
    outputTokens: aggregate.outputTokens + (event.usage.outputTokens ?? 0),
    estimatedCostUsdMicros:
      aggregate.estimatedCostUsdMicros + (event.usage.estimatedCostUsdMicros ?? 0),
  };
}
