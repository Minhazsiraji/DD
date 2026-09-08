import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { isPlatformOwnerMock } = vi.hoisted(() => ({
  isPlatformOwnerMock: vi.fn<() => Promise<boolean>>(),
}));

vi.mock("@/features/owner/authority", () => ({
  isPlatformOwner: isPlatformOwnerMock,
}));

import {
  isAllowedPostMfaDestination,
  resolvePostMfaDestination,
} from "./post-mfa-destination";

const read = (path: string) => readFileSync(path, "utf8");

describe("SEC-01C post-MFA destination routing", () => {
  beforeEach(() => {
    isPlatformOwnerMock.mockReset();
  });

  it("routes an Owner-only user to /owner after MFA", async () => {
    isPlatformOwnerMock.mockResolvedValue(true);

    await expect(resolvePostMfaDestination()).resolves.toBe("/owner");
    expect(isPlatformOwnerMock).toHaveBeenCalledTimes(1);
  });

  it("routes a normal clinical user to /dashboard after MFA", async () => {
    isPlatformOwnerMock.mockResolvedValue(false);

    await expect(resolvePostMfaDestination()).resolves.toBe("/dashboard");
    expect(isPlatformOwnerMock).toHaveBeenCalledTimes(1);
  });

  it("rejects external, protocol-relative and cross-authority return paths", async () => {
    for (const unsafe of [
      "https://evil.example/steal",
      "//evil.example/steal",
      "javascript:alert(1)",
      "/owner?next=https://evil.example",
      "/settings/security",
    ]) {
      expect(isAllowedPostMfaDestination(unsafe)).toBe(false);
    }

    isPlatformOwnerMock.mockResolvedValue(false);
    await expect(
      resolvePostMfaDestination("https://evil.example/steal"),
    ).resolves.toBe("/dashboard");
    await expect(resolvePostMfaDestination("/owner")).resolves.toBe(
      "/dashboard",
    );

    isPlatformOwnerMock.mockResolvedValue(true);
    await expect(resolvePostMfaDestination("//evil.example/steal")).resolves.toBe(
      "/owner",
    );
    await expect(resolvePostMfaDestination("/dashboard")).resolves.toBe(
      "/owner",
    );
  });

  it("uses the server resolver after challenge success and for an already-AAL2 /mfa visit", () => {
    const actions = read("src/features/security/actions.ts");
    const mfaPage = read("src/app/(auth)/mfa/page.tsx");

    expect(actions).toContain(
      'resolvePostMfaDestination(formData.get("returnTo"))',
    );
    expect(actions).toContain("redirect(destination)");
    expect(actions).not.toContain('redirect("/dashboard");\n}\n\n/**\n * Sign-out scopes');

    expect(mfaPage).toContain("redirect(await resolvePostMfaDestination())");
    expect(mfaPage).not.toContain('redirect("/dashboard")');
  });
});
