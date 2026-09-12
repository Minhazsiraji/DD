import "server-only";

import { randomUUID } from "node:crypto";
import type { AiTaskType } from "./contracts";
import { picousdToMicrosDecimal, type Picousd } from "./money";
import type { TokenCostFacts } from "./pricing";
import type { ProviderUsageReport } from "./providers";
import {
  AI_FAILURE_CODES,
  AI_TELEMETRY_SCHEMA_VERSION,
  eventKeyFor,
  type AiDoctorDecisionType,
  type AiFailureCode,
  type AiOperationStartedEvent,
  type AiProposalDecisionEvent,
  type AiProposalProducedEvent,
  type AiProviderAttemptedEvent,
  type AiProviderOutcomeEvent,
  type AiProviderOutcomeType,
  type AiTelemetryEventType,
  type EventBase,
} from "./telemetry-events";

// ---------------------------------------------------------------------------
// Id minting — the only legitimate source of telemetry correlation ids
// ---------------------------------------------------------------------------

export function mintTelemetryOperationId(): string {
  return `ddop_${randomUUID()}`;
}

export function mintProposalId(): string {
  return `ddprop_${randomUUID()}`;
}

export function mintVoiceGrantId(): string {
  return `ddgr_${randomUUID()}`;
}

// ---------------------------------------------------------------------------
// Builders. Each takes explicit primitives, never a clinical object, so there
// is no path by which a binding's patient or record id reaches an event.
// ---------------------------------------------------------------------------

export interface TelemetryPrincipal {
  actorUserId: string | null;
  doctorProfileId: string | null;
}

export function eventBase<T extends AiTelemetryEventType>(
  type: T,
  occurredAt: Date,
  principal: TelemetryPrincipal,
): Omit<EventBase<T>, "event_key"> {
  return {
    event_type: type,
    schema_version: AI_TELEMETRY_SCHEMA_VERSION,
    occurred_at: occurredAt.toISOString(),
    actor_user_id: principal.actorUserId,
    doctor_profile_id: principal.doctorProfileId,
  };
}

export function withEventKey<E extends Record<string, unknown>>(event: E): E & { event_key: string } {
  return { ...event, event_key: eventKeyFor(event) };
}

export const microsOrNull = (value: Picousd | null): string | null =>
  value === null ? null : picousdToMicrosDecimal(value);

export function toFailureCode(code: string): AiFailureCode {
  return (AI_FAILURE_CODES as readonly string[]).includes(code)
    ? (code as AiFailureCode)
    : "PROVIDER_ERROR_UNCLASSIFIED";
}

export function buildOperationStarted(input: {
  occurredAt: Date;
  principal: TelemetryPrincipal;
  operationId: string;
  providerId: string;
  modelId: string;
  taskType: AiTaskType;
  source: "TEXT" | "VOICE_TRANSCRIPT";
}): AiOperationStartedEvent {
  return withEventKey({
    ...eventBase("AI_OPERATION_STARTED", input.occurredAt, input.principal),
    operation_id: input.operationId,
    provider_id: input.providerId,
    model_id: input.modelId,
    task_type: input.taskType,
    source: input.source,
  });
}

export function buildProviderAttempted(input: {
  occurredAt: Date;
  principal: TelemetryPrincipal;
  operationId: string;
  attemptNo: number;
  providerId: string;
  modelId: string;
  taskType: AiTaskType;
}): AiProviderAttemptedEvent {
  return withEventKey({
    ...eventBase("AI_PROVIDER_ATTEMPTED", input.occurredAt, input.principal),
    operation_id: input.operationId,
    attempt_no: input.attemptNo,
    provider_id: input.providerId,
    model_id: input.modelId,
    task_type: input.taskType,
  });
}

export function buildProviderOutcome(input: {
  type: AiProviderOutcomeType;
  occurredAt: Date;
  principal: TelemetryPrincipal;
  operationId: string;
  attemptNo: number;
  providerId: string;
  modelId: string;
  taskType: AiTaskType;
  latencyMs: number;
  failureCode: AiFailureCode | null;
  httpStatus: number | null;
  usage: ProviderUsageReport;
  cost: TokenCostFacts;
}): AiProviderOutcomeEvent {
  const reported = input.usage.state === "REPORTED";
  const tokens = input.usage.tokens;
  return withEventKey({
    ...eventBase(input.type, input.occurredAt, input.principal),
    operation_id: input.operationId,
    attempt_no: input.attemptNo,
    provider_id: input.providerId,
    model_id: input.modelId,
    task_type: input.taskType,
    latency_ms: Math.max(0, Math.round(input.latencyMs)),
    failure_code: input.failureCode,
    provider_http_status: input.httpStatus,
    usage_state: input.usage.state,
    input_tokens: reported ? tokens.inputTokens : null,
    cached_input_tokens: reported ? tokens.cachedInputTokens : null,
    output_tokens: reported ? tokens.outputTokens : null,
    reasoning_tokens: reported ? tokens.reasoningTokens : null,
    total_tokens: reported ? tokens.totalTokens : null,
    cost_state: input.cost.state,
    cost_source: input.cost.source,
    cost_attribution_mode: input.cost.mode,
    pricing_snapshot_id: input.cost.pricingSnapshotId,
    estimated_cost_usd_micros: microsOrNull(input.cost.total),
    input_cost_usd_micros: microsOrNull(input.cost.inputUncached),
    cached_input_cost_usd_micros: microsOrNull(input.cost.cachedInput),
    output_cost_usd_micros: microsOrNull(input.cost.output),
  });
}

export function buildProposalProduced(input: {
  occurredAt: Date;
  principal: TelemetryPrincipal;
  operationId: string;
  proposalId: string;
  providerId: string;
  modelId: string;
  taskType: AiTaskType;
  uncertaintyCount: number;
}): AiProposalProducedEvent {
  return withEventKey({
    ...eventBase("AI_PROPOSAL_PRODUCED", input.occurredAt, input.principal),
    operation_id: input.operationId,
    proposal_id: input.proposalId,
    provider_id: input.providerId,
    model_id: input.modelId,
    task_type: input.taskType,
    uncertainty_count: input.uncertaintyCount,
  });
}

export function buildProposalDecision(input: {
  type: AiDoctorDecisionType | "AI_PROPOSAL_EXPIRED";
  occurredAt: Date;
  principal: TelemetryPrincipal;
  proposalId: string;
  taskType: AiTaskType;
}): AiProposalDecisionEvent {
  return withEventKey({
    ...eventBase(input.type, input.occurredAt, input.principal),
    proposal_id: input.proposalId,
    task_type: input.taskType,
  });
}

