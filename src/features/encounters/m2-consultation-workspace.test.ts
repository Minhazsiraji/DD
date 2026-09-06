import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { AUTOSAVE_DEBOUNCE_MS, shouldScheduleAutosave } from "./autosave-policy";
import { appendTextSuggestion } from "./text-suggestions";
import { applySaveResult } from "./draft-state";
import { emptyDraft } from "./schema";
import { MutationGate } from "./mutation-gate";

const read = (file: string) => readFileSync(path.resolve(file), "utf8");
const runtimeSource = (file: string) =>
  read(file)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");

describe("M2 autosave contract", () => {
  it("uses a bounded debounce and reschedules from the live values object", () => {
    expect(AUTOSAVE_DEBOUNCE_MS).toBe(650);
    const controller = read("src/features/encounters/components/consultation-autosave.tsx");
    expect(controller).toContain("window.setTimeout");
    expect(controller).toContain("AUTOSAVE_DEBOUNCE_MS");
    expect(controller).toMatch(/\[values, dirty, blocked, hasVitalErrors, state\.kind, save\]/);
  });

  it("schedules only a valid, dirty, unblocked draft", () => {
    expect(shouldScheduleAutosave({ dirty: true, blocked: false, hasVitalErrors: false, state: "dirty" })).toBe(true);
    expect(shouldScheduleAutosave({ dirty: false, blocked: false, hasVitalErrors: false, state: "dirty" })).toBe(false);
    expect(shouldScheduleAutosave({ dirty: true, blocked: true, hasVitalErrors: false, state: "dirty" })).toBe(false);
    expect(shouldScheduleAutosave({ dirty: true, blocked: false, hasVitalErrors: true, state: "dirty" })).toBe(false);
    expect(shouldScheduleAutosave({ dirty: true, blocked: false, hasVitalErrors: false, state: "error" })).toBe(false);
    expect(shouldScheduleAutosave({ dirty: true, blocked: false, hasVitalErrors: false, state: "conflict" })).toBe(false);
  });

  it("keeps edits made during an in-flight save dirty", () => {
    const baseline = emptyDraft();
    const sent = { ...baseline, examination: "Chest clear" };
    const current = { ...sent, examination: "Chest clear; no wheeze" };
    const applied = applySaveResult({
      sent,
      current,
      baseline,
      result: { ok: true, version: 2, savedAt: "2026-09-06T10:00:00.000Z" },
    });
    expect(applied.baseline.examination).toBe("Chest clear");
    expect(applied.state.kind).toBe("dirty");
  });

  it("serializes autosave and list writes through the existing one-at-a-time gate", async () => {
    const gate = new MutationGate();
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const first = gate.run(async () => { await held; return "notes"; });
    const second = await gate.run(async () => "list");
    expect(second).toBeNull();
    release();
    await expect(first).resolves.toBe("notes");
  });

  it("never creates a parallel server-action autosave path", () => {
    const controller = runtimeSource("src/features/encounters/components/consultation-autosave.tsx");
    expect(controller).not.toMatch(/saveConsultationAction|from\s+["'][^"']*actions["']/);
    const workspace = read("src/features/encounters/components/consultation-workspace.tsx");
    expect(workspace).toContain("save={s.save}");
    expect(workspace).toContain("onRetry={() => void s.save()}");
  });

  it("reports failure truthfully and offers Retry only after an error", () => {
    const bar = runtimeSource("src/features/encounters/components/save-bar.tsx");
    expect(bar).toContain("Not saved —");
    expect(bar).toContain("Retry save");
    expect(bar).not.toMatch(/>\s*Save notes\s*</);
    expect(bar).toMatch(/state\.kind === "error"/);
  });
});

