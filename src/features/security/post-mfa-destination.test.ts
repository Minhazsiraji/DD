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

  it("completes FIRST-TIME enrollment to /owner for Owner and /dashboard for clinical user", async () => {
    isPlatformOwnerMock.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    await expect(resolvePostMfaDestination()).resolves.toBe("/owner");
    await expect(resolvePostMfaDestination()).resolves.toBe("/dashboard");

    const enrollPage = read("src/app/(auth)/mfa/enroll/page.tsx");
    expect(enrollPage).toContain(
      'if (current === "aal2") redirect(await resolvePostMfaDestination());',
    );
    expect(enrollPage).not.toContain(
      'if (current === "aal2") redirect("/dashboard");',
    );
    expect(enrollPage).toContain(
      'import { resolvePostMfaDestination } from "@/features/security/post-mfa-destination";',
    );
  });

  it("completes EXISTING-FACTOR challenge to /owner for Owner and /dashboard for clinical user", async () => {
    isPlatformOwnerMock.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    await expect(resolvePostMfaDestination()).resolves.toBe("/owner");
    await expect(resolvePostMfaDestination()).resolves.toBe("/dashboard");

    const actions = read("src/features/security/actions.ts");
    expect(actions).toContain(
      'resolvePostMfaDestination(formData.get("returnTo"))',
    );
    expect(actions).toContain("redirect(destination)");
    expect(actions).not.toContain(
      'redirect("/dashboard");\n}\n\n/**\n * Sign-out scopes',
    );
  });

  it("routes an ALREADY-AAL2 /mfa visit to /owner for Owner and /dashboard for clinical user", async () => {
    isPlatformOwnerMock.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    await expect(resolvePostMfaDestination()).resolves.toBe("/owner");
    await expect(resolvePostMfaDestination()).resolves.toBe("/dashboard");

    const mfaPage = read("src/app/(auth)/mfa/page.tsx");
    expect(mfaPage).toContain("redirect(await resolvePostMfaDestination())");
    expect(mfaPage).not.toContain('redirect("/dashboard")');
  });

  it("rejects external, protocol-relative, unapproved and cross-authority return paths", async () => {
    for (const unsafe of [
      "https://evil.example/steal",
      "//evil.example/steal",
      "javascript:alert(1)",
      "/owner?next=https://evil.example",
      "/settings/security",
    ]) {
      expect(isAllowedPostMfaDestination(unsafe)).toBe(false);
    }

    expect(isAllowedPostMfaDestination("/owner")).toBe(true);
    expect(isAllowedPostMfaDestination("/dashboard")).toBe(true);

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
});
