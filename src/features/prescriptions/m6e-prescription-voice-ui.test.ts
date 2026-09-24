import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const voiceSource = readFileSync(
  resolve(root, "src/features/prescriptions/components/m6e-prescription-voice-panel.tsx"),
  "utf8",
);
const composerSource = readFileSync(
  resolve(root, "src/features/prescriptions/components/prescription-composer.tsx"),
  "utf8",
);
const dictationSource = readFileSync(
  resolve(root, "src/features/dictation/use-dictation.ts"),
  "utf8",
);

describe("M6E-A prescription voice shell", () => {
  it("reuses the existing M6 transport, language control, and continuous session", () => {
    expect(voiceSource).toContain('from "@/features/dictation/use-dictation"');
    expect(voiceSource).toContain("VoiceLanguageControl");
    expect(voiceSource).toContain('providerMode: LIVE_VOICE_ENABLED ? "deepgram" : "mock"');
    expect(voiceSource).toContain("continuous: true");
    expect(voiceSource).toContain("data-m6e-prescription-voice");
  });

  it("mounts only for an editable prescription and never auto-starts on render", () => {
    expect(composerSource).toContain("!readOnly ? <M6EPrescriptionVoicePanel disabled={rx.blocked} /> : null");
    expect(voiceSource).toContain("onClick={start}");
    expect(voiceSource.match(/dictation\.start\(\);/g)).toHaveLength(1);
    expect(voiceSource).not.toMatch(/useEffect[\s\S]{0,300}dictation\.start/);
  });

  it("keeps M6E-A speech preview-only with no clinical, Autopilot, Review, or Finalize mutation path", () => {
    for (const forbidden of [
      "addMedicineAction",
      "updateMedicineAction",
      "removeMedicineAction",
      "moveMedicineAction",
      "generateAutopilotPrescriptionProposalAction",
      "applyAutopilotProposalToDraftAction",
      "finalizePrescriptionAction",
      "openPrescriptionAction",
    ]) {
      expect(voiceSource).not.toContain(forbidden);
    }
    expect(voiceSource).not.toContain("router.push");
    expect(voiceSource).not.toContain("/review");
    expect(voiceSource).toContain("No clinical field was changed");
  });

  it("inherits the existing single-owner lease and unmount abort cleanup", () => {
    expect(dictationSource).toContain("let activeVoiceLease: ActiveVoiceLease | null = null");
    expect(dictationSource).toContain("if (activeVoiceLease && activeVoiceLease.owner !== owner) activeVoiceLease.cancel()");
    expect(dictationSource).toContain("current?.abort();");
  });

  it("keeps the shell mobile-contained", () => {
    expect(voiceSource).toContain('className="min-w-0 overflow-hidden"');
    expect(voiceSource).toContain("flex min-w-0 flex-col");
    expect(voiceSource).toContain("w-full shrink-0");
    expect(voiceSource).toContain("break-words");
  });
});
