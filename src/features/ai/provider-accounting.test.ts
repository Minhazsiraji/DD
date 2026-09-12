import { describe, expect, it, vi } from "vitest";
import { createHmacProposalIntegrity } from "./integrity";
import { MockProposalParser, NeverResolvingParser } from "./mock-provider";
import { OpenAiProposalProviderError, OpenAiTerraProposalParser } from "./openai-terra-provider";
import { AiProviderTimeoutError, createClinicalProposal } from "./orchestrator";
import { costForAudio, costForTokenUsage, createPricingBook, type PricingSnapshot } from "./pricing";
import {
  NOT_DISPATCHED_USAGE,
  UNKNOWN_USAGE,
  providerAttemptFacts,
  reportedUsage,
  type ClinicalProposalParser,
} from "./providers";
import { mintTelemetryOperationId, validateAiTelemetryEvent } from "./telemetry";
import { InMemoryAiTelemetrySink } from "./telemetry-sink";

const binding = {
  actorUserId: "11111111-1111-4111-8111-111111111111",
  doctorProfileId: "22222222-2222-4222-8222-222222222222",
  practiceLocationId: "33333333-3333-4333-8333-333333333333",
  patientId: "44444444-4444-4444-8444-444444444444",
  clinicalRecordId: "55555555-5555-4555-8555-555555555555",
  expectedVersion: 7,
};
const integrity = createHmacProposalIntegrity("o1e-test-signing-secret-32-bytes-minimum-2026");
const validRx = {
  kind: "PRESCRIPTION_MEDICINE",
  medicine: { display_name: "Napa", strength_text: "500 mg" },
  uncertainties: [],
  requires_review: true,
} as const;

/** Illustrative rates — the arithmetic is under test, not any real price. */
const SNAPSHOT: PricingSnapshot = {
  id: "illustrative-2026-09",
  providerId: "mock",
  modelId: "mock-parser-v1",
  capturedAt: "2026-01-01T00:00:00.000Z",
  sourceRef: "test fixture",
  unitPriceUsdMicros: {
    INPUT_TOKENS: BigInt(250_000),
    CACHED_INPUT_TOKENS: BigInt(25_000),
    OUTPUT_TOKENS: BigInt(2_500_000),
  },
};
const PRICING = createPricingBook([SNAPSHOT]);
const R3_USAGE = reportedUsage({
  inputTokens: 1000,
  cachedInputTokens: 200,
  outputTokens: 38,
  reasoningTokens: 18,
  totalTokens: 1038,
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
function openAi(fetchImpl: typeof fetch) {
  return new OpenAiTerraProposalParser({ apiKey: "k", fetchImpl, syntheticEvaluationEnabled: true });
}
const parseInput = {
  taskType: "PRESCRIPTION_MEDICINE" as const,
  authoredText: "Napa 500",
  jsonSchema: {},
};
const completedBody = (usage: unknown) => ({
  id: "resp_1",
  status: "completed",
  output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(validRx) }] }],
  usage,
});

