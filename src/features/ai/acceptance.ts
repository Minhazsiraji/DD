import type { AiProposalEnvelope, ProposalBinding } from "./contracts";

export class ProposalAcceptanceError extends Error {
  constructor(
    public readonly code:
      | "PROPOSAL_EXPIRED"
      | "ACTOR_CONTEXT_CHANGED"
      | "DOCTOR_CONTEXT_CHANGED"
      | "LOCATION_CONTEXT_CHANGED"
      | "PATIENT_CONTEXT_CHANGED"
      | "RECORD_CONTEXT_CHANGED"
      | "STALE_CLINICAL_VERSION"
      | "CLINICAL_REVIEW_REQUIRED",
  ) {
    super(code);
    this.name = "ProposalAcceptanceError";
  }
}

export interface AuthoritativeAcceptanceContext extends ProposalBinding {
  now: Date;
  /** True only after the Doctor visibly accepts the clinical proposal. */
  explicitlyAccepted: boolean;
}

/**
 * Pure pre-commit guard. Integration code must construct `current` from the
 * verified session + authoritative record re-read, then call the existing DD
 * action/RPC. This function itself cannot write or finalize anything.
 *
 * Binding expectedVersion to the proposal lets the existing CAS-protected DD
 * clinical RPCs reject replay/duplicate accepts after the first successful
 * write advances the record.
 */
export function assertProposalAcceptanceContext(
  envelope: AiProposalEnvelope,
  current: AuthoritativeAcceptanceContext,
): void {
  if (current.now.getTime() > Date.parse(envelope.expiresAt)) {
    throw new ProposalAcceptanceError("PROPOSAL_EXPIRED");
  }
  if (current.actorUserId !== envelope.binding.actorUserId) {
    throw new ProposalAcceptanceError("ACTOR_CONTEXT_CHANGED");
  }
  if (current.doctorProfileId !== envelope.binding.doctorProfileId) {
    throw new ProposalAcceptanceError("DOCTOR_CONTEXT_CHANGED");
  }
  if (current.practiceLocationId !== envelope.binding.practiceLocationId) {
    throw new ProposalAcceptanceError("LOCATION_CONTEXT_CHANGED");
  }
  if (current.patientId !== envelope.binding.patientId) {
    throw new ProposalAcceptanceError("PATIENT_CONTEXT_CHANGED");
  }
  if (current.clinicalRecordId !== envelope.binding.clinicalRecordId) {
    throw new ProposalAcceptanceError("RECORD_CONTEXT_CHANGED");
  }
  if (current.expectedVersion !== envelope.binding.expectedVersion) {
    throw new ProposalAcceptanceError("STALE_CLINICAL_VERSION");
  }

  if (envelope.proposal.kind !== "NAVIGATION_COMMAND" && !current.explicitlyAccepted) {
    throw new ProposalAcceptanceError("CLINICAL_REVIEW_REQUIRED");
  }
}

/** Voice can never directly trigger finalization or destructive clinical actions. */
export const VOICE_FORBIDDEN_ACTIONS = [
  "FINALIZE_PRESCRIPTION",
  "CONFIRM_PRINT",
  "DELETE_CLINICAL_RECORD",
  "START_CORRECTION",
] as const;
