import "server-only";

import { AI_TASK_TYPES } from "./contracts";
import { microsDecimalToPicousd } from "./money";
import type { CostAttributionMode, CostSource, CostState } from "./pricing";
import type { ProviderUsageState } from "./providers";
import { AI_TELEMETRY_ALLOWLIST } from "./telemetry-allowlist";
import {
  AI_FAILURE_CODES,
  AI_PROVIDER_OUTCOME_TYPES,
  AI_TELEMETRY_EVENT_TYPES,
  AI_TELEMETRY_SCHEMA_VERSION,
  AiTelemetryValidationError,
  GRANT_ID_RE,
  MICROS_RE,
  OPERATION_ID_RE,
  PROPOSAL_ID_RE,
  SLUG_RE,
  SNAPSHOT_ID_RE,
  UUID_RE,
  VOICE_GRANT_DENIAL_REASONS,
  VOICE_MEASUREMENT_QUALITIES,
  VOICE_SESSION_ID_RE,
  VOICE_SESSION_MAX_MS,
  eventKeyFor,
  type AiTelemetryEvent,
  type AiTelemetryEventType,
} from "./telemetry-events";
import { assertPrivacySafeTelemetry } from "./telemetry-privacy";

/** Value shapes and cross-field truth rules for persisted telemetry. */

const USAGE_STATES: readonly ProviderUsageState[] = [
  "REPORTED",
  "UNKNOWN_PENDING_RECONCILIATION",
  "NOT_APPLICABLE",
];
const COST_STATES: readonly CostState[] = [
  "ESTIMATED",
  "PROVIDER_REPORTED",
  "RECONCILED",
  "UNKNOWN_PENDING_RECONCILIATION",
  "UNPRICED",
  "NOT_INCURRED",
];
const COST_SOURCES: readonly CostSource[] = ["PRICING_SNAPSHOT", "PROVIDER_REPORTED", "RECONCILIATION"];
const COST_MODES: readonly CostAttributionMode[] = ["ALLOCATED", "CANONICAL"];

type Check = (value: unknown) => boolean;

const isString = (value: unknown): value is string => typeof value === "string";
const nullable = (check: Check): Check => (value) => value === null || check(value);
const oneOf = (values: readonly string[]): Check => (value) => isString(value) && values.includes(value);
const matches = (pattern: RegExp): Check => (value) => isString(value) && pattern.test(value);
const count: Check = (value) =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const isoTimestamp: Check = (value) => {
  if (!isString(value)) return false;
  const time = Date.parse(value);
  return !Number.isNaN(time) && new Date(time).toISOString() === value;
};

const CHECKS: Readonly<Record<string, Check>> = {
  event_type: oneOf(AI_TELEMETRY_EVENT_TYPES),
  schema_version: (value) => value === AI_TELEMETRY_SCHEMA_VERSION,
  event_key: (value) => isString(value) && value.length > 0 && value.length <= 160,
  occurred_at: isoTimestamp,
  actor_user_id: nullable(matches(UUID_RE)),
  doctor_profile_id: nullable(matches(UUID_RE)),
  operation_id: matches(OPERATION_ID_RE),
  proposal_id: matches(PROPOSAL_ID_RE),
  voice_session_id: matches(VOICE_SESSION_ID_RE),
  grant_id: matches(GRANT_ID_RE),
  provider_id: matches(SLUG_RE),
  model_id: matches(SLUG_RE),
  task_type: oneOf(AI_TASK_TYPES),
  source: oneOf(["TEXT", "VOICE_TRANSCRIPT"]),
  attempt_no: (value) => count(value) && (value as number) >= 1 && (value as number) <= 100,
  latency_ms: count,
  failure_code: nullable(oneOf(AI_FAILURE_CODES)),
  provider_http_status: nullable(
    (value) => count(value) && (value as number) >= 100 && (value as number) <= 599,
  ),
  usage_state: oneOf(USAGE_STATES),
  input_tokens: nullable(count),
  cached_input_tokens: nullable(count),
  output_tokens: nullable(count),
  reasoning_tokens: nullable(count),
  total_tokens: nullable(count),
  cost_state: oneOf(COST_STATES),
  cost_source: nullable(oneOf(COST_SOURCES)),
  cost_attribution_mode: nullable(oneOf(COST_MODES)),
  pricing_snapshot_id: nullable(matches(SNAPSHOT_ID_RE)),
  estimated_cost_usd_micros: nullable(matches(MICROS_RE)),
  input_cost_usd_micros: nullable(matches(MICROS_RE)),
  cached_input_cost_usd_micros: nullable(matches(MICROS_RE)),
  output_cost_usd_micros: nullable(matches(MICROS_RE)),
  uncertainty_count: count,
  denial_reason: nullable(oneOf(VOICE_GRANT_DENIAL_REASONS)),
  streamed_audio_ms: nullable(
    (value) => count(value) && (value as number) <= VOICE_SESSION_MAX_MS,
  ),
  measurement_quality: oneOf(VOICE_MEASUREMENT_QUALITIES),
  connect_latency_ms: nullable(count),
  first_result_latency_ms: nullable(count),
};

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const TOKEN_FIELDS = [
  "input_tokens",
  "cached_input_tokens",
  "output_tokens",
  "reasoning_tokens",
  "total_tokens",
] as const;