describe("OpenAI adapter — every returned component preserved, nothing fabricated", () => {
  it("captures input, cached, output, reasoning and total tokens", async () => {
    const result = await openAi(async () =>
      jsonResponse(
        completedBody({
          input_tokens: 1000,
          output_tokens: 38,
          total_tokens: 1038,
          input_tokens_details: { cached_tokens: 200 },
          output_tokens_details: { reasoning_tokens: 18 },
        }),
      ),
    ).parse(parseInput, new AbortController().signal);
    expect(result.usage).toEqual(R3_USAGE);
  });

  it("leaves an unreturned component null — not zero", async () => {
    const result = await openAi(async () =>
      jsonResponse(completedBody({ input_tokens: 90, output_tokens: 80 })),
    ).parse(parseInput, new AbortController().signal);
    expect(result.usage.state).toBe("REPORTED");
    expect(result.usage.tokens.cachedInputTokens).toBeNull();
    expect(result.usage.tokens.reasoningTokens).toBeNull();
    expect(result.usage.tokens.totalTokens).toBeNull();
  });

  it("treats a response with no usage block as unknown consumption", async () => {
    const result = await openAi(async () => jsonResponse(completedBody(undefined))).parse(
      parseInput,
      new AbortController().signal,
    );
    expect(result.usage).toEqual(UNKNOWN_USAGE);
  });

  it("keeps the billed usage of an incomplete response on the thrown error", async () => {
    const error = await openAi(async () =>
      jsonResponse({
        status: "incomplete",
        usage: { input_tokens: 500, output_tokens: 2500, input_tokens_details: { cached_tokens: 0 } },
      }),
    )
      .parse(parseInput, new AbortController().signal)
      .catch((e: unknown) => e);
    const facts = providerAttemptFacts(error);
    expect(facts?.failureCode).toBe("OPENAI_PROVIDER_INCOMPLETE");
    expect(facts?.dispatched).toBe(true);
    expect(facts?.usage.state).toBe("REPORTED");
    expect(facts?.usage.tokens.outputTokens).toBe(2500);
  });

  it("records a refusal before dispatch as an authoritative zero, not unknown", () => {
    const facts = providerAttemptFacts(new OpenAiProposalProviderError("OPENAI_API_KEY_MISSING"));
    expect(facts?.dispatched).toBe(false);
    expect(facts?.usage).toEqual(NOT_DISPATCHED_USAGE);
  });

  it("keeps the error's public shape unchanged for existing callers", () => {
    const error = new OpenAiProposalProviderError("OPENAI_PROVIDER_REFUSAL", undefined, R3_USAGE);
    expect(Object.keys(error).sort()).toEqual(["code", "name", "status"].sort());
  });
});

describe("Pricing — exact fixed point, disjoint meters, no double count", () => {
  it("prices the O1-E-R3 worked example to exactly 300 micros", () => {
    const cost = costForTokenUsage(R3_USAGE, SNAPSHOT);
    expect(cost.state).toBe("ESTIMATED");
    expect(cost.mode).toBe("ALLOCATED");
    // pUSD: 800×250000 + 200×25000 + 38×2500000 = 200 + 5 + 95 micros.
    expect(cost.inputUncached).toBe(BigInt(200_000_000));
    expect(cost.cachedInput).toBe(BigInt(5_000_000));
    expect(cost.output).toBe(BigInt(95_000_000));
    expect(cost.total).toBe(BigInt(300_000_000));
  });

  it("never adds reasoning tokens on top of output", () => {
    const withReasoning = costForTokenUsage(R3_USAGE, SNAPSHOT);
    const without = costForTokenUsage(
      reportedUsage({ inputTokens: 1000, cachedInputTokens: 200, outputTokens: 38 }),
      SNAPSHOT,
    );
    expect(withReasoning.total).toBe(without.total);
  });

  it("is UNPRICED — null, not zero — with no snapshot", () => {
    const cost = costForTokenUsage(R3_USAGE, null);
    expect(cost.state).toBe("UNPRICED");
    expect(cost.total).toBeNull();
  });

  it("refuses to guess the cached split when it was not reported", () => {
    const cost = costForTokenUsage(reportedUsage({ inputTokens: 1000, outputTokens: 38 }), SNAPSHOT);
    expect(cost.state).toBe("UNKNOWN_PENDING_RECONCILIATION");
    expect(cost.total).toBeNull();
  });

  it("attaches a provider-reported total to one canonical row only", () => {
    const cost = costForTokenUsage(reportedUsage({ inputTokens: 5, outputTokens: 5 }, BigInt(777)), null);
    expect(cost.mode).toBe("CANONICAL");
    expect(cost.total).toBe(BigInt(777_000_000));
    expect(cost.output).toBe(cost.total);
    expect(cost.inputUncached).toBe(BigInt(0));
    expect(cost.cachedInput).toBe(BigInt(0));
  });

  it("prices streamed audio exactly, and a zero-length session as a known zero", () => {
    const audio = { ...SNAPSHOT, unitPriceUsdMicros: { AUDIO_SECONDS: BigInt(77) } };
    expect(costForAudio(1500, audio).total).toBe(BigInt(1500 * 77 * 1000));
    expect(costForAudio(0, null).total).toBe(BigInt(0));
    expect(costForAudio(1500, null).total).toBeNull();
  });

  it("applies the snapshot in force when the call was made", () => {
    const later = { ...SNAPSHOT, id: "later", capturedAt: "2026-10-01T00:00:00.000Z" };
    const book = createPricingBook([SNAPSHOT, later]);
    expect(book.snapshotFor("mock", "mock-parser-v1", new Date("2026-09-15T00:00:00Z"))?.id).toBe(
      "illustrative-2026-09",
    );
    expect(book.snapshotFor("mock", "mock-parser-v1", new Date("2026-10-02T00:00:00Z"))?.id).toBe("later");
  });
});

