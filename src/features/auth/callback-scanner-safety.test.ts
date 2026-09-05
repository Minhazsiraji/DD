import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { createServerClient } = vi.hoisted(() => ({ createServerClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: createServerClient,
}));

import { GET } from "@/app/auth/callback/route";

describe("legacy auth callback scanner safety", () => {
  beforeEach(() => createServerClient.mockReset());

  it("forwards token_hash without spending it or establishing a session", async () => {
    const request = new NextRequest(
      "https://preview.example/auth/callback?token_hash=secret-value&type=recovery&next=/reset-password",
    );

    const response = await GET(request);

    expect(response.status).toBeGreaterThanOrEqual(300);
    expect(response.status).toBeLessThan(400);
    expect(response.headers.get("location")).toBe(
      "https://preview.example/auth/confirm?token_hash=secret-value&type=recovery&next=/reset-password",
    );
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(createServerClient).not.toHaveBeenCalled();
  });

  it("forwards a callback whose credential exists only in the browser fragment", async () => {
    const request = new NextRequest(
      "https://preview.example/auth/callback?next=/reset-password",
    );

    const response = await GET(request);
    expect(response.headers.get("location")).toBe(
      "https://preview.example/auth/confirm?next=/reset-password",
    );
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(createServerClient).not.toHaveBeenCalled();
  });
});
