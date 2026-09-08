import "server-only";

import type { ProposalBinding } from "./contracts";
import type {
  ProposalIntegrityService,
  ProposalSecurityPayload,
} from "./integrity";

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
 * Pure pre-commit guard over a MAC-verified immutable security payload.
 *
 * Integration code must first authenticate the current user, reconstruct the
 * Doctor/person/location authority from the verified session, re-read the
 * authoritative clinical record, then pass that current state here. The
 * Doctor-editable proposal body is deliberately not part of this security
 * comparison and this function performs no write/finalization itself.
 */
export function assertVerifiedProposalAcceptanceContext(
  security: ProposalSecurityPayload,
  current: AuthoritativeAcceptanceContext,
): void {
  if (current.now.getTime() > Date.parse(security.expiresAt)) {
    throw new ProposalAcceptanceError("PROPOSAL_EXPIRED");
  }
  if (current.actorUserId !== security.binding.actorUserId) {
    throw new ProposalAcceptanceError("ACTOR_CONTEXT_CHANGED");
  }
  if (current.doctorProfileId !== security.binding.doctorProfileId) {
    throw new ProposalAcceptanceError("DOCTOR_CONTEXT_CHANGED");
  }
  if (current.practiceLocationId !== security.binding.practiceLocationId) {
    throw new ProposalAcceptanceError("LOCATION_CONTEXT_CHANGED");
  }
  if (current.patientId !== security.binding.patientId) {
    throw new ProposalAcceptanceError("PATIENT_CONTEXT_CHANGED");
  }
  if (current.clinicalRecordId !== security.binding.clinicalRecordId) {
    throw new ProposalAcceptanceError("RECORD_CONTEXT_CHANGED");
  }
  if (current.expectedVersion !== security.binding.expectedVersion) {
    throw new ProposalAcceptanceError("STALE_CLINICAL_VERSION");
  }

  if (security.taskType !== "NAVIGATION_COMMAND" && !current.explicitlyAccepted) {
    throw new ProposalAcceptanceError("CLINICAL_REVIEW_REQUIRED");
  }
}

/**
 * PA1-SEC-01 acceptance entry point. Browser-supplied binding/timestamps are
 * never trusted: the server verifies the opaque handle and compares only the
 * verified signed payload to current authoritative state.
 */
export function verifyAndAssertProposalAcceptanceContext(
  securityHandle: string,
  integrity: ProposalIntegrityService,
  current: AuthoritativeAcceptanceContext,
): ProposalSecurityPayload {
  const security = integrity.verify(securityHandle);
  assertVerifiedProposalAcceptanceContext(security, current);
  return security;
}

/** Voice can never directly trigger finalization or destructive clinical actions. */
export const VOICE_FORBIDDEN_ACTIONS = [
  "FINALIZE_PRESCRIPTION",
  "CONFIRM_PRINT",
  "DELETE_CLINICAL_RECORD",
  "START_CORRECTION",
] as const;
