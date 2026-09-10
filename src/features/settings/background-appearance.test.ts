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
  it("uses the byte-identical authoritative INV1 background CSS and artwork", () => {
    expect(existsSync("src/app/global-background-test.css")).toBe(true);
    expect(existsSync("public/dd-global-bg.webp")).toBe(true);
    expect(gitBlobSha("src/app/global-background-test.css")).toBe(
      "062f35853c07cf72e7f6d6438878a2e9f4ff6b79",
    );
    expect(gitBlobSha("public/dd-global-bg.webp")).toBe(
      "e50c9e62d3340206d18724784a94a9a295c3851c",
    );
  });

  it("loads the authoritative reference background at the root runtime layer", () => {
    const rootLayout = read("src/app/layout.tsx");
    const referenceCss = read("src/app/global-background-test.css");

    expect(rootLayout).toContain('import "./globals.css";');
    expect(rootLayout).toContain('import "./global-background-test.css";');
    expect(referenceCss).toContain("background-color: #e8e3ee !important");
    expect(referenceCss).toContain('url("/dd-global-bg.webp")');
    expect(referenceCss).toContain("inset: -18px");
    expect(referenceCss).toContain("filter: blur(8px)");
    expect(referenceCss).toContain("transform: scale(1.02)");
    expect(referenceCss).toContain("background-position: center center");
    expect(referenceCss).toContain("background-position: center top");
    expect(referenceCss).toContain("filter: blur(7px)");
    expect(referenceCss).toContain("transform: scale(1.035)");
  });

  it("keeps Default and Restore Default free of personalization-owned canvas styling", () => {
    const canvas = read("src/features/settings/components/background-canvas.tsx");
    const appearance = read("src/features/settings/components/background-appearance.tsx");

    expect(canvas).toContain('if (preference.mode === "default")');
    expect(canvas).toContain("applyExactReferenceDefault();");
    expect(canvas).not.toContain('markMode("default")');
    expect(appearance).toContain("clearBackgroundPreference();");
    expect(appearance).toContain("await deleteBackgroundImage();");
    expect(appearance).toContain('setMode("default")');
    expect(appearance).toContain("Restore Doctor’s Diary Default");
  });

  it("keeps Custom Color and Custom Image as explicit authenticated overrides", () => {
    const canvas = read("src/features/settings/components/background-canvas.tsx");
    const lockedCss = read(
      "src/features/settings/components/locked-default-background.module.css",
    );

    expect(canvas).toContain('if (preference.mode === "color")');
    expect(canvas).toContain('markMode("color")');
    expect(canvas).toContain('markMode("image")');
    expect(canvas).toContain('"background-size", "cover"');
    expect(canvas).toContain('"background-position", "center"');
    expect(canvas).toContain('"background-image", "none", "important"');
    expect(lockedCss).toContain('body[data-dd-background-mode="color"]::before');
    expect(lockedCss).toContain('body[data-dd-background-mode="image"]::before');
    expect(lockedCss).toContain("display: none !important");
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

  it("accepts only local V1 image formats and keeps uploaded bytes in IndexedDB", () => {
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
    expect(appearance).toContain('type="file"');
    expect(appearance).not.toContain('type="url"');
  });

  it("keeps canonical globals, clinical logic, backend and print behavior outside personalization", () => {
    const globals = read("src/app/globals.css");
    const appLayout = read("src/app/(app)/layout.tsx");
    const preference = read("src/features/settings/background-preference.ts");
    const canvas = read("src/features/settings/components/background-canvas.tsx");
    const lockedCss = read(
      "src/features/settings/components/locked-default-background.module.css",
    );
    const combined = `${preference}\n${canvas}\n${lockedCss}`;

    expect(gitBlobSha("src/app/globals.css")).toBe(
      "9e5d07175e729f142b4cff5574ded5af5a61bdbf",
    );
    expect(globals).toContain("--background: #dbe7fb;");
    expect(appLayout).toContain("<BackgroundCanvas />");
    expect(combined).not.toMatch(/supabase|prescription item|investigation|encounter mutation/i);
    expect(combined).not.toMatch(/fetch\(|axios|XMLHttpRequest/);
    expect(canvas).not.toContain("@media print");
    expect(lockedCss).not.toContain("@media print");
  });
});
