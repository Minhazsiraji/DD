import { describe, expect, it } from "vitest";
import { M6D_COMMAND_ALIASES } from "./m6d-command-catalogue";
import { parseM6DLocalCommand, type M6DLocalIntent, type M6DTarget } from "./m6d-intent-router";

const parseFor = (text: string, activeTarget?: M6DTarget) => parseM6DLocalCommand(text, { activeTarget });

describe("M6D permanent command regression catalogue", () => {
  it.each([
    ["Pause voice", "PAUSE"], ["Stop for a moment", "PAUSE"], ["একটু থামো", "PAUSE"], ["pause koro", "PAUSE"],
    ["Continue voice", "RESUME"], ["Start again", "RESUME"], ["আবার শুরু করো", "RESUME"], ["resume koro", "RESUME"],
    ["Stop voice", "END"], ["Voice off", "END"], ["শেষ", "END"], ["voice bondho koro", "END"],
    ["Undo last change", "UNDO"], ["Cancel last change", "UNDO"], ["আগেরটা বাতিল", "UNDO"], ["last change undo koro", "UNDO"],
    ["Delete last line", "REMOVE_LAST_SENTENCE"], ["শেষ বাক্য মুছো", "REMOVE_LAST_SENTENCE"], ["last sentence delete koro", "REMOVE_LAST_SENTENCE"],
  ] as const)("maps protected control alias %s", (spoken, type) => {
    expect(parseFor(`${spoken}.`).type).toBe(type);
  });

  it("keeps the central catalogue as the source of deterministic standalone controls", () => {
    expect(M6D_COMMAND_ALIASES.pause).toContain("pause koro");
    expect(M6D_COMMAND_ALIASES.resume).toContain("resume koro");
    expect(M6D_COMMAND_ALIASES.end).toContain("voice bondho koro");
    expect(M6D_COMMAND_ALIASES.undo).toContain("last change undo koro");
  });

  it.each([
    ["Complaint", "chiefComplaints"], ["Go to chief complaint", "chiefComplaints"], ["chief complaint e jao", "chiefComplaints"],
    ["Present illness", "presentIllness"], ["Open history", "presentIllness"], ["history e jao", "presentIllness"],
    ["Previous medical history", "pastHistory"], ["past history e jao", "pastHistory"],
    ["Clinical examination", "examination"], ["শারীরিক পরীক্ষা", "examination"], ["examination e jao", "examination"],
    ["Clinical impression", "assessment"], ["মূল্যায়ন", "assessment"], ["assessment e jao", "assessment"],
    ["Treatment advice", "advice"], ["advice e jao", "advice"],
    ["Next appointment", "nextVisitNote"], ["Review visit", "nextVisitNote"], ["follow up e jao", "nextVisitNote"],
  ] as const)("maps navigation alias %s without fuzzy matching", (spoken, target) => {
    expect(parseFor(spoken)).toEqual({ type: "NAVIGATE", target });
  });

  it.each([
    ["diagnosis e jao", { type: "DIAGNOSIS_NAVIGATE" }],
    ["Diagnosis comments", { type: "DIAGNOSIS_TARGET", target: "note" }],
    ["Rule out", { type: "DIAGNOSIS_CERTAINTY", certainty: "RULED_OUT" }],
    ["Tests", { type: "INVESTIGATION_NAVIGATE" }],
    ["Test orders", { type: "INVESTIGATION_NAVIGATE" }],
    ["Search investigation", { type: "INVESTIGATION_TARGET", target: "field" }],
    ["investigation e jao", { type: "INVESTIGATION_NAVIGATE" }],
  ] satisfies readonly [string, M6DLocalIntent][])("maps target alias %s", (spoken, intent) => {
    expect(parseFor(spoken)).toEqual(intent);
  });

  it("supports target-aware edit aliases without changing edit semantics", () => {
    expect(parseFor("Clear this field")).toEqual({ type: "NOTE_EDIT", operation: "CLEAR" });
    expect(parseFor("field clear koro")).toEqual({ type: "NOTE_EDIT", operation: "CLEAR" });
    expect(parseFor("headache change kore body ache")).toEqual({ type: "NOTE_EDIT", operation: "REPLACE", value: "headache", replacement: "body ache" });
    expect(parseFor("headache er jaygay body ache")).toEqual({ type: "NOTE_EDIT", operation: "REPLACE", value: "headache", replacement: "body ache" });
  });

  it("keeps ambiguous Bangla পরীক্ষা on its protected Examination meaning", () => {
    expect(parseFor("পরীক্ষা")).toEqual({ type: "NAVIGATE", target: "examination" });
    expect(parseFor("পরীক্ষার অর্ডার")).toEqual({ type: "INVESTIGATION_NAVIGATE" });
  });
});

