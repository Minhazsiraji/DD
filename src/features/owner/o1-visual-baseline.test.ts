import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import matrix from "../../../qa/o1-owner-visual-matrix.json";

const read = (path: string) => readFileSync(path, "utf8");

function gitBlobSha(path: string): string {
  const bytes = readFileSync(path);
  const header = Buffer.from(`blob ${bytes.length}\0`);
  return createHash("sha1").update(header).update(bytes).digest("hex");
}

const lockedVisualBlobs: Record<string, string> = {
  "src/app/globals.css": "9e5d07175e729f142b4cff5574ded5af5a61bdbf",
  "src/app/branding-logo.css": "06c8270df5ea493673a0218d3cdfbe4edef2066e",
  "src/app/canonical-brand.css": "bb5b7b496826e8f593266facab9c2319c410c799",
  "src/app/global-background-test.css": "062f35853c07cf72e7f6d6438878a2e9f4ff6b79",
  "src/app/app-unified-liquid.css": "a35db74b73aa843caf5086d72a4fdae006f244c8",
  "src/app/dd-material-system.css": "eea7e0691a67a5d8df231537a4247a5c5806b934",
  "public/dd-global-bg.webp": "e50c9e62d3340206d18724784a94a9a295c3851c",
};

const futureOwnerRoutes = [
  "/owner/dashboard",
  "/owner/dashboard/doctors",
  "/owner/dashboard/adoption",
  "/owner/dashboard/ai-usage",
  "/owner/dashboard/costs",
  "/owner/dashboard/pilot-health",
  "/owner/dashboard/security",
];

