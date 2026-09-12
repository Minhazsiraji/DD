import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { costForTokenUsage } from "./pricing";
import { reportedUsage } from "./providers";
import {
  AI_TELEMETRY_ALLOWLIST,
  AI_TELEMETRY_EVENT_TYPES,
  AiTelemetryValidationError,
  assertPrivacySafeTelemetry,
  buildOperationStarted,
  buildProviderOutcome,
  mintTelemetryOperationId,
  parseVoiceUsageBeacon,
  validateAiTelemetryEvent,
} from "./telemetry";
import { OWNER_AGGREGATE_COLUMNS, projectOwnerAggregates } from "./owner-projection";
import { InMemoryAiTelemetrySink, emitAiTelemetry } from "./telemetry-sink";
import { voiceUsageBeaconBody } from "../dictation/voice-usage";

const principal = {
  actorUserId: "11111111-1111-4111-8111-111111111111",
  doctorProfileId: "22222222-2222-4222-8222-222222222222",
};
const PATIENT_ID = "44444444-4444-4444-8444-444444444444";

function started() {
  return buildOperationStarted({
    occurredAt: new Date("2026-09-11T04:00:00Z"),
    principal,
    operationId: mintTelemetryOperationId(),
    providerId: "openai",
    modelId: "gpt-5.6-terra",
    taskType: "PRESCRIPTION_MEDICINE",
    source: "TEXT",
  });
}

function rejects(candidate: unknown): AiTelemetryValidationError {
  try {
    validateAiTelemetryEvent(candidate);
  } catch (error) {
    if (error instanceof AiTelemetryValidationError) return error;
    throw error;
  }
  throw new Error("expected the allowlist to reject this event");
}

/** Every class Central named as never-persisted, in the spellings a caller might use. */
const PROHIBITED_KEYS = [
  "securityHandle",
  "security_handle",
  "patient_id",
  "patientId",
  "patientIdentifier",
  "encounter_id",
  "encounterId",
  "prescription_id",
  "document_id",
  "appointment_id",
  "clinicalRecordId",
  "patient_id_hash",
  "encounter_hmac",
  "prompt",
  "completion",
  "authoredText",
  "proposal",
  "proposalBody",
  "transcript",
  "transcriptText",
  "rawAudio",
  "audioBytes",
  "medicine",
  "medicineName",
  "investigation",
  "testName",
  "diagnosis",
  "note",
  "raw_request",
  "rawResponse",
  "binding",
  "meta",
];

describe("Persisted telemetry allowlist — unknown fields fail", () => {
  it("accepts a well-formed event built by the builders", () => {
    expect(() => validateAiTelemetryEvent(started())).not.toThrow();
  });

  it.each(PROHIBITED_KEYS)("rejects an event carrying %s", (key) => {
    const error = rejects({ ...started(), [key]: "x" });
    expect(["UNKNOWN_FIELD", "PRIVACY_UNSAFE_KEY"]).toContain(error.code);
  });

  it("rejects ANY field outside the allowlist, not only known-bad names", () => {
    expect(rejects({ ...started(), innocuous_looking: 1 }).code).toBe("UNKNOWN_FIELD");
  });

  it("rejects a missing allowed field rather than defaulting it", () => {
    const withoutSource: Record<string, unknown> = { ...started() };
    delete withoutSource.source;
    expect(rejects(withoutSource)).toMatchObject({ code: "MISSING_FIELD", field: "source" });
  });

  it("will not accept a bare clinical UUID as a telemetry operation id", () => {
    const event = { ...started(), operation_id: PATIENT_ID };
    event.event_key = `op:${PATIENT_ID}`;
    expect(rejects(event)).toMatchObject({ code: "INVALID_VALUE", field: "operation_id" });
  });

  it("rejects an event whose key does not match its content", () => {
    expect(rejects({ ...started(), event_key: "op:forged" }).code).toBe("EVENT_KEY_MISMATCH");
  });

  it("never places a rejected VALUE in the error", () => {
    const error = rejects({ ...started(), transcript: "Napa 500 twice daily for Rahim" });
    expect(error.message).not.toContain("Rahim");
    expect(error.message).not.toContain("Napa");
  });

  it("gives no event type a key that names a prohibited class", () => {
    for (const type of AI_TELEMETRY_EVENT_TYPES) {
      for (const key of AI_TELEMETRY_ALLOWLIST[type]) {
        expect(() => assertPrivacySafeTelemetry({ [key]: null }), `${type}.${key}`).not.toThrow();
      }
    }
  });

  it("second net catches nested and oddly-spelled keys", () => {
    expect(() => assertPrivacySafeTelemetry({ a: { b: [{ "Patient-Id": 1 }] } })).toThrow(
      /PRIVACY_UNSAFE_KEY/,
    );
  });
});

