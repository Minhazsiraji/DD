import { readFileSync } from "node:fs";
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

describe("DD visual personalization V1", () => {
  it("keeps color parsing deterministic and bounded", () => {
    expect(DEFAULT_BACKGROUND_COLOR).toBe("#CACACA");
    expect(normalizeHex("c8c8c8")).toBe("#C8C8C8");
    expect(normalizeHex("#12abef")).toBe("#12ABEF");
    expect(normalizeHex("#123")).toBeNull();
    expect(rgbToHex(200, 200, 200)).toBe("#C8C8C8");
    expect(hexToRgb("#C8C8C8")).toEqual({ red: 200, green: 200, blue: 200 });
    expect(clampOverlay(-90)).toBe(-60);
    expect(clampOverlay(90)).toBe(60);
    expect(overlayCss(0)).toBe("rgb(255 255 255 / 0)");
  });

  it("accepts only the V1 local image formats", () => {
    expect(isAcceptedBackgroundImageType("image/png")).toBe(true);
    expect(isAcceptedBackgroundImageType("image/jpeg")).toBe(true);
    expect(isAcceptedBackgroundImageType("image/webp")).toBe(true);
    expect(isAcceptedBackgroundImageType("image/svg+xml")).toBe(false);
    expect(isAcceptedBackgroundImageType("text/html")).toBe(false);
  });

  it("stores image bytes in IndexedDB rather than localStorage", () => {
    const source = read("src/features/settings/background-preference.ts");
    expect(source).toContain('indexedDB.open(DB_NAME, DB_VERSION)');
    expect(source).toContain('store.put(file, IMAGE_KEY)');
    expect(source).not.toMatch(/localStorage\.setItem\([^\n]*file/i);
    expect(source).not.toContain("FileReader");
    expect(source).not.toContain("readAsDataURL");
  });

  it("does not allow remote URL entry and keeps image rendering cover/center", () => {
    const appearance = read("src/features/settings/components/background-appearance.tsx");
    const canvas = read("src/features/settings/components/background-canvas.tsx");
    expect(appearance).toContain('type="file"');
    expect(appearance).toContain('accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"');
    expect(appearance).not.toContain('type="url"');
    expect(canvas).toContain('backgroundSize: "cover"');
    expect(canvas).toContain('backgroundPosition: "center"');
    expect(canvas).toContain('className="pointer-events-none fixed inset-0 print:hidden"');
  });

  it("preserves patientless-clinical-write separation", () => {
    const appearance = read("src/features/settings/components/background-appearance.tsx");
    const canvas = read("src/features/settings/components/background-canvas.tsx");
    const combined = `${appearance}\n${canvas}`;
    expect(combined).not.toMatch(/supabase|prescription|investigation|encounter|clinical write/i);
    expect(combined).not.toMatch(/fetch\(|axios|XMLHttpRequest/);
  });
});
