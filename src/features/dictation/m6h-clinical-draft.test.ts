import { describe, expect, it } from "vitest";
import { acceptAllSafe, approvedDocumentation, canApplyDocumentation, clinicalSummary, reviewLevel, suppressDraftDuplicates, toDraftItem, withExistingDiff } from "./m6h-clinical-draft";
import type { M6GAmbientRoute } from "./m6g-ambient-router";

const route = (target: M6GAmbientRoute["target"], risk: M6GAmbientRoute["risk"], text: string): M6GAmbientRoute => ({ target, risk, text, reason: "test" });

describe("M6H clinical draft safety", () => {
  it("classifies documentation, protected proposals and uncertainty", () => {
    expect(reviewLevel(route("presentIllness", "low-risk", "fever for 3 days"))).toBe("ready");
    expect(reviewLevel(route("diagnosis", "proposal", "possible pancreatitis"))).toBe("confirmation");
    expect(reviewLevel(route("needs-review", "needs-review", "previous sentence was wrong"))).toBe("needs-review");
  });

  it("never lets Accept All approve protected proposals", () => {
    const items = acceptAllSafe([
      toDraftItem(route("examination", "low-risk", "BP 120/80"), "1"),
      toDraftItem(route("medicine", "proposal", "Paracetamol 500 mg twice daily for 3 days"), "2"),
    ]);
    expect(items[0].decision).toBe("accepted");
    expect(items[1].decision).toBe("pending");
    expect(canApplyDocumentation(items[1])).toBe(false);
  });

  it("suppresses exact repeated facts while preserving clinical text", () => {
    const item = toDraftItem(route("presentIllness", "low-risk", "Patient-er 3 din dhore fever, HbA1c 8.2%."), "1");
    expect(suppressDraftDuplicates([item, { ...item, id: "2" }])).toHaveLength(1);
    expect(clinicalSummary([item])).toContain("HbA1c 8.2%");
  });

  it("shows an existing-content change rather than silently overwriting it", () => {
    const item = withExistingDiff(toDraftItem(route("presentIllness", "low-risk", "Fever for 4 days"), "1"), "Fever for 3 days");
    expect(item.currentText).toBe("Fever for 3 days");
    expect(item.proposedText).toBe("Fever for 4 days");
  });

  it("keeps finalize/sign requests out of ready-to-apply", () => {
    expect(reviewLevel(route("advice", "low-risk", "finalize prescription"))).toBe("needs-review");
    expect(reviewLevel(route("advice", "low-risk", "sign"))).toBe("needs-review");
  });

  it("applies only accepted safe documentation", () => {
    const safe = toDraftItem(route("chiefComplaints", "low-risk", "Fever"), "1");
    const protectedItem = toDraftItem(route("investigation", "proposal", "CBC"), "2");
    expect(approvedDocumentation([safe, protectedItem])).toEqual([safe]);
  });
});
