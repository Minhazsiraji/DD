import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  COMMON_INVESTIGATIONS,
  addStagedInvestigation,
  confirmationButtonLabel,
  hasExactInvestigationChoice,
  removeStagedInvestigation,
  searchInvestigationChoices,
  snapshotStagedInvestigations,
  stagingIsConfirmable,
  updateStagedInvestigation,
  type LocalStagedInvestigation,
} from "./investigation-v1-ui";

const read = (file: string) => readFileSync(path.resolve(file), "utf8");
const runtimeSource = (file: string) =>
  read(file)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");

function gitBlobSha(file: string): string {
  const content = readFileSync(path.resolve(file));
  return createHash("sha1")
    .update(Buffer.from(`blob ${content.length}\0`))
    .update(content)
    .digest("hex");
}

const initial: LocalStagedInvestigation[] = [];

describe("Investigation V1 local staging", () => {
  it("Common adds locally only", () => {
    const added = addStagedInvestigation(initial, { name: "CBC", note: null }, "one");
    expect(added.rows).toEqual([{ localId: "one", name: "CBC", note: null }]);
    expect(COMMON_INVESTIGATIONS).toContain("CBC");
  });

  it("Recent wording can enter the same local staging function", () => {
    const added = addStagedInvestigation(initial, { name: "Serum Ferritin", note: null }, "recent");
    expect(added.rows[0]?.name).toBe("Serum Ferritin");
  });

  it("custom text adds locally without persistence", () => {
    const added = addStagedInvestigation(initial, { name: " D-dimer ", note: null }, "custom");
    expect(added.rows[0]?.name).toBe("D-dimer");
  });

  it("edits an optional note before confirmation", () => {
    const rows = [{ localId: "one", name: "CBC", note: null }];
    const updated = updateStagedInvestigation(rows, "one", { note: "Repeat fasting" });
    expect(updated.rows[0]?.note).toBe("Repeat fasting");
  });

  it("removes a staged row locally", () => {
    const rows = [{ localId: "one", name: "CBC", note: null }];
    expect(removeStagedInvestigation(rows, "one")).toEqual([]);
  });

  it("warns and refuses an exact duplicate name plus note", () => {
    const rows = [{ localId: "one", name: "CBC", note: "Morning" }];
    const duplicate = addStagedInvestigation(rows, { name: " cbc ", note: " morning " }, "two");
    expect(duplicate.duplicate).toBe(true);
    expect(duplicate.rows).toBe(rows);
  });

  it("does not merge the same name when the note differs", () => {
    const rows = [{ localId: "one", name: "CBC", note: "Morning" }];
    const second = addStagedInvestigation(rows, { name: "CBC", note: "After 6 hours" }, "two");
    expect(second.duplicate).toBe(false);
    expect(second.rows).toHaveLength(2);
  });

  it("blocks confirmation when a staged name is blank", () => {
    expect(stagingIsConfirmable([{ localId: "one", name: "   ", note: null }])).toBe(false);
  });

  it("snapshots the exact staged payload without local ids", () => {
    const rows = [{ localId: "one", name: " CBC ", note: " note " }];
    expect(snapshotStagedInvestigations(rows)).toEqual([{ name: "CBC", note: "note" }]);
  });

  it("uses grammatically correct confirmation counts", () => {
    expect(confirmationButtonLabel(1)).toBe("Confirm 1 investigation");
    expect(confirmationButtonLabel(3)).toBe("Confirm 3 investigations");
  });
});

describe("Investigation V1 accelerators", () => {
  const recent = [
    { name: "Serum Ferritin", lastUsedAt: "2026-09-08T10:00:00Z", usageCount: 3 },
    { name: "CBC", lastUsedAt: "2026-09-07T10:00:00Z", usageCount: 9 },
  ];

  it("searches Common and Recent lexically", () => {
    const names = searchInvestigationChoices(recent, "ser").map((row) => row.name);
    expect(names).toContain("Serum Creatinine");
    expect(names).toContain("Serum Ferritin");
  });

  it("does not duplicate Common wording inside search results", () => {
    const cbc = searchInvestigationChoices(recent, "cbc");
    expect(cbc.filter((row) => row.name.toLowerCase() === "cbc")).toHaveLength(1);
  });

  it("detects an exact search choice before offering custom text", () => {
    const choices = searchInvestigationChoices(recent, "CBC");
    expect(hasExactInvestigationChoice(choices, " cbc ")).toBe(true);
  });

  it("does not expose a clinical synonym or ranking engine", () => {
    const helper = runtimeSource("src/features/encounters/investigation-v1-ui.ts");
    expect(helper).not.toMatch(/synonym|recommendationScore|clinicalRank|AI/i);
  });
});

