import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");
const panel = read("src/features/encounters/components/m6a-voice-panel.tsx");
const workspace = read("src/features/encounters/components/consultation-workspace.tsx");
const form = read("src/features/encounters/components/finding-form.tsx");
const router = read("src/features/dictation/m6d-intent-router.ts");

describe("M6D complete Diagnoses voice workflow", () => {
  it("makes Diagnosis and Diagnoses open and focus the controlled title field", () => {
    expect(workspace).toContain('id="diagnoses"');
    expect(panel).toContain('return applyDiagnosisIntent({ type: "DIAGNOSIS_TARGET", target: "title" })');
    expect(panel).toContain("pendingDiagnosisIntentRef.current = intent");
    expect(panel).toContain("onOpenDiagnosis()");
    expect(workspace).toContain('if (!s.editors.diagnosis) s.openAdd("diagnosis")');
    expect(panel).toContain('"[data-m6d-diagnosis-title]"');
    expect(panel).toContain('"[data-m6d-diagnosis-certainty]"');
    expect(panel).toContain('"[data-m6d-diagnosis-note]"');
    expect(form).toContain("data-m6d-diagnosis-title");
    expect(form).toContain("data-m6d-diagnosis-note");
  });

  it("routes ordinary speech only into the selected diagnosis title or note draft", () => {
    expect(panel).toContain('targetField !== "title" && targetField !== "note"');
    expect(panel).toContain("insertTranscript(current, text, current.length)");
    expect(panel).toContain("onDiagnosisDraftChange(next)");
    expect(workspace).toContain('onDiagnosisDraftChange={(draft) => s.setDraft("diagnosis", draft)}');
  });

  it("selects exactly one controlled certainty enum and keeps it editable", () => {
    for (const certainty of ["PROVISIONAL", "WORKING", "CONFIRMED", "RULED_OUT"]) {
      expect(router).toContain(certainty);
    }
    expect(panel).toContain("const next = { ...draft, certainty: intent.certainty }");
    expect(panel).toContain("onDiagnosisDraftChange(next)");
    expect(form).toContain("checked={value.certainty === c}");
    expect(form).toContain('type="radio"');
    expect(form).toContain("name={`${id}-certainty`}");
  });

  it("consumes diagnosis controls once at speech-final and never appends their text", () => {
    const providerFinal = panel.slice(panel.indexOf("function handleProviderFinal"), panel.indexOf("async function handleFinal"));
    const speechFinal = panel.slice(panel.indexOf("async function handleFinal"), panel.indexOf("const dictation = useDictation"));
    expect(providerFinal).toContain("isM6DDiagnosisIntent(local)");
    expect(providerFinal).toContain("isM6DDiagnosisDirectOpenIntent(local)");
    expect(providerFinal).toContain("dictation.commitUtterance()");
    expect(providerFinal).not.toContain("applyDiagnosisIntent");
    expect(speechFinal.indexOf("applyLocal(local)")).toBeLessThan(speechFinal.indexOf("appendDiagnosisDraft(text)"));
  });

  it("uses the same direct-open target for singular, plural and Diagnosis field", () => {
    expect(router).toContain('if (value === "diagnosis" || value === "diagnoses") return { type: "DIAGNOSIS_NAVIGATE" }');
    expect(router).toContain('if (value === "diagnosis field") return { type: "DIAGNOSIS_TARGET", target: "title" }');
    expect(panel).toContain('intent.type === "DIAGNOSIS_NAVIGATE"');
    expect(panel).toContain('intent.type === "DIAGNOSIS_TARGET" && intent.target === "title"');
    expect(panel).toContain('diagnosisTargetRef.current = intent.target');
  });

  it("allows the next ordinary utterance to enter the focused title without submitting", () => {
    const speechFinal = panel.slice(panel.indexOf("async function handleFinal"), panel.indexOf("const dictation = useDictation"));
    expect(speechFinal.indexOf("applyLocal(local)")).toBeLessThan(speechFinal.indexOf("appendDiagnosisDraft(text)"));
    expect(panel).toContain("insertTranscript(current, text, current.length)");
    expect(panel).toContain("onDiagnosisDraftChange(next)");
    expect(panel).not.toContain("onSubmit");
  });

  it("never submits or creates a diagnosis from voice", () => {
    expect(panel).not.toContain("onSubmit");
    expect(panel).not.toContain("submitDiagnosisEditor");
    expect(panel).not.toContain("addDiagnosisAction");
    expect(panel).toContain('focusDiagnosis("[data-m6d-diagnosis-submit]")');
    expect(panel).toContain("Press Add diagnosis explicitly to create it.");
    expect(form).toContain('type="submit"');
  });
});