describe("Truth rules enforced at the door", () => {
  const outcome = (overrides: Record<string, unknown>) => ({
    ...buildProviderOutcome({
      type: "AI_PROVIDER_SUCCEEDED",
      occurredAt: new Date("2026-09-11T04:00:00Z"),
      principal,
      operationId: mintTelemetryOperationId(),
      attemptNo: 1,
      providerId: "openai",
      modelId: "gpt-5.6-terra",
      taskType: "PRESCRIPTION_MEDICINE",
      latencyMs: 10,
      failureCode: null,
      httpStatus: null,
      usage: reportedUsage({ inputTokens: 10, cachedInputTokens: 0, outputTokens: 5 }),
      cost: costForTokenUsage(reportedUsage({ inputTokens: 10, cachedInputTokens: 0, outputTokens: 5 }), null),
    }),
    ...overrides,
  });

  it("refuses a token count on usage that was never reported", () => {
    expect(rejects(outcome({ usage_state: "UNKNOWN_PENDING_RECONCILIATION", cost_state: "UNKNOWN_PENDING_RECONCILIATION" })).code).toBe(
      "INCONSISTENT_EVENT",
    );
  });

  it("refuses an amount beside an UNPRICED cost state", () => {
    expect(rejects(outcome({ estimated_cost_usd_micros: "0.000000" })).field).toBe(
      "estimated_cost_usd_micros",
    );
  });

  it("refuses per-meter amounts that do not sum to the total", () => {
    const error = rejects(
      outcome({
        cost_state: "ESTIMATED",
        cost_source: "PRICING_SNAPSHOT",
        cost_attribution_mode: "ALLOCATED",
        estimated_cost_usd_micros: "10.000000",
        input_cost_usd_micros: "4.000000",
        cached_input_cost_usd_micros: "0.000000",
        output_cost_usd_micros: "4.000000",
      }),
    );
    expect(error.code).toBe("INCONSISTENT_EVENT");
  });
});

describe("Sink — exactly once, and never throws", () => {
  it("ignores a replayed event with the same key", async () => {
    const sink = new InMemoryAiTelemetrySink();
    const event = started();
    await emitAiTelemetry(sink, event);
    await emitAiTelemetry(sink, { ...event });
    expect(sink.events()).toHaveLength(1);
  });

  it("drops an unsafe event without throwing into the caller", async () => {
    const sink = new InMemoryAiTelemetrySink();
    const result = await emitAiTelemetry(sink, { ...started(), transcript: "x" });
    expect(result.ok).toBe(false);
    expect(sink.events()).toHaveLength(0);
  });
});

describe("Voice usage beacon — the browser-controlled inbound path", () => {
  const valid = {
    voice_session_id: "ddvs_66666666-6666-4666-8666-666666666666",
    grant_id: "ddgr_77777777-7777-4777-8777-777777777777",
    streamed_audio_ms: 4200,
  };

  it("accepts the exact allowlisted shape", () => {
    expect(parseVoiceUsageBeacon(valid).streamedAudioMs).toBe(4200);
  });

  it.each(["transcript", "text", "patient_id", "language", "audio"])(
    "rejects the WHOLE body when it carries %s",
    (key) => {
      expect(() => parseVoiceUsageBeacon({ ...valid, [key]: "x" })).toThrow(/UNKNOWN_FIELD/);
    },
  );

  it("rejects, rather than clamps, an out-of-range duration", () => {
    expect(() => parseVoiceUsageBeacon({ ...valid, streamed_audio_ms: 16 * 60 * 1000 })).toThrow(
      /INVALID_VALUE/,
    );
    expect(() => parseVoiceUsageBeacon({ ...valid, streamed_audio_ms: -1 })).toThrow(/INVALID_VALUE/);
  });

  it("the browser builds only allowlisted keys, and nothing without a grant", () => {
    const body = voiceUsageBeaconBody({
      voiceSessionId: valid.voice_session_id,
      grantId: valid.grant_id,
      streamedAudioMs: 4200.4,
      connectLatencyMs: 310,
      firstResultLatencyMs: null,
    });
    expect(Object.keys(body!).sort()).toEqual(
      ["connect_latency_ms", "grant_id", "streamed_audio_ms", "voice_session_id"].sort(),
    );
    expect(() => parseVoiceUsageBeacon(body)).not.toThrow();
    expect(
      voiceUsageBeaconBody({
        voiceSessionId: valid.voice_session_id,
        grantId: null,
        streamedAudioMs: 0,
        connectLatencyMs: null,
        firstResultLatencyMs: null,
      }),
    ).toBeNull();
  });

  it("the browser usage module never references a transcript", () => {
    const source = readFileSync(new URL("../dictation/voice-usage.ts", import.meta.url), "utf8");
    const code = source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    expect(code).not.toMatch(/transcript/i);
    expect(code).not.toMatch(/patient|encounter|prescription/i);
  });
});

describe("O1-F conformance — the E→F projection never widens the contract", () => {
  it("emits rows with exactly the ten O1-F columns", () => {
    const rows = projectOwnerAggregates([started()], { timeZone: "Asia/Dhaka" });
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(Object.keys(row)).toEqual([...OWNER_AGGREGATE_COLUMNS]);
    expect(OWNER_AGGREGATE_COLUMNS).toHaveLength(10);
  });
});