describe("Orchestrator — one outcome on every exit, correctly accounted", () => {
  const run = (parser: ClinicalProposalParser, sink: InMemoryAiTelemetrySink, extra = {}) =>
    createClinicalProposal(
      { operationId: "op-x", taskType: "PRESCRIPTION_MEDICINE", binding, text: "Napa 500" },
      { parser, integrity, telemetry: { sink, pricing: PRICING }, ...extra },
    );

  it("emits started, attempted, succeeded and produced, all allowlist-valid", async () => {
    const sink = new InMemoryAiTelemetrySink();
    const result = await run(new MockProposalParser(validRx, R3_USAGE), sink);
    expect(sink.events().map((e) => e.event_type)).toEqual([
      "AI_OPERATION_STARTED",
      "AI_PROVIDER_ATTEMPTED",
      "AI_PROVIDER_SUCCEEDED",
      "AI_PROPOSAL_PRODUCED",
    ]);
    for (const event of sink.events()) expect(() => validateAiTelemetryEvent(event)).not.toThrow();
    const [outcome] = sink.ofType("AI_PROVIDER_SUCCEEDED");
    expect(outcome!.estimated_cost_usd_micros).toBe("300.000000");
    expect(outcome!.reasoning_tokens).toBe(18);
    expect(result.usage.estimatedCostUsdMicros).toBe("300.000000");
    expect(result.telemetry.proposalId).toMatch(/^ddprop_/);
  });

  it("records a validation rejection with the usage the provider billed", async () => {
    const sink = new InMemoryAiTelemetrySink();
    await expect(run(new MockProposalParser({ kind: "NOPE" }, R3_USAGE), sink)).rejects.toThrow();
    const [failed] = sink.ofType("AI_PROVIDER_FAILED");
    expect(failed!.failure_code).toBe("VALIDATION_REJECTED");
    expect(failed!.estimated_cost_usd_micros).toBe("300.000000");
    expect(sink.ofType("AI_PROPOSAL_PRODUCED")).toHaveLength(0);
  });

  it("records a timeout as unknown consumption, never zero", async () => {
    const sink = new InMemoryAiTelemetrySink();
    await expect(run(new NeverResolvingParser(), sink, { timeoutMs: 5 })).rejects.toBeInstanceOf(
      AiProviderTimeoutError,
    );
    const [timedOut] = sink.ofType("AI_PROVIDER_TIMEOUT");
    expect(timedOut!.usage_state).toBe("UNKNOWN_PENDING_RECONCILIATION");
    expect(timedOut!.cost_state).toBe("UNKNOWN_PENDING_RECONCILIATION");
    expect(timedOut!.estimated_cost_usd_micros).toBeNull();
    expect(timedOut!.output_tokens).toBeNull();
  });

  it("maps an adapter error to its enumerated code and carried usage", async () => {
    const sink = new InMemoryAiTelemetrySink();
    const failing: ClinicalProposalParser = {
      descriptor: { provider: "mock", model: "mock-parser-v1" },
      async parse() {
        throw new OpenAiProposalProviderError("OPENAI_PROVIDER_INCOMPLETE", undefined, R3_USAGE);
      },
    };
    await expect(run(failing, sink)).rejects.toThrow("OPENAI_PROVIDER_INCOMPLETE");
    const [failed] = sink.ofType("AI_PROVIDER_FAILED");
    expect(failed!.failure_code).toBe("OPENAI_PROVIDER_INCOMPLETE");
    expect(failed!.estimated_cost_usd_micros).toBe("300.000000");
  });

  it("never lets a provider message into failure_code", async () => {
    const sink = new InMemoryAiTelemetrySink();
    const leaky: ClinicalProposalParser = {
      async parse() {
        throw new Error("patient Rahim, Napa 500 — provider stack trace");
      },
    };
    await expect(run(leaky, sink)).rejects.toThrow();
    const [failed] = sink.ofType("AI_PROVIDER_FAILED");
    expect(failed!.failure_code).toBe("PROVIDER_ERROR_UNCLASSIFIED");
    expect(JSON.stringify(sink.events())).not.toContain("Rahim");
  });

  it("counts a retry as another call on the same operation, never a new operation", async () => {
    const sink = new InMemoryAiTelemetrySink();
    const operationId = mintTelemetryOperationId();
    const flaky: ClinicalProposalParser = {
      descriptor: { provider: "mock", model: "mock-parser-v1" },
      async parse() {
        throw new OpenAiProposalProviderError("OPENAI_PROVIDER_HTTP", 500);
      },
    };
    await expect(run(flaky, sink, { telemetry: { sink, operationId, attemptNo: 1 } })).rejects.toThrow();
    await expect(
      createClinicalProposal(
        { operationId: "op-x", taskType: "PRESCRIPTION_MEDICINE", binding, text: "Napa 500" },
        { parser: new MockProposalParser(validRx, R3_USAGE), integrity, telemetry: { sink, operationId, attemptNo: 2 } },
      ),
    ).resolves.toBeTruthy();
    expect(sink.ofType("AI_OPERATION_STARTED")).toHaveLength(1);
    expect(sink.ofType("AI_PROVIDER_ATTEMPTED")).toHaveLength(2);
  });

  it("does not record telemetry for input refused before any provider call", async () => {
    const sink = new InMemoryAiTelemetrySink();
    await expect(
      createClinicalProposal(
        { operationId: "op-x", taskType: "PRESCRIPTION_MEDICINE", binding, text: "   " },
        { parser: new MockProposalParser(validRx), integrity, telemetry: { sink } },
      ),
    ).rejects.toThrow("AI_INPUT_EMPTY");
    expect(sink.events()).toHaveLength(0);
  });

  it("no orchestrator path produces an event the allowlist rejects", async () => {
    const rejected = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const sink = new InMemoryAiTelemetrySink();
      const unattributed: ClinicalProposalParser = {
        async parse() {
          return { rawProposal: validRx, provider: { provider: "x", model: "y" }, usage: UNKNOWN_USAGE };
        },
      };
      const adapterFailure: ClinicalProposalParser = {
        async parse() {
          throw new OpenAiProposalProviderError("OPENAI_PROVIDER_HTTP", 500);
        },
      };
      await run(new MockProposalParser(validRx, R3_USAGE), sink);
      await run(new MockProposalParser(validRx), sink);
      await run(unattributed, sink);
      await run(new MockProposalParser({ kind: "NOPE" }, R3_USAGE), sink).catch(() => undefined);
      await run(adapterFailure, sink).catch(() => undefined);
      await run(new NeverResolvingParser(), sink, { timeoutMs: 5 }).catch(() => undefined);
      expect(rejected).not.toHaveBeenCalled();
      // started + attempted + one outcome for each of the six runs, plus three proposals.
      expect(sink.events()).toHaveLength(6 * 3 + 3);
    } finally {
      rejected.mockRestore();
    }
  });

  it("replaces a caller id that is not a minted telemetry id — a bare UUID is refused", async () => {
    const sink = new InMemoryAiTelemetrySink();
    await run(new MockProposalParser(validRx), sink, {
      telemetry: { sink, operationId: binding.patientId },
    });
    expect(JSON.stringify(sink.events())).not.toContain(binding.patientId);
  });
});
