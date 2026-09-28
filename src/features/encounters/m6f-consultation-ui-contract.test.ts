import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("M6F consultation target / DOM synchronization", () => {
  it("uses the source-backed target inventory for the visible voice target selector", () => {
    const panel = source("src/features/encounters/components/m6a-voice-panel.tsx");
    expect(panel).toContain("M6F_TARGET_OPTIONS.map");
    expect(panel).toContain('value={activeTarget}');
    expect(panel).toContain("focusM6FTarget");
    expect(panel).toContain("function syncVoiceTarget");
    expect(panel).toContain("activeTargetRef.current = target");
    expect(panel).toContain("m6fConsultationTargetForDestination(destination)");
  });

  it("opens More vitals before focusing hidden fields and exposes the confirm boundary", () => {
    const panel = source("src/features/encounters/components/m6a-voice-panel.tsx");
    const vitals = source("src/features/encounters/components/m2-vital-fields.tsx");
    const investigation = source("src/features/encounters/components/investigation-panel.tsx");
    expect(panel).toContain("details.open = true");
    expect(vitals).toContain("data-m6f-more-vitals");
    expect(investigation).toContain("data-m6f-confirm-investigations");
    expect(panel).toContain("Nothing was confirmed by voice");
  });

  it("opens only an editable prescription draft from consultation voice", () => {
    const workspace = source("src/features/encounters/components/consultation-workspace.tsx");
    const panel = source("src/features/encounters/components/m6a-voice-panel.tsx");
    expect(workspace).toContain("onOpenPrescription={() => { void openRx(false); }}");
    expect(panel).toContain("Nothing was added or finalized");
  });
});
