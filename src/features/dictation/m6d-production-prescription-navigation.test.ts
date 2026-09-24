import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const requirePermission = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth/session", () => ({ requirePermission }));

import { POST as voiceCommandPost } from "@/app/api/voice/command/route";

const ORIGIN = "https://dd.agentsiraji.com";

function request(transcript: string, origin = ORIGIN) {
  return new NextRequest(`${ORIGIN}/api/voice/command`, {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify({ transcript, language: "en-US" }),
  });
}

beforeEach(() => {
  vi.stubEnv("VERCEL_ENV", "production");
  requirePermission.mockReset();
  requirePermission.mockResolvedValue({ user: { id: "doctor-production-test" } });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
describe("Production deterministic prescription navigation", () => {
  it.each([
    "Prescription",
    "Open prescription",
    "Write prescription",
    "Go to prescription",
    "Start prescription",
  ])("allows %s without invoking Preview-only AI", async (transcript) => {
    const response = await voiceCommandPost(request(transcript));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      provider: "deterministic",
      intent: { type: "NAVIGATE", target: "prescription" },
    });
  });

  it("keeps non-deterministic AI command interpretation Preview-only", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const response = await voiceCommandPost(request("Add Napa 500 mg"));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ code: "preview-only" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("still requires an authenticated editable encounter", async () => {
    requirePermission.mockRejectedValueOnce(new Error("unauthorized"));
    const response = await voiceCommandPost(request("Write prescription"));
    expect(response.status).toBe(401);
  });

  it("still rejects cross-origin deterministic navigation", async () => {
    const response = await voiceCommandPost(request("Write prescription", "https://evil.example"));
    expect(response.status).toBe(403);
  });
});
