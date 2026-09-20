import { describe, expect, it } from "vitest";
import { isAuthEntryPath, isPublicRequestPath } from "./public-routes";

describe("AEO/GEO public route boundary", () => {
  it.each([
    "/about",
    "/for-doctors",
    "/learn",
    "/learn/doctors",
    "/learn/patients",
    "/learn/medical-students/prescription-structure",
    "/editorial-policy",
    "/medical-content-policy",
    "/corrections-policy",
    "/authors",
    "/authors/agentsiraji",
    "/reviewers",
    "/dr/example",
  ])("keeps %s signed-out public", (pathname) => {
    expect(isPublicRequestPath(pathname)).toBe(true);
  });

  it.each([
    "/dashboard",
    "/patients",
    "/appointments",
    "/assistant",
    "/consultation/active",
    "/documents",
    "/medicines",
    "/owner",
    "/payments",
    "/prescription",
    "/queue",
    "/reports",
    "/settings",
    "/onboarding",
  ])("keeps %s protected", (pathname) => {
    expect(isPublicRequestPath(pathname)).toBe(false);
  });

  it("still treats sign-in surfaces as public entry routes", () => {
    expect(isPublicRequestPath("/login")).toBe(true);
    expect(isPublicRequestPath("/signup")).toBe(true);
    expect(isAuthEntryPath("/login")).toBe(true);
    expect(isAuthEntryPath("/learn")).toBe(false);
  });
});
