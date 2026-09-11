import { describe, expect, it } from "vitest";
import type { AiProposalPayload } from "./contracts";
import { projectOwnerAggregates } from "./owner-projection";
import {
  DEFAULT_EXPIRY_GRACE_MS,
  classifyAcceptance,
  deriveTerminalOutcome,
  proposalsDueForExpiry,
  recordProposalDecision,
  recordProposalExpiry,
} from "./proposal-decision";
import {
  buildProposalDecision,
  buildProposalProduced,
  mintProposalId,
  mintTelemetryOperationId,
  type AiProposalProducedEvent,
} from "./telemetry";
import { InMemoryAiTelemetrySink, emitAiTelemetry } from "./telemetry-sink";

const DOCTOR = "22222222-2222-4222-8222-222222222222";
const OTHER_DOCTOR = "99999999-9999-4999-8999-999999999999";
const principal = { actorUserId: "11111111-1111-4111-8111-111111111111", doctorProfileId: DOCTOR };
const TTL = 5 * 60_000;

function produced(at = new Date("2026-09-11T04:00:00Z")): AiProposalProducedEvent {
  return buildProposalProduced({
    occurredAt: at,
    principal,
    operationId: mintTelemetryOperationId(),
    proposalId: mintProposalId(),
    providerId: "openai",
    modelId: "gpt-5.6-terra",
    taskType: "PRESCRIPTION_MEDICINE",
    uncertaintyCount: 0,
  });
}

describe("Namespace-safe immutable proposal id", () => {
  it("is random and prefixed, never a bare UUID", () => {
    const a = mintProposalId();
    expect(a).toMatch(/^ddprop_[0-9a-f-]{36}$/);
    expect(mintProposalId()).not.toBe(a);
  });
});

describe("Exactly one terminal outcome, resolved deterministically", () => {
  it("a Doctor decision beats expiry whichever arrives first", async () => {
    for (const order of ["decision-first", "expiry-first"] as const) {
      const sink = new InMemoryAiTelemetrySink();
      const p = produced();
      await emitAiTelemetry(sink, p);
      const accept = () =>
        recordProposalDecision(sink, {
          decision: "AI_PROPOSAL_ACCEPTED",
          proposalId: p.proposal_id,
          taskType: p.task_type,
          principal,
        });
      const expire = () => recordProposalExpiry(sink, p, new Date("2026-09-11T05:00:00Z"));
      if (order === "decision-first") {
        await accept();
        await expire();
      } else {
        await expire();
        await accept();
      }
      // Both rows exist — different keys, neither blocked the other…
      expect(sink.events().filter((e) => "proposal_id" in e && e.proposal_id === p.proposal_id)).toHaveLength(3);
      // …and the outcome is the same regardless of order.
      expect(deriveTerminalOutcome(sink.events(), p.proposal_id)).toBe("ACCEPTED");
    }
  });

  it("a Doctor decides once — a second decision is refused, not appended", async () => {
    const sink = new InMemoryAiTelemetrySink();
    const p = produced();
    for (const decision of ["AI_PROPOSAL_REJECTED", "AI_PROPOSAL_ACCEPTED"] as const) {
      await recordProposalDecision(sink, { decision, proposalId: p.proposal_id, taskType: p.task_type, principal });
    }
    expect(deriveTerminalOutcome(sink.events(), p.proposal_id)).toBe("REJECTED");
    expect(sink.events()).toHaveLength(1);
  });

  it("with no decision and no expiry, the proposal is PENDING", () => {
    const p = produced();
    expect(deriveTerminalOutcome([p], p.proposal_id)).toBe("PENDING");
  });

  it("expiry becomes due only after TTL plus grace", () => {
    const p = produced(new Date("2026-09-11T04:00:00Z"));
    const at = (ms: number) => new Date(Date.parse(p.occurred_at) + ms);
    expect(proposalsDueForExpiry([p], at(TTL), TTL)).toHaveLength(0);
    expect(proposalsDueForExpiry([p], at(TTL + DEFAULT_EXPIRY_GRACE_MS - 1), TTL)).toHaveLength(0);
    expect(proposalsDueForExpiry([p], at(TTL + DEFAULT_EXPIRY_GRACE_MS), TTL)).toHaveLength(1);
  });
});

describe("Accepted vs accepted-after-edit", () => {
  const issued = {
    kind: "PRESCRIPTION_MEDICINE",
    medicine: { display_name: "Napa", strength_text: "500 mg" },
    uncertainties: [],
    requires_review: true,
  } as unknown as AiProposalPayload;

  it("is ACCEPTED when unchanged, regardless of key order", () => {
    const reordered = { requires_review: true, uncertainties: [], medicine: { strength_text: "500 mg", display_name: "Napa" }, kind: "PRESCRIPTION_MEDICINE" } as unknown as AiProposalPayload;
    expect(classifyAcceptance(issued, reordered)).toBe("AI_PROPOSAL_ACCEPTED");
  });

  it("is EDITED when the Doctor changed anything — and returns only the verdict", () => {
    const edited = { ...issued, medicine: { display_name: "Napa", strength_text: "665 mg" } } as unknown as AiProposalPayload;
    const verdict = classifyAcceptance(issued, edited);
    expect(verdict).toBe("AI_PROPOSAL_EDITED");
    expect(verdict).not.toContain("665");
  });
});

describe("Forged or misrouted decisions cannot inflate acceptance", () => {
  it("ignores a decision by a Doctor other than the one it was produced for", () => {
    const p = produced();
    const forged = buildProposalDecision({
      type: "AI_PROPOSAL_ACCEPTED",
      occurredAt: new Date("2026-09-11T04:01:00Z"),
      principal: { actorUserId: principal.actorUserId, doctorProfileId: OTHER_DOCTOR },
      proposalId: p.proposal_id,
      taskType: p.task_type,
    });
    const rows = projectOwnerAggregates([p, forged], { timeZone: "Asia/Dhaka" });
    expect(rows.some((r) => r.unit === "PROPOSALS_ACCEPTED")).toBe(false);
  });

  it("ignores a decision for a proposal that was never produced", () => {
    const orphan = buildProposalDecision({
      type: "AI_PROPOSAL_ACCEPTED",
      occurredAt: new Date("2026-09-11T04:01:00Z"),
      principal,
      proposalId: mintProposalId(),
      taskType: "PRESCRIPTION_MEDICINE",
    });
    expect(projectOwnerAggregates([orphan], { timeZone: "Asia/Dhaka" })).toHaveLength(0);
  });

  it("counts EDITED separately from ACCEPTED", () => {
    const p = produced();
    const edited = buildProposalDecision({
      type: "AI_PROPOSAL_EDITED",
      occurredAt: new Date("2026-09-11T04:01:00Z"),
      principal,
      proposalId: p.proposal_id,
      taskType: p.task_type,
    });
    const units = projectOwnerAggregates([p, edited], { timeZone: "Asia/Dhaka" }).map((r) => r.unit);
    expect(units).toContain("PROPOSALS_EDITED");
    expect(units).not.toContain("PROPOSALS_ACCEPTED");
  });
});
