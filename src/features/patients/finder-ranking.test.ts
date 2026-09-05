import { describe, expect, it } from "vitest";
import { classifyFinderTerm, finderRank, rankFinderPatients } from "./finder-ranking";

const patient = (over: Partial<{ id: string; patientNumber: string; fullName: string; phone: string | null }> = {}) => ({
  id: "p1",
  patientNumber: "DD-000123",
  fullName: "Md. Rahim Hossain",
  phone: "+8801711000124",
  ...over,
});

describe("Universal Patient Finder ranking", () => {
  it("classifies patient number, phone and name discovery terms", () => {
    expect(classifyFinderTerm("DD-000123")).toBe("PATIENT_NUMBER");
    expect(classifyFinderTerm("+880 1711 000124")).toBe("PHONE");
    expect(classifyFinderTerm("Rahim Hossain")).toBe("NAME");
  });

  it("ranks exact patient number before every other signal", () => {
    expect(finderRank(patient(), "DD-000123")).toBe(0);
  });

  it("ranks exact normalized phone next", () => {
    expect(finderRank(patient(), "01711000124")).toBe(1);
  });

  it("ranks exact name after exact identifiers, then prefix/similar candidates", () => {
    expect(finderRank(patient(), "Md. Rahim Hossain")).toBe(2);
    expect(finderRank(patient(), "Md Rahim")).toBe(3);
    expect(finderRank(patient(), "Rahim Karim")).toBe(4);
  });

  it("returns duplicate-name candidates rather than deciding identity", () => {
    const rows = [
      patient({ id: "p1", patientNumber: "DD-000123", phone: "01711000124", fullName: "Rahim Hossain" }),
      patient({ id: "p2", patientNumber: "DD-000456", phone: "01822000124", fullName: "Rahim Hossain" }),
    ];
    expect(rankFinderPatients(rows, "Rahim Hossain")).toHaveLength(2);
    expect(rankFinderPatients(rows, "Rahim Hossain").map((row) => row.id).sort()).toEqual(["p1", "p2"]);
  });

  it("caps discovery suggestions at six", () => {
    const rows = Array.from({ length: 10 }, (_, index) =>
      patient({ id: `p${index}`, patientNumber: `DD-000${index + 10}`, fullName: `Rahim Test ${index}` }),
    );
    expect(rankFinderPatients(rows, "Rahim")).toHaveLength(6);
  });
});
