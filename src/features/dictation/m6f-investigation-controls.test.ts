import { describe, expect, it } from "vitest";
import { parseM6FInvestigationCommand } from "./m6f-investigation-controls";

describe("M6F investigation controls", () => {
  it("targets search, staged, and confirmed editors", () => {
    expect(parseM6FInvestigationCommand("investigation search")).toEqual({ type: "TARGET", target: "search", index: null });
    expect(parseM6FInvestigationCommand("open staged investigation note 2")).toEqual({ type: "TARGET", target: "stagedNote", index: 2 });
    expect(parseM6FInvestigationCommand("confirmed investigation title 1 open")).toEqual({ type: "TARGET", target: "confirmedTitle", index: 1 });
  });

  it("can stage search text but never executes confirmation", () => {
    expect(parseM6FInvestigationCommand("search investigation CBC")).toEqual({ type: "SET_SEARCH", value: "CBC" });
    expect(parseM6FInvestigationCommand("confirm investigations")).toEqual({ type: "PROTECTED_CONFIRM" });
  });
});