describe("O1-MD2 visual baseline guard", () => {
  it("pins the accepted DD theme files and organ artwork", () => {
    for (const [path, expected] of Object.entries(lockedVisualBlobs)) {
      expect(existsSync(path), path).toBe(true);
      expect(gitBlobSha(path), path).toBe(expected);
    }
  });

  it("keeps the root visual stylesheet order authoritative", () => {
    const layout = read("src/app/layout.tsx");
    const imports = [
      'import "./globals.css";',
      'import "./branding-logo.css";',
      'import "./canonical-brand.css";',
      'import "./global-background-test.css";',
      'import "./app-unified-liquid.css";',
      'import "./dd-material-system.css";',
    ];
    let previous = -1;
    for (const item of imports) {
      const current = layout.indexOf(item);
      expect(current, item).toBeGreaterThan(previous);
      previous = current;
    }
    expect(layout).toContain("Geist({");
    expect(layout).toContain("Geist_Mono({");
    expect(layout).toContain("Manrope({");
  });

  it("guards shell material and responsive spacing without changing shell behavior", () => {
    const appLayout = read("src/app/(app)/layout.tsx");
    const sidebar = read("src/components/layout/desktop-sidebar.tsx");
    const topbar = read("src/components/layout/top-bar.tsx");

    expect(appLayout).toContain("<BackgroundCanvas />");
    expect(appLayout).toContain("max-w-[1400px]");
    expect(appLayout).toContain("px-4 py-5");
    expect(appLayout).toContain("sm:px-6 sm:py-6");
    expect(appLayout).toContain("lg:pb-8");

    expect(sidebar).toContain("dd-sidebar dd-material-chrome glass");
    expect(sidebar).toContain("lg:w-[76px] xl:w-[248px]");
    expect(topbar).toContain("dd-topbar dd-material-chrome glass");
    expect(topbar).toContain("h-16");
  });

  it("keeps the owner authority shell separate from the clinical workspace shell", () => {
    const ownerLayout = read("src/app/owner/layout.tsx");
    const ownerPage = read("src/app/owner/page.tsx");
    expect(ownerLayout).toContain("requirePlatformOwner");
    expect(ownerLayout).not.toMatch(/DesktopSidebar|TopBar|LocationSwitcher|GlobalPatientFinder/);
    expect(ownerPage).toContain("outside the `(app)` group on purpose");
    expect(ownerPage).toContain("no clinical data");
  });

  it("guards the accepted card, badge, empty and skeleton primitives", () => {
    const section = read("src/components/common/section-card.tsx");
    const stat = read("src/components/common/stat-card.tsx");
    const glass = read("src/components/glass/glass-card.tsx");
    const badge = read("src/components/common/status-badge.tsx");
    const empty = read("src/components/common/empty-state.tsx");
    const skeletons = read("src/components/common/skeletons.tsx");

    expect(section).toContain("dd-app-panel dd-material-panel");
    expect(section).toContain("dd-section-header");
    expect(stat).toContain("value: number | string");
    expect(stat).toContain("text-[28px] leading-none font-bold text-ink tabular-nums sm:text-[32px]");
    expect(glass).toContain('type Tone = "default" | "strong"');
    expect(glass).toContain('interactive?: boolean');
    expect(glass).toContain('blur?: boolean');
    expect(glass).toContain("glass-flat-strong");
    for (const tone of ["neutral", "info", "success", "warning", "danger"]) {
      expect(badge).toContain(tone);
    }
    expect(empty).toContain("py-10 text-center");
    expect(skeletons).toContain('aria-hidden="true"');
    expect(skeletons).toContain('aria-busy="true"');
    expect(skeletons).toContain("grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4");
  });

  it("locks the future Owner route QA matrix without implementing the routes", () => {
    expect(matrix.authorityBase).toBe("7dd53576022fa50706eb5e57a2f34fd59425ad96");
    expect(matrix.routes).toEqual(futureOwnerRoutes);
    expect(matrix.viewports).toEqual([
      { name: "desktop", width: 1440, height: 900 },
      { name: "tablet", width: 1024, height: 768 },
      { name: "mobile", width: 390, height: 844 },
    ]);
    expect(matrix.baselineRouteStatus).toBe("future-not-implemented-at-authority-base");
  });

  it("makes zero, not measured, unavailable and insufficient cohort semantically distinct", () => {
    const states = Object.values(matrix.visualStates);
    expect(states).toHaveLength(4);
    expect(new Set(states.map((state) => state.label)).size).toBe(4);
    expect(new Set(states.map((state) => state.kind)).size).toBe(4);

    expect(matrix.visualStates.zero.label).toBe("0");
    expect(matrix.visualStates.zero.kind).toBe("measured-number");
    expect(matrix.visualStates.notMeasured.label).toBe("Not measured");
    expect(matrix.visualStates.unavailable.label).toBe("Unavailable");
    expect(matrix.visualStates.insufficientCohort.label).toBe("Insufficient cohort");

    for (const state of [
      matrix.visualStates.notMeasured,
      matrix.visualStates.unavailable,
      matrix.visualStates.insufficientCohort,
    ]) {
      expect(state.requiredText).not.toBe("0");
      expect(state.presentation).toMatch(/text|nonnumeric/i);
    }
  });

  it("preserves Appearance default/restore and local-only overrides", () => {
    const appearanceTest = read("src/features/settings/background-appearance.test.ts");
    const canvas = read("src/features/settings/components/background-canvas.tsx");
    const preference = read("src/features/settings/background-preference.ts");

    expect(appearanceTest).toContain("Restore Doctor’s Diary Default");
    expect(canvas).toContain('if (preference.mode === "default")');
    expect(canvas).toContain("applyExactReferenceDefault();");
    expect(canvas).toContain('markMode("color")');
    expect(canvas).toContain('markMode("image")');
    expect(preference).toContain("indexedDB.open(DB_NAME, DB_VERSION)");
    expect(`${canvas}\n${preference}`).not.toMatch(/fetch\(|axios|XMLHttpRequest/);
  });

  it("preserves white clinical print isolation and the frozen print sheet", () => {
    const background = read("src/app/global-background-test.css");
    expect(background).toContain("@media print");
    expect(background).toContain("background: #ffffff !important");
    expect(background).toContain("body::before");
    expect(background).toContain("content: none !important");
    expect(background).toContain("filter: none !important");
    expect(gitBlobSha("src/features/prescriptions/components/print-sheet.tsx")).toBe(
      "0b8afc336ff27faa0a33eaf22f6a8eac1b236c36",
    );
  });
});
