import {
  UNKNOWN_USAGE,
  type ClinicalProposalParser,
  type ProposalParseInput,
  type ProposalParseResult,
  type ProviderUsageReport,
} from "./providers";

/**
 * Deterministic PA1 mock parser. Tests inject exact provider output so the
 * safety boundary, not model cleverness, is what gets exercised.
 *
 * Speech-to-text is deliberately absent: PA1 reuses DD's existing audited
 * Deepgram Nova-3 streaming subsystem instead of mocking or duplicating it.
 *
 * USAGE DEFAULTS TO UNKNOWN, NOT ZERO. This mock reports no consumption, and
 * "not reported" must never be represented as an authoritative 0 — that is the
 * pattern every test using this class would otherwise learn. A test that needs
 * reported usage passes it explicitly.
 */
export class MockProposalParser implements ClinicalProposalParser {
  readonly descriptor = { provider: "mock", model: "mock-parser-v1" };

  constructor(
    private readonly output: unknown,
    private readonly usage: ProviderUsageReport = UNKNOWN_USAGE,
  ) {}

  async parse(
    _input: ProposalParseInput,
    signal: AbortSignal,
  ): Promise<ProposalParseResult> {
    if (signal.aborted) throw new Error("MOCK_ABORTED");
    return {
      rawProposal: this.output,
      provider: { provider: "mock", model: "mock-parser-v1" },
      usage: this.usage,
    };
  }
}

export class NeverResolvingParser implements ClinicalProposalParser {
  readonly descriptor = { provider: "mock", model: "never-resolving-v1" };

  async parse(
    _input: ProposalParseInput,
    _signal: AbortSignal,
  ): Promise<ProposalParseResult> {
    // Intentionally ignores AbortSignal. The orchestrator must still time out
    // safely even when a provider adapter fails to cooperate.
    return await new Promise<ProposalParseResult>(() => undefined);
  }
}
