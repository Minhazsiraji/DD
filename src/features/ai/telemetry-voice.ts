import "server-only";

import type { AudioCostFacts } from "./pricing";
import { eventBase, microsOrNull, withEventKey } from "./telemetry-builders";
import {
  AiTelemetryValidationError,
  GRANT_ID_RE,
  VOICE_MODEL_ID,
  VOICE_PROVIDER_ID,
  VOICE_SESSION_ID_RE,
  VOICE_SESSION_MAX_MS,
  type VoiceGrantDenialReason,
  type VoiceGrantEvent,
  type VoiceSessionReportedEvent,
} from "./telemetry-events";

const isString = (value: unknown): value is string => typeof value === "string";
const isCount = (value: unknown): boolean =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

export function buildVoiceGrant(input: {
  occurredAt: Date;
  actorUserId: string;
  grantId: string;
  denialReason: VoiceGrantDenialReason | null;
}): VoiceGrantEvent {
  return withEventKey({
    ...eventBase(
      input.denialReason === null ? "VOICE_GRANT_ISSUED" : "VOICE_GRANT_DENIED",
      input.occurredAt,
      // The grant route knows the auth user, not the Doctor profile, and must
      // not grow a database lookup to find out. The Owner projection resolves
      // the principal from the actor instead.
      { actorUserId: input.actorUserId, doctorProfileId: null },
    ),
    grant_id: input.grantId,
    provider_id: VOICE_PROVIDER_ID,
    model_id: VOICE_MODEL_ID,
    denial_reason: input.denialReason,
  });
}

export function buildVoiceSessionReported(input: {
  occurredAt: Date;
  actorUserId: string;
  beacon: VoiceUsageBeacon;
  cost: AudioCostFacts;
}): VoiceSessionReportedEvent {
  return withEventKey({
    ...eventBase("VOICE_SESSION_REPORTED", input.occurredAt, {
      actorUserId: input.actorUserId,
      doctorProfileId: null,
    }),
    voice_session_id: input.beacon.voiceSessionId,
    grant_id: input.beacon.grantId,
    provider_id: VOICE_PROVIDER_ID,
    model_id: VOICE_MODEL_ID,
    streamed_audio_ms: input.beacon.streamedAudioMs,
    // Browser→Deepgram streaming is direct: the duration is the client's
    // estimate and is labelled as exactly that.
    measurement_quality: "CLIENT_ESTIMATE" as const,
    connect_latency_ms: input.beacon.connectLatencyMs,
    first_result_latency_ms: input.beacon.firstResultLatencyMs,
    cost_state: input.cost.state,
    cost_source: input.cost.source,
    cost_attribution_mode: input.cost.mode,
    pricing_snapshot_id: input.cost.pricingSnapshotId,
    estimated_cost_usd_micros: microsOrNull(input.cost.total),
  });
}

// ---------------------------------------------------------------------------
// Voice usage beacon — the one inbound path a browser controls
// ---------------------------------------------------------------------------

export interface VoiceUsageBeacon {
  voiceSessionId: string;
  grantId: string;
  streamedAudioMs: number;
  connectLatencyMs: number | null;
  firstResultLatencyMs: number | null;
}

const BEACON_REQUIRED = ["voice_session_id", "grant_id", "streamed_audio_ms"] as const;
const BEACON_OPTIONAL = ["connect_latency_ms", "first_result_latency_ms"] as const;
const BEACON_KEYS: readonly string[] = [...BEACON_REQUIRED, ...BEACON_OPTIONAL];

/**
 * Parse an untrusted browser beacon. A single key outside the allowlist rejects
 * the WHOLE body — it is never stripped and accepted, because a stripped body
 * is still proof the client tried to send something it should not.
 * Out-of-range durations are rejected, not clamped: a clamp hides a broken client.
 */
export function parseVoiceUsageBeacon(body: unknown): VoiceUsageBeacon {
  if (
    body === null ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.getPrototypeOf(body) !== Object.prototype
  ) {
    throw new AiTelemetryValidationError("NOT_PLAIN_OBJECT");
  }
  const record = body as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!BEACON_KEYS.includes(key)) throw new AiTelemetryValidationError("UNKNOWN_FIELD", key);
  }
  for (const key of BEACON_REQUIRED) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) {
      throw new AiTelemetryValidationError("MISSING_FIELD", key);
    }
  }
  if (!VOICE_SESSION_ID_RE.test(String(record.voice_session_id)) || !isString(record.voice_session_id)) {
    throw new AiTelemetryValidationError("INVALID_VALUE", "voice_session_id");
  }
  if (!isString(record.grant_id) || !GRANT_ID_RE.test(record.grant_id)) {
    throw new AiTelemetryValidationError("INVALID_VALUE", "grant_id");
  }
  const ms = record.streamed_audio_ms;
  if (!isCount(ms) || (ms as number) > VOICE_SESSION_MAX_MS) {
    throw new AiTelemetryValidationError("INVALID_VALUE", "streamed_audio_ms");
  }
  const optionalCount = (key: string): number | null => {
    const value = record[key];
    if (value === undefined || value === null) return null;
    if (!isCount(value)) throw new AiTelemetryValidationError("INVALID_VALUE", key);
    return value as number;
  };
  return {
    voiceSessionId: record.voice_session_id,
    grantId: record.grant_id,
    streamedAudioMs: ms as number,
    connectLatencyMs: optionalCount("connect_latency_ms"),
    firstResultLatencyMs: optionalCount("first_result_latency_ms"),
  };
}
