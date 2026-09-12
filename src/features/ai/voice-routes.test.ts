import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Voice route behaviour, and the INTENTIONAL NON-EVENTS.
 *
 * Rejected traffic must never become a telemetry write: otherwise an
 * authenticated-but-hostile caller, or a hostile page driving a signed-in
 * Doctor's browser, could turn refusals into an unbounded stream of stored
 * rows. Each refusal below asserts the response AND that nothing was recorded.
 */

const requirePermission = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth/session", () => ({ requirePermission }));

import { configureAiTelemetrySink, InMemoryAiTelemetrySink } from "./telemetry-sink";
import { POST as voiceUsagePost } from "@/app/api/ai/voice-usage/route";
import { POST as voiceTokenPost } from "@/app/api/voice/token/route";

const ORIGIN = "http://localhost:3200";
let sink: InMemoryAiTelemetrySink;
let user = 0;

function signedInAs(id: string) {
  requirePermission.mockResolvedValue({ user: { id } });
}
/** A fresh user id per test: the routes' rate limiters are module-level. */
function nextUser(): string {
  user += 1;
  return `11111111-1111-4111-8111-${String(user).padStart(12, "0")}`;
}

function request(path: string, init: { origin?: string | null; body?: string; length?: string } = {}) {
  const headers = new Headers({ "content-type": "application/json" });
  if (init.origin !== null) headers.set("origin", init.origin ?? ORIGIN);
  if (init.length) headers.set("content-length", init.length);
  return new NextRequest(`${ORIGIN}${path}`, { method: "POST", headers, body: init.body });
}

const beacon = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    voice_session_id: "ddvs_66666666-6666-4666-8666-666666666666",
    grant_id: "ddgr_77777777-7777-4777-8777-777777777777",
    streamed_audio_ms: 4200,
    ...over,
  });

beforeEach(() => {
  sink = new InMemoryAiTelemetrySink();
  configureAiTelemetrySink(sink);
  signedInAs(nextUser());
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("/api/ai/voice-usage — accepts one honest report, records nothing otherwise", () => {
  it("records exactly one CLIENT_ESTIMATE session for a valid report", async () => {
    const response = await voiceUsagePost(request("/api/ai/voice-usage", { body: beacon() }));
    expect(response.status).toBe(204);
    const events = sink.ofType("VOICE_SESSION_REPORTED");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      streamed_audio_ms: 4200,
      measurement_quality: "CLIENT_ESTIMATE",
      // No pricing is configured, so cost is unknown — never zero.
      cost_state: "UNPRICED",
      estimated_cost_usd_micros: null,
    });
  });

  it("writes nothing for an unauthenticated request", async () => {
    requirePermission.mockRejectedValue(new Error("unauthorized"));
    const response = await voiceUsagePost(request("/api/ai/voice-usage", { body: beacon() }));
    expect(response.status).toBe(401);
    expect(sink.events()).toHaveLength(0);
  });

  it("writes nothing for a cross-origin request", async () => {
    const response = await voiceUsagePost(
      request("/api/ai/voice-usage", { origin: "https://evil.example", body: beacon() }),
    );
    expect(response.status).toBe(403);
    expect(sink.events()).toHaveLength(0);
  });

  it("writes nothing for an oversized body", async () => {
    const response = await voiceUsagePost(
      request("/api/ai/voice-usage", { body: beacon({ grant_id: "x".repeat(4000) }) }),
    );
    expect(response.status).toBe(413);
    expect(sink.events()).toHaveLength(0);
  });

  it("writes nothing for a malformed body", async () => {
    const response = await voiceUsagePost(request("/api/ai/voice-usage", { body: "{not json" }));
    expect(response.status).toBe(400);
    expect(sink.events()).toHaveLength(0);
  });

  it.each(["transcript", "patient_id", "text"])(
    "writes nothing for a body carrying %s",
    async (key) => {
      const response = await voiceUsagePost(
        request("/api/ai/voice-usage", { body: beacon({ [key]: "Napa 500 for Rahim" }) }),
      );
      expect(response.status).toBe(400);
      expect(sink.events()).toHaveLength(0);
      expect(JSON.stringify(sink.events())).not.toContain("Rahim");
    },
  );

  it("stops recording once the caller is rate limited", async () => {
    for (let i = 0; i < 40; i++) {
      await voiceUsagePost(
        request("/api/ai/voice-usage", {
          body: beacon({ voice_session_id: `ddvs_66666666-6666-4666-8666-${String(i).padStart(12, "0")}` }),
        }),
      );
    }
    // 30 per window, and the refusals beyond it add nothing.
    expect(sink.ofType("VOICE_SESSION_REPORTED")).toHaveLength(30);
  });
});

describe("/api/voice/token — grant telemetry and its intentional non-events", () => {
  it("records one issued grant and returns the correlation id with the token", async () => {
    vi.stubEnv("DEEPGRAM_API_KEY", "server-side-only-key");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ access_token: "dg-token", expires_in: 30 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    const response = await voiceTokenPost(request("/api/voice/token"));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { grantId?: string; accessToken?: string };
    expect(body.grantId).toMatch(/^ddgr_/);
    const issued = sink.ofType("VOICE_GRANT_ISSUED");
    expect(issued).toHaveLength(1);
    expect(issued[0]!.grant_id).toBe(body.grantId);
    // The grant event carries the actor and nothing clinical.
    expect(issued[0]!.denial_reason).toBeNull();
    expect(JSON.stringify(issued[0])).not.toContain("dg-token");
  });

  it("writes nothing for an unauthenticated request", async () => {
    requirePermission.mockRejectedValue(new Error("unauthorized"));
    const response = await voiceTokenPost(request("/api/voice/token"));
    expect(response.status).toBe(401);
    expect(sink.events()).toHaveLength(0);
  });

  it("writes nothing for a cross-origin request", async () => {
    const response = await voiceTokenPost(request("/api/voice/token", { origin: "https://evil.example" }));
    expect(response.status).toBe(403);
    expect(sink.events()).toHaveLength(0);
  });

  it("records a missing provider credential as a denial", async () => {
    vi.stubEnv("DEEPGRAM_API_KEY", "");
    const response = await voiceTokenPost(request("/api/voice/token"));
    expect(response.status).toBe(503);
    expect(sink.ofType("VOICE_GRANT_DENIED")).toMatchObject([{ denial_reason: "CONFIG_MISSING" }]);
  });

  it("records the first rate-limit denial in a window and no repeats", async () => {
    vi.stubEnv("DEEPGRAM_API_KEY", "");
    for (let i = 0; i < 20; i++) await voiceTokenPost(request("/api/voice/token"));
    const denials = sink.ofType("VOICE_GRANT_DENIED");
    // 12 grants attempted (each refused for config), then ONE rate-limit denial
    // for the rest of the window — refused traffic cannot amplify writes.
    expect(denials.filter((e) => e.denial_reason === "RATE_LIMITED")).toHaveLength(1);
    expect(denials).toHaveLength(13);
  });
});