const KNOWN_COST_STATES: readonly CostState[] = ["ESTIMATED", "PROVIDER_REPORTED", "RECONCILED"];
const UNKNOWN_COST_STATES: readonly CostState[] = ["UNKNOWN_PENDING_RECONCILIATION", "UNPRICED"];

function inconsistent(field: string): never {
  throw new AiTelemetryValidationError("INCONSISTENT_EVENT", field);
}

function checkCostFacts(event: Record<string, unknown>, perMeterFields: readonly string[]): void {
  const state = event.cost_state as CostState;
  const total = event.estimated_cost_usd_micros as string | null;
  const perMeter = perMeterFields.map((field) => event[field] as string | null);

  if (UNKNOWN_COST_STATES.includes(state)) {
    // Unknown means unknown everywhere: no partial amount may sit beside it.
    if (total !== null) inconsistent("estimated_cost_usd_micros");
    perMeter.forEach((value, i) => {
      if (value !== null) inconsistent(perMeterFields[i]!);
    });
    if (event.cost_source !== null) inconsistent("cost_source");
    if (event.cost_attribution_mode !== null) inconsistent("cost_attribution_mode");
    return;
  }

  if (total === null) inconsistent("estimated_cost_usd_micros");
  const totalValue = microsDecimalToPicousd(total);

  if (state === "NOT_INCURRED") {
    if (totalValue !== BigInt(0)) inconsistent("estimated_cost_usd_micros");
    return;
  }

  if (!KNOWN_COST_STATES.includes(state)) inconsistent("cost_state");
  if (event.cost_source === null) inconsistent("cost_source");
  if (event.cost_attribution_mode === null) inconsistent("cost_attribution_mode");

  if (perMeterFields.length === 0) return;
  let sum = BigInt(0);
  perMeter.forEach((value, i) => {
    if (value === null) inconsistent(perMeterFields[i]!);
    sum += microsDecimalToPicousd(value);
  });
  // The cost-bearing row invariant, enforced at the door: the disjoint meters
  // sum exactly to the total, so nothing is ever counted twice downstream.
  if (sum !== totalValue) inconsistent("estimated_cost_usd_micros");
  if (event.cost_attribution_mode === "CANONICAL") {
    if (microsDecimalToPicousd(event.input_cost_usd_micros as string) !== BigInt(0)) {
      inconsistent("input_cost_usd_micros");
    }
    if (microsDecimalToPicousd(event.cached_input_cost_usd_micros as string) !== BigInt(0)) {
      inconsistent("cached_input_cost_usd_micros");
    }
  }
}

