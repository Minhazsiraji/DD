import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(path.resolve(file), "utf8");
function gitBlobSha(file: string): string {
  const content = readFileSync(path.resolve(file));
  return createHash("sha1")
    .update(Buffer.from(`blob ${content.length}\0`))
    .update(content)
    .digest("hex");
}

describe("DD-VISUAL-REF-01 glass canvas correction", () => {
  it("changes only the live global canvas while frozen material/print layers stay byte-identical", () => {
    expect(gitBlobSha("src/app/globals.css")).toBe("9e5d07175e729f142b4cff5574ded5af5a61bdbf");
    expect(gitBlobSha("src/app/app-unified-liquid.css")).toBe("a35db74b73aa843caf5086d72a4fdae006f244c8");
    expect(gitBlobSha("src/app/dd-material-system.css")).toBe("eea7e0691a67a5d8df231537a4247a5c5806b934");
  });

  it("uses the approved cool-neutral live canvas and neutral organ-art wash", () => {
    const canvas = read("src/app/global-background-test.css");
    expect(canvas).toContain("background-color: #eef3f8 !important;");
    expect(canvas).toContain("linear-gradient(rgb(238 243 248 / 0.38), rgb(238 243 248 / 0.38))");
    expect(canvas).toContain('var(--dd-organ-bg)');
    expect(canvas).not.toContain("background-color: #e8e3ee !important;");
    expect(canvas).not.toContain("rgb(246 243 250 / 0.28)");
  });

  it("preserves organ artwork, blur, positioning and clinical print reset", () => {
    const canvas = read("src/app/global-background-test.css");
    expect(canvas).toContain('--dd-organ-bg: url("/dd-global-bg.webp")');
    expect(canvas).toContain("filter: blur(8px);");
    expect(canvas).toContain("background-position: center center;");
    expect(canvas).toContain("background: #ffffff !important;");
    expect(canvas).toContain("content: none !important;");
  });

  it("keeps the canvas global across app surfaces and responsive widths", () => {
    const layout = read("src/app/layout.tsx");
    const canvas = read("src/app/global-background-test.css");
    const globalsAt = layout.indexOf('import "./globals.css"');
    const canvasAt = layout.indexOf('import "./global-background-test.css"');
    expect(globalsAt).toBeGreaterThanOrEqual(0);
    expect(canvasAt).toBeGreaterThan(globalsAt);
    expect(canvas).toContain("html,\nbody {");
    expect(canvas).toContain("@media (max-width: 767px)");
    expect(canvas).toContain("background-color: transparent !important;");
  });
});
