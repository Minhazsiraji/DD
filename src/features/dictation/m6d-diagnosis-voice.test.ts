import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");
const panel = read("src/features/encounters/components/m6a-voice-panel.tsx");
const workspace = read("src/features/encounters/components/consultation-workspace.tsx");
const form = read("src/features/encounters/components/finding-form.tsx");
const router = read("src/features/dictation/m6d-intent-router.ts");

describe("M6D complete Diagnoses voice workflow", () => {
  it("navigates and focuses the existing controlled diagnosis form", () => {
    expect(workspace).toContain('id="diagnoses"');
    expect(panel).toContain('focusDiagnosis("#diagnoses")');
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
    expect(providerFinal).not.toContain("applyDiagnosisIntent");
    expect(speechFinal.indexOf("applyLocal(local)")).toBeLessThan(speechFinal.indexOf("appendDiagnosisDraft(text)"));
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
