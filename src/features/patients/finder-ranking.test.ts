import { describe, expect, it } from "vitest";
import { finderRank, rankFinderPatients } from "./finder-ranking";

const patient = (over: Partial<{ id: string; patientNumber: string; fullName: string; phone: string | null }> = {}) => ({
  id: "p1",
  patientNumber: "DD-000123",
  fullName: "Md. Rahim Hossain",
  phone: "+8801711000124",
  ...over,
});

describe("Universal Patient Finder ranking", () => {
  it("ranks an exact patient number first", () => {
    expect(finderRank(patient(), "DD-000123")).toBe(0);
  });

  it("ranks an exact normalized Bangladeshi phone second", () => {
    expect(finderRank(patient(), "01711000124")).toBe(1);
  });

  it("ranks an exact normalized full name third", () => {
    expect(finderRank(patient(), "Rahim Hossain")).toBe(2);
  });

  it("ranks strong prefixes ahead of remaining matches", () => {
    expect(finderRank(patient(), "DD-000")).toBe(3);
    expect(finderRank(patient(), "01711")).toBe(3);
    expect(finderRank(patient(), "Rahim")).toBe(3);
  });

  it("ranks similar names ahead of unrelated remaining matches", () => {
    expect(finderRank(patient(), "Rahim Karim")).toBeLessThan(finderRank(patient(), "Completely Different"));
  });

  it("caps first suggestions at six", () => {
    const rows = Array.from({ length: 10 }, (_, index) => patient({ id: `p${index}`, patientNumber: `DD-${index}` }));
    expect(rankFinderPatients(rows, "DD")).toHaveLength(6);
  });
});
