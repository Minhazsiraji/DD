import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  clampOverlay,
  hexToRgb,
  isAcceptedBackgroundImageType,
  normalizeHex,
  overlayCss,
  rgbToHex,
} from "./background-preference";

const read = (path: string) => readFileSync(path, "utf8");

describe("DD-VISUAL-PERSONALIZATION-01-R2 background lock", () => {
  it("uses the exact selected INV1 preview treatment for authenticated Default", () => {
    const globals = read("src/app/globals.css");
    const rootLayout = read("src/app/layout.tsx");
    const canvas = read("src/features/settings/components/background-canvas.tsx");
    const lockedCss = read(
      "src/features/settings/components/locked-default-background.module.css",
    );

    expect(existsSync("public/dd-global-bg.webp")).toBe(true);
    expect(canvas).toContain('const LOCKED_DEFAULT_COLOR = "#e8e3ee"');
    expect(canvas).toContain("applyLockedDefaultCanvas();");
    expect(canvas).toContain('data-dd-locked-default-background="true"');
    expect(lockedCss).toContain('url("/dd-global-bg.webp")');
    expect(lockedCss).toContain(
      "linear-gradient(rgb(246 243 250 / 0.28), rgb(246 243 250 / 0.28))",
    );
    expect(lockedCss).toContain("filter: blur(8px)");
    expect(lockedCss).toContain("transform: scale(1.02)");
    expect(lockedCss).toContain("background-position: center center");
    expect(lockedCss).toContain("@media (max-width: 767px)");
    expect(lockedCss).toContain("background-position: center top");
    expect(lockedCss).toContain("filter: blur(7px)");
    expect(lockedCss).toContain("transform: scale(1.035)");

    // The selected background is isolated from the canonical global stylesheet.
    expect(globals).toContain("--background: #dbe7fb;");
    expect(rootLayout).toContain('import "./globals.css";');
    expect(rootLayout).not.toContain("global-background-test.css");
    expect(existsSync("src/app/global-background-test.css")).toBe(false);
  });

  it("keeps the selected background and all personalization inside the authenticated shell", () => {
    const rootLayout = read("src/app/layout.tsx");
    const appLayout = read("src/app/(app)/layout.tsx");
    const canvas = read("src/features/settings/components/background-canvas.tsx");

    expect(rootLayout).not.toContain("BackgroundCanvas");
    expect(appLayout).toContain('import { BackgroundCanvas }');
    expect(appLayout).toContain("<BackgroundCanvas />");
    expect(canvas).toContain("clearOwnedCanvasStyles();");
  });

  it("keeps color parsing deterministic and bounded", () => {
    expect(normalizeHex("c8c8c8")).toBe("#C8C8C8");
    expect(normalizeHex("#12abef")).toBe("#12ABEF");
    expect(normalizeHex("#123")).toBeNull();
    expect(rgbToHex(200, 200, 200)).toBe("#C8C8C8");
    expect(hexToRgb("#C8C8C8")).toEqual({ red: 200, green: 200, blue: 200 });
    expect(clampOverlay(-90)).toBe(-60);
    expect(clampOverlay(90)).toBe(60);
    expect(overlayCss(0)).toBe("rgb(255 255 255 / 0)");
  });

  it("accepts only local V1 image formats and stores custom image bytes in IndexedDB", () => {
    const storage = read("src/features/settings/background-preference.ts");
    const appearance = read("src/features/settings/components/background-appearance.tsx");

    expect(isAcceptedBackgroundImageType("image/png")).toBe(true);
    expect(isAcceptedBackgroundImageType("image/jpeg")).toBe(true);
    expect(isAcceptedBackgroundImageType("image/webp")).toBe(true);
    expect(isAcceptedBackgroundImageType("image/svg+xml")).toBe(false);
    expect(storage).toContain('indexedDB.open(DB_NAME, DB_VERSION)');
    expect(storage).toContain('store.put(file, IMAGE_KEY)');
    expect(storage).not.toContain("FileReader");
    expect(storage).not.toContain("readAsDataURL");
    expect(appearance).toContain('type="file"');
    expect(appearance).not.toContain('type="url"');
  });

  it("keeps explicit custom modes and Restore Default behavior unchanged", () => {
    const canvas = read("src/features/settings/components/background-canvas.tsx");
    const appearance = read("src/features/settings/components/background-appearance.tsx");

    expect(canvas).toContain('if (preference.mode === "color")');
    expect(canvas).toContain('document.body.style.setProperty("background-color", preference.color)');
    expect(canvas).toContain('document.body.style.setProperty("background-image", "none")');
    expect(canvas).toContain('document.body.style.setProperty("background-size", "cover")');
    expect(canvas).toContain('document.body.style.setProperty("background-position", "center")');
    expect(appearance).toContain("clearBackgroundPreference();");
    expect(appearance).toContain("await deleteBackgroundImage();");
    expect(appearance).toContain('setMode("default")');
    expect(appearance).toContain("Restore Doctor’s Diary Default");
  });

  it("does not introduce backend, clinical, remote-image or print behavior", () => {
    const preference = read("src/features/settings/background-preference.ts");
    const appearance = read("src/features/settings/components/background-appearance.tsx");
    const canvas = read("src/features/settings/components/background-canvas.tsx");
    const lockedCss = read(
      "src/features/settings/components/locked-default-background.module.css",
    );
    const combined = `${preference}\n${appearance}\n${canvas}\n${lockedCss}`;

    expect(combined).not.toMatch(/supabase|prescription item|investigation|encounter mutation/i);
    expect(combined).not.toMatch(/fetch\(|axios|XMLHttpRequest/);
    expect(combined).not.toContain("http://");
    expect(combined).not.toContain("https://");
    expect(lockedCss).toContain("@media print");
    expect(lockedCss).toContain("display: none !important");
  });
});
