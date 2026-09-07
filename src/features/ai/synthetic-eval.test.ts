import { describe, expect, it } from "vitest";
import { PA1_SYNTHETIC_EVAL_CORPUS } from "./synthetic-eval-corpus";
import { scoreSyntheticEvaluation } from "./synthetic-eval";

describe("PA1 synthetic semantic scoring", () => {
  it("scores the hand-authored expected corpus at 100% without hallucinations", () => {
    const metrics = scoreSyntheticEvaluation(
      PA1_SYNTHETIC_EVAL_CORPUS,
      PA1_SYNTHETIC_EVAL_CORPUS.map((item) => ({
        caseId: item.id,
        proposal: item.expected,
      })),
    );
    expect(metrics.providerErrors).toBe(0);
    expect(metrics.medicineName.rate).toBe(1);
    expect(metrics.strength.rate).toBe(1);
    expect(metrics.dose.rate).toBe(1);
    expect(metrics.schedule.rate).toBe(1);
    expect(metrics.duration.rate).toBe(1);
    expect(metrics.explicitInvestigationRecall.rate).toBe(1);
    expect(metrics.extraInvestigations.extra).toBe(0);
    expect(metrics.extraInvestigations.rate).toBe(0);
    expect(metrics.ambiguityDisclosure.rate).toBe(1);
    expect(metrics.mixedInput.rate).toBe(1);
    expect(metrics.casePasses.every((entry) => entry.passed)).toBe(true);
  });

  it("reports an extra investigation as hallucination separately from recall", () => {
    const target = PA1_SYNTHETIC_EVAL_CORPUS.find((item) => item.id === "en-inv-01")!;
    if (target.expected.kind !== "INVESTIGATION_LIST") throw new Error("fixture kind");
    const proposal = {
      ...target.expected,
      investigations: [...target.expected.investigations, { name: "MRI brain" }],
    };
    const metrics = scoreSyntheticEvaluation([target], [{ caseId: target.id, proposal }]);
    expect(metrics.explicitInvestigationRecall.rate).toBe(1);
    expect(metrics.extraInvestigations.extra).toBe(1);
    expect(metrics.extraInvestigations.predicted).toBe(5);
    expect(metrics.extraInvestigations.rate).toBe(0.2);
    expect(metrics.casePasses[0]?.passed).toBe(false);
  });

  it("scores missing ambiguity disclosure as a semantic failure", () => {
    const target = PA1_SYNTHETIC_EVAL_CORPUS.find((item) => item.id === "en-amb-dose")!;
    if (target.expected.kind !== "PRESCRIPTION_MEDICINE") throw new Error("fixture kind");
    const proposal = { ...target.expected, uncertainties: [] };
    const metrics = scoreSyntheticEvaluation([target], [{ caseId: target.id, proposal }]);
    expect(metrics.ambiguityDisclosure.rate).toBe(0);
    expect(metrics.casePasses[0]?.errors.join(" ")).toContain("AMBIGUOUS_DOSE");
  });
});
