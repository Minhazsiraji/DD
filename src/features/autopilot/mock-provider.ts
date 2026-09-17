import type { AutopilotPrescription, AutopilotProvider, BoundAutopilotContext } from "./contracts";

function textValues(context: BoundAutopilotContext): string[] {
  return Object.values(context.encounter.consultationText).map((value) => value.trim()).filter(Boolean);
}

function explicitFollowUp(context: BoundAutopilotContext): { date: string | null; note: string | null } {
  const date = context.encounter.consultationText.nextVisitOn?.trim() ?? "";
  const note = context.encounter.consultationText.nextVisitNote?.trim() ?? "";
  return {
    date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null,
    note: note || null,
  };
}

function explicitAdvice(context: BoundAutopilotContext): string | null {
  const advice = context.encounter.consultationText.advice?.trim() ?? "";
  return advice || null;
}

/**
 * Deterministic synthetic provider. It deliberately does not interpret medical
 * convention. It only echoes already-explicit structured consultation facts.
 */
export class MockAutopilotProvider implements AutopilotProvider {
  readonly id = "mock-autopilot-v1";

  async generate(context: BoundAutopilotContext): Promise<AutopilotPrescription> {
    const followUp = explicitFollowUp(context);
    const advice = explicitAdvice(context);
    const hasClinicalText = textValues(context).length > 0;
    const uncertainties: string[] = [];

    if (!hasClinicalText) uncertainties.push("Consultation context is incomplete; clinical proposals require doctor review.");
    if (!followUp.date && !followUp.note) uncertainties.push("No explicit follow-up plan is present in the consultation context.");

    return {
      type: "AUTOPILOT_PRESCRIPTION",
      schemaVersion: 1,
      status: uncertainties.length ? "NEEDS_REVIEW" : "PROPOSAL",
      medicines: [],
      investigations: context.encounter.investigations.map((investigation) => ({
        name: investigation.name || null,
        note: investigation.note,
        needsReview: [],
        sourceRefs: [{ kind: "investigation", ref: investigation.id }],
      })),
      advice: advice
        ? [{ text: advice, sourceRefs: [{ kind: "consultation", ref: "advice" }] }]
        : [],
      followUp: {
        date: followUp.date,
        intervalText: null,
        note: followUp.note,
        needsReview: followUp.date || followUp.note ? [] : ["Follow-up was not explicitly supplied."],
        sourceRefs: followUp.date || followUp.note
          ? [{ kind: "consultation", ref: followUp.date ? "nextVisitOn" : "nextVisitNote" }]
          : [],
      },
      warnings: [],
      uncertainties,
      context: {
        encounterId: context.encounter.encounterId,
        patientId: context.patient.patientId,
        practiceLocationId: context.practice.locationId,
        prescriptionId: context.draft?.prescriptionId ?? null,
        encounterVersion: context.encounter.version,
        prescriptionVersion: context.draft?.version ?? null,
      },
    };
  }
}