describe("M2 low-typing and clinical boundaries", () => {
  it("a complaint suggestion changes nothing until explicitly applied", () => {
    const original = "Cough";
    expect(original).toBe("Cough");
    expect(appendTextSuggestion(original, "Fever")).toBe("Cough; Fever");
    expect(appendTextSuggestion("Fever", "fever")).toBe("Fever");
    const source = read("src/features/encounters/components/m2-clinical-notes.tsx");
    expect(source).toContain("suggestions do nothing until selected");
    expect(source).toMatch(/onClick=\{\(\) => onPick\(suggestion\)\}/);
  });

  it("does not invent structured complaint, favourites or template persistence", () => {
    const files = [
      "src/features/encounters/components/m2-clinical-notes.tsx",
      "src/features/encounters/text-suggestions.ts",
      "src/features/encounters/components/finding-form.tsx",
    ].map(runtimeSource).join("\n");
    expect(files).not.toMatch(/template_id|complaint_id|insert\(|upsert\(|\.rpc\(/i);
  });

  it("labels investigations as orders and never as results", () => {
    const workspace = read("src/features/encounters/components/consultation-workspace.tsx");
    const previous = read("src/features/encounters/components/previous-visit-card.tsx");
    expect(workspace).toContain('title="Investigation orders"');
    expect(previous).toContain("Investigations ordered");
    expect(previous).toContain("Results are not recorded");
  });

  it("keeps previous context distinct and read-only", () => {
    const previous = read("src/features/encounters/components/previous-visit-card.tsx");
    expect(previous).toContain("Previous visit");
    expect(previous).not.toMatch(/<input|<textarea/);
    const workspace = read("src/features/encounters/components/consultation-workspace.tsx");
    expect(workspace).toContain("<PreviousVisitCard");
    expect(workspace).toContain("<M2ClinicalNotes");
  });
});

describe("M2 identity, finish and prescription handoff", () => {
  it("keeps patient identity and allergy safety pinned during consultation", () => {
    const workspace = read("src/features/encounters/components/consultation-workspace.tsx");
    const identity = read("src/features/encounters/components/consultation-identity.tsx");
    expect(workspace).toMatch(/sticky top-0/);
    expect(workspace).toContain("<ConsultationIdentity");
    expect(identity).toContain("patient.patientNumber");
    expect(identity).toContain("Allergy:");
    expect(identity).toContain("No known drug allergies recorded");
    expect(identity).not.toContain(">No allergy<");
  });

  it("blocks Finish behind dirty, saving, conflict and desync states", () => {
    const workspace = read("src/features/encounters/components/consultation-workspace.tsx");
    const finish = read("src/features/encounters/components/finish-consultation.tsx");
    expect(workspace).toContain("unsaved={s.anythingUnsaved}");
    expect(workspace).toContain("blockedReason={finishBlockedReason}");
    expect(workspace).toContain("s.desynced");
    expect(workspace).toContain("s.conflict");
    expect(workspace).toContain("s.busy !== null");
    expect(workspace).toContain('s.state.kind === "error"');
    expect(finish).toContain("disabled={blocked}");
    expect(finish).toContain("disabled={busy || blocked}");
  });

  it("hands Rx off with the exact current encounter return context", () => {
    const handoff = read("src/features/prescriptions/components/open-prescription-button.tsx");
    const rx = read("src/features/prescriptions/components/prescription-composer.tsx");
    expect(handoff).toContain("const returnTo = `/consultation/${encounterId}`");
    expect(handoff).toContain("encodeURIComponent(returnTo)");
    expect(rx).toContain("<ConsultationIdentity patient={prescription.patient}");
  });

  it("Finish does not finalise a prescription", () => {
    const action = read("src/features/encounters/actions.ts");
    const start = action.indexOf("export async function finishConsultationAction");
    const end = action.indexOf("export async function saveConsultationAction", start);
    const finish = action.slice(start, end);
    expect(finish).toContain('rpc("finish_consultation"');
    expect(finish).not.toMatch(/finalize_prescription|finalise_prescription|openPrescriptionAction/);
  });
});

describe("M2 responsive and repository boundaries", () => {
  it("keeps a single-column mobile/tablet flow and a dominant desktop clinical column", () => {
    const workspace = read("src/features/encounters/components/consultation-workspace.tsx");
    const notes = read("src/features/encounters/components/m2-clinical-notes.tsx");
    const vitals = read("src/features/encounters/components/m2-vital-fields.tsx");
    expect(workspace).toContain("xl:grid-cols-[minmax(0,1fr)_340px]");
    expect(workspace).toContain("min-w-0");
    expect(notes).toContain("lg:grid-cols-2");
    expect(vitals).toContain("grid-cols-2");
    expect(vitals).toContain("lg:grid-cols-5");
    expect([notes, vitals, workspace].join("\n")).not.toMatch(/w-\[(?:[4-9]\d\d|\d{4,})px\]/);
  });

  it("keeps 44px interaction targets on new M2 controls", () => {
    for (const file of [
      "src/features/encounters/components/m2-clinical-notes.tsx",
      "src/features/encounters/components/m2-vital-fields.tsx",
      "src/features/encounters/components/save-bar.tsx",
      "src/features/encounters/components/fast-entry.tsx",
    ]) {
      expect(read(file), file).toMatch(/h-11|min-h-11/);
    }
  });

  it("preserves Seoul runtime configuration and contains no DB change in M2 source", () => {
    const config = JSON.parse(read("vercel.json"));
    expect(config.regions).toEqual(["icn1"]);
    const source = [
      "src/features/encounters/autosave-policy.ts",
      "src/features/encounters/text-suggestions.ts",
      "src/features/encounters/components/consultation-autosave.tsx",
      "src/features/encounters/components/m2-clinical-notes.tsx",
      "src/features/encounters/components/m2-vital-fields.tsx",
    ].map(runtimeSource).join("\n");
    expect(source).not.toMatch(/service_role|CREATE TABLE|ALTER TABLE|CREATE INDEX|DROP TABLE/i);
  });
});
