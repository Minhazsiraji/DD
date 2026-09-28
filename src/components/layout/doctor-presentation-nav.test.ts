import { describe, expect, it } from "vitest";
import { PRIMARY_NAV, VOICE_GUIDE_NAV } from "./nav-config";
import { readFileSync } from "node:fs";
import path from "node:path";

describe("Doctor presentation navigation", () => {
  it("places Analytics directly below Dashboard", () => {
    expect(PRIMARY_NAV.slice(0, 2).map((item) => [item.label, item.href])).toEqual([
      ["Dashboard", "/dashboard"],
      ["Analytics", "/analytics"],
    ]);
  });

  it("places Voice Guide above AI Assistant and Settings in the desktop footer", () => {
    expect(VOICE_GUIDE_NAV).toMatchObject({ label: "Voice Guide", href: "/voice-guide" });
    const sidebar = readFileSync(path.resolve("src/components/layout/desktop-sidebar.tsx"), "utf8");
    expect(sidebar.indexOf("VOICE_GUIDE_NAV")).toBeLessThan(sidebar.indexOf('href="/assistant"'));
    expect(sidebar.indexOf('href="/assistant"')).toBeLessThan(sidebar.indexOf("SECONDARY_NAV.map"));
  });

  it("exposes both routes through the existing mobile More architecture", () => {
    const more = readFileSync(path.resolve("src/app/(app)/more/page.tsx"), "utf8");
    expect(more).toContain("PRIMARY_NAV.filter");
    expect(more).toContain("VOICE_GUIDE_NAV");
  });

  it("keeps both routes inside the authenticated AAL2 app layout", () => {
    const layout = readFileSync(path.resolve("src/app/(app)/layout.tsx"), "utf8");
    expect(layout).toContain('currentAal !== "aal2"');
    expect(layout).toContain('redirect(nextAal === "aal2" ? "/mfa" : "/mfa/enroll")');
    expect(readFileSync(path.resolve("src/app/(app)/analytics/page.tsx"), "utf8")).toContain("getDoctorAnalytics");
    expect(readFileSync(path.resolve("src/app/(app)/voice-guide/page.tsx"), "utf8")).toContain("M6F_VOICE_GUIDE");
  });

  it("uses min-width containment and responsive grids on both presentation pages", () => {
    const analytics = readFileSync(path.resolve("src/features/analytics/components/analytics-dashboard.tsx"), "utf8");
    const guide = readFileSync(path.resolve("src/features/dictation/components/doctor-voice-guide.tsx"), "utf8");
    expect(analytics).toContain("min-w-0");
    expect(analytics).toContain("min-[480px]:grid-cols-2");
    expect(analytics).toContain("lg:grid-cols-2");
    expect(guide).toContain("min-w-0");
    expect(guide).toContain("md:grid-cols-2");
    expect(guide).toContain("xl:grid-cols-3");
  });
});
