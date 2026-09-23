type M6DExampleSectionKey =
  | "chiefComplaints"
  | "symptoms"
  | "presentIllness"
  | "pastHistory"
  | "examination"
  | "assessment"
  | "advice"
  | "nextVisitNote";

export const M6D_SECTION_EXAMPLES: Readonly<Record<M6DExampleSectionKey, string>> = {
  chiefComplaints: "e.g. Fever for 3 days with headache",
  symptoms: "e.g. Fever, cough, pain — as the patient reports them",
  presentIllness: "e.g. Fever for 3 days, associated with cough and body ache",
  pastHistory: "e.g. Diabetes for 5 years, on regular medication",
  examination: "e.g. Pulse 96/min, BP 110/70 mmHg, throat congested",
  assessment: "e.g. Viral fever with dehydration",
  advice: "e.g. Drink plenty of fluids and take adequate rest",
  nextVisitNote: "e.g. With reports / If symptoms persist / After treatment course",
};

export const M6D_DIAGNOSIS_TITLE_EXAMPLE = "e.g. Dengue fever";
export const M6D_DIAGNOSIS_NOTE_EXAMPLE = "e.g. High fever with thrombocytopenia";
export const M6D_INVESTIGATION_EXAMPLE = "e.g. CBC and lipid profile";
export const M6D_FOLLOW_UP_DATE_HELP = "Try: Tomorrow, 3 days, 2 weeks, 1 month";

/**
 * Guidance is a DOM placeholder only. Returning undefined for real content
 * makes the presentation/data boundary explicit and keeps examples out of the
 * controlled value that autosave, review, finalization and print consume.
 */
export function m6dInlinePlaceholder(value: string, example: string): string | undefined {
  return value === "" ? example : undefined;
}