function checkConsistency(event: Record<string, unknown>): void {
  const type = event.event_type as AiTelemetryEventType;

  if ((AI_PROVIDER_OUTCOME_TYPES as readonly string[]).includes(type)) {
    const failure = event.failure_code;
    if (type === "AI_PROVIDER_SUCCEEDED" && failure !== null) inconsistent("failure_code");
    if (type !== "AI_PROVIDER_SUCCEEDED" && failure === null) inconsistent("failure_code");
    if (type === "AI_PROVIDER_TIMEOUT") {
      if (failure !== "PROVIDER_TIMEOUT") inconsistent("failure_code");
      if (event.usage_state !== "UNKNOWN_PENDING_RECONCILIATION") inconsistent("usage_state");
    }
    // Only a reported usage may carry token counts. Absence is null, never 0.
    if (event.usage_state !== "REPORTED") {
      for (const field of TOKEN_FIELDS) if (event[field] !== null) inconsistent(field);
    }
    if (event.usage_state === "UNKNOWN_PENDING_RECONCILIATION") {
      if (event.cost_state !== "UNKNOWN_PENDING_RECONCILIATION") inconsistent("cost_state");
    }
    if (event.usage_state === "NOT_APPLICABLE" && event.cost_state !== "NOT_INCURRED") {
      inconsistent("cost_state");
    }
    const input = event.input_tokens as number | null;
    const cached = event.cached_input_tokens as number | null;
    const output = event.output_tokens as number | null;
    const reasoning = event.reasoning_tokens as number | null;
    if (input !== null && cached !== null && cached > input) inconsistent("cached_input_tokens");
    if (output !== null && reasoning !== null && reasoning > output) inconsistent("reasoning_tokens");
    checkCostFacts(event, [
      "input_cost_usd_micros",
      "cached_input_cost_usd_micros",
      "output_cost_usd_micros",
    ]);
  }

  if (type === "VOICE_GRANT_ISSUED" && event.denial_reason !== null) inconsistent("denial_reason");
  if (type === "VOICE_GRANT_DENIED" && event.denial_reason === null) inconsistent("denial_reason");

  if (type === "VOICE_SESSION_REPORTED") {
    if (event.streamed_audio_ms === null && event.cost_state !== "UNKNOWN_PENDING_RECONCILIATION") {
      inconsistent("cost_state");
    }
    checkCostFacts(event, []);
  }
}

/**
 * Validate a candidate for persistence. Returns the event unchanged, or throws
 * an `AiTelemetryValidationError` naming only the offending FIELD.
 */
export function validateAiTelemetryEvent(candidate: unknown): AiTelemetryEvent {
  if (
    candidate === null ||
    typeof candidate !== "object" ||
    Array.isArray(candidate) ||
    (Object.getPrototypeOf(candidate) !== Object.prototype &&
      Object.getPrototypeOf(candidate) !== null)
  ) {
    throw new AiTelemetryValidationError("NOT_PLAIN_OBJECT");
  }
  const event = candidate as Record<string, unknown>;
  const type = event.event_type;
  if (!isString(type) || !(AI_TELEMETRY_EVENT_TYPES as readonly string[]).includes(type)) {
    throw new AiTelemetryValidationError("UNKNOWN_EVENT_TYPE", "event_type");
  }

  const allowed = AI_TELEMETRY_ALLOWLIST[type as AiTelemetryEventType];
  for (const key of Object.keys(event)) {
    if (!allowed.includes(key)) throw new AiTelemetryValidationError("UNKNOWN_FIELD", key);
  }
  for (const key of allowed) {
    if (!Object.prototype.hasOwnProperty.call(event, key)) {
      throw new AiTelemetryValidationError("MISSING_FIELD", key);
    }
    const check = CHECKS[key];
    if (!check || !check(event[key])) throw new AiTelemetryValidationError("INVALID_VALUE", key);
  }
  if (event.event_key !== eventKeyFor(event)) {
    throw new AiTelemetryValidationError("EVENT_KEY_MISMATCH", "event_key");
  }
  checkConsistency(event);
  assertPrivacySafeTelemetry(event);
  return event as unknown as AiTelemetryEvent;
}

