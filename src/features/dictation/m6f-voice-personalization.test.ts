import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseM6FConsultationCommand } from "./m6f-consultation-controls";
import { parseM6EPrescriptionVoiceTargeting } from "@/features/prescriptions/m6e-prescription-voice-targeting";
import {
  EMPTY_DOCTOR_VOICE_PROFILE,
  PERSONAL_COMMAND_TARGETS,
  applyDoctorVoicePersonalization,
  validateDoctorVoiceAlias,
  type DoctorVoicePersonalizationProfile,
} from "./m6f-voice-personalization";

const profile: DoctorVoicePersonalizationProfile = {
  ...EMPTY_DOCTOR_VOICE_PROFILE,
  commandAliases: [{ phrase: "oshudh ta dao", canonicalUtterance: "add medicine" }],
  fieldAliases: [{ phrase: "O/E", canonicalUtterance: "examination" }],
};

describe("Doctor Voice personalization", () => {
  it("maps an exact personal phrase to an existing canonical intent", () => {
    const personalized = applyDoctorVoicePersonalization("O/E", profile);
    expect(personalized).toBe("examination");
    expect(parseM6FConsultationCommand(personalized)).toEqual({ type: "TARGET", target: "examination" });

    expect(parseM6EPrescriptionVoiceTargeting(applyDoctorVoicePersonalization("oshudh ta dao", profile), {
      editorOpen: false, fieldTarget: null, destinationKind: "MEDICINES",
      autopilotProposalActive: false, medicineResultsActive: false,
    })).toEqual({ type: "OPEN_ADD" });
  });

  it("does not rewrite embedded clinical dictation", () => {
    const prose = "Patient reports O/E was completed yesterday";
    expect(applyDoctorVoicePersonalization(prose, profile)).toBe(prose);
  });

  it("offers no personal alias for finalize, sign, confirm investigations, save or Apply", () => {
    const canonical = PERSONAL_COMMAND_TARGETS.map((target) => target.canonicalUtterance).join(" ");
    expect(canonical).not.toMatch(/finalize|sign|confirm investigations|save medicine|apply selected/i);
    const tampered = {
      ...profile,
      commandAliases: [{ phrase: "my secret shortcut", canonicalUtterance: "apply selected" }],
    };
    expect(applyDoctorVoicePersonalization("my secret shortcut", tampered)).toBe("my secret shortcut");
  });

  it("rejects duplicate and unbounded phrases", () => {
    expect(validateDoctorVoiceAlias("O/E", profile.fieldAliases)).toMatch(/already configured/);
    expect(validateDoctorVoiceAlias("x".repeat(81), [])).toMatch(/80 characters/);
  });

  it("routes both consultation and prescription through personalization before parsing", () => {
    const read = (file: string) => readFileSync(path.resolve(file), "utf8");
    expect(read("src/features/encounters/components/m6a-voice-panel.tsx")).toContain("resolveDoctorVoiceUtterance(text)");
    expect(read("src/features/prescriptions/use-m6e-prescription-voice.ts")).toContain("resolveDoctorVoiceUtterance(text)");
  });

  it("keeps storage browser-local and makes the persistence limitation visible", () => {
    const component = readFileSync(path.resolve("src/features/dictation/components/voice-personalization-settings.tsx"), "utf8");
    expect(component).toContain("window.localStorage.setItem");
    expect(component).toContain("stay in this browser");
    expect(component).toContain("Passive learning is not enabled");
    expect(component).not.toMatch(/supabase|service.role|fetch\(/i);
  });
});
