import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const panel = fs.readFileSync(path.resolve("src/features/encounters/components/m6a-voice-panel.tsx"), "utf8");
const audit = fs.readFileSync(path.resolve("src/features/dictation/m6g-ambient-audit.ts"), "utf8");

describe("M6H review/apply UI contract", () => {
  it("shows the three review levels and one-click documentation action", () => {
    expect(panel).toContain("Ambient Clinical Draft - M6H");
    expect(panel).toContain("Ready to apply");
    expect(panel).toContain("Needs confirmation");
    expect(panel).toContain("Needs review");
    expect(panel).toContain("Apply approved draft");
    expect(panel).toContain("Discard draft");
  });

  it("does not apply protected proposals in the one-click path", () => {
    expect(panel).toContain('item.risk === "low-risk"');
    expect(panel).toContain("NOTE_TARGETS.has(item.target as M6DTarget)");
    expect(panel).toContain("Open protected review");
  });

  it("keeps audit payload privacy-safe and adds only decision events", () => {
    expect(audit).toContain('"draft_applied"');
    expect(audit).toContain('"draft_discarded"');
    expect(audit).toContain("meta: target ? { target } : {}");
    expect(audit).not.toMatch(/rawAudio|audioBlob|clinicalText|transcript:/);
  });

  it("has responsive and sticky review controls", () => {
    expect(panel).toContain("sticky bottom-0");
    expect(panel).toContain("flex flex-wrap");
    expect(panel).toContain("min-h-11");
  });
});
