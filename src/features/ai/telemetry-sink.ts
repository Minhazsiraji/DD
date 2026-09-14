import "server-only";

import {
  persistRuntimeAiVoiceTelemetry,
  resolveRuntimeDoctorId,
} from "@/lib/o1/runtime-authority";
import {
  AiTelemetryValidationError,
  validateAiTelemetryEvent,
  type AiTelemetryEvent,
} from "./telemetry";

/**
 * Where AI / Voice telemetry goes.
 *
 * The default runtime sink is frozen O1-F's durable RPC. It first resolves the
 * actor to the canonical Doctor profile on the trusted server path and refuses
 * a conflicting Doctor id. The database then re-validates the exact allowlist
 * and enforces event-key idempotency.
 *
 * Telemetry remains non-clinical and non-blocking: `emitAiTelemetry` never lets
 * a persistence failure break the Doctor's action.
 */
export interface AiTelemetrySink {
  record(event: AiTelemetryEvent): Promise<void>;
}

export const NOOP_AI_TELEMETRY_SINK: AiTelemetrySink = Object.freeze({
  record: async () => undefined,
});

/** Exactly-once in-memory sink. Used by tests and by any process-local consumer. */
export class InMemoryAiTelemetrySink implements AiTelemetrySink {
  private readonly byKey = new Map<string, AiTelemetryEvent>();

  async record(event: AiTelemetryEvent): Promise<void> {
    if (this.byKey.has(event.event_key)) return;
    this.byKey.set(event.event_key, Object.freeze({ ...event }) as AiTelemetryEvent);
  }

  events(): readonly AiTelemetryEvent[] {
    return [...this.byKey.values()];
  }

  ofType<T extends AiTelemetryEvent["event_type"]>(type: T): EventOfType<T>[] {
    return this.events().filter((event) => event.event_type === type) as EventOfType<T>[];
  }
}

export type EventOfType<T extends AiTelemetryEvent["event_type"]> = AiTelemetryEvent extends infer E
  ? E extends { event_type: infer U }
    ? T extends U
      ? E
      : never
    : never
  : never;

/**
 * Production O1-E sink. Actor identity is authoritative; Doctor identity is
 * derived from it and never trusted from a browser-returned binding.
 */
export const O1_DURABLE_AI_TELEMETRY_SINK: AiTelemetrySink = Object.freeze({
  async record(event: AiTelemetryEvent): Promise<void> {
    let doctorProfileId: string | null = null;

    if (event.actor_user_id !== null) {
      doctorProfileId = await resolveRuntimeDoctorId(event.actor_user_id);
      if (!doctorProfileId) throw new Error("O1E_ACTOR_DOCTOR_REQUIRED");
      if (event.doctor_profile_id !== null && event.doctor_profile_id !== doctorProfileId) {
        throw new Error("O1E_ACTOR_DOCTOR_MISMATCH");
      }
    } else if (event.doctor_profile_id !== null) {
      throw new Error("O1E_DOCTOR_WITHOUT_ACTOR_REJECTED");
    }

    const canonical = validateAiTelemetryEvent({
      ...event,
      doctor_profile_id: doctorProfileId,
    });

    await persistRuntimeAiVoiceTelemetry(
      canonical as unknown as Record<string, unknown>,
    );
  },
});

let configuredSink: AiTelemetrySink = O1_DURABLE_AI_TELEMETRY_SINK;

/** Test/controlled-runtime hook. Production needs no boot-time configuration. */
export function configureAiTelemetrySink(sink: AiTelemetrySink): void {
  configuredSink = sink;
}

export function getAiTelemetrySink(): AiTelemetrySink {
  return configuredSink;
}

export type EmitResult = { ok: true } | { ok: false; code: string };

/**
 * Validate against the allowlist, then record.
 *
 * NEVER THROWS. Telemetry is a monitoring concern and must never break the
 * Doctor's action. A rejected or failed event is reported by code only: the
 * event itself is never logged.
 */
export async function emitAiTelemetry(
  sink: AiTelemetrySink,
  candidate: unknown,
): Promise<EmitResult> {
  let event: AiTelemetryEvent;
  try {
    event = validateAiTelemetryEvent(candidate);
  } catch (error) {
    const code =
      error instanceof AiTelemetryValidationError ? error.message : "TELEMETRY_VALIDATION_FAILED";
    console.error("[ai-telemetry] event rejected", code);
    return { ok: false, code };
  }
  try {
    await sink.record(event);
    return { ok: true };
  } catch {
    console.error("[ai-telemetry] sink failed", event.event_type);
    return { ok: false, code: "SINK_FAILED" };
  }
}
