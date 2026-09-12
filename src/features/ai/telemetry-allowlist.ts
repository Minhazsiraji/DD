import "server-only";

import type { AiTelemetryEventType } from "./telemetry-events";

/**
 * The persisted allowlist. THIS IS THE SCHEMA: a key absent here cannot be
 * stored, and every key present here must be present on the event.
 */

// ---------------------------------------------------------------------------
// The allowlist
// ---------------------------------------------------------------------------

const COMMON_KEYS = [
  "event_type",
  "schema_version",
  "event_key",
  "occurred_at",
  "actor_user_id",
  "doctor_profile_id",
] as const;

const OUTCOME_KEYS = [
  "operation_id",
  "attempt_no",
  "provider_id",
  "model_id",
  "task_type",
  "latency_ms",
  "failure_code",
  "provider_http_status",
  "usage_state",
  "input_tokens",
  "cached_input_tokens",
  "output_tokens",
  "reasoning_tokens",
  "total_tokens",
  "cost_state",
  "cost_source",
  "cost_attribution_mode",
  "pricing_snapshot_id",
  "estimated_cost_usd_micros",
  "input_cost_usd_micros",
  "cached_input_cost_usd_micros",
  "output_cost_usd_micros",
] as const;

const DECISION_KEYS = ["proposal_id", "task_type"] as const;

export const AI_TELEMETRY_ALLOWLIST: Readonly<Record<AiTelemetryEventType, readonly string[]>> =
  Object.freeze({
    AI_OPERATION_STARTED: [
      ...COMMON_KEYS,
      "operation_id",
      "provider_id",
      "model_id",
      "task_type",
      "source",
    ],
    AI_PROVIDER_ATTEMPTED: [
      ...COMMON_KEYS,
      "operation_id",
      "attempt_no",
      "provider_id",
      "model_id",
      "task_type",
    ],
    AI_PROVIDER_SUCCEEDED: [...COMMON_KEYS, ...OUTCOME_KEYS],
    AI_PROVIDER_FAILED: [...COMMON_KEYS, ...OUTCOME_KEYS],
    AI_PROVIDER_TIMEOUT: [...COMMON_KEYS, ...OUTCOME_KEYS],
    AI_PROPOSAL_PRODUCED: [
      ...COMMON_KEYS,
      "operation_id",
      "proposal_id",
      "provider_id",
      "model_id",
      "task_type",
      "uncertainty_count",
    ],
    AI_PROPOSAL_ACCEPTED: [...COMMON_KEYS, ...DECISION_KEYS],
    AI_PROPOSAL_EDITED: [...COMMON_KEYS, ...DECISION_KEYS],
    AI_PROPOSAL_REJECTED: [...COMMON_KEYS, ...DECISION_KEYS],
    AI_PROPOSAL_EXPIRED: [...COMMON_KEYS, ...DECISION_KEYS],
    VOICE_GRANT_ISSUED: [...COMMON_KEYS, "grant_id", "provider_id", "model_id", "denial_reason"],
    VOICE_GRANT_DENIED: [...COMMON_KEYS, "grant_id", "provider_id", "model_id", "denial_reason"],
    VOICE_SESSION_REPORTED: [
      ...COMMON_KEYS,
      "voice_session_id",
      "grant_id",
      "provider_id",
      "model_id",
      "streamed_audio_ms",
      "measurement_quality",
      "connect_latency_ms",
      "first_result_latency_ms",
      "cost_state",
      "cost_source",
      "cost_attribution_mode",
      "pricing_snapshot_id",
      "estimated_cost_usd_micros",
    ],
  });