describe("M6D contextual Follow-up date contract", () => {
  const followUp = "nextVisitNote" as const;

  it.each([
    ["Tomorrow", 1, "days"], ["1 day", 1, "days"], ["2 days", 2, "days"], ["3 days", 3, "days"],
    ["5 days", 5, "days"], ["7 days", 7, "days"], ["10 days", 10, "days"], ["14 days", 14, "days"],
    ["one week", 7, "days"], ["two weeks", 14, "days"], ["three weeks", 21, "days"],
    ["one month", 1, "months"], ["two months", 2, "months"], ["three months", 3, "months"],
    ["আগামীকাল", 1, "days"], ["৩ দিন পরে", 3, "days"], ["এক সপ্তাহ পরে", 7, "days"], ["দুই সপ্তাহ পরে", 14, "days"], ["তিন মাস পরে", 3, "months"],
    ["kal", 1, "days"], ["3 din pore", 3, "days"], ["1 week por", 7, "days"], ["ek week pore", 7, "days"], ["2 week pore", 14, "days"], ["1 month pore", 1, "months"],
  ] as const)("maps bare Follow-up-target interval %s", (spoken, amount, unit) => {
    expect(parseFor(spoken, followUp)).toEqual({ type: "FOLLOW_UP_DATE", amount, unit });
  });

  it.each([
    ["after 3 days", 3, "days"], ["in one week", 7, "days"], ["review after 2 weeks", 14, "days"],
    ["next visit in 1 month", 1, "months"], ["next appointment after 1 month", 1, "months"],
    ["follow-up after 2 weeks", 14, "days"], ["ফলোআপ এক সপ্তাহ পরে", 7, "days"],
    ["পরবর্তী ভিজিট দুই সপ্তাহ পরে", 14, "days"], ["follow up 2 week pore", 14, "days"], ["next visit 1 month pore", 1, "months"],
  ] as const)("maps natural date phrase %s", (spoken, amount, unit) => {
    expect(parseFor(spoken, followUp)).toEqual({ type: "FOLLOW_UP_DATE", amount, unit });
  });

  it.each(["2 weeks", "one month", "আগামীকাল", "3 din pore"])("does not apply bare interval %s outside Follow-up", (spoken) => {
    expect(parseFor(spoken, "presentIllness")).toEqual({ type: "NONE" });
  });

  it.each([
    "With reports", "If symptoms persist", "After treatment course", "Come earlier if fever returns", "Review with CBC report",
  ])("keeps Follow-up note prose as dictation: %s", (spoken) => {
    expect(parseFor(spoken, followUp)).toEqual({ type: "NONE" });
  });
});

describe("M6D ambiguity protections", () => {
  it.each([
    ["fever for one week", "presentIllness"],
    ["patient will return after two weeks", "presentIllness"],
    ["confirmed by laboratory findings", undefined],
    ["investigation suggests dengue", "assessment"],
    ["pause medication for two days", "advice"],
    ["The diagnosis was confirmed yesterday", undefined],
  ] as const)("keeps clinical prose as dictation: %s", (spoken, activeTarget) => {
    expect(parseFor(spoken, activeTarget)).toEqual({ type: "NONE" });
  });
});
