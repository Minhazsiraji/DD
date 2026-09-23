import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");
const panel = read("src/features/encounters/components/m6a-voice-panel.tsx");
const workspace = read("src/features/encounters/components/consultation-workspace.tsx");
const investigations = read("src/features/encounters/components/investigation-panel.tsx");

describe("M6D diagnosis editing and Investigation navigation", () => {
  it("dispatches deterministic diagnosis edits before all target append paths", () => {
    const finalHandler = panel.slice(panel.indexOf("async function handleFinal"), panel.indexOf("const dictation = useDictation"));
    expect(finalHandler.indexOf("applyLocal(local)")).toBeLessThan(finalHandler.indexOf("appendDiagnosisDraft(dictationText)"));
    expect(finalHandler.indexOf("applyLocal(local)")).toBeLessThan(finalHandler.indexOf('destination.kind === "investigation"'));
    expect(panel).toContain('if (priority === "edit" && applyDestinationEdit(intent)) return;');
    expect(panel).toContain("lastChangeRef.current");
    expect(panel).toContain("applyM6DTextEdit(draft[targetField], intent)");
  });

  it("scopes Undo, Remove-last-sentence and Clear to Diagnosis title or note", () => {
    expect(panel).toContain('targetField !== "title" && targetField !== "note"');
    expect(panel).toContain("change.target !== targetField");
    expect(panel).toContain("updateDiagnosisField(targetField, nextValue)");
    expect(panel).toContain("applyM6DTextEdit(draft[targetField], intent)");
    expect(panel).toContain("Saved diagnoses were not changed.");
    expect(panel).not.toContain("addDiagnosisAction");
  });

  it("connects direct and relative Investigation navigation without clinical action", () => {
    expect(panel).toContain('setDestination({ kind: "investigation", target: "field" })');
    expect(panel).toContain("m6dVoiceDestinationForIntent(voiceStateRef.current.destination, intent)");
    expect(panel).toContain('applyDiagnosisIntent({ type: "DIAGNOSIS_TARGET", target: destination.target })');
    expect(panel).toContain('applyInvestigationIntent({ type: "INVESTIGATION_TARGET", target: "field" })');
  });

  it("focuses and appends only to the existing Investigation search input", () => {
    expect(workspace).toContain("investigationPanelRef.current?.focusVoiceField()");
    expect(workspace).toContain("investigationPanelRef.current?.appendVoiceText(text)");
    expect(investigations).toContain("React.useImperativeHandle");
    expect(investigations).toContain("const after = insertTranscript(searchText, text, searchText.length).text");
    const voiceHandle = investigations.slice(investigations.indexOf("React.useImperativeHandle"), investigations.indexOf("function updateSearchText"));
    expect(voiceHandle).not.toContain("stage(");
    expect(voiceHandle).not.toContain("confirmStaged");
    expect(voiceHandle).not.toContain("onStagedChange");
  });
});
