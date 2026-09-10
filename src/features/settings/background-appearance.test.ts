import { createHash } from "node:crypto";
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

function gitBlobSha(path: string): string {
  const bytes = readFileSync(path);
  const header = Buffer.from(`blob ${bytes.length}\0`);
  return createHash("sha1").update(header).update(bytes).digest("hex");
}

describe("DD-VISUAL-PERSONALIZATION exact reference background", () => {
  it("uses the byte-identical selected INV1 organ artwork", () => {
    expect(existsSync("public/dd-global-bg.webp")).toBe(true);
    expect(gitBlobSha("public/dd-global-bg.webp")).toBe(
      "e50c9e62d3340206d18724784a94a9a295c3851c",
    );
  });

  it("copies the authoritative runtime screen declarations exactly", () => {
    const canvas = read("src/features/settings/components/background-canvas.tsx");

    expect(canvas).toContain('--dd-organ-bg: url("/dd-global-bg.webp")');
    expect(canvas).toContain("min-height: 100%");
    expect(canvas).toContain("background-color: #e8e3ee !important");
    expect(canvas).toContain("position: relative");
    expect(canvas).toContain("isolation: isolate");
    expect(canvas).toContain("background-image: none !important");
    expect(canvas).toContain('content: ""');
    expect(canvas).toContain("position: fixed");
    expect(canvas).toContain("inset: -18px");
    expect(canvas).toContain("z-index: 0");
    expect(canvas).toContain("pointer-events: none");
    expect(canvas).toContain(
      "linear-gradient(rgb(246 243 250 / 0.28), rgb(246 243 250 / 0.28))",
    );
    expect(canvas).toContain("var(--dd-organ-bg)");
    expect(canvas).toContain("background-size: cover");
    expect(canvas).toContain("background-position: center center");
    expect(canvas).toContain("background-repeat: no-repeat");
    expect(canvas).toContain("filter: blur(8px)");
    expect(canvas).toContain("transform: scale(1.02)");
    expect(canvas).toContain("transform-origin: center");
    expect(canvas).toContain("z-index: 1");
    expect(canvas).toContain("background-color: transparent !important");
    expect(canvas).toContain("display: none !important");
    expect(canvas).toContain("@media screen and (max-width: 767px)");
    expect(canvas).toContain("background-position: center top");
    expect(canvas).toContain("filter: blur(7px)");
    expect(canvas).toContain("transform: scale(1.035)");
  });

  it("keeps Default and Restore Default on the exact reference surface", () => {
    const canvas = read("src/features/settings/components/background-canvas.tsx");
    const appearance = read("src/features/settings/components/background-appearance.tsx");

    expect(canvas).toContain('if (preference.mode === "default")');
    expect(canvas).toContain("applyExactReferenceDefault();");
    expect(canvas).toContain('markMode("default")');
    expect(appearance).toContain("clearBackgroundPreference();");
    expect(appearance).toContain("await deleteBackgroundImage();");
    expect(appearance).toContain('setMode("default")');
    expect(appearance).toContain("Restore Doctor’s Diary Default");
  });

  it("keeps Custom Color and Custom Image as explicit overrides", () => {
    const canvas = read("src/features/settings/components/background-canvas.tsx");
    const appearance = read("src/features/settings/components/background-appearance.tsx");

    expect(canvas).toContain('if (preference.mode === "color")');
    expect(canvas).toContain('markMode("color")');
    expect(canvas).toContain('document.body.style.setProperty("background-color", preference.color)');
    expect(canvas).toContain('document.body.style.setProperty("background-image", "none")');
    expect(canvas).toContain('markMode("image")');
    expect(canvas).toContain('document.body.style.setProperty("background-size", "cover")');
    expect(canvas).toContain('document.body.style.setProperty("background-position", "center")');
    expect(appearance).toContain('type="file"');
    expect(appearance).not.toContain('type="url"');
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

  it("accepts only local V1 image formats and keeps bytes in IndexedDB", () => {
    const storage = read("src/features/settings/background-preference.ts");
    const appearance = read("src/features/settings/components/background-appearance.tsx");

    expect(isAcceptedBackgroundImageType("image/png")).toBe(true);
    expect(isAcceptedBackgroundImageType("image/jpeg")).toBe(true);
    expect(isAcceptedBackgroundImageType("image/webp")).toBe(true);
    expect(isAcceptedBackgroundImageType("image/svg+xml")).toBe(false);
    expect(storage).toContain("indexedDB.open(DB_NAME, DB_VERSION)");
    expect(storage).toContain("store.put(file, IMAGE_KEY)");
    expect(storage).not.toContain("FileReader");
    expect(storage).not.toContain("readAsDataURL");
  });

  it("does not alter frozen global, application, backend, security or print files", () => {
    const globals = read("src/app/globals.css");
    const rootLayout = read("src/app/layout.tsx");
    const appLayout = read("src/app/(app)/layout.tsx");
    const appearance = read("src/features/settings/components/background-appearance.tsx");
    const preference = read("src/features/settings/background-preference.ts");
    const canvas = read("src/features/settings/components/background-canvas.tsx");
    const lockedCss = read(
      "src/features/settings/components/locked-default-background.module.css",
    );
    const combined = `${preference}\n${appearance}\n${canvas}\n${lockedCss}`;

    expect(globals).toContain("--background: #dbe7fb;");
    expect(rootLayout).toContain('import "./globals.css";');
    expect(rootLayout).not.toContain("global-background-test.css");
    expect(appLayout).toContain("<BackgroundCanvas />");
    expect(combined).not.toMatch(/supabase|prescription item|investigation|encounter mutation/i);
    expect(combined).not.toMatch(/fetch\(|axios|XMLHttpRequest/);
    expect(canvas).not.toContain("@media print");
    expect(lockedCss).not.toContain("@media print");
  });
});
