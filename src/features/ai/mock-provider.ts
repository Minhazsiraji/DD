import type {
  ClinicalProposalParser,
  ProposalParseInput,
  ProposalParseResult,
} from "./providers";

/**
 * Deterministic PA1 mock parser. Tests inject exact provider output so the
 * safety boundary, not model cleverness, is what gets exercised.
 *
 * Speech-to-text is deliberately absent: PA1 reuses DD's existing audited
 * Deepgram Nova-3 streaming subsystem instead of mocking or duplicating it.
 */
export class MockProposalParser implements ClinicalProposalParser {
  constructor(private readonly output: unknown) {}

  async parse(
    _input: ProposalParseInput,
    signal: AbortSignal,
  ): Promise<ProposalParseResult> {
    if (signal.aborted) throw new Error("MOCK_ABORTED");
    return {
      rawProposal: this.output,
      provider: { provider: "mock", model: "mock-parser-v1" },
      usage: { inputTokens: 0, outputTokens: 0, estimatedCostUsdMicros: 0 },
    };
  }
}

export class NeverResolvingParser implements ClinicalProposalParser {
  async parse(
    _input: ProposalParseInput,
    _signal: AbortSignal,
  ): Promise<ProposalParseResult> {
    // Intentionally ignores AbortSignal. The orchestrator must still time out
    // safely even when a provider adapter fails to cooperate.
    return await new Promise<ProposalParseResult>(() => undefined);
  }
}
