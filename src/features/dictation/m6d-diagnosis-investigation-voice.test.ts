import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");
const panel = read("src/features/encounters/components/m6a-voice-panel.tsx");
const workspace = read("src/features/encounters/components/consultation-workspace.tsx");
const investigations = read("src/features/encounters/components/investigation-panel.tsx");

describe("M6D diagnosis editing and Investigation navigation", () => {
  it("dispatches deterministic diagnosis edits before all target append paths", () => {
    const finalHandler = panel.slice(panel.indexOf("async function handleFinal"), panel.indexOf("const dictation = useDictation"));
    expect(finalHandler.indexOf("applyLocal(local)")).toBeLessThan(finalHandler.indexOf("appendDiagnosisDraft(text)"));
    expect(finalHandler.indexOf("applyLocal(local)")).toBeLessThan(finalHandler.indexOf('investigationTargetRef.current === "field"'));
    expect(panel).toContain("if (applyDiagnosisEdit(intent)) return;");
    expect(panel).toContain("lastDiagnosisChangeRef.current");
    expect(panel).toContain("removeM6DLastSentence(draft[targetField])");
  });

  it("scopes Undo, Remove-last-sentence and Clear to Diagnosis title or note", () => {
    expect(panel).toContain('targetField !== "title" && targetField !== "note"');
    expect(panel).toContain("change.target !== targetField");
    expect(panel).toContain("updateDiagnosisField(targetField, \"\")");
    expect(panel).toContain("Saved diagnoses were not changed.");
    expect(panel).not.toContain("addDiagnosisAction");
  });

  it("connects direct and relative Investigation navigation without clinical action", () => {
    expect(panel).toContain('focusDiagnosis("#m6b-investigations")');
    expect(panel).toContain('activeExtendedSectionRef.current = "investigations"');
    expect(panel).toContain("resolveM6DExtendedSectionStep(current, direction)");
    expect(panel).toContain('applyDiagnosisIntent({ type: "DIAGNOSIS_NAVIGATE" })');
    expect(panel).toContain('applyInvestigationIntent({ type: "INVESTIGATION_NAVIGATE" })');
  });

  it("focuses and appends only to the existing Investigation search input", () => {
    expect(workspace).toContain("investigationPanelRef.current?.focusVoiceField()");
    expect(workspace).toContain("investigationPanelRef.current?.appendVoiceText(text)");
    expect(investigations).toContain("React.useImperativeHandle");
    expect(investigations).toContain("setSearchText((current) => insertTranscript(current, text, current.length).text)");
    const voiceHandle = investigations.slice(investigations.indexOf("React.useImperativeHandle"), investigations.indexOf("function updateSearchText"));
    expect(voiceHandle).not.toContain("stage(");
    expect(voiceHandle).not.toContain("confirmStaged");
    expect(voiceHandle).not.toContain("onStagedChange");
  });
});
