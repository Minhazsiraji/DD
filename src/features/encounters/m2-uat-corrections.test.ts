import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(path.resolve(file), "utf8");

describe("M2 UAT material reconciliation", () => {
  it("uses the shared DD profile-summary primitive for consultation identity", () => {
    const identity = read("src/features/encounters/components/consultation-identity.tsx");
    expect(identity).toContain("dd-material-clinical dd-profile-summary");
    expect(identity).toContain("bg-danger-soft");
    expect(identity).toContain("border-l-danger");
    expect(identity).not.toContain("bg-info-soft/65");
  });

  it("keeps previous context secondary with one shared pearl panel and unblurred records", () => {
    const previous = read("src/features/encounters/components/previous-visit-card.tsx");
    expect(previous).toContain("dd-material-panel dd-panel-pearl dd-panel-rim");
    expect(previous).toContain("dd-material-record dd-record-pearl");
    expect(previous).not.toMatch(/backdrop-blur|backdrop-filter/);
    expect(previous).not.toContain("clinical-surface rounded-glass");
  });
});

describe("M2 UAT autosave status clarity", () => {
  it("renders explicit waiting, saving, saved, failed and conflict lifecycle copy", () => {
    const bar = read("src/features/encounters/components/save-bar.tsx");
    expect(bar).toContain("data-save-state={state.kind}");
    expect(bar).toContain("Pending save —");
    expect(bar).toContain("Saving…");
    expect(bar).toContain("All changes saved at");
    expect(bar).toContain('text: "All changes saved"');
    expect(bar).toContain("Not saved —");
    expect(bar).toContain("choose which version to keep");
  });

  it("still retries only through the existing workspace save coordinator", () => {
    const workspace = read("src/features/encounters/components/consultation-workspace.tsx");
    const autosave = read("src/features/encounters/components/consultation-autosave.tsx");
    expect(workspace).toContain("save={s.save}");
    expect(workspace).toContain("onRetry={() => void s.save()}");
    expect(autosave).not.toMatch(/saveConsultationAction|from\s+["'][^"']*actions["']/);
  });
});

describe("M2 targeted interaction render containment", () => {
  it("memoizes static identity and historical context outside the keystroke render path", () => {
    const identity = read("src/features/encounters/components/consultation-identity.tsx");
    const previous = read("src/features/encounters/components/previous-visit-card.tsx");
    expect(identity).toContain("React.memo(function ConsultationIdentity");
    expect(previous).toContain("React.memo(function PreviousVisitCard");
  });

  it("does not change the single encounter state/mutation coordinator for the optimization", () => {
    const workspace = read("src/features/encounters/components/consultation-workspace.tsx");
    const hook = read("src/features/encounters/use-consultation.ts");
    expect(workspace).toContain("const s = useConsultation(consultation)");
    expect(hook).toContain("const gateRef = React.useRef(new MutationGate())");
    expect(hook).toMatch(/setValues\(\(prev\) => \(\{ \.\.\.prev, \[key\]: value \}\)\)/);
  });
});
