import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { AutopilotPrescription, AutopilotProvider, BoundAutopilotContext } from "./contracts";
import { generateAutopilotPrescription } from "./engine";
import { MockAutopilotProvider } from "./mock-provider";

const ids = {
  user: "11111111-1111-4111-8111-111111111111",
  doctor: "22222222-2222-4222-8222-222222222222",
  location: "33333333-3333-4333-8333-333333333333",
  patient: "44444444-4444-4444-8444-444444444444",
  encounter: "55555555-5555-4555-8555-555555555555",
  draft: "66666666-6666-4666-8666-666666666666",
  investigation: "77777777-7777-4777-8777-777777777777",
  medicine: "88888888-8888-4888-8888-888888888888",
};

function context(overrides: Partial<BoundAutopilotContext> = {}): BoundAutopilotContext {
  return {
    actor: { userId: ids.user },
    doctor: { doctorId: ids.doctor, userId: ids.user },
    practice: { locationId: ids.location, locationName: "Synthetic Clinic" },
    patient: { patientId: ids.patient },
    encounter: {
      encounterId: ids.encounter,
      patientId: ids.patient,
      practiceLocationId: ids.location,
      status: "DRAFT",
      version: 3,
      consultationText: { advice: "Rest and hydrate", nextVisitOn: "2026-09-25" },
      investigations: [{ id: ids.investigation, name: "CBC", note: "Synthetic only" }],
    },    draft: {
      prescriptionId: ids.draft,
      encounterId: ids.encounter,
      patientId: ids.patient,
      practiceLocationId: ids.location,
      status: "DRAFT",
      version: 7,
      items: [{ id: ids.medicine, displayName: "SyntheticMed", brandName: "SyntheticMed", genericName: "Synthetic Generic", strengthText: "10 mg", doseText: null, dosageForm: "Tablet", route: null, scheduleText: null, durationText: null, quantityText: null, foodRelation: null, instructions: null, isPrn: false, substitutionAllowed: true }],
    },
    medicineReferences: [{
      id: ids.medicine,
      displayName: "SyntheticMed",
      genericName: "Synthetic Generic",
      brandName: "SyntheticMed",
      strengthText: "10 mg",
      dosageForm: "Tablet",
    }],
    ...overrides,
  };
}

function proposalFor(ctx: BoundAutopilotContext): AutopilotPrescription {
  return {
    type: "AUTOPILOT_PRESCRIPTION" as const,
    schemaVersion: 1 as const,
    status: "NEEDS_REVIEW" as const,
    medicines: [], investigations: [], advice: [],
    followUp: { date: null, intervalText: null, note: null, needsReview: [], sourceRefs: [] },
    warnings: [], uncertainties: ["Synthetic needs review"],
    context: {
      doctorId: ctx.doctor.doctorId,
      encounterId: ctx.encounter.encounterId,
      patientId: ctx.patient.patientId,
      practiceLocationId: ctx.practice.locationId,      prescriptionId: ctx.draft?.prescriptionId ?? null,
      encounterVersion: ctx.encounter.version,
      prescriptionVersion: ctx.draft?.version ?? null,
    },
  };
}

function providerReturning(value: unknown): AutopilotProvider {
  return { id: "test", generate: vi.fn(async () => value) };
}

