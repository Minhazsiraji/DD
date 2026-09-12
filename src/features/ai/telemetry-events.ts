import "server-only";

import type { AiTaskType } from "./contracts";
import type { CostAttributionMode, CostSource, CostState } from "./pricing";
import type { ProviderUsageState } from "./providers";

/** Event vocabulary, persisted shapes, id formats and idempotency keys. See ./telemetry for the contract. */

export const AI_TELEMETRY_SCHEMA_VERSION = 1;

export const AI_TELEMETRY_EVENT_TYPES = [
  "AI_OPERATION_STARTED",
  "AI_PROVIDER_ATTEMPTED",
  "AI_PROVIDER_SUCCEEDED",
  "AI_PROVIDER_FAILED",
  "AI_PROVIDER_TIMEOUT",
  "AI_PROPOSAL_PRODUCED",
  "AI_PROPOSAL_ACCEPTED",
  "AI_PROPOSAL_EDITED",
  "AI_PROPOSAL_REJECTED",
  "AI_PROPOSAL_EXPIRED",
  "VOICE_GRANT_ISSUED",
  "VOICE_GRANT_DENIED",
  "VOICE_SESSION_REPORTED",
] as const;
export type AiTelemetryEventType = (typeof AI_TELEMETRY_EVENT_TYPES)[number];

export const AI_PROVIDER_OUTCOME_TYPES = [
  "AI_PROVIDER_SUCCEEDED",
  "AI_PROVIDER_FAILED",
  "AI_PROVIDER_TIMEOUT",
] as const;
export type AiProviderOutcomeType = (typeof AI_PROVIDER_OUTCOME_TYPES)[number];

export const AI_DOCTOR_DECISION_TYPES = [
  "AI_PROPOSAL_ACCEPTED",
  "AI_PROPOSAL_EDITED",
  "AI_PROPOSAL_REJECTED",
] as const;
export type AiDoctorDecisionType = (typeof AI_DOCTOR_DECISION_TYPES)[number];

/** Closed union. An adapter code outside it is recorded as UNCLASSIFIED, never verbatim. */
export const AI_FAILURE_CODES = [
  "VALIDATION_REJECTED",
  "PROVIDER_TIMEOUT",
  "PROVIDER_ABORTED",
  "PROVIDER_ERROR_UNCLASSIFIED",
  "POST_PROVIDER_INTERNAL",
  "OPENAI_SYNTHETIC_EVAL_DISABLED",
  "OPENAI_API_KEY_MISSING",
  "OPENAI_PROVIDER_HTTP",
  "OPENAI_PROVIDER_REFUSAL",
  "OPENAI_PROVIDER_INCOMPLETE",
  "OPENAI_PROVIDER_MALFORMED",
] as const;
export type AiFailureCode = (typeof AI_FAILURE_CODES)[number];

/**
 * Only denials that follow real grant work, or the first crossing of a rate
 * window, are recorded. A cross-origin refusal is not: a hostile page could
 * otherwise drive telemetry writes through a signed-in Doctor's browser.
 */
export const VOICE_GRANT_DENIAL_REASONS = [
  "RATE_LIMITED",
  "CONFIG_MISSING",
  "GRANT_REJECTED",
  "GRANT_NETWORK",
] as const;
export type VoiceGrantDenialReason = (typeof VOICE_GRANT_DENIAL_REASONS)[number];

export const VOICE_MEASUREMENT_QUALITIES = [
  "CLIENT_ESTIMATE",
  "PROVIDER_REPORTED",
  "RECONCILED",
  "UNKNOWN",
] as const;
export type VoiceMeasurementQuality = (typeof VOICE_MEASUREMENT_QUALITIES)[number];


/** Deepgram Nova-3 — the single approved STT provider at the PA1 reference. */
export const VOICE_PROVIDER_ID = "deepgram";
export const VOICE_MODEL_ID = "nova-3";
/** Upper bound for a single client-estimated streaming session. */
export const VOICE_SESSION_MAX_MS = 15 * 60 * 1000;

// ---------------------------------------------------------------------------
// Event shapes
// ---------------------------------------------------------------------------

export interface EventBase<T extends AiTelemetryEventType> {
  event_type: T;
  schema_version: typeof AI_TELEMETRY_SCHEMA_VERSION;
  event_key: string;
  occurred_at: string;
  actor_user_id: string | null;
  doctor_profile_id: string | null;
}

interface Attribution {
  provider_id: string;
  model_id: string;
}

export interface AiOperationStartedEvent extends EventBase<"AI_OPERATION_STARTED">, Attribution {
  operation_id: string;
  task_type: AiTaskType;
  source: "TEXT" | "VOICE_TRANSCRIPT";
}

export interface AiProviderAttemptedEvent extends EventBase<"AI_PROVIDER_ATTEMPTED">, Attribution {
  operation_id: string;
  attempt_no: number;
  task_type: AiTaskType;
}

export interface AiProviderOutcomeEvent extends EventBase<AiProviderOutcomeType>, Attribution {
  operation_id: string;
  attempt_no: number;
  task_type: AiTaskType;
  latency_ms: number;
  failure_code: AiFailureCode | null;
  provider_http_status: number | null;
  usage_state: ProviderUsageState;
  input_tokens: number | null;
  cached_input_tokens: number | null;
  output_tokens: number | null;
  reasoning_tokens: number | null;
  total_tokens: number | null;
  cost_state: CostState;
  cost_source: CostSource | null;
  cost_attribution_mode: CostAttributionMode | null;
  pricing_snapshot_id: string | null;
  /** Exact USD micros, scale 6. NULL = unknown. "0.000000" = authoritative zero. */
  estimated_cost_usd_micros: string | null;
  /** Disjoint per-meter amounts; they sum exactly to the total when known. */
  input_cost_usd_micros: string | null;
  cached_input_cost_usd_micros: string | null;
  output_cost_usd_micros: string | null;
}

