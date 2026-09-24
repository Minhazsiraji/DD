import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const controller = readFileSync(resolve(root, "src/features/prescriptions/use-m6e-prescription-voice.ts"), "utf8");
const composer = readFileSync(resolve(root, "src/features/prescriptions/components/prescription-composer.tsx"), "utf8");
const autopilot = readFileSync(resolve(root, "src/features/autopilot/components/m6c2-autopilot-panel.tsx"), "utf8");
const panel = readFileSync(resolve(root, "src/features/prescriptions/components/m6e-prescription-voice-panel.tsx"), "utf8");

describe("M6E complete Prescription safety integration", () => {
  it("keeps medicine voice edits staged and never directly submits or removes a saved row", () => {
    expect(controller).toContain("rx.setDraft");
    expect(controller).toContain("rx.setConfirmingRemoval(row)");
    expect(controller).not.toContain("rx.submit(");
    expect(controller).not.toContain("rx.remove(");
    expect(controller).not.toContain("addMedicineAction");
    expect(controller).not.toContain("removeMedicineAction");
  });

  it("reuses the existing M3 add/save/remove controls as the authoritative write boundary", () => {
    expect(composer).toContain('submitLabel="Add medicine"');
    expect(composer).toContain("onSubmit={() => void rx.submit()}");
    expect(composer).toContain("<MedicineList rx={rx} readOnly={readOnly} />");
  });

  it("reuses the existing Autopilot proposal engine and Apply action instead of creating another one", () => {
    expect(autopilot).toContain("generateAutopilotPrescriptionProposalAction");
    expect(autopilot).toContain("applyAutopilotProposalToDraftAction");
    expect(controller).toContain("autopilotVoiceRef.current.generate()");
    expect(controller).toContain("autopilotVoiceRef.current.discard()");
    expect(controller).toContain("autopilotVoiceRef.current.apply()");
  });

  it("allows voice to open Review but never exposes a Finalize mutation path", () => {
    expect(controller).toContain("/review");
    expect(controller).toContain("PROHIBITED_FINALIZE");
    expect(controller).not.toContain("finalizePrescriptionAction");
    expect(controller).not.toContain("approvePrescriptionAction");
    expect(panel).not.toContain("finalizePrescriptionAction");
  });

  it("keeps the route-local single M6 transport and normalized stable transcript handoff", () => {
    expect(panel).toContain("useDictation");
    expect(panel).toContain("onStableTranscriptRef");
    expect(panel).toContain("await hearingSequencer.onStable");
    expect(panel).not.toContain("new WebSocket");
    expect(panel).not.toContain("getUserMedia");
  });
});
