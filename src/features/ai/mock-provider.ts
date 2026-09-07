import type {
  ClinicalProposalParser,
  ProposalParseInput,
  ProposalParseResult,
  SpeechInput,
  SpeechProvider,
  SpeechResult,
} from "./providers";

/**
 * Deterministic PA1 mock providers. They are intentionally dumb: tests inject
 * exact provider output so the safety boundary, not model cleverness, is what
 * gets exercised.
 */
export class MockSpeechProvider implements SpeechProvider {
  constructor(
    private readonly transcript: string,
    private readonly language: string | null = null,
    private readonly confidence: number | null = null,
  ) {}

  async transcribe(input: SpeechInput, signal: AbortSignal): Promise<SpeechResult> {
    if (signal.aborted) throw new Error("MOCK_ABORTED");
    if (!(input.audio instanceof Uint8Array) || input.audio.byteLength === 0) {
      throw new Error("MOCK_AUDIO_EMPTY");
    }
    return {
      transcript: this.transcript,
      language: this.language,
      confidence: this.confidence,
      provider: { provider: "mock", model: "mock-stt-v1" },
      usage: { audioSeconds: 1, estimatedCostUsdMicros: 0 },
    };
  }
}

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
    signal: AbortSignal,
  ): Promise<ProposalParseResult> {
    return await new Promise<ProposalParseResult>((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new Error("MOCK_ABORTED")), { once: true });
    });
  }
}
