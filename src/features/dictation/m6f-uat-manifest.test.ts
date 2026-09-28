import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { M6F_VOICE_SURFACE_INVENTORY } from "./m6f-voice-surface-inventory";

describe("M6F generated UAT manifest parity", () => {
  const manifest = readFileSync(resolve(process.cwd(), "M6F-VOICE-CONTRACT-UAT.md"), "utf8");

  it("contains every contract target and no pending marker", () => {
    for (const entry of M6F_VOICE_SURFACE_INVENTORY) expect(manifest, entry.canonicalId).toContain(`\`${entry.canonicalId}\``);
    expect(manifest).not.toContain("⚠ target pending");
    expect(manifest).not.toContain("⚠ alias pending");
  });
});
