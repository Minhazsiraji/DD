import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_BACKGROUND_COLOR,
  clampOverlay,
  hexToRgb,
  isAcceptedBackgroundImageType,
  normalizeHex,
  overlayCss,
  rgbToHex,
} from "./background-preference";

const read = (path: string) => readFileSync(path, "utf8");

describe("DD-VISUAL-PERSONALIZATION-01-R1", () => {
  it("keeps the original main canvas authoritative for Default", () => {
    const globals = read("src/app/globals.css");
    const rootLayout = read("src/app/layout.tsx");
    const canvas = read("src/features/settings/components/background-canvas.tsx");

    expect(DEFAULT_BACKGROUND_COLOR).toBe("#DBE7FB");
    expect(globals).toContain("--background: #dbe7fb;");
    expect(globals).toContain("circle at 90% 10%");
    expect(globals).toContain("circle at 4% 72%");
    expect(globals).toContain("linear-gradient(160deg, #e4edfd 0%, #d5e3fb 46%, #c9dbf9 100%)");
    expect(rootLayout).toContain('import "./globals.css";');
    expect(rootLayout).not.toContain("global-background-test.css");
    expect(existsSync("src/app/global-background-test.css")).toBe(false);
    expect(canvas).toContain('if (preference.mode === "default")');
    expect(canvas).toContain("clearCustomBodyBackground();");
  });

  it("keeps personalization inside the authenticated application shell", () => {
    const rootLayout = read("src/app/layout.tsx");
    const appLayout = read("src/app/(app)/layout.tsx");

    expect(rootLayout).not.toContain("BackgroundCanvas");
    expect(appLayout).toContain('import { BackgroundCanvas }');
    expect(appLayout).toContain("<BackgroundCanvas />");
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

  it("accepts only local V1 image formats and stores bytes in IndexedDB", () => {
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

  it("applies custom modes explicitly and restores every custom preference", () => {
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
    expect(appearance).toContain("setOverlay(DEFAULT_BACKGROUND_PREFERENCE.overlay)");
    expect(appearance).toContain("Restore Doctor’s Diary Default");
  });

  it("does not introduce backend, clinical, remote-image or print behavior", () => {
    const preference = read("src/features/settings/background-preference.ts");
    const appearance = read("src/features/settings/components/background-appearance.tsx");
    const canvas = read("src/features/settings/components/background-canvas.tsx");
    const combined = `${preference}\n${appearance}\n${canvas}`;

    expect(combined).not.toMatch(/supabase|prescription item|investigation|encounter mutation/i);
    expect(combined).not.toMatch(/fetch\(|axios|XMLHttpRequest/);
    expect(combined).not.toContain("http://");
    expect(combined).not.toContain("https://");
  });
});
