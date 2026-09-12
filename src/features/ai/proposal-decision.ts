import "server-only";

import type { AiProposalPayload, AiTaskType } from "./contracts";
import {
  buildProposalDecision,
  type AiDoctorDecisionType,
  type AiProposalProducedEvent,
  type AiTelemetryEvent,
  type TelemetryPrincipal,
} from "./telemetry";
import { emitAiTelemetry, type AiTelemetrySink, type EmitResult } from "./telemetry-sink";

/**
 * Proposal decision state machine (O1-E-R2 §5).
 *
 *   PRODUCED ──► ACCEPTED   accepted exactly as issued
 *            ├─► EDITED     accepted after the Doctor changed it — still an acceptance
 *            ├─► REJECTED   the Doctor dismissed it
 *            └─► EXPIRED    TTL (plus grace) elapsed with no decision
 *
 * EXACTLY ONE TERMINAL OUTCOME, DERIVED — NEVER RACED. A Doctor decision and an
 * expiry may both physically exist (they deliberately use different idempotency
 * keys so neither can block the other). The outcome is a pure function of
 * which rows are present, so it is independent of arrival order, clock skew
 * and replay: any Doctor-originated outcome beats EXPIRED.
 *
 * That precedence is correct, not merely convenient: a Doctor decision is only
 * recorded after the authoritative acceptance guard admits it, and that guard
 * refuses an expired proposal. If both rows exist, the sweep raced a decision
 * the guard had already allowed.
 *
 * A `ProposalAcceptanceError` is NOT a rejection and records nothing — a stale
 * version or changed context is a compare-and-swap race, not a verdict on the AI.
 */

export type TerminalOutcome = "ACCEPTED" | "EDITED" | "REJECTED" | "EXPIRED" | "PENDING";

/** Must exceed the longest acceptance round trip, so a sweep never pre-empts a real decision. */
export const DEFAULT_EXPIRY_GRACE_MS = 60_000;

const PRECEDENCE: readonly Exclude<TerminalOutcome, "PENDING">[] = [
  "ACCEPTED",
  "EDITED",
  "REJECTED",
  "EXPIRED",
];

const OUTCOME_OF_EVENT: Readonly<Record<string, Exclude<TerminalOutcome, "PENDING">>> = {
  AI_PROPOSAL_ACCEPTED: "ACCEPTED",
  AI_PROPOSAL_EDITED: "EDITED",
  AI_PROPOSAL_REJECTED: "REJECTED",
  AI_PROPOSAL_EXPIRED: "EXPIRED",
};

export function deriveTerminalOutcome(
  events: readonly AiTelemetryEvent[],
  proposalId: string,
): TerminalOutcome {
  const present = new Set<string>();
  for (const event of events) {
    const outcome = OUTCOME_OF_EVENT[event.event_type];
    if (outcome && "proposal_id" in event && event.proposal_id === proposalId) {
      present.add(outcome);
    }
  }
  return PRECEDENCE.find((outcome) => present.has(outcome)) ?? "PENDING";
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, child]) => child !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`).join(",")}}`;
}

/**
 * ACCEPTED or EDITED — a boolean decided at the boundary. The comparison never
 * leaves this function: no diff, no changed value and no field name is
 * returned, logged or recorded.
 */
export function classifyAcceptance(
  issued: AiProposalPayload,
  accepted: AiProposalPayload,
): "AI_PROPOSAL_ACCEPTED" | "AI_PROPOSAL_EDITED" {
  return canonical(issued) === canonical(accepted) ? "AI_PROPOSAL_ACCEPTED" : "AI_PROPOSAL_EDITED";
}

export function recordProposalDecision(
  sink: AiTelemetrySink,
  input: {
    decision: AiDoctorDecisionType;
    proposalId: string;
    taskType: AiTaskType;
    principal: TelemetryPrincipal;
    occurredAt?: Date;
  },
): Promise<EmitResult> {
  return emitAiTelemetry(
    sink,
    buildProposalDecision({
      type: input.decision,
      occurredAt: input.occurredAt ?? new Date(),
      principal: input.principal,
      proposalId: input.proposalId,
      taskType: input.taskType,
    }),
  );
}

/**
 * Produced proposals whose TTL plus grace has elapsed with no terminal outcome.
 * Pure: the scheduler that runs it needs the durable event store (O1-F).
 */
export function proposalsDueForExpiry(
  events: readonly AiTelemetryEvent[],
  now: Date,
  ttlMs: number,
  graceMs: number = DEFAULT_EXPIRY_GRACE_MS,
): AiProposalProducedEvent[] {
  const produced = events.filter(
    (event): event is AiProposalProducedEvent => event.event_type === "AI_PROPOSAL_PRODUCED",
  );
  return produced.filter(
    (event) =>
      deriveTerminalOutcome(events, event.proposal_id) === "PENDING" &&
      now.getTime() >= Date.parse(event.occurred_at) + ttlMs + graceMs,
  );
}

export function recordProposalExpiry(
  sink: AiTelemetrySink,
  produced: AiProposalProducedEvent,
  occurredAt: Date,
): Promise<EmitResult> {
  return emitAiTelemetry(
    sink,
    buildProposalDecision({
      type: "AI_PROPOSAL_EXPIRED",
      occurredAt,
      // Attributed to the Doctor the proposal was produced for, not to the sweep.
      principal: {
        actorUserId: produced.actor_user_id,
        doctorProfileId: produced.doctor_profile_id,
      },
      proposalId: produced.proposal_id,
      taskType: produced.task_type,
    }),
  );
}
