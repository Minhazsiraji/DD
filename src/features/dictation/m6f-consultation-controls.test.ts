import { describe, expect, it } from "vitest";
import { parseM6FConsultationCommand } from "./m6f-consultation-controls";

describe("M6F consultation controls", () => {
  it.each([
    ["go to symptoms", { type: "TARGET", target: "symptoms" }],
    ["উপসর্গে যাও", { type: "TARGET", target: "symptoms" }],
    ["symptoms e jao", { type: "TARGET", target: "symptoms" }],
    ["পালস ছিয়ানব্বই", { type: "SET_DRAFT", target: "vitalPulseBpm", value: "96" }],
    ["pulse chiyanobboi", { type: "SET_DRAFT", target: "vitalPulseBpm", value: "96" }],
    ["ওজন সত্তর কেজি", { type: "SET_DRAFT", target: "vitalWeightKg", value: "70" }],
    ["weight sottor kg", { type: "SET_DRAFT", target: "vitalWeightKg", value: "70" }],
    ["height eksho sottor centimeter", { type: "SET_DRAFT", target: "vitalHeightCm", value: "170" }],
    ["BP eksho atharo by ashi", { type: "SET_BP", systolic: "118", diastolic: "80" }],
    ["follow up date kal dao", { type: "SET_FOLLOW_UP", amount: 1, unit: "days" }],
    ["ফলো আপ তারিখ দুই সপ্তাহ পরে", { type: "SET_FOLLOW_UP", amount: 14, unit: "days" }],
    ["open prescription", { type: "OPEN_PRESCRIPTION" }],
  ])("routes %s deterministically", (spoken, expected) => {
    expect(parseM6FConsultationCommand(spoken, { activeTarget: "vitals", destination: { kind: "note", target: "examination" } })).toEqual(expected);
  });

  it("does not convert command-like words embedded in clinical prose", () => {
    const fixedNegatives = [
      "রোগী মেডিসিন বন্ধ করেছে", "আগের পরীক্ষায় হিমোগ্লোবিন কম ছিল", "পরের সপ্তাহে রোগী আসবে",
      "রোগী খাবার পরিবর্তন করেছে", "patient stopped medicine yesterday", "previous treatment was stopped",
      "next week review was advised", "patient changed diet",
    ];
    const subjects = ["patient", "the patient", "রোগী", "শিশুটি", "তিনি"];
    const events = ["stopped", "changed", "continued", "reported", "আগে বন্ধ করেছে", "পরিবর্তন করেছে"];
    const objects = ["medicine yesterday", "diet last week", "treatment after review", "ওষুধ গতকাল", "খাবার আগে"];
    const negatives = [...fixedNegatives, ...subjects.flatMap((subject) => events.flatMap((event) => objects.map((object) => `${subject} ${event} ${object}`)))];
    expect(negatives.length).toBeGreaterThan(150);
    for (const text of negatives) expect(parseM6FConsultationCommand(text), text).toEqual({ type: "NONE" });
  });

  it("keeps bare পরীক্ষা ambiguous", () => {
    expect(parseM6FConsultationCommand("পরীক্ষা")).toEqual({ type: "NONE" });
    expect(parseM6FConsultationCommand("শারীরিক পরীক্ষা")).toEqual({ type: "TARGET", target: "examination" });
  });
});
