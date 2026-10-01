import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const panel = fs.readFileSync(path.resolve(process.cwd(), "src/features/encounters/components/m6a-voice-panel.tsx"), "utf8");
const audit = fs.readFileSync(path.resolve(process.cwd(), "src/features/dictation/m6g-ambient-audit.ts"), "utf8");

describe("M6G ambient UI and safety boundary", () => {
  it("reuses the existing voice panel and exposes the compact review surface", () => {
    expect(panel).toContain("data-m6g-ambient-review");
    expect(panel).toContain("data-m6g-review-panel");
    expect(panel).toContain("Start Ambient");
    expect(panel).toContain("Stop & Review");
    expect(panel).toContain("sm:");
  });

  it("keeps high-risk items behind protected review rather than silent application", () => {
    expect(panel).toContain("Open protected review");
    expect(panel).toContain("handOffClinicalAction(item.text)");
    expect(panel).toContain("Add diagnosis remains explicit");
    expect(panel).toContain("this assistant cannot sign or finalize");
  });

  it("records privacy-safe ambient audit facts without transcript content", () => {
    expect(audit).toContain('resourceType: "encounter"');
    expect(audit).toContain('meta: target ? { target } : {}');
    expect(audit).not.toMatch(/transcript|clinicalText|rawAudio|audioBlob/);
  });

  it("does not add raw-audio persistence", () => {
    expect(panel).not.toMatch(/localStorage.*audio|sessionStorage.*audio|indexedDB.*audio|upload.*audio/i);
  });
});
