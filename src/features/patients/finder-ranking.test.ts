import { describe, expect, it } from "vitest";
import { classifyFinderTerm, finderRank, rankFinderPatients } from "./finder-ranking";

const patient = (over: Partial<{ id: string; patientNumber: string; fullName: string; phone: string | null }> = {}) => ({
  id: "p1",
  patientNumber: "DD-000123",
  fullName: "Md. Rahim Hossain",
  phone: "+8801711000124",
  ...over,
});

describe("Universal Patient Finder identifier matching", () => {
  it("accepts patient numbers and normalized Bangladeshi phones", () => {
    expect(classifyFinderTerm("DD-000123")).toBe("PATIENT_NUMBER");
    expect(classifyFinderTerm("+880 1711 000124")).toBe("PHONE");
    expect(classifyFinderTerm("Rahim Hossain")).toBe("INVALID");
  });

  it("ranks exact patient number matches first", () => {
    expect(finderRank(patient(), "DD-000123")).toBe(0);
  });

  it("ranks exact normalized phone matches first", () => {
    expect(finderRank(patient(), "01711000124")).toBe(0);
  });

  it("allows identifier prefixes but never name-only matches", () => {
    expect(finderRank(patient(), "DD-000")).toBe(1);
    expect(finderRank(patient(), "01711")).toBe(1);
    expect(finderRank(patient(), "Rahim")).toBe(Number.POSITIVE_INFINITY);
    expect(rankFinderPatients([patient()], "Rahim Hossain")).toEqual([]);
  });

  it("caps identifier suggestions at six", () => {
    const rows = Array.from({ length: 10 }, (_, index) =>
      patient({ id: `p${index}`, patientNumber: `DD-000${index + 10}` }),
    );
    expect(rankFinderPatients(rows, "DD-00")).toHaveLength(6);
  });
});
