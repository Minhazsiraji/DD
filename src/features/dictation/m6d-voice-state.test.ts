import { describe, expect, it } from "vitest";
import { parseM6DLocalCommand } from "./m6d-intent-router";
import {
  INITIAL_M6D_VOICE_STATE,
  applyM6DTextEdit,
  m6dCommandPriority,
  m6dVoiceDestinationForIntent,
  m6dVoiceFocusSelector,
  m6dVoiceSection,
  type M6DVoiceDestination,
} from "./m6d-voice-state";

function destination(current: M6DVoiceDestination, spoken: string): M6DVoiceDestination {
  return m6dVoiceDestinationForIntent(current, parseM6DLocalCommand(spoken)) ?? current;
}

describe("M6D authoritative voice destination", () => {
  it("atomically maps Diagnosis and Diagnoses to the title field", () => {
    for (const spoken of ["Diagnosis", "Diagnosis.", "Diagnoses", "Diagnoses."]) {
      const next = destination(INITIAL_M6D_VOICE_STATE.destination, spoken);
      expect(next).toEqual({ kind: "diagnosis", target: "title" });
      expect(m6dVoiceSection(next)).toBe("diagnoses");
      expect(m6dVoiceFocusSelector(next)).toBe("[data-m6d-diagnosis-title]");
    }
  });

  it("atomically maps every Investigation section alias to its editable input", () => {
    for (const spoken of ["Investigation", "Investigations", "Investigation order", "Investigation orders"]) {
      const next = destination(INITIAL_M6D_VOICE_STATE.destination, spoken);
      expect(next).toEqual({ kind: "investigation", target: "field" });
      expect(m6dVoiceSection(next)).toBe("investigations");
      expect(m6dVoiceFocusSelector(next)).toBe("#investigation-search");
    }
  });

  it("keeps the extended Next/Previous graph deterministic in both directions", () => {
    const diagnoses = destination(INITIAL_M6D_VOICE_STATE.destination, "Diagnoses");
    const investigations = destination(diagnoses, "Next");
    expect(investigations).toEqual({ kind: "investigation", target: "field" });
    expect(destination(investigations, "Previous")).toEqual({ kind: "diagnosis", target: "title" });
  });

  it("enforces the global dispatch priority before destination-specific append", () => {
    expect(m6dCommandPriority(parseM6DLocalCommand("Pause"))).toBe("session");
    expect(m6dCommandPriority(parseM6DLocalCommand("Undo"))).toBe("session");
    expect(m6dCommandPriority(parseM6DLocalCommand("Clear current section"))).toBe("edit");
    expect(m6dCommandPriority(parseM6DLocalCommand("Diagnosis"))).toBe("navigation");
    expect(m6dCommandPriority(parseM6DLocalCommand("Confirmed"))).toBe("certainty");
    expect(m6dCommandPriority(parseM6DLocalCommand("Dengue fever"))).toBe("none");
  });

  it("preserves the protected edit-command semantics for every text destination", () => {
    expect(applyM6DTextEdit("Fever. Cough.", parseM6DLocalCommand("Remove last sentence"))).toBe("Fever.");
    expect(applyM6DTextEdit("Fever and Cough", parseM6DLocalCommand("Replace cough with rash"))).toBe("Fever and rash");
    expect(applyM6DTextEdit("Fever. Cough.", parseM6DLocalCommand("Replace last line with No chest pain"))).toBe("Fever. No chest pain");
    expect(applyM6DTextEdit("Fever and Headache", parseM6DLocalCommand("Delete headache"))).toBe("Fever and");
    expect(applyM6DTextEdit("Fever", parseM6DLocalCommand("Clear this section"))).toBe("");
  });
});
