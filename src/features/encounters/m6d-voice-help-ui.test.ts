import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { draftPatchSchema } from "./schema";
import {
  M6D_DIAGNOSIS_NOTE_EXAMPLE,
  M6D_DIAGNOSIS_TITLE_EXAMPLE,
  M6D_FOLLOW_UP_DATE_HELP,
  M6D_INVESTIGATION_EXAMPLE,
  M6D_SECTION_EXAMPLES,
  m6dInlinePlaceholder,
} from "./m6d-inline-examples";

const read = (path: string) => readFileSync(path, "utf8");
const notes = read("src/features/encounters/components/m2-clinical-notes.tsx");
const finding = read("src/features/encounters/components/finding-form.tsx");
const investigation = read("src/features/encounters/components/investigation-panel.tsx");
const followUp = read("src/features/encounters/components/next-visit-fields.tsx");
const voice = read("src/features/encounters/components/m6a-voice-panel.tsx");

describe("M6D inline clinical-field examples", () => {
  it("defines the approved example for every voice-enabled editable destination", () => {
    expect(M6D_SECTION_EXAMPLES).toMatchObject({
      chiefComplaints: "e.g. Fever for 3 days with headache",
      presentIllness: "e.g. Fever for 3 days, associated with cough and body ache",
      pastHistory: "e.g. Diabetes for 5 years, on regular medication",
      examination: "e.g. Pulse 96/min, BP 110/70 mmHg, throat congested",
      assessment: "e.g. Viral fever with dehydration",
      advice: "e.g. Drink plenty of fluids and take adequate rest",
      nextVisitNote: "e.g. With reports / If symptoms persist / After treatment course",
    });
    expect(M6D_DIAGNOSIS_TITLE_EXAMPLE).toBe("e.g. Dengue fever");
    expect(M6D_DIAGNOSIS_NOTE_EXAMPLE).toBe("e.g. High fever with thrombocytopenia");
    expect(M6D_INVESTIGATION_EXAMPLE).toBe("e.g. CBC and lipid profile");
    expect(M6D_FOLLOW_UP_DATE_HELP).toBe("Try: Tomorrow, 3 days, 2 weeks, 1 month");
  });

  it("shows guidance only for an empty controlled value and restores it after clearing", () => {
    const example = M6D_SECTION_EXAMPLES.chiefComplaints;
    expect(m6dInlinePlaceholder("", example)).toBe(example);
    expect(m6dInlinePlaceholder("Fever for 3 days", example)).toBeUndefined();
    expect(m6dInlinePlaceholder("", example)).toBe(example);
  });

  it("keeps examples out of the autosave patch and clinical value", () => {
    const value = "";
    const placeholder = m6dInlinePlaceholder(value, M6D_SECTION_EXAMPLES.chiefComplaints);
    const parsed = draftPatchSchema.parse({ chiefComplaints: value, nextVisitNote: "" });
    expect(placeholder).toBe(M6D_SECTION_EXAMPLES.chiefComplaints);
    expect(parsed).toEqual({ chiefComplaints: "", nextVisitNote: "" });
    expect(JSON.stringify(parsed)).not.toContain("e.g.");
  });

  it("uses controlled value/onChange paths for typing and voice insertion", () => {
    expect(notes).toContain("value={value}");
    expect(notes).toContain("onChange={(e) => onChange(field, e.target.value)}");
    expect(notes).toContain("onInsert={(next) => onChange(field, next)}");
    expect(finding).toContain("value={value.title}");
    expect(finding).toContain("value={value.note}");
    expect(investigation).toContain("value={searchText}");
    expect(investigation).toContain("onInsert={(next) => updateSearchText(next)}");
    expect(followUp).toContain("value={note}");
  });

  it("associates the persistent Follow-up date helper with the date field", () => {
    expect(followUp).toContain('id="nextVisitOn-help"');
    expect(followUp).toContain('aria-describedby={badDate ? "nextVisitOn-help nextVisitOn-error" : "nextVisitOn-help"}');
    expect(followUp).toContain("{M6D_FOLLOW_UP_DATE_HELP}");
  });

  it("removes the expanding help panel and preserves the stable sticky assistant", () => {
    expect(voice).not.toContain("What can I say?");
    expect(voice).not.toContain("data-m6d-voice-help");
    expect(voice).not.toContain("sm:absolute");
    expect(voice).toContain('className="sticky top-2 z-40 min-w-0"');
    expect((voice.match(/useState<M6DVoiceState>/g) ?? []).length).toBe(1);
  });

  it("keeps all inline guidance mobile-contained", () => {
    expect(notes).toContain("w-full resize-y");
    expect(finding).toContain("h-11 w-full");
    expect(investigation).toContain("w-full min-w-0");
    expect(followUp).toContain("break-words");
  });
});
