import {
  autopilotPrescriptionSchema,
  boundAutopilotContextSchema,
  type AutopilotGenerationResult,
  type AutopilotProvider,
  type BoundAutopilotContext,
} from "./contracts";

function bindingError(context: BoundAutopilotContext): string | null {
  if (context.actor.userId !== context.doctor.userId) return "Actor is not bound to the doctor identity.";
  if (context.encounter.patientId !== context.patient.patientId) return "Encounter is not bound to the requested patient.";
  if (context.encounter.practiceLocationId !== context.practice.locationId) return "Encounter is not bound to the active practice location.";
  if (context.draft) {
    if (context.draft.status !== "DRAFT") return "Prescription is not editable.";
    if (context.draft.encounterId !== context.encounter.encounterId) return "Prescription draft is not bound to the active encounter.";
    if (context.draft.patientId !== context.patient.patientId) return "Prescription draft is not bound to the active patient.";
    if (context.draft.practiceLocationId !== context.practice.locationId) return "Prescription draft is not bound to the active practice location.";
  }
  return null;
}

/**
 * M6C1 is intentionally generation-only. This module has no database client,
 * mutation dependency, Apply operation, Review bypass, or Finalize operation.
 */
export async function generateAutopilotPrescription(
  rawContext: unknown,
  provider: AutopilotProvider,
): Promise<AutopilotGenerationResult> {
  const parsedContext = boundAutopilotContextSchema.safeParse(rawContext);
  if (!parsedContext.success) {
    return { ok: false, reason: "invalid-context", message: "Autopilot context could not be verified." };
  }

  const context = parsedContext.data;
  const rejected = bindingError(context);
  if (rejected) return { ok: false, reason: "binding-rejected", message: rejected };

  let rawProposal: unknown;
  try {
    rawProposal = await provider.generate(context);
  } catch {
    return {
      ok: false,
      reason: "malformed-provider-output",
      message: "Autopilot could not produce a verifiable proposal.",
    };
  }

  const parsedProposal = autopilotPrescriptionSchema.safeParse(rawProposal);
  if (!parsedProposal.success) {
    return {
      ok: false,
      reason: "malformed-provider-output",
      message: "Autopilot returned a proposal shape this build will not accept.",
    };
  }

  const proposal = parsedProposal.data;
  if (
    proposal.context.doctorId !== context.doctor.doctorId ||
    proposal.context.encounterId !== context.encounter.encounterId ||
    proposal.context.patientId !== context.patient.patientId ||
    proposal.context.practiceLocationId !== context.practice.locationId ||
    proposal.context.prescriptionId !== (context.draft?.prescriptionId ?? null) ||
    proposal.context.encounterVersion !== context.encounter.version ||
    proposal.context.prescriptionVersion !== (context.draft?.version ?? null)
  ) {
    return {
      ok: false,
      reason: "binding-rejected",
      message: "Autopilot proposal context does not match the verified consultation state.",
    };
  }

  return { ok: true, proposal };
}
