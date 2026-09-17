import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function read(rel: string) {
  return readFileSync(path.resolve(rel), "utf8");
}

describe("M6B command safety integration", () => {
  it("keeps M6B on mock voice with explicit review/apply", () => {
    const panel = read("src/features/dictation/components/m6b-voice-commands.tsx");
    expect(panel).toContain('providerMode: "mock"');
    expect(panel).toContain("Review/edit command transcript");
    expect(panel).toContain("Apply");
    expect(panel).toContain("Discard");
    expect(panel).not.toMatch(/OPENAI_API_KEY|DEEPGRAM_API_KEY|fetch\([^)]*openai|fetch\([^)]*deepgram/i);
  });

  it("does not directly finalize or call medicine write actions", () => {
    const panel = read("src/features/dictation/components/m6b-voice-commands.tsx");
    const workspace = read("src/features/encounters/components/consultation-workspace.tsx");
    expect(panel).not.toMatch(/finalizePrescriptionAction|approvePrescription|addMedicineAction/);
    expect(workspace).not.toMatch(/finalizePrescriptionAction|approvePrescription/);
    expect(workspace).toContain('/review?returnTo=');
  });

  it("medicine Apply only proposes into the existing M3 editor", () => {
    const composer = read("src/features/prescriptions/components/prescription-composer.tsx");
    expect(composer).toContain("rx.proposeMedicine(draft)");
    expect(composer).not.toMatch(/m6bMedicine[\s\S]{0,500}addMedicineAction/);
    expect(composer).toContain("Add medicine");
  });

  it("investigations stage locally and retain the existing confirmation boundary", () => {
    const workspace = read("src/features/encounters/components/consultation-workspace.tsx");
    expect(workspace).toContain("addStagedInvestigation");
    expect(workspace).toContain("setStagedInvestigations");
    const panel = read("src/features/encounters/components/investigation-panel.tsx");
    expect(panel).toContain("confirmInvestigationsAction");
  });

  it("derives arbitrary day follow-up from the chamber-local Tomorrow shortcut", () => {
    const workspace = read("src/features/encounters/components/consultation-workspace.tsx");
    expect(workspace).toContain("addCalendarDays(tomorrow.date, -1)");
    expect(workspace).toContain("addCalendarDays(today, days)");
    expect(workspace).toContain('s.setField("nextVisitOn", date)');
  });

  it("remains phone-first and wrap-safe", () => {
    const panel = read("src/features/dictation/components/m6b-voice-commands.tsx");
    expect(panel).toContain("min-w-0");
    expect(panel).toContain("flex-wrap");
    expect(panel).toContain("min-h-11");
  });
});