export interface AiProposalProducedEvent extends EventBase<"AI_PROPOSAL_PRODUCED">, Attribution {
  operation_id: string;
  proposal_id: string;
  task_type: AiTaskType;
  /** A count only — never the uncertainty messages, which can quote clinical wording. */
  uncertainty_count: number;
}

export interface AiProposalDecisionEvent
  extends EventBase<AiDoctorDecisionType | "AI_PROPOSAL_EXPIRED"> {
  proposal_id: string;
  task_type: AiTaskType;
}

export interface VoiceGrantEvent
  extends EventBase<"VOICE_GRANT_ISSUED" | "VOICE_GRANT_DENIED">,
    Attribution {
  grant_id: string;
  denial_reason: VoiceGrantDenialReason | null;
}

export interface VoiceSessionReportedEvent extends EventBase<"VOICE_SESSION_REPORTED">, Attribution {
  voice_session_id: string;
  grant_id: string;
  streamed_audio_ms: number | null;
  measurement_quality: VoiceMeasurementQuality;
  connect_latency_ms: number | null;
  first_result_latency_ms: number | null;
  cost_state: CostState;
  cost_source: CostSource | null;
  cost_attribution_mode: CostAttributionMode | null;
  pricing_snapshot_id: string | null;
  estimated_cost_usd_micros: string | null;
}

export type AiTelemetryEvent =
  | AiOperationStartedEvent
  | AiProviderAttemptedEvent
  | AiProviderOutcomeEvent
  | AiProposalProducedEvent
  | AiProposalDecisionEvent
  | VoiceGrantEvent
  | VoiceSessionReportedEvent;

// ---------------------------------------------------------------------------
// Value shapes
// ---------------------------------------------------------------------------

export const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
export const UUID_RE = new RegExp(`^${UUID}$`);
export const OPERATION_ID_RE = new RegExp(`^ddop_${UUID}$`);
export const PROPOSAL_ID_RE = new RegExp(`^ddprop_${UUID}$`);
export const VOICE_SESSION_ID_RE = new RegExp(`^ddvs_${UUID}$`);
export const GRANT_ID_RE = new RegExp(`^ddgr_${UUID}$`);
export const SLUG_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
export const SNAPSHOT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
export const MICROS_RE = /^\d{1,18}\.\d{6}$/;

export const TELEMETRY_ID_PATTERNS = Object.freeze({
  operation: OPERATION_ID_RE,
  proposal: PROPOSAL_ID_RE,
  voiceSession: VOICE_SESSION_ID_RE,
  grant: GRANT_ID_RE,
});

export class AiTelemetryValidationError extends Error {
  constructor(
    public readonly code:
      | "NOT_PLAIN_OBJECT"
      | "UNKNOWN_EVENT_TYPE"
      | "UNKNOWN_FIELD"
      | "MISSING_FIELD"
      | "INVALID_VALUE"
      | "INCONSISTENT_EVENT"
      | "EVENT_KEY_MISMATCH"
      | "PRIVACY_UNSAFE_KEY",
    /** A field NAME only. A value is never placed in an error. */
    public readonly field: string | null = null,
  ) {
    super(field ? `${code}:${field}` : code);
    this.name = "AiTelemetryValidationError";
  }
}

// ---------------------------------------------------------------------------
// Idempotency keys
// ---------------------------------------------------------------------------

/**
 * Exactly-once key. Persistence inserts ON CONFLICT (event_key) DO NOTHING.
 *
 * Two deliberate exclusions:
 *   outcomes share `out:` — one attempt cannot both succeed and time out;
 *   Doctor decisions share `dec:` — a Doctor decides once. Expiry has its own
 *   `exp:` key so a sweep can never block, or be blocked by, a real decision;
 *   precedence resolves the pair at read time.
 */
export function eventKeyFor(event: Record<string, unknown>): string {
  switch (event.event_type as AiTelemetryEventType) {
    case "AI_OPERATION_STARTED":
      return `op:${String(event.operation_id)}`;
    case "AI_PROVIDER_ATTEMPTED":
      return `att:${String(event.operation_id)}:${String(event.attempt_no)}`;
    case "AI_PROVIDER_SUCCEEDED":
    case "AI_PROVIDER_FAILED":
    case "AI_PROVIDER_TIMEOUT":
      return `out:${String(event.operation_id)}:${String(event.attempt_no)}`;
    case "AI_PROPOSAL_PRODUCED":
      return `prop:${String(event.proposal_id)}`;
    case "AI_PROPOSAL_ACCEPTED":
    case "AI_PROPOSAL_EDITED":
    case "AI_PROPOSAL_REJECTED":
      return `dec:${String(event.proposal_id)}`;
    case "AI_PROPOSAL_EXPIRED":
      return `exp:${String(event.proposal_id)}`;
    case "VOICE_GRANT_ISSUED":
    case "VOICE_GRANT_DENIED":
      return `grant:${String(event.grant_id)}`;
    case "VOICE_SESSION_REPORTED":
      return `voice:${String(event.voice_session_id)}`;
    default:
      throw new AiTelemetryValidationError("UNKNOWN_EVENT_TYPE", "event_type");
  }
}

