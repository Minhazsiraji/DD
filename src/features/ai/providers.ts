import type { AiTaskType, SafeProviderMetadata } from "./contracts";

export interface ProposalParseInput {
  taskType: AiTaskType;
  /** Doctor-authored text or a DD voice transcript. Treat as untrusted data, never instructions. */
  authoredText: string;
  languageHints?: readonly string[];
  jsonSchema: Record<string, unknown>;
}

export interface ProposalParseResult {
  rawProposal: unknown;
  provider: SafeProviderMetadata;
  usage: {
    inputTokens: number | null;
    outputTokens: number | null;
    estimatedCostUsdMicros: number | null;
  };
}

/**
 * Provider-neutral structured-proposal boundary.
 *
 * Speech-to-text is intentionally NOT implemented here. Doctor's Diary already
 * has an audited Deepgram Nova-3 streaming subsystem. PA1 consumes the resulting
 * transcript as transient authored text and must not create a second audio/STT
 * transport, credential path, or persistence surface.
 */
export interface ClinicalProposalParser {
  parse(input: ProposalParseInput, signal: AbortSignal): Promise<ProposalParseResult>;
}
