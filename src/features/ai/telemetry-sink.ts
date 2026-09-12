import "server-only";

import {
  AiTelemetryValidationError,
  validateAiTelemetryEvent,
  type AiTelemetryEvent,
} from "./telemetry";

/**
 * Where AI / Voice telemetry goes.
 *
 * PERSISTENCE IS NOT BUILT HERE. The durable table is owned by O1-F (0047).
 * Until a durable sink is configured, events go to the no-op sink: validated,
 * then dropped. That is deliberate — telemetry written somewhere unreviewed is
 * worse than telemetry not yet written.
 *
 * EVERY SINK MUST BE IDEMPOTENT ON `event_key`: a second event with a key
 * already recorded is ignored, never appended. That is the contract a durable
 * sink implements with INSERT … ON CONFLICT (event_key) DO NOTHING, and it is
 * what keeps retried emissions from inflating any counter.
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
    if (this.byKey.has(event.event_key)) return; // ON CONFLICT DO NOTHING
    this.byKey.set(event.event_key, Object.freeze({ ...event }) as AiTelemetryEvent);
  }

  events(): readonly AiTelemetryEvent[] {
    return [...this.byKey.values()];
  }

  ofType<T extends AiTelemetryEvent["event_type"]>(type: T): EventOfType<T>[] {
    return this.events().filter((event) => event.event_type === type) as EventOfType<T>[];
  }
}

/**
 * The event shape(s) that can carry `event_type` T. Not `Extract<>`: several
 * shapes share one interface across a union of types (the three provider
 * outcomes, say), and `Extract` cannot match a single literal against that
 * union — it resolves to `never`.
 */
export type EventOfType<T extends AiTelemetryEvent["event_type"]> = AiTelemetryEvent extends infer E
  ? E extends { event_type: infer U }
    ? T extends U
      ? E
      : never
    : never
  : never;

let configuredSink: AiTelemetrySink = NOOP_AI_TELEMETRY_SINK;

/** Server configuration hook, for binding the durable O1-F sink when it exists. */
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
 * Doctor's action — the same rule `src/lib/audit/emit.ts` states for audit.
 * A rejected or failed event is reported by code only: the event itself is
 * never logged, because a rejected event is by definition one that may carry
 * something it should not.
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
