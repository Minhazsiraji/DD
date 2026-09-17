import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { AutopilotPrescription } from "./contracts";
import type { MedicineRow } from "@/features/prescriptions/schema";
import {
  applyableInvestigations,
  duplicateMedicineDecision,
  incompleteMedicineReason,
  investigationKey,
  medicineExactKey,
  medicineIdentity,
  storedMedicineExactKey,
} from "./apply";

const files = {
  apply: readFileSync(new URL("./apply.ts", import.meta.url), "utf8"),
  server: readFileSync(new URL("./apply-server.ts", import.meta.url), "utf8"),
  ui: readFileSync(new URL("./components/m6c2-autopilot-panel.tsx", import.meta.url), "utf8"),
  composer: readFileSync(new URL("../prescriptions/components/prescription-composer.tsx", import.meta.url), "utf8"),
  generation: readFileSync(new URL("./server.ts", import.meta.url), "utf8"),
};

function med(overrides: Partial<AutopilotPrescription["medicines"][number]> = {}) {
  return {
    medicineReferenceId: null, displayName: "DemoMed", brandName: "DemoMed",
    genericName: "Demo Generic", strengthText: "10 mg", doseText: "1 tablet",
    dosageForm: "Tablet", route: "Oral", scheduleText: "Twice daily", durationText: "5 days",
    quantityText: null, foodRelation: null, instructions: null, isPrn: false,
    substitutionAllowed: true, needsReview: [], sourceRefs: [{ kind: "consultation" as const, ref: "medicine" }],
    ...overrides,
  };
}

function row(overrides: Partial<MedicineRow> = {}): MedicineRow {
  return {
    id: "11111111-1111-4111-8111-111111111111", display_name: "DemoMed",
    brand_name: "DemoMed", generic_name: "Demo Generic", strength_text: "10 mg",
    dose_text: "1 tablet", dosage_form: "Tablet", route: "Oral", schedule_text: "Twice daily",
    duration_text: "5 days", quantity_text: null, food_relation: null, instructions: null,
    is_prn: false, substitution_allowed: true, position: 1, ...overrides,
  };
}

function proposal(investigations: AutopilotPrescription["investigations"] = []): AutopilotPrescription {
  return {
    type: "AUTOPILOT_PRESCRIPTION", schemaVersion: 1, status: "PROPOSAL", medicines: [],
    investigations, advice: [], followUp: { date: null, intervalText: null, note: null, needsReview: [], sourceRefs: [] },
    warnings: [], uncertainties: [], context: {
      doctorId: "22222222-2222-4222-8222-222222222222", encounterId: "33333333-3333-4333-8333-333333333333",
      patientId: "44444444-4444-4444-8444-444444444444", practiceLocationId: "55555555-5555-4555-8555-555555555555",
      prescriptionId: "66666666-6666-4666-8666-666666666666", encounterVersion: 3, prescriptionVersion: 7,
    },
  };
}
describe("M6C2 proposal validation", () => {
  it("accepts a complete medicine", () => expect(incompleteMedicineReason(med())).toBeNull());
  it("blocks missing medicine name", () => expect(incompleteMedicineReason(med({ displayName: null }))).toMatch(/name/i));
  it("blocks missing dose", () => expect(incompleteMedicineReason(med({ doseText: null }))).toMatch(/dose/i));
  it("blocks numeric-only dose", () => expect(incompleteMedicineReason(med({ doseText: "1" }))).toMatch(/unit/i));
  it("accepts Bangla dose wording", () => expect(incompleteMedicineReason(med({ doseText: "১ ট্যাবলেট" }))).toBeNull());
  it("blocks missing dosage form", () => expect(incompleteMedicineReason(med({ dosageForm: null }))).toMatch(/form/i));
  it("blocks missing route", () => expect(incompleteMedicineReason(med({ route: null }))).toMatch(/route/i));
  it("blocks missing frequency", () => expect(incompleteMedicineReason(med({ scheduleText: null }))).toMatch(/frequency/i));
  it("blocks missing duration", () => expect(incompleteMedicineReason(med({ durationText: null }))).toMatch(/duration/i));
  it("blocks unresolved medicine uncertainty", () => expect(incompleteMedicineReason(med({ needsReview: ["Check dose"] }))).toMatch(/uncertainties/i));

  it("skips exact duplicate medicine", () => expect(duplicateMedicineDecision(med(), [row()])).toBe("skip-exact"));
  it("surfaces same-medicine conflicting directions", () => expect(duplicateMedicineDecision(med({ doseText: "2 tablets" }), [row()])).toBe("conflict"));
  it("appends a distinct medicine", () => expect(duplicateMedicineDecision(med({ displayName: "OtherMed" }), [row()])).toBe("append"));
  it("normalizes medicine identity", () => expect(medicineIdentity({ displayName: " DemoMed ", strengthText: "10 MG", dosageForm: "TABLET" })).toBe("demomed|10 mg|tablet"));
  it("matches stored/proposed exact keys", () => expect(medicineExactKey(med())).toBe(storedMedicineExactKey(row())));
});
describe("M6C2 investigation safety", () => {
  const current = { name: "CBC", note: null, needsReview: [], sourceRefs: [{ kind: "consultation" as const, ref: "assessment" }] };
  const history = { ...current, sourceRefs: [{ kind: "investigation" as const, ref: "old-result" }] };
  const uncertain = { ...current, needsReview: ["Confirm test"] };

  it("allows only current-consultation investigation proposals", () => expect(applyableInvestigations(proposal([current]))).toHaveLength(1));
  it("does not auto-apply investigation history", () => expect(applyableInvestigations(proposal([history]))).toHaveLength(0));
  it("does not auto-apply unresolved investigations", () => expect(applyableInvestigations(proposal([uncertain]))).toHaveLength(0));
  it("normalizes investigation duplicate keys", () => expect(investigationKey(" CBC ", " FBC ")).toBe("cbc|fbc"));
  it("server rejects history-only investigation provenance", () => expect(files.server).toContain("Investigation history is context only"));
  it("server requires investigation uncertainty resolution", () => expect(files.server).toContain("Resolve investigation names and uncertainties"));
});