describe("Investigation V1 authority and unknown-outcome contracts", () => {
  const panel = () => runtimeSource("src/features/encounters/components/investigation-panel.tsx");
  const workspace = () => runtimeSource("src/features/encounters/components/consultation-workspace.tsx");

  it("removes the legacy immediate Investigation write path from the consultation workspace", () => {
    expect(workspace()).not.toMatch(/addInvestigationAction|updateInvestigationAction|removeInvestigationAction/);
    expect(workspace()).toContain("<InvestigationPanel");
  });

  it("confirmation uses the accepted batch action through the existing runList coordinator", () => {
    expect(panel()).toContain("confirmInvestigationsAction");
    expect(panel()).toMatch(/runList\(\s*["']investigation["']/);
  });

  it("creates one UUID operation key for a new deliberate confirmation", () => {
    const source = panel();
    const start = source.indexOf("async function confirmStaged");
    const end = source.indexOf("async function retryUnknownConfirmation", start);
    const confirm = source.slice(start, end);
    expect(confirm.match(/crypto\.randomUUID\(\)/g)).toHaveLength(1);
  });

  it("unknown outcome stores operation key, expected version and exact payload together", () => {
    const source = panel();
    expect(source).toContain("operationKey,");
    expect(source).toContain("expectedVersion,");
    expect(source).toContain("investigations: payload");
    expect(source).toContain("onUnknownChange({");
  });

  it("unknown outcome does not clear staged rows or announce success", () => {
    const source = panel();
    const start = source.indexOf('backendResult.kind === "write-unconfirmed"');
    const end = source.indexOf("onUnknownChange(null)", start);
    const branch = source.slice(start, end);
    expect(branch).not.toContain("onStagedChange([])");
    expect(branch).not.toContain('setConfirmationTone("success")');
  });

  it("retry reuses the exact operation key, version and payload", () => {
    const source = panel();
    const start = source.indexOf("async function retryUnknownConfirmation");
    const retry = source.slice(start);
    expect(retry).toContain("expectedVersion: unknown.expectedVersion");
    expect(retry).toContain("operationKey: unknown.operationKey");
    expect(retry).toContain("investigations: unknown.investigations");
    expect(retry).not.toContain("crypto.randomUUID()");
  });

  it("retry reconciles first and then uses the same MutationGate path", () => {
    const source = panel();
    const start = source.indexOf("async function retryUnknownConfirmation");
    const retry = source.slice(start);
    expect(retry.indexOf("await retrySync()")).toBeGreaterThan(-1);
    expect(retry.indexOf('runList(\n      "investigation"')).toBeGreaterThan(retry.indexOf("await retrySync()"));
  });

  it("successful authoritative confirmation is the only path that clears staging", () => {
    const source = panel();
    expect(source).toContain("if (backendResult.ok)");
    expect(source).toContain("onStagedChange([])");
    expect(read("src/features/encounters/investigation-v1-actions.ts")).toContain("const server = await getServerState");
  });

  it("failed authoritative reread stays write-unconfirmed", () => {
    const action = read("src/features/encounters/investigation-v1-actions.ts");
    expect(action).toMatch(/if \(!server \|\| server\.version < confirmation\.resultVersion\)/);
    expect(action).toContain('kind: "write-unconfirmed"');
  });

  it("stale-version conflict is handed to the existing consultation conflict model", () => {
    const source = panel();
    expect(source).toContain('kind: "conflict"');
    expect(source).toContain("server: result.server");
    expect(workspace()).toContain("<FindingConflictPanel");
  });

  it("Diagnosis remains on the frozen FindingList workflow", () => {
    const source = workspace();
    expect(source).toContain('kind="diagnosis"');
    expect(source).toContain("addDiagnosisAction");
    expect(source).toContain("updateDiagnosisAction");
    expect(source).toContain("removeDiagnosisAction");
  });

  it("confirmed Investigation rows expose no normal edit/remove clinical path", () => {
    const source = panel();
    const start = source.indexOf('aria-labelledby="confirmed-investigation-heading"');
    const end = source.indexOf("Previous Investigation history", start);
    const confirmed = source.slice(start, end);
    expect(confirmed).not.toMatch(/Edit|Remove|onOpenEdit|onAskRemove/);
    expect(confirmed).toContain("Ordered");
  });

  it("completed/cancelled consultations expose no staging or confirmation controls", () => {
    const source = panel();
    expect(source).toContain("{readOnly ? null : (");
    expect(source).toContain("Staged for confirmation");
    expect(source).toContain("confirmStaged");
  });
});

describe("Investigation V1 reads, accessibility and responsive structure", () => {
  const panel = () => read("src/features/encounters/components/investigation-panel.tsx");

  it("Recent failure state does not mutate staging", () => {
    const source = panel();
    const start = source.indexOf("loadRecentInvestigationsAction().then");
    const end = source.indexOf("return () =>", start);
    expect(source.slice(start, end)).not.toContain("onStagedChange");
  });

  it("patient history failure state does not mutate staging", () => {
    const source = panel();
    const start = source.indexOf("loadPatientInvestigationHistoryAction(patientId).then");
    const end = source.indexOf("return () =>", start);
    expect(source.slice(start, end)).not.toContain("onStagedChange");
  });

  it("renders patient history with investigation, note, time, location and ordering Doctor when present", () => {
    const source = panel();
    expect(source).toContain("row.investigationName");
    expect(source).toContain("row.note");
    expect(source).toContain("row.orderedAt");
    expect(source).toContain("row.practiceLocationName");
    expect(source).toContain("row.orderingDoctorName");
  });

  it("does not chamber-truncate Recent on the client", () => {
    const source = panel();
    expect(source).not.toMatch(/practiceLocation.*recent|recent.*practiceLocation/i);
    expect(read("src/features/encounters/investigation-v1-queries.ts")).toContain("There is intentionally no active-location parameter");
  });

  it("keeps the future AI proposal boundary at local staging and has no provider integration", () => {
    const source = runtimeSource("src/features/encounters/components/investigation-panel.tsx");
    expect(source).not.toMatch(/openai|deepgram|provider|speech-to-text|recommend.*investigation/i);
    expect(source).toContain("addStagedInvestigation");
  });

  it("has no keyboard shortcut that confirms a clinical order", () => {
    const source = panel();
    const keyHandlerStart = source.indexOf("function handleSearchKeyDown");
    const keyHandlerEnd = source.indexOf("async function confirmStaged", keyHandlerStart);
    const keys = source.slice(keyHandlerStart, keyHandlerEnd);
    expect(keys).toContain('event.key === "Enter"');
    expect(keys).toContain("addFromSearch");
    expect(keys).not.toContain("confirmStaged");
  });

  it("uses practical 44px touch targets and single-column-safe controls", () => {
    const source = panel();
    expect(source).toMatch(/min-h-11|h-11/);
    expect(source).toContain("w-full");
    expect(source).toContain("sm:w-auto");
    expect(source).toContain("min-w-0");
    expect(source).not.toMatch(/w-\[(?:[4-9]\d\d|\d{4,})px\]/);
  });

  it("provides labelled search, listbox semantics, live states and named buttons", () => {
    const source = panel();
    expect(source).toContain('htmlFor="investigation-search"');
    expect(source).toContain('role="listbox"');
    expect(source).toContain('role="option"');
    expect(source).toContain('aria-live="assertive"');
    expect(source).toContain("focus-visible:focus-ring");
    expect(source).not.toMatch(/aria-label={`(?:Edit|Remove) investigation/);
  });

  it("keeps Previous Investigation history collapsed behind an explicit control", () => {
    const source = panel();
    expect(source).toContain("historyOpen");
    expect(source).toContain('aria-expanded={historyOpen}');
    expect(source).toContain("Previous Investigation history");
  });

  it("leaves the frozen Prescription/global print surfaces byte-identical", () => {
    expect(gitBlobSha("src/app/globals.css")).toBe("9e5d07175e729f142b4cff5574ded5af5a61bdbf");
    expect(gitBlobSha("src/features/prescriptions/components/print-sheet.tsx")).toBe("0b8afc336ff27faa0a33eaf22f6a8eac1b236c36");
  });
});
