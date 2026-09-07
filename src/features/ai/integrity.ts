import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import type { AiTaskType, ProposalBinding } from "./contracts";

const TOKEN_VERSION = 1 as const;
const MIN_SECRET_BYTES = 32;

export interface ProposalSecurityPayload {
  v: typeof TOKEN_VERSION;
  operationId: string;
  taskType: AiTaskType;
  source: "TEXT" | "VOICE_TRANSCRIPT";
  binding: ProposalBinding;
  createdAt: string;
  expiresAt: string;
}

export interface ProposalIntegrityService {
  issue(payload: ProposalSecurityPayload): string;
  verify(handle: string): ProposalSecurityPayload;
}

export class ProposalIntegrityError extends Error {
  constructor(
    public readonly code:
      | "PROPOSAL_INTEGRITY_CONFIG"
      | "PROPOSAL_INTEGRITY_FORMAT"
      | "PROPOSAL_INTEGRITY_SIGNATURE"
      | "PROPOSAL_INTEGRITY_PAYLOAD",
  ) {
    super(code);
    this.name = "ProposalIntegrityError";
  }
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function decodeBase64url(input: string): Buffer {
  try {
    return Buffer.from(input, "base64url");
  } catch {
    throw new ProposalIntegrityError("PROPOSAL_INTEGRITY_FORMAT");
  }
}

function canonicalPayload(payload: ProposalSecurityPayload): string {
  return JSON.stringify({
    v: payload.v,
    operationId: payload.operationId,
    taskType: payload.taskType,
    source: payload.source,
    binding: {
      actorUserId: payload.binding.actorUserId,
      doctorProfileId: payload.binding.doctorProfileId,
      practiceLocationId: payload.binding.practiceLocationId,
      patientId: payload.binding.patientId,
      clinicalRecordId: payload.binding.clinicalRecordId,
      expectedVersion: payload.binding.expectedVersion,
    },
    createdAt: payload.createdAt,
    expiresAt: payload.expiresAt,
  });
}

function assertNonBlank(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function validatePayload(value: unknown): ProposalSecurityPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ProposalIntegrityError("PROPOSAL_INTEGRITY_PAYLOAD");
  }
  const row = value as Record<string, unknown>;
  const binding = row.binding as Record<string, unknown> | undefined;
  if (
    row.v !== TOKEN_VERSION ||
    !assertNonBlank(row.operationId) ||
    !["PRESCRIPTION_MEDICINE", "INVESTIGATION_LIST", "CLINICAL_NOTE", "NAVIGATION_COMMAND"].includes(
      String(row.taskType),
    ) ||
    !["TEXT", "VOICE_TRANSCRIPT"].includes(String(row.source)) ||
    !binding ||
    !assertNonBlank(binding.actorUserId) ||
    !assertNonBlank(binding.doctorProfileId) ||
    !assertNonBlank(binding.practiceLocationId) ||
    !(binding.patientId === null || assertNonBlank(binding.patientId)) ||
    !(binding.clinicalRecordId === null || assertNonBlank(binding.clinicalRecordId)) ||
    !(
      binding.expectedVersion === null ||
      (typeof binding.expectedVersion === "number" &&
        Number.isSafeInteger(binding.expectedVersion) &&
        binding.expectedVersion >= 0)
    ) ||
    !assertNonBlank(row.createdAt) ||
    !assertNonBlank(row.expiresAt) ||
    !Number.isFinite(Date.parse(row.createdAt)) ||
    !Number.isFinite(Date.parse(row.expiresAt))
  ) {
    throw new ProposalIntegrityError("PROPOSAL_INTEGRITY_PAYLOAD");
  }

  return {
    v: TOKEN_VERSION,
    operationId: row.operationId,
    taskType: row.taskType as AiTaskType,
    source: row.source as "TEXT" | "VOICE_TRANSCRIPT",
    binding: {
      actorUserId: binding.actorUserId,
      doctorProfileId: binding.doctorProfileId,
      practiceLocationId: binding.practiceLocationId,
      patientId: binding.patientId as string | null,
      clinicalRecordId: binding.clinicalRecordId as string | null,
      expectedVersion: binding.expectedVersion as number | null,
    },
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
  };
}

function secretBytes(secret: string): Buffer {
  const bytes = Buffer.from(secret, "utf8");
  if (bytes.byteLength < MIN_SECRET_BYTES) {
    throw new ProposalIntegrityError("PROPOSAL_INTEGRITY_CONFIG");
  }
  return bytes;
}

/**
 * Stateless PA1-SEC-01 boundary. The signed payload contains only immutable
 * security context; the Doctor-editable proposal body is deliberately excluded.
 */
export function createHmacProposalIntegrity(secret: string): ProposalIntegrityService {
  const key = secretBytes(secret);

  return {
    issue(payload) {
      const validated = validatePayload(payload);
      const encoded = base64url(canonicalPayload(validated));
      const mac = createHmac("sha256", key).update(encoded).digest("base64url");
      return `${encoded}.${mac}`;
    },
    verify(handle) {
      const [encoded, suppliedMac, extra] = handle.split(".");
      if (!encoded || !suppliedMac || extra !== undefined) {
        throw new ProposalIntegrityError("PROPOSAL_INTEGRITY_FORMAT");
      }
      const expectedMac = createHmac("sha256", key).update(encoded).digest();
      const actualMac = decodeBase64url(suppliedMac);
      if (actualMac.byteLength !== expectedMac.byteLength || !timingSafeEqual(actualMac, expectedMac)) {
        throw new ProposalIntegrityError("PROPOSAL_INTEGRITY_SIGNATURE");
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(decodeBase64url(encoded).toString("utf8"));
      } catch {
        throw new ProposalIntegrityError("PROPOSAL_INTEGRITY_PAYLOAD");
      }
      const payload = validatePayload(parsed);
      // Reject semantically equivalent but non-canonical payload encodings.
      if (base64url(canonicalPayload(payload)) !== encoded) {
        throw new ProposalIntegrityError("PROPOSAL_INTEGRITY_PAYLOAD");
      }
      return payload;
    },
  };
}

export function createProposalIntegrityFromEnv(): ProposalIntegrityService {
  const secret = process.env.PA1_PROPOSAL_SIGNING_SECRET;
  if (!secret) throw new ProposalIntegrityError("PROPOSAL_INTEGRITY_CONFIG");
  return createHmacProposalIntegrity(secret);
}
