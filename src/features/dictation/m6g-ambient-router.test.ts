import { describe, expect, it } from "vitest";
import {
  ambientDedupKey,
  applyAmbientCorrection,
  isHighRiskAmbientTarget,
  routeAmbientUtterance,
} from "./m6g-ambient-router";

describe("M6G ambient consultation routing", () => {
  it.each([
    ["Patient has fever for three days and vomiting twice", "presentIllness"],
    ["Pain radiates to the back", "presentIllness"],
    ["On examination mild epigastric tenderness", "examination"],
    ["Follow-up after 3 days", "nextVisitNote"],
    ["Patient-er fever ache", "chiefComplaints"],
    ["History of diabetes for 5 years", "pastHistory"],
  ])("routes %s to %s", (text, target) => {
    expect(routeAmbientUtterance(text)).toMatchObject({ target, risk: "low-risk" });
  });

  it("preserves Banglish clinical English terms", () => {
    const route = routeAmbientUtterance(
      "Patient-er 3 din dhore fever, upper abdominal pain ache, vomiting dui bar hoyeche.",
    );
    expect(route.target).toBe("presentIllness");
    expect(route.text).toContain("Patient-er");
    expect(route.text).toContain("fever");
    expect(route.text).toContain("upper abdominal pain");
    expect(route.text).toContain("vomiting");
  });

  it.each([
    ["Assessment suggests acute pancreatitis", "diagnosis"],
    ["Add CBC, serum amylase and lipase", "investigation"],
    ["Check HbA1c", "investigation"],
    ["Start paracetamol 500 mg", "medicine"],
  ])("keeps consequential utterance %s as a proposal", (text, target) => {
    const route = routeAmbientUtterance(text);
    expect(route).toMatchObject({ target, risk: "proposal" });
    expect(isHighRiskAmbientTarget(route.target)).toBe(true);
  });

  it("does not invent a numeric confidence for uncertain content", () => {
    const route = routeAmbientUtterance("The patient discussed several unrelated things today");
    expect(route).toMatchObject({ target: "needs-review", risk: "needs-review" });
    expect(JSON.stringify(route)).not.toMatch(/confidence/i);
  });

  it("recognizes remove corrections and applies them only when matched", () => {
    const route = routeAmbientUtterance("remove vomiting");
    expect(route.correction).toEqual({ type: "remove", value: "vomiting" });
    expect(applyAmbientCorrection("fever and vomiting", route.correction!)).toBe("fever and");
    expect(applyAmbientCorrection("fever only", route.correction!)).toBeNull();
  });

  it("recognizes replace corrections", () => {
    const route = routeAmbientUtterance("not fever, actually chills");
    expect(route.correction).toEqual({ type: "replace", value: "fever", replacement: "chills" });
    expect(applyAmbientCorrection("fever for three days", route.correction!)).toBe("chills for three days");
  });

  it("deduplicates equivalent repeated routed statements", () => {
    const first = routeAmbientUtterance("Pain radiates to the back.");
    const second = routeAmbientUtterance(" pain radiates to the back ");
    expect(ambientDedupKey(first)).toBe(ambientDedupKey(second));
  });

  it("never exposes finalize/sign as an ambient route", () => {
    for (const phrase of ["finalize prescription", "sign prescription", "complete encounter"]) {
      const route = routeAmbientUtterance(phrase);
      expect(["diagnosis", "investigation", "medicine"]).not.toContain(route.target);
      expect(route.target).toBe("needs-review");
    }
  });
});
