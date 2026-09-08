import { describe, expect, it } from "vitest";
import {
  createHmacProposalIntegrity,
  ProposalIntegrityError,
  type ProposalSecurityPayload,
} from "./integrity";

const security: ProposalSecurityPayload = {
  v: 1,
  operationId: "op-integrity-001",
  taskType: "PRESCRIPTION_MEDICINE",
  source: "VOICE_TRANSCRIPT",
  binding: {
    actorUserId: "11111111-1111-4111-8111-111111111111",
    doctorProfileId: "22222222-2222-4222-8222-222222222222",
    practiceLocationId: "33333333-3333-4333-8333-333333333333",
    patientId: "44444444-4444-4444-8444-444444444444",
    clinicalRecordId: "55555555-5555-4555-8555-555555555555",
    expectedVersion: 9,
  },
  createdAt: "2026-09-07T10:00:00.000Z",
  expiresAt: "2026-09-07T10:05:00.000Z",
};

describe("PA1-SEC-01 proposal integrity", () => {
  it("round-trips the immutable security binding", () => {
    const service = createHmacProposalIntegrity("a-strong-pa1-c1-test-secret-that-is-long-enough");
    const handle = service.issue(security);
    expect(service.verify(handle)).toEqual(security);
  });

  it("rejects a short signing secret", () => {
    expect(() => createHmacProposalIntegrity("too-short")).toThrowError(
      new ProposalIntegrityError("PROPOSAL_INTEGRITY_CONFIG"),
    );
  });

  it("rejects modified payload bytes even with structurally valid JSON", () => {
    const service = createHmacProposalIntegrity("another-strong-pa1-c1-test-secret-123456789");
    const handle = service.issue(security);
    const [payload, mac] = handle.split(".");
    const parsed = JSON.parse(Buffer.from(payload!, "base64url").toString("utf8")) as Record<string, unknown>;
    const binding = parsed.binding as Record<string, unknown>;
    binding.patientId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const changedPayload = Buffer.from(JSON.stringify(parsed)).toString("base64url");
    expect(() => service.verify(`${changedPayload}.${mac}`)).toThrowError(
      new ProposalIntegrityError("PROPOSAL_INTEGRITY_SIGNATURE"),
    );
  });

  it("rejects modified actor/version/expiry identity", () => {
    const service = createHmacProposalIntegrity("third-strong-pa1-c1-test-secret-1234567890");
    const handles = [
      { ...security, binding: { ...security.binding, actorUserId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" } },
      { ...security, binding: { ...security.binding, expectedVersion: 10 } },
      { ...security, expiresAt: "2026-09-07T11:05:00.000Z" },
    ].map((changed) => service.issue(changed));
    expect(new Set(handles).size).toBe(3);
    expect(handles.every((handle) => handle !== service.issue(security))).toBe(true);
  });

  it("does not sign or carry Doctor-editable proposal content", () => {
    const service = createHmacProposalIntegrity("fourth-strong-pa1-c1-test-secret-123456789");
    const handle = service.issue(security);
    expect(handle).not.toContain("Napa");
    expect(handle).not.toContain("medicine");
    expect(handle).not.toContain("investigation");
  });
});