describe("M6C1 Autopilot prescription engine", () => {
  it("returns a valid structured proposal from the deterministic mock provider", async () => {
    const result = await generateAutopilotPrescription(context(), new MockAutopilotProvider());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.proposal.type).toBe("AUTOPILOT_PRESCRIPTION");
    expect(result.proposal.investigations).toEqual([]);
    expect(result.proposal.advice[0]?.text).toBe("Rest and hydrate");
    expect(result.proposal.followUp.date).toBe("2026-09-25");
  });

  it("does not infer new investigation necessity from existing encounter investigation rows", async () => {
    const result = await generateAutopilotPrescription(context(), new MockAutopilotProvider());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.proposal.investigations).toEqual([]);
  });

  it("turns incomplete consultation context into structured uncertainty", async () => {
    const ctx = context({
      encounter: { ...context().encounter, consultationText: {}, investigations: [] },
    });
    const result = await generateAutopilotPrescription(ctx, new MockAutopilotProvider());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.proposal.status).toBe("NEEDS_REVIEW");
    expect(result.proposal.uncertainties.length).toBeGreaterThan(0);
  });
  it("keeps ambiguous medicine data in needs-review state", async () => {
    const ctx = context();
    const value = proposalFor(ctx);
    value.medicines = [{
      medicineReferenceId: null,
      displayName: "SyntheticMed",
      brandName: null,
      genericName: null,
      strengthText: null,
      doseText: null,
      dosageForm: null,
      route: null,
      scheduleText: null,
      durationText: null,
      quantityText: null,
      foodRelation: null,
      instructions: null,
      isPrn: null,
      substitutionAllowed: null,
      needsReview: ["Medicine match is ambiguous."],
      sourceRefs: [{ kind: "consultation" as const, ref: "medicines" }],
    }];
    const result = await generateAutopilotPrescription(ctx, providerReturning(value));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.proposal.medicines[0]?.medicineReferenceId).toBeNull();
    expect(result.proposal.medicines[0]?.needsReview).toContain("Medicine match is ambiguous.");
  });

  it("does not invent missing dose, frequency, route, or duration", async () => {
    const ctx = context();
    const value = proposalFor(ctx);    value.medicines = [{
      medicineReferenceId: ids.medicine,
      displayName: "SyntheticMed",
      brandName: "SyntheticMed",
      genericName: "Synthetic Generic",
      strengthText: "10 mg",
      doseText: null,
      dosageForm: "Tablet",
      route: null,
      scheduleText: null,
      durationText: null,
      quantityText: null,
      foodRelation: null,
      instructions: null,
      isPrn: null,
      substitutionAllowed: null,
      needsReview: ["Dose, frequency, route and duration were not explicitly supplied."],
      sourceRefs: [{ kind: "medicine_reference", ref: ids.medicine }],
    }];
    const result = await generateAutopilotPrescription(ctx, providerReturning(value));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const medicine = result.proposal.medicines[0];
    expect(medicine?.doseText).toBeNull();
    expect(medicine?.scheduleText).toBeNull();
    expect(medicine?.route).toBeNull();
    expect(medicine?.durationText).toBeNull();
  });

  it("rejects wrong patient and encounter binding before provider generation", async () => {
    const ctx = context({ encounter: { ...context().encounter, patientId: ids.doctor } });
    const provider = providerReturning(proposalFor(context()));
    const result = await generateAutopilotPrescription(ctx, provider);    expect(result).toMatchObject({ ok: false, reason: "binding-rejected" });
    expect(provider.generate).not.toHaveBeenCalled();
  });

  it("rejects unauthorized actor before provider generation", async () => {
    const ctx = context({ actor: { userId: ids.patient } });
    const provider = providerReturning(proposalFor(context()));
    const result = await generateAutopilotPrescription(ctx, provider);
    expect(result).toMatchObject({ ok: false, reason: "binding-rejected" });
    expect(provider.generate).not.toHaveBeenCalled();
  });

  it("rejects a finalized prescription context", async () => {
    const raw = context() as unknown as Record<string, unknown>;
    raw.draft = { ...(context().draft as object), status: "FINALIZED" };
    const provider = providerReturning(proposalFor(context()));
    const result = await generateAutopilotPrescription(raw, provider);
    expect(result).toMatchObject({ ok: false, reason: "invalid-context" });
    expect(provider.generate).not.toHaveBeenCalled();
  });

  it("rejects stale draft proposal versions", async () => {
    const ctx = context();
    const value = proposalFor(ctx);
    value.context.prescriptionVersion = 6;
    const result = await generateAutopilotPrescription(ctx, providerReturning(value));
    expect(result).toMatchObject({ ok: false, reason: "binding-rejected" });
  });

  it("fails closed on malformed provider output and unknown fields", async () => {
    const ctx = context();
    expect(await generateAutopilotPrescription(ctx, providerReturning({ nope: true })))
      .toMatchObject({ ok: false, reason: "malformed-provider-output" });    const withUnknown = { ...proposalFor(ctx), secretWrite: true };
    expect(await generateAutopilotPrescription(ctx, providerReturning(withUnknown)))
      .toMatchObject({ ok: false, reason: "malformed-provider-output" });
  });

  it("is deterministic and tolerates English, Bangla and Banglish context text", async () => {
    for (const advice of [
      "Take adequate rest",
      "পর্যাপ্ত বিশ্রাম নিন",
      "Pani beshi khaben ebong rest niben",
    ]) {
      const ctx = context({ encounter: { ...context().encounter, consultationText: { advice } } });
      const provider = new MockAutopilotProvider();
      const first = await generateAutopilotPrescription(ctx, provider);
      const second = await generateAutopilotPrescription(ctx, provider);
      expect(first).toEqual(second);
      expect(first.ok).toBe(true);
    }
  });

  it("has no clinical mutation or finalize capability in the M6C1 generation surface", () => {
    const engineSource = readFileSync(new URL("./engine.ts", import.meta.url), "utf8");
    const serverSource = readFileSync(new URL("./server.ts", import.meta.url), "utf8");
    const source = `${engineSource}\n${serverSource}`;
    expect(source).not.toMatch(/\.insert\s*\(/);
    expect(source).not.toMatch(/\.update\s*\(/);
    expect(source).not.toMatch(/\.delete\s*\(/);
    expect(source).not.toMatch(/finalizePrescription|finalize.*Action|apply.*Draft/i);
  });

  it("generation does not mutate the verified context", async () => {
    const ctx = context();
    const before = structuredClone(ctx);
    await generateAutopilotPrescription(ctx, new MockAutopilotProvider());
    expect(ctx).toEqual(before);
  });
});
