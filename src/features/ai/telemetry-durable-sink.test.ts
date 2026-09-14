import { describe, expect, it, vi } from "vitest";
import { buildOperationStarted } from "./telemetry";
import { canonicalizeAiTelemetryPrincipal } from "./telemetry-sink";

const ACTOR = "11111111-1111-4111-8111-111111111111";
const DOCTOR = "22222222-2222-4222-8222-222222222222";
const OTHER_DOCTOR = "33333333-3333-4333-8333-333333333333";

function event(actorUserId: string | null, doctorProfileId: string | null) {
  return buildOperationStarted({
    occurredAt: new Date("2026-09-14T05:30:00.000Z"),
    principal: { actorUserId, doctorProfileId },
    operationId: "ddop_44444444-4444-4444-8444-444444444444",
    providerId: "openai",
    modelId: "gpt-5.6",
    taskType: "PRESCRIPTION_MEDICINE",
    source: "TEXT",
  });
}

describe("durable AI/Voice telemetry principal binding", () => {
  it("injects the canonical Doctor resolved from the actor without changing the event key", async () => {
    const input = event(ACTOR, null);
    const resolver = vi.fn(async () => DOCTOR);

    const canonical = await canonicalizeAiTelemetryPrincipal(input, resolver);

    expect(resolver).toHaveBeenCalledWith(ACTOR);
    expect(canonical.actor_user_id).toBe(ACTOR);
    expect(canonical.doctor_profile_id).toBe(DOCTOR);
    expect(canonical.event_key).toBe(input.event_key);
  });

  it("accepts an already-canonical matching Doctor", async () => {
    const canonical = await canonicalizeAiTelemetryPrincipal(
      event(ACTOR, DOCTOR),
      vi.fn(async () => DOCTOR),
    );
    expect(canonical.doctor_profile_id).toBe(DOCTOR);
  });

  it("rejects a conflicting Doctor id even when the rest of the event is valid", async () => {
    await expect(
      canonicalizeAiTelemetryPrincipal(event(ACTOR, OTHER_DOCTOR), vi.fn(async () => DOCTOR)),
    ).rejects.toThrow("O1E_ACTOR_DOCTOR_MISMATCH");
  });

  it("rejects an actor that has no canonical Doctor profile", async () => {
    await expect(
      canonicalizeAiTelemetryPrincipal(event(ACTOR, null), vi.fn(async () => null)),
    ).rejects.toThrow("O1E_ACTOR_DOCTOR_REQUIRED");
  });

  it("rejects Doctor authority without an actor", async () => {
    await expect(
      canonicalizeAiTelemetryPrincipal(event(null, DOCTOR), vi.fn(async () => DOCTOR)),
    ).rejects.toThrow("O1E_DOCTOR_WITHOUT_ACTOR_REJECTED");
  });
});