describe("M6C2 exact write boundary", () => {
  it("generation remains the M6C1 mock-only zero-write action", () => {
    expect(files.generation).toContain("new MockAutopilotProvider()");
    expect(files.generation).not.toMatch(/addMedicineAction|saveConsultationAction|confirmInvestigationsAction/);
  });
  it("UI generates before any Apply call", () => expect(files.ui.indexOf("generateAutopilotPrescriptionProposalAction")).toBeLessThan(files.ui.indexOf("applyAutopilotProposalToDraftAction")));
  it("proposal is reviewable/editable before Apply", () => expect(files.ui).toContain("data-m6c2-proposal-review"));
  it("Discard is explicit", () => expect(files.ui).toContain("Discard"));
  it("Apply is explicit", () => expect(files.ui).toContain("Apply to Draft"));
  it("mandatory AI review wording is present", () => expect(files.apply).toContain("AI-generated proposal — review before applying"));
  it("does not import or call finalization", () => expect(files.server + files.ui).not.toMatch(/finalizePrescriptionAction|finalize_prescription/));
  it("keeps the existing M3 Review link separate", () => expect(files.composer).toContain("Review prescription"));
});
describe("M6C2 authority and stale protection", () => {
  it("requires doctor role", () => expect(files.server).toContain('ctx.roles.includes("DOCTOR")'));
  it("revalidates doctor identity", () => expect(files.server).toContain("Doctor authority no longer matches"));
  it("revalidates patient and location", () => expect(files.server).toContain("The patient or location no longer matches"));
  it("requires editable DRAFT prescription", () => expect(files.server).toContain('prescription.status !== "DRAFT"'));
  it("checks encounter version", () => expect(files.server).toContain("consultation.version !== proposal.context.encounterVersion"));
  it("checks prescription version", () => expect(files.server).toContain("prescription.version !== proposal.context.prescriptionVersion"));
  it("fails stale context closed", () => expect(files.server).toContain('reason: "stale-context"'));
  it("preserves existing medicine content instead of overwriting", () => expect(files.server).toContain("Review the collision instead of overwriting it"));
  it("requires explicit replacement for a conflicting follow-up before writes", () => {
    expect(files.server.indexOf("followUpConflictsBeforeWrite")).toBeLessThan(files.server.indexOf("addMedicineAction({"));
    expect(files.server).toContain("!replaceFollowUp");
  });
  it("blocks unresolved follow-up", () => expect(files.server).toContain("Resolve follow-up uncertainty before applying"));
});

describe("M6C2 idempotency, language and responsive surface", () => {
  it("detects already-applied proposals on stale retry", () => expect(files.server).toContain("fullProposalAlreadyApplied"));
  it("passes apply key to investigation operation idempotency", () => expect(files.server).toContain("operationKey: applyKey"));
  it("uses existing M3 medicine write", () => expect(files.server).toContain("addMedicineAction({"));
  it("preserves existing advice while appending", () => expect(files.server).toContain("[existing.trim(), ...additions]"));
  it("supports English proposal text", () => expect(incompleteMedicineReason(med({ instructions: "Take after food" }))).toBeNull());
  it("supports Bangla proposal text", () => expect(incompleteMedicineReason(med({ instructions: "খাবারের পরে খাবেন" }))).toBeNull());
  it("supports Banglish proposal text", () => expect(incompleteMedicineReason(med({ instructions: "khabar por khaben" }))).toBeNull());
  it("declares mock mode in UI", () => expect(files.ui).toContain('data-ai-mode="mock"'));
  it("does not activate OpenAI or Deepgram", () => expect((files.generation + files.server).toLowerCase()).not.toMatch(/openai|deepgram/));
  it("uses 44px-equivalent minimum action targets", () => expect(files.ui).toContain("min-h-11"));
  it("guards horizontal overflow with min-width zero", () => expect(files.ui).toContain("min-w-0"));
});

describe("M6C2 uncertainty acknowledgement", () => {
  it("requires explicit acknowledgement of proposal-level uncertainties", () => {
    expect(files.server).toContain("Review and acknowledge proposal uncertainties before applying");
    expect(files.ui).toContain("I reviewed these uncertainties / missing details.");
  });
});
